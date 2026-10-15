package mailingest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// MicrosoftAuthority is the Microsoft identity platform's common endpoint: it
// takes personal accounts (Outlook.com, Hotmail, Live) and work accounts alike.
const MicrosoftAuthority = "https://login.microsoftonline.com/common/oauth2/v2.0"

// imapScope is the delegated permission to read mail over IMAP. offline_access
// gets a refresh token; openid and profile get the id_token that names the
// mailbox address.
const imapScope = "https://outlook.office.com/IMAP.AccessAsUser.All"

var microsoftScopes = strings.Join([]string{imapScope, "offline_access", "openid", "profile", "email"}, " ")

// ErrReauth means the stored refresh token no longer works (expired, revoked,
// password changed): the user has to sign in to Microsoft again.
var ErrReauth = errors.New("mailingest: microsoft sign-in expired")

// Microsoft talks to the identity platform's device-code flow (RFC 8628) as a
// public client: there is no client secret, only the application id that
// CloudBank is registered under.
type Microsoft struct {
	clientID  string
	authority string
	http      *http.Client
}

// NewMicrosoft builds the client. An empty authority means MicrosoftAuthority;
// tests pass a fake one.
func NewMicrosoft(clientID, authority string, hc *http.Client) *Microsoft {
	if authority == "" {
		authority = MicrosoftAuthority
	}
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Microsoft{clientID: clientID, authority: strings.TrimRight(authority, "/"), http: hc}
}

// DeviceCode is what the user needs to sign in on another device, plus the
// code CloudBank keeps to collect the token. DeviceCode never leaves the
// server.
type DeviceCode struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

// Token is a usable access token, the refresh token that renews it, and the
// mailbox address the id_token names.
type Token struct {
	AccessToken  string
	RefreshToken string
	// ExpiresIn is the access token's lifetime from the moment it was issued.
	ExpiresIn time.Duration
	Email     string
}

// PollState is where a device-code sign-in stands.
type PollState int

// The states of a device-code sign-in.
const (
	PollPending PollState = iota
	PollSlowDown
	PollDeclined
	PollExpired
	PollDone
)

func (s PollState) String() string {
	return [...]string{"pending", "slow_down", "declined", "expired", "done"}[s]
}

// StartDevice asks Microsoft for a user code.
func (m *Microsoft) StartDevice(ctx context.Context) (DeviceCode, error) {
	var dc DeviceCode
	if err := m.post(ctx, "/devicecode", url.Values{"scope": {microsoftScopes}}, &dc); err != nil {
		return DeviceCode{}, err
	}
	if dc.DeviceCode == "" || dc.UserCode == "" {
		return DeviceCode{}, errors.New("mailingest: microsoft returned no device code")
	}
	return dc, nil
}

// PollDevice makes one token request for a pending sign-in. The caller paces
// the calls by the interval Microsoft asked for.
func (m *Microsoft) PollDevice(ctx context.Context, deviceCode string) (PollState, Token, error) {
	tok, code, err := m.token(ctx, url.Values{
		"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
		"device_code": {deviceCode},
	})
	switch code {
	case "":
	case "authorization_pending":
		return PollPending, Token{}, nil
	case "slow_down":
		return PollSlowDown, Token{}, nil
	case "authorization_declined", "access_denied":
		return PollDeclined, Token{}, nil
	case "expired_token", "bad_verification_code":
		return PollExpired, Token{}, nil
	default:
		return PollPending, Token{}, err
	}
	if err != nil {
		return PollPending, Token{}, err
	}
	if tok.RefreshToken == "" {
		return PollPending, Token{}, errors.New("mailingest: microsoft returned no refresh token")
	}
	return PollDone, tok, nil
}

// Refresh trades a refresh token for a fresh access token. Microsoft usually
// rotates the refresh token too; when it does not, the old one stays.
func (m *Microsoft) Refresh(ctx context.Context, refresh string) (Token, error) {
	tok, code, err := m.token(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refresh},
		"scope":         {microsoftScopes},
	})
	switch code {
	case "":
	case "invalid_grant", "interaction_required", "consent_required":
		return Token{}, ErrReauth
	default:
		return Token{}, err
	}
	if err != nil {
		return Token{}, err
	}
	if tok.RefreshToken == "" {
		tok.RefreshToken = refresh
	}
	return tok, nil
}

// token posts to the token endpoint. An OAuth error comes back as its code
// too, so callers can tell "keep waiting" from a failure; the error itself
// carries Microsoft's explanation.
func (m *Microsoft) token(ctx context.Context, form url.Values) (Token, string, error) {
	var body struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		IDToken      string `json:"id_token"`
	}
	if err := m.post(ctx, "/token", form, &body); err != nil {
		var oe *OAuthError
		if errors.As(err, &oe) {
			return Token{}, oe.Code, err
		}
		return Token{}, "", err
	}
	if body.AccessToken == "" {
		return Token{}, "", errors.New("mailingest: microsoft returned no access token")
	}
	return Token{
		AccessToken:  body.AccessToken,
		RefreshToken: body.RefreshToken,
		ExpiresIn:    time.Duration(body.ExpiresIn) * time.Second,
		Email:        emailFromIDToken(body.IDToken),
	}, "", nil
}

// OAuthError is an error Microsoft's identity platform answered with: its
// code, and the explanation it gave.
type OAuthError struct {
	Code        string
	Description string
}

func (e *OAuthError) Error() string {
	d := e.Description
	// Microsoft appends trace and correlation ids; the reader needs the
	// sentence before them.
	if i := strings.Index(d, " Trace ID:"); i >= 0 {
		d = d[:i]
	}
	if d == "" {
		d = e.Code
	}
	return "mailingest: microsoft: " + d
}

// post sends a form to the authority and decodes the JSON answer. An OAuth
// error, a JSON body on a 400 or 401, comes back as an *OAuthError.
func (m *Microsoft) post(ctx context.Context, path string, form url.Values, out any) error {
	form.Set("client_id", m.clientID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.authority+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := m.http.Do(req)
	if err != nil {
		return fmt.Errorf("mailingest: microsoft unreachable: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		var oe struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		if json.Unmarshal(raw, &oe) == nil && oe.Error != "" {
			return &OAuthError{Code: oe.Error, Description: oe.Description}
		}
		return fmt.Errorf("mailingest: microsoft answered %d", resp.StatusCode)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return errors.New("mailingest: microsoft answered with no JSON")
	}
	return nil
}

// emailFromIDToken reads the mailbox address from an id_token's payload. The
// token came straight from Microsoft's token endpoint over TLS, so its
// signature is not checked: it only names the address to log in as, and a
// wrong one simply fails the IMAP login.
func emailFromIDToken(idToken string) string {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		PreferredUsername string `json:"preferred_username"`
		Email             string `json:"email"`
	}
	if json.Unmarshal(raw, &claims) != nil {
		return ""
	}
	if strings.Contains(claims.PreferredUsername, "@") {
		return claims.PreferredUsername
	}
	return claims.Email
}
