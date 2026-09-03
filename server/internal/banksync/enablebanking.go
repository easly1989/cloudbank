package banksync

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// Enable Banking (https://enablebanking.com) is an EU/PSD2 open-banking provider.
// CloudBank talks to it on behalf of the user's own registered application: every
// request carries a JWT (RS256, kid = application id) signed with the app's RSA
// private key. The flow is OAuth-style: list ASPSPs, start an authorization
// (redirect the user to their bank), exchange the returned code for a session,
// then read the session's accounts, balances and transactions.

const enableBankingDefaultBase = "https://api.enablebanking.com"

// ebBaseURL is the API root. CB_ENABLEBANKING_BASE_URL overrides it so the flow
// can be exercised against a local protocol stub in tests / manual verification.
func ebBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("CB_ENABLEBANKING_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return enableBankingDefaultBase
}

// Enable Banking sentinel errors.
var (
	ErrEBNotConfigured  = errors.New("banksync: enable banking is not configured for this wallet")
	ErrEBConsentExpired = errors.New("banksync: bank consent expired — reconnect the bank")
)

type enableBankingClient struct {
	hc    httpDoer
	appID string
	key   *rsa.PrivateKey

	mu          sync.Mutex
	cachedToken string
	tokenExp    time.Time
}

// newEnableBankingClient parses the PEM private key and builds a client. hc nil =
// a default HTTP client.
func newEnableBankingClient(hc httpDoer, appID, privateKeyPEM string) (*enableBankingClient, error) {
	key, err := parseRSAPrivateKey(privateKeyPEM)
	if err != nil {
		return nil, ErrInvalid
	}
	if strings.TrimSpace(appID) == "" {
		return nil, ErrInvalid
	}
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &enableBankingClient{hc: hc, appID: strings.TrimSpace(appID), key: key}, nil
}

// parseRSAPrivateKey accepts a PKCS#1 or PKCS#8 PEM-encoded RSA private key.
func parseRSAPrivateKey(pemStr string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(pemStr)))
	if block == nil {
		return nil, errors.New("no PEM block found")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("PEM key is not RSA")
	}
	return rk, nil
}

func base64URL(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// randToken returns a URL-safe random string, used for the OAuth state.
func randToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64URL(b), nil
}

// token returns a signed JWT, cached and reused until shortly before it expires
// (the token is valid for an hour), so a multi-request sync signs once, not per call.
func (c *enableBankingClient) token() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cachedToken != "" && time.Now().Before(c.tokenExp.Add(-5*time.Minute)) {
		return c.cachedToken, nil
	}
	now := time.Now()
	t, err := c.jwt(now)
	if err != nil {
		return "", err
	}
	c.cachedToken = t
	c.tokenExp = now.Add(time.Hour)
	return t, nil
}

// jwt builds and signs the bearer token Enable Banking expects.
func (c *enableBankingClient) jwt(now time.Time) (string, error) {
	header := map[string]string{"typ": "JWT", "alg": "RS256", "kid": c.appID}
	payload := map[string]any{
		"iss": "enablebanking.com",
		"aud": "api.enablebanking.com",
		"iat": now.Unix(),
		"exp": now.Add(time.Hour).Unix(),
	}
	hb, _ := json.Marshal(header)
	pb, _ := json.Marshal(payload)
	signingInput := base64URL(hb) + "." + base64URL(pb)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, c.key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return signingInput + "." + base64URL(sig), nil
}

