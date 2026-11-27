package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Passkeys (#798) sign a user in without the password and without the TOTP
// code: every ceremony requires user verification, so the device has already
// checked the person with a fingerprint, a face or a PIN.

const (
	// MaxPasskeys is how many passkeys one user can have.
	MaxPasskeys = 10
	// passkeyRecent is how old a sign-in can be for its session to add a
	// passkey, so a computer left signed in cannot be given one more way in.
	passkeyRecent = 10 * time.Minute
	// ceremonyTTL bounds a challenge between begin and finish. The login page
	// asks for one as it opens and the browser offers the passkey whenever the
	// user gets to the username field, so it is generous.
	ceremonyTTL = 10 * time.Minute
	// ceremonyCap bounds the challenges held at once: the login one is public.
	ceremonyCap = 4096
	// passkeyNameMax is the longest name a passkey keeps, in characters.
	passkeyNameMax = 60
)

var (
	// ErrReauthRequired: the session is older than passkeyRecent.
	ErrReauthRequired = errors.New("auth: sign in again to add a passkey")
	// ErrPasskeyLimit: the user already has MaxPasskeys.
	ErrPasskeyLimit = errors.New("auth: passkey limit reached")
	// ErrPasskeyRejected: the browser's answer to an add did not verify, or
	// its challenge expired.
	ErrPasskeyRejected = errors.New("auth: passkey not accepted")
)

// RelyingParty is where a ceremony runs: the page's origin and its host, the
// WebAuthn relying party ID. A passkey made on one host signs in only there.
type RelyingParty struct {
	ID     string
	Origin string
}

// Passkey is a passkey as its owner sees it.
type Passkey struct {
	ID         int64
	Name       string
	CreatedAt  string
	LastUsedAt string
}

// passkeyUser adapts an account to the library's User.
type passkeyUser struct {
	id     int64
	handle []byte
	name   string
	rows   []db.Passkey
	creds  []webauthn.Credential
}

func (u *passkeyUser) WebAuthnID() []byte                         { return u.handle }
func (u *passkeyUser) WebAuthnName() string                       { return u.name }
func (u *passkeyUser) WebAuthnDisplayName() string                { return u.name }
func (u *passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func newRelyingParty(rp RelyingParty) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{
		RPID:          rp.ID,
		RPDisplayName: "CloudBank",
		RPOrigins:     []string{rp.Origin},
	})
}

// loadPasskeyUser reads the user's passkeys made on rp. handle is the user's
// handle, or a new random one when they have no passkey yet.
func (s *Service) loadPasskeyUser(ctx context.Context, userID int64, rpID string) (*passkeyUser, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	handle, err := s.q.GetPasskeyUserHandle(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		handle = make([]byte, 32)
		_, err = rand.Read(handle)
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListPasskeysByHandle(ctx, db.ListPasskeysByHandleParams{UserHandle: handle, RpID: rpID})
	if err != nil {
		return nil, err
	}
	return newPasskeyUser(u, handle, rows)
}

func newPasskeyUser(u db.User, handle []byte, rows []db.Passkey) (*passkeyUser, error) {
	pu := &passkeyUser{id: u.ID, handle: handle, name: u.Username, rows: rows}
	for _, r := range rows {
		var c webauthn.Credential
		if err := json.Unmarshal([]byte(r.Credential), &c); err != nil {
			return nil, err
		}
		pu.creds = append(pu.creds, c)
	}
	return pu, nil
}

// signedInRecently reports ErrReauthRequired when the session behind token
// was opened more than passkeyRecent ago.
func (s *Service) signedInRecently(ctx context.Context, token string) error {
	sess, err := s.q.GetSession(ctx, hashToken(token))
	if err != nil {
		return ErrUnauthorized
	}
	at, err := time.Parse(time.RFC3339, sess.CreatedAt)
	if err != nil || s.now().Sub(at) > passkeyRecent {
		return ErrReauthRequired
	}
	return nil
}

// BeginPasskeyAdd starts adding a passkey for the user of the session token
// and returns the options for navigator.credentials.create.
func (s *Service) BeginPasskeyAdd(ctx context.Context, userID int64, token string, rp RelyingParty) (*protocol.CredentialCreation, error) {
	if err := s.signedInRecently(ctx, token); err != nil {
		return nil, err
	}
	n, err := s.q.CountPasskeys(ctx, userID)
	if err != nil {
		return nil, err
	}
	if n >= MaxPasskeys {
		return nil, ErrPasskeyLimit
	}
	wa, err := newRelyingParty(rp)
	if err != nil {
		return nil, err
	}
	pu, err := s.loadPasskeyUser(ctx, userID, rp.ID)
	if err != nil {
		return nil, err
	}
	exclude := make([]protocol.CredentialDescriptor, 0, len(pu.creds))
	for i := range pu.creds {
		exclude = append(exclude, pu.creds[i].Descriptor())
	}
	opts, data, err := wa.BeginRegistration(pu,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			RequireResidentKey: protocol.ResidentKeyRequired(),
			UserVerification:   protocol.VerificationRequired,
		}),
		webauthn.WithExclusions(exclude),
	)
	if err != nil {
		return nil, err
	}
	s.ceremonies.put(addKey(userID), ceremony{data: *data, rp: rp, userID: userID, expires: s.now().Add(ceremonyTTL)}, s.now())
	return opts, nil
}