// do performs an authenticated request. out may be nil. A 401/403/422 on an
// account-data call (a live session/consent problem) surfaces as
// ErrEBConsentExpired so the UI can prompt a reconnect; the same status on a
// setup-time call (aspsps/auth/sessions) stays a generic error so a wrong
// app id / key is not mislabelled as an expired consent.
func (c *enableBankingClient) do(ctx context.Context, method, path string, body, out any) error {
	tok, err := c.token()
	if err != nil {
		return err
	}
	var rd io.Reader
	if body != nil {
		b, mErr := json.Marshal(body)
		if mErr != nil {
			return mErr
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, ebBaseURL()+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		accountData := strings.Contains(path, "/accounts/")
		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity:
			if accountData {
				return fmt.Errorf("%w (%d: %s)", ErrEBConsentExpired, resp.StatusCode, strings.TrimSpace(string(msg)))
			}
			return fmt.Errorf("banksync: enable banking rejected the request (%d: %s) — check the application id and key", resp.StatusCode, strings.TrimSpace(string(msg)))
		default:
			return fmt.Errorf("banksync: enable banking returned %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
		}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out)
}

// --- API payload types (documented Enable Banking schema) ---

type ebASPSP struct {
	Name    string `json:"name"`
	Country string `json:"country"`
	Logo    string `json:"logo,omitempty"`
}

type ebASPSPList struct {
	Aspsps []ebASPSP `json:"aspsps"`
}

type ebAuthResp struct {
	URL             string `json:"url"`
	AuthorizationID string `json:"authorization_id"`
}

// ebOtherID is Enable Banking's non-IBAN account identifier — the "other" branch
// of account_id, returned as an object (not a string). Card / non-IBAN accounts
// (e.g. a CPAN) use this instead of an IBAN.
type ebOtherID struct {
	Identification string `json:"identification,omitempty"`
	SchemeName     string `json:"scheme_name,omitempty"`
	Issuer         string `json:"issuer,omitempty"`
}

// ebAccountID carries the account's human identifier: an IBAN, or an "other"
// identification object for accounts without one.
type ebAccountID struct {
	IBAN  string    `json:"iban,omitempty"`
	Other ebOtherID `json:"other,omitempty"`
}

type ebAccount struct {
	UID       string      `json:"uid"`
	Name      string      `json:"name,omitempty"`
	Currency  string      `json:"currency,omitempty"`
	Product   string      `json:"product,omitempty"`
	AccountID ebAccountID `json:"account_id"`
}

// identifier returns the account's IBAN, or its "other" identification (e.g. a
// masked card PAN) when there is no IBAN.
func (a ebAccount) identifier() string {
	if a.AccountID.IBAN != "" {
		return a.AccountID.IBAN
	}
	return a.AccountID.Other.Identification
}

// label is a human name for the account, falling back to its identifier.
func (a ebAccount) label() string {
	switch {
	case strings.TrimSpace(a.Name) != "":
		return a.Name
	case a.identifier() != "":
		return a.identifier()
	case a.Product != "":
		return a.Product
	default:
		return a.UID
	}
}

type ebAccess struct {
	ValidUntil string `json:"valid_until,omitempty"`
}

// ebSession is the POST /sessions response, whose accounts are full objects.
// (GET /sessions/{id} returns only uid strings, so its accounts are captured
// here at connect time and persisted instead.)
type ebSession struct {
	SessionID string      `json:"session_id"`
	Accounts  []ebAccount `json:"accounts"`
	Access    ebAccess    `json:"access"`
	Aspsp     ebASPSP     `json:"aspsp"`
}

type ebAmount struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency,omitempty"`
}

type ebBalance struct {
	BalanceAmount ebAmount `json:"balance_amount"`
	BalanceType   string   `json:"balance_type,omitempty"`
}

type ebBalances struct {
	Balances []ebBalance `json:"balances"`
}

type ebTxn struct {
	EntryReference        string   `json:"entry_reference,omitempty"`
	TransactionID         string   `json:"transaction_id,omitempty"`
	TransactionAmount     ebAmount `json:"transaction_amount"`
	CreditDebitIndicator  string   `json:"credit_debit_indicator,omitempty"` // CRDT | DBIT
	Status                string   `json:"status,omitempty"`                 // BOOK | PDNG
	BookingDate           string   `json:"booking_date,omitempty"`
	ValueDate             string   `json:"value_date,omitempty"`
	TransactionDate       string   `json:"transaction_date,omitempty"`
	RemittanceInformation []string `json:"remittance_information,omitempty"`
}

type ebTxnPage struct {
	Transactions    []ebTxn `json:"transactions"`
	ContinuationKey string  `json:"continuation_key,omitempty"`
}

// --- API calls ---

func (c *enableBankingClient) listASPSPs(ctx context.Context, country string) ([]ebASPSP, error) {
	path := "/aspsps"
	if s := strings.TrimSpace(country); s != "" {
		path += "?country=" + url.QueryEscape(strings.ToUpper(s))
	}
	var out ebASPSPList
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out.Aspsps, nil
}

// startAuth begins an authorization and returns the bank redirect URL. validUntil
// is the requested consent expiry.
func (c *enableBankingClient) startAuth(ctx context.Context, aspspName, aspspCountry, redirectURL, state string, validUntil time.Time) (ebAuthResp, error) {
	body := map[string]any{
		"access":       map[string]any{"valid_until": validUntil.UTC().Format(time.RFC3339)},
		"aspsp":        map[string]any{"name": aspspName, "country": strings.ToUpper(aspspCountry)},
		"state":        state,
		"redirect_url": redirectURL,
		"psu_type":     "personal",
	}
	var out ebAuthResp
	if err := c.do(ctx, http.MethodPost, "/auth", body, &out); err != nil {
		return ebAuthResp{}, err
	}
	return out, nil
}