// FinishPasskeyAdd checks the browser's answer to BeginPasskeyAdd and stores
// the passkey under name.
func (s *Service) FinishPasskeyAdd(ctx context.Context, userID int64, token, name string, response []byte) (Passkey, error) {
	if err := s.signedInRecently(ctx, token); err != nil {
		return Passkey{}, err
	}
	c, ok := s.ceremonies.take(addKey(userID), s.now())
	if !ok {
		return Passkey{}, ErrPasskeyRejected
	}
	n, err := s.q.CountPasskeys(ctx, userID)
	if err != nil {
		return Passkey{}, err
	}
	if n >= MaxPasskeys {
		return Passkey{}, ErrPasskeyLimit
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
	if err != nil {
		return Passkey{}, ErrPasskeyRejected
	}
	wa, err := newRelyingParty(c.rp)
	if err != nil {
		return Passkey{}, err
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return Passkey{}, err
	}
	pu := &passkeyUser{id: userID, handle: c.data.UserID, name: u.Username}
	cred, err := wa.CreateCredential(pu, c.data, parsed)
	if err != nil {
		return Passkey{}, ErrPasskeyRejected
	}
	raw, err := json.Marshal(cred)
	if err != nil {
		return Passkey{}, err
	}
	row, err := s.q.CreatePasskey(ctx, db.CreatePasskeyParams{
		UserID: userID, CredentialID: cred.ID, UserHandle: c.data.UserID, RpID: c.rp.ID,
		Name: cleanPasskeyName(name), Credential: string(raw), CreatedAt: s.now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return Passkey{}, ErrPasskeyRejected
		}
		return Passkey{}, err
	}
	return toPasskey(row), nil
}

// BeginPasskeyLogin starts a sign-in with any passkey made on rp. The key
// comes back with the browser's answer to FinishPasskeyLogin.
func (s *Service) BeginPasskeyLogin(rp RelyingParty) (opts *protocol.CredentialAssertion, key string, err error) {
	wa, err := newRelyingParty(rp)
	if err != nil {
		return nil, "", err
	}
	opts, data, err := wa.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		return nil, "", err
	}
	key, _, err = newToken()
	if err != nil {
		return nil, "", err
	}
	s.ceremonies.put("login:"+key, ceremony{data: *data, rp: rp, expires: s.now().Add(ceremonyTTL)}, s.now())
	return opts, key, nil
}

// FinishPasskeyLogin checks the browser's answer to BeginPasskeyLogin and
// opens a session for the passkey's owner. Every failure is
// ErrInvalidCredentials, a disabled account included.
func (s *Service) FinishPasskeyLogin(ctx context.Context, ip, key string, response []byte, userAgent string) (User, string, error) {
	limit := "passkey|" + ip
	if !s.limiter.allow(limit) {
		return User{}, "", ErrRateLimited
	}
	fail := func() (User, string, error) {
		s.limiter.record(limit)
		return User{}, "", ErrInvalidCredentials
	}
	c, ok := s.ceremonies.take("login:"+key, s.now())
	if !ok {
		return fail()
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return fail()
	}
	wa, err := newRelyingParty(c.rp)
	if err != nil {
		return User{}, "", err
	}
	var owner db.User
	find := func(_, userHandle []byte) (webauthn.User, error) {
		rows, err := s.q.ListPasskeysByHandle(ctx, db.ListPasskeysByHandleParams{UserHandle: userHandle, RpID: c.rp.ID})
		if err != nil || len(rows) == 0 {
			return nil, ErrInvalidCredentials
		}
		owner, err = s.q.GetUserByID(ctx, rows[0].UserID)
		if err != nil || owner.Disabled != 0 {
			return nil, ErrInvalidCredentials
		}
		return newPasskeyUser(owner, userHandle, rows)
	}
	wu, cred, err := wa.ValidatePasskeyLogin(find, c.data, parsed)
	if err != nil {
		return fail()
	}
	pu := wu.(*passkeyUser)
	for _, r := range pu.rows {
		if string(r.CredentialID) != string(cred.ID) {
			continue
		}
		raw, err := json.Marshal(cred)
		if err != nil {
			return User{}, "", err
		}
		// The sign count and the backup flags move on with every use; the next
		// sign-in compares against these.
		if err := s.q.UpdatePasskeyUse(ctx, db.UpdatePasskeyUseParams{
			Credential: string(raw), LastUsedAt: s.now().UTC().Format(time.RFC3339), ID: r.ID,
		}); err != nil {
			return User{}, "", err
		}
	}
	s.limiter.reset(limit)
	token, err := s.openSession(ctx, owner.ID, userAgent)
	if err != nil {
		return User{}, "", err
	}
	return toUser(owner), token, nil
}

// ListPasskeys returns the user's passkeys, oldest first.
func (s *Service) ListPasskeys(ctx context.Context, userID int64) ([]Passkey, error) {
	rows, err := s.q.ListPasskeys(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Passkey, 0, len(rows))
	for _, r := range rows {
		out = append(out, toPasskey(r))
	}
	return out, nil
}

// RenamePasskey renames one of the user's passkeys.
func (s *Service) RenamePasskey(ctx context.Context, userID, id int64, name string) error {
	n, err := s.q.RenamePasskey(ctx, db.RenamePasskeyParams{Name: cleanPasskeyName(name), ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeletePasskey removes one of the user's passkeys.
func (s *Service) DeletePasskey(ctx context.Context, userID, id int64) error {
	n, err := s.q.DeletePasskey(ctx, db.DeletePasskeyParams{ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteUserPasskeys removes every passkey of a user (admin action) and
// returns how many there were.
func (s *Service) DeleteUserPasskeys(ctx context.Context, userID int64) (int64, error) {
	return s.q.DeleteUserPasskeys(ctx, userID)
}

// PasskeyCounts returns how many passkeys each user has; users without one
// are missing.
func (s *Service) PasskeyCounts(ctx context.Context) (map[int64]int64, error) {
	rows, err := s.q.CountPasskeysByUser(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]int64, len(rows))
	for _, r := range rows {
		out[r.UserID] = r.N
	}
	return out, nil
}

func toPasskey(r db.Passkey) Passkey {
	return Passkey{ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt, LastUsedAt: r.LastUsedAt}
}

// cleanPasskeyName trims the name and cuts it to passkeyNameMax characters;
// an empty one becomes "Passkey".
func cleanPasskeyName(name string) string {
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > passkeyNameMax {
		name = strings.TrimSpace(string([]rune(name)[:passkeyNameMax]))
	}
	if name == "" {
		return "Passkey"
	}
	return name
}

func addKey(userID int64) string { return "add:" + strconv.FormatInt(userID, 10) }

// ceremony is one challenge waiting for the browser's answer.
type ceremony struct {
	data    webauthn.SessionData
	rp      RelyingParty
	userID  int64
	expires time.Time
}

// ceremonyStore keeps the challenges in memory: one container, and a restart
// only costs the user one more tap.
type ceremonyStore struct {
	mu sync.Mutex
	m  map[string]ceremony
}

func newCeremonyStore() *ceremonyStore { return &ceremonyStore{m: map[string]ceremony{}} }

func (c *ceremonyStore) put(key string, v ceremony, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) >= ceremonyCap {
		for k, e := range c.m {
			if now.After(e.expires) {
				delete(c.m, k)
			}
		}
		for k := range c.m {
			if len(c.m) < ceremonyCap {
				break
			}
			delete(c.m, k)
		}
	}
	c.m[key] = v
}

// take returns the ceremony under key once: a challenge is good for one answer.
func (c *ceremonyStore) take(key string, now time.Time) (ceremony, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.m[key]
	delete(c.m, key)
	if !ok || now.After(v.expires) {
		return ceremony{}, false
	}
	return v, true
}