// createSession exchanges the redirect code for a session with its accounts.
func (c *enableBankingClient) createSession(ctx context.Context, code string) (ebSession, error) {
	var out ebSession
	if err := c.do(ctx, http.MethodPost, "/sessions", map[string]any{"code": code}, &out); err != nil {
		return ebSession{}, err
	}
	return out, nil
}

// deleteSession revokes the bank consent (best-effort on removal).
func (c *enableBankingClient) deleteSession(ctx context.Context, sessionID string) error {
	return c.do(ctx, http.MethodDelete, "/sessions/"+url.PathEscape(sessionID), nil, nil)
}

// balance returns a representative balance string for an account, or "".
func (c *enableBankingClient) balance(ctx context.Context, accountUID string) (string, string) {
	var out ebBalances
	if err := c.do(ctx, http.MethodGet, "/accounts/"+url.PathEscape(accountUID)+"/balances", nil, &out); err != nil {
		return "", ""
	}
	if len(out.Balances) == 0 {
		return "", ""
	}
	// Prefer a closing/interim booked balance; otherwise the first one.
	for _, want := range []string{"CLBD", "ITBD", "XPCD"} {
		for _, b := range out.Balances {
			if b.BalanceType == want {
				return b.BalanceAmount.Amount, b.BalanceAmount.Currency
			}
		}
	}
	return out.Balances[0].BalanceAmount.Amount, out.Balances[0].BalanceAmount.Currency
}

// transactions fetches all transactions for an account since dateFrom, following
// continuation keys.
func (c *enableBankingClient) transactions(ctx context.Context, accountUID string, dateFrom time.Time) ([]ebTxn, error) {
	base := "/accounts/" + url.PathEscape(accountUID) + "/transactions"
	q := url.Values{}
	if !dateFrom.IsZero() {
		q.Set("date_from", dateFrom.UTC().Format("2006-01-02"))
	}
	var all []ebTxn
	for page := 0; page < 100; page++ { // hard cap against a misbehaving provider
		path := base
		if enc := q.Encode(); enc != "" {
			path += "?" + enc
		}
		var out ebTxnPage
		if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
			return nil, err
		}
		all = append(all, out.Transactions...)
		if out.ContinuationKey == "" {
			break
		}
		q.Set("continuation_key", out.ContinuationKey)
	}
	return all, nil
}

// signedAmount turns Enable Banking's unsigned amount + indicator into a signed
// decimal string (negative = debit), matching CloudBank's convention.
func (t ebTxn) signedAmount() string {
	amt := strings.TrimSpace(t.TransactionAmount.Amount)
	if amt == "" {
		return ""
	}
	neg := strings.HasPrefix(amt, "-")
	amt = strings.TrimPrefix(amt, "-")
	if strings.EqualFold(t.CreditDebitIndicator, "DBIT") {
		neg = true
	} else if strings.EqualFold(t.CreditDebitIndicator, "CRDT") {
		neg = false
	}
	if neg {
		return "-" + amt
	}
	return amt
}

// date returns the best available date for the ledger row (YYYY-MM-DD),
// preferring the booking date.
func (t ebTxn) date() string {
	for _, d := range []string{t.BookingDate, t.ValueDate, t.TransactionDate} {
		if len(d) >= 10 {
			return d[:10]
		}
	}
	return ""
}

// dedupID is a stable per-transaction key. Enable Banking does not guarantee a
// unique id across ASPSPs, so fall back to a hash of stable fields. The hash uses
// the value/transaction date (not the booking date, which changes when a pending
// transaction later books) so a pending row and its booked form share a key.
func (t ebTxn) dedupID() string {
	if s := strings.TrimSpace(t.EntryReference); s != "" {
		return s
	}
	if s := strings.TrimSpace(t.TransactionID); s != "" {
		return s
	}
	hashDate := ""
	for _, d := range []string{t.ValueDate, t.TransactionDate, t.BookingDate} {
		if len(d) >= 10 {
			hashDate = d[:10]
			break
		}
	}
	sum := sha256.Sum256([]byte(hashDate + "|" + t.signedAmount() + "|" + strings.Join(t.RemittanceInformation, " ")))
	return "h" + base64URL(sum[:12])
}

func (t ebTxn) memo() string {
	if len(t.RemittanceInformation) > 0 {
		return strings.TrimSpace(strings.Join(t.RemittanceInformation, " "))
	}
	return ""
}
