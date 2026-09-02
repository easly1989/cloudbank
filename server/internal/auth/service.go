package auth

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors returned by the service. The HTTP layer maps these to status
// codes; messages are deliberately generic to avoid user enumeration.
var (
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	ErrSetupNotAllowed    = errors.New("auth: setup already completed")
	ErrRateLimited        = errors.New("auth: too many attempts")
	ErrUnauthorized       = errors.New("auth: unauthorized")
	ErrNotFound           = errors.New("auth: not found")
	// ErrTOTPRequired means the password was correct but a second factor is
	// needed to finish logging in.
	ErrTOTPRequired = errors.New("auth: two-factor code required")
	// ErrTOTPEnabled / ErrTOTPNotEnabled guard the enrollment transitions.
	ErrTOTPEnabled    = errors.New("auth: two-factor already enabled")
	ErrTOTPNotEnabled = errors.New("auth: two-factor not enabled")
)

// sessionTTL is the sliding lifetime of a session; each authenticated request
// extends it.
const sessionTTL = 7 * 24 * time.Hour

// User is the public representation of an account — never includes the hash.
type User struct {
	ID               int64
	Username         string
	Email            string
	IsAdmin          bool
	Locale           string
	Theme            string
	Preferences      string // opaque JSON blob of UI preferences
	Disabled         bool
	TwoFactorEnabled bool
	CreatedAt        string
}

func toUser(u db.User) User {
	prefs := u.Preferences
	if prefs == "" {
		prefs = "{}"
	}
	return User{
		ID:               u.ID,
		Username:         u.Username,
		Email:            u.Email,
		IsAdmin:          u.IsAdmin != 0,
		Locale:           u.Locale,
		Theme:            u.Theme,
		Preferences:      prefs,
		Disabled:         u.Disabled != 0,
		TwoFactorEnabled: u.TotpEnabled != 0,
		CreatedAt:        u.CreatedAt,
	}
}

// UpdateSettings updates the current user's locale, theme and preferences blob.
func (s *Service) UpdateSettings(ctx context.Context, userID int64, locale, theme, preferences string) (User, error) {
	if preferences == "" {
		preferences = "{}"
	}
	if err := s.q.UpdateUserSettings(ctx, db.UpdateUserSettingsParams{
		Locale: locale, Theme: theme, Preferences: preferences, ID: userID,
	}); err != nil {
		return User{}, err
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return User{}, err
	}
	return toUser(u), nil
}

// Service implements authentication, the first-run setup, and user management.
type Service struct {
	q       *db.Queries
	limiter *rateLimiter
	now     func() time.Time
}

// NewService builds a Service backed by the given querier.
func NewService(q *db.Queries) *Service {
	return &Service{
		q:       q,
		limiter: newRateLimiter(10, 15*time.Minute),
		now:     time.Now,
	}
}

// NeedsSetup reports whether no users exist yet (first run).
func (s *Service) NeedsSetup(ctx context.Context) (bool, error) {
	n, err := s.q.CountUsers(ctx)
	if err != nil {
		return false, err
	}
	return n == 0, nil
}

// Setup creates the first user as an administrator and opens a session for it.
// It fails with ErrSetupNotAllowed once any user exists.
func (s *Service) Setup(ctx context.Context, username, email, password, userAgent string) (User, string, error) {
	n, err := s.q.CountUsers(ctx)
	if err != nil {
		return User{}, "", err
	}
	if n != 0 {
		return User{}, "", ErrSetupNotAllowed
	}
	u, err := s.createUser(ctx, username, email, password, true)
	if err != nil {
		return User{}, "", err
	}
	token, err := s.openSession(ctx, u.ID, userAgent)
	if err != nil {
		return User{}, "", err
	}
	return toUser(u), token, nil
}

// Login verifies credentials and opens a session. ip scopes the rate limiter.
// When the account has two-factor enabled, a valid totpCode (a TOTP code or a
// one-time recovery code) is also required; an empty code yields
// ErrTOTPRequired after the password is confirmed, so the caller can prompt for
// the second factor.
func (s *Service) Login(ctx context.Context, ip, username, password, totpCode, userAgent string) (User, string, error) {
	key := ip + "|" + username
	if !s.limiter.allow(key) {
		return User{}, "", ErrRateLimited
	}
	u, err := s.q.GetUserByUsername(ctx, username)
	if errors.Is(err, sql.ErrNoRows) {
		s.limiter.record(key)
		return User{}, "", ErrInvalidCredentials
	}
	if err != nil {
		return User{}, "", err
	}
	if u.Disabled != 0 {
		s.limiter.record(key)
		return User{}, "", ErrInvalidCredentials
	}
	ok, err := Verify(u.PasswordHash, password)
	if err != nil {
		return User{}, "", err
	}
	if !ok {
		s.limiter.record(key)
		return User{}, "", ErrInvalidCredentials
	}
	if u.TotpEnabled != 0 {
		if totpCode == "" {
			// Password is correct; the second factor is still needed. This does
			// not consume a rate-limit attempt — the password check passed.
			return User{}, "", ErrTOTPRequired
		}
		valid, err := s.checkSecondFactor(ctx, u, totpCode)
		if err != nil {
			return User{}, "", err
		}
		if !valid {
			s.limiter.record(key)
			return User{}, "", ErrInvalidCredentials
		}
	}
	s.limiter.reset(key)
	token, err := s.openSession(ctx, u.ID, userAgent)
	if err != nil {
		return User{}, "", err
	}
	return toUser(u), token, nil
}

// checkSecondFactor accepts either a current TOTP code or an unused recovery
// code (which it consumes).
func (s *Service) checkSecondFactor(ctx context.Context, u db.User, code string) (bool, error) {
	if verifyTOTP(secrets.Open(u.TotpSecret), code, s.now()) {
		return true, nil
	}
	n, err := s.q.ConsumeRecoveryCode(ctx, db.ConsumeRecoveryCodeParams{
		UserID: u.ID, CodeHash: hashToken(normalizeRecoveryCode(code)),
	})
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Logout revokes the session identified by the given token (a no-op if unknown).
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.q.DeleteSession(ctx, hashToken(token))
}

// Authenticate validates a session token and returns its user, extending the
// session's expiry (sliding window). Expired or unknown tokens yield
// ErrUnauthorized; the expired session is cleaned up.
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrUnauthorized
	}
	id := hashToken(token)
	sess, err := s.q.GetSession(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	if err != nil {
		return User{}, err
	}
	exp, err := time.Parse(time.RFC3339, sess.ExpiresAt)
	if err != nil || !s.now().Before(exp) {
		_ = s.q.DeleteSession(ctx, id)
		return User{}, ErrUnauthorized
	}
	u, err := s.q.GetUserByID(ctx, sess.UserID)
	if err != nil {
		return User{}, err
	}
	if u.Disabled != 0 {
		_ = s.q.DeleteSession(ctx, id)
		return User{}, ErrUnauthorized
	}
	_ = s.q.TouchSession(ctx, db.TouchSessionParams{
		ExpiresAt: s.now().Add(sessionTTL).UTC().Format(time.RFC3339),
		ID:        id,
	})
	return toUser(u), nil
}

// CreateUser creates a new account (admin action).
func (s *Service) CreateUser(ctx context.Context, username, email, password string, isAdmin bool) (User, error) {
	u, err := s.createUser(ctx, username, email, password, isAdmin)
	if err != nil {
		return User{}, err
	}
	return toUser(u), nil
}

// ListUsers returns all accounts.
func (s *Service) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.q.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	users := make([]User, 0, len(rows))
	for _, u := range rows {
		users = append(users, toUser(u))
	}
	return users, nil
}

// SetDisabled enables/disables an account; disabling also revokes its sessions.
func (s *Service) SetDisabled(ctx context.Context, id int64, disabled bool) error {
	var v int64
	if disabled {
		v = 1
	}
	if err := s.q.SetUserDisabled(ctx, db.SetUserDisabledParams{Disabled: v, ID: id}); err != nil {
		return err
	}
	if disabled {
		return s.q.DeleteUserSessions(ctx, id)
	}
	return nil
}

// ResetPassword sets a new password and revokes the user's existing sessions.
func (s *Service) ResetPassword(ctx context.Context, id int64, password string) error {
	hash, err := Hash(password)
	if err != nil {
		return err
	}
	if err := s.q.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{PasswordHash: hash, ID: id}); err != nil {
		return err
	}
	return s.q.DeleteUserSessions(ctx, id)
}

func (s *Service) createUser(ctx context.Context, username, email, password string, isAdmin bool) (db.User, error) {
	hash, err := Hash(password)
	if err != nil {
		return db.User{}, err
	}
	var admin int64
	if isAdmin {
		admin = 1
	}
	return s.q.CreateUser(ctx, db.CreateUserParams{
		Username:     username,
		Email:        email,
		PasswordHash: hash,
		IsAdmin:      admin,
		Locale:       "en",
		Theme:        "auto",
	})
}

// API-token scopes.
const (
	ScopeRead  = "read"  // safe methods only (GET/HEAD)
	ScopeWrite = "write" // all methods
)

// ErrInvalidScope is returned when an API token is created with an unknown scope.
var ErrInvalidScope = errors.New("auth: invalid token scope")

// APIToken is the public representation of a personal access token — never the
// token itself, only its metadata.
type APIToken struct {
	ID         string
	Name       string
	Scope      string
	Prefix     string
	CreatedAt  string
	LastUsedAt string // "" until first use
	ExpiresAt  string // "" = never
}

func toAPIToken(t db.ApiToken) APIToken {
	out := APIToken{
		ID: t.ID, Name: t.Name, Scope: t.Scope, Prefix: t.Prefix, CreatedAt: t.CreatedAt,
	}
	if t.LastUsedAt.Valid {
		out.LastUsedAt = t.LastUsedAt.String
	}
	if t.ExpiresAt.Valid {
		out.ExpiresAt = t.ExpiresAt.String
	}
	return out
}

// CreateAPIToken mints a personal access token for the user and returns its
// metadata plus the plaintext token, which is shown once and never recoverable.
// expiresAt is optional (empty = never expires).
func (s *Service) CreateAPIToken(ctx context.Context, userID int64, name, scope, expiresAt string) (APIToken, string, error) {
	if scope != ScopeRead && scope != ScopeWrite {
		return APIToken{}, "", ErrInvalidScope
	}
	token, id, prefix, err := newAPIToken()
	if err != nil {
		return APIToken{}, "", err
	}
	exp := sql.NullString{}
	if expiresAt != "" {
		exp = sql.NullString{String: expiresAt, Valid: true}
	}
	row, err := s.q.InsertAPIToken(ctx, db.InsertAPITokenParams{
		ID: id, UserID: userID, Name: name, Scope: scope, Prefix: prefix, ExpiresAt: exp,
	})
	if err != nil {
		return APIToken{}, "", err
	}
	return toAPIToken(row), token, nil
}

// ListAPITokens returns the user's tokens (metadata only), newest first.
func (s *Service) ListAPITokens(ctx context.Context, userID int64) ([]APIToken, error) {
	rows, err := s.q.ListAPITokensForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]APIToken, 0, len(rows))
	for _, t := range rows {
		out = append(out, toAPIToken(t))
	}
	return out, nil
}

// RevokeAPIToken deletes one of the user's tokens. Revoking an unknown token (or
// one owned by someone else) yields ErrNotFound.
func (s *Service) RevokeAPIToken(ctx context.Context, userID int64, id string) error {
	n, err := s.q.DeleteAPIToken(ctx, db.DeleteAPITokenParams{ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// AuthenticateToken validates a personal API token and returns its user and
// scope. Unknown, expired, or disabled-owner tokens yield ErrUnauthorized (an
// expired token is deleted). Last-used is recorded on success.
func (s *Service) AuthenticateToken(ctx context.Context, token string) (User, string, error) {
	if token == "" {
		return User{}, "", ErrUnauthorized
	}
	id := hashToken(token)
	t, err := s.q.GetAPIToken(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, "", ErrUnauthorized
	}
	if err != nil {
		return User{}, "", err
	}
	if t.ExpiresAt.Valid {
		exp, perr := time.Parse(time.RFC3339, t.ExpiresAt.String)
		if perr != nil || !s.now().Before(exp) {
			_, _ = s.q.DeleteAPIToken(ctx, db.DeleteAPITokenParams{ID: id, UserID: t.UserID})
			return User{}, "", ErrUnauthorized
		}
	}
	u, err := s.q.GetUserByID(ctx, t.UserID)
	if err != nil {
		return User{}, "", err
	}
	if u.Disabled != 0 {
		return User{}, "", ErrUnauthorized
	}
	_ = s.q.TouchAPIToken(ctx, id)
	return toUser(u), t.Scope, nil
}

// recoveryCodeCount is how many one-time recovery codes are issued at enrollment.
const recoveryCodeCount = 10

// Begin2FASetup generates a fresh TOTP secret (not yet persisted) and the
// otpauth:// provisioning URI for the user to scan. Enable2FA confirms it.
func (s *Service) Begin2FASetup(ctx context.Context, userID int64) (secret, uri string, err error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return "", "", err
	}
	if u.TotpEnabled != 0 {
		return "", "", ErrTOTPEnabled
	}
	secret, err = generateTOTPSecret()
	if err != nil {
		return "", "", err
	}
	return secret, otpauthURI(u.Username, secret), nil
}

// Enable2FA confirms enrollment: it verifies a code against the pending secret,
// persists the secret, turns 2FA on, and returns a fresh set of one-time
// recovery codes (shown once). Any previous recovery codes are replaced.
func (s *Service) Enable2FA(ctx context.Context, userID int64, secret, code string) ([]string, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if u.TotpEnabled != 0 {
		return nil, ErrTOTPEnabled
	}
	if !verifyTOTP(secret, code, s.now()) {
		return nil, ErrInvalidCredentials
	}
	if err := s.q.SetUserTOTP(ctx, db.SetUserTOTPParams{TotpSecret: secrets.Seal(secret), TotpEnabled: 1, ID: userID}); err != nil {
		return nil, err
	}
	if err := s.q.DeleteRecoveryCodes(ctx, userID); err != nil {
		return nil, err
	}
	codes := make([]string, 0, recoveryCodeCount)
	for i := 0; i < recoveryCodeCount; i++ {
		display, canonical, err := newRecoveryCode()
		if err != nil {
			return nil, err
		}
		if err := s.q.InsertRecoveryCode(ctx, db.InsertRecoveryCodeParams{
			UserID: userID, CodeHash: hashToken(canonical),
		}); err != nil {
			return nil, err
		}
		codes = append(codes, display)
	}
	return codes, nil
}

// Disable2FA turns two-factor off after re-authenticating with the password,
// clearing the secret and all recovery codes.
func (s *Service) Disable2FA(ctx context.Context, userID int64, password string) error {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if u.TotpEnabled == 0 {
		return ErrTOTPNotEnabled
	}
	ok, err := Verify(u.PasswordHash, password)
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvalidCredentials
	}
	if err := s.q.ClearUserTOTP(ctx, userID); err != nil {
		return err
	}
	return s.q.DeleteRecoveryCodes(ctx, userID)
}

// RecoveryCodesRemaining reports how many unused recovery codes the user has.
func (s *Service) RecoveryCodesRemaining(ctx context.Context, userID int64) (int64, error) {
	return s.q.CountUnusedRecoveryCodes(ctx, userID)
}

func (s *Service) openSession(ctx context.Context, userID int64, userAgent string) (string, error) {
	token, id, err := newToken()
	if err != nil {
		return "", err
	}
	if err := s.q.CreateSession(ctx, db.CreateSessionParams{
		ID:        id,
		UserID:    userID,
		ExpiresAt: s.now().Add(sessionTTL).UTC().Format(time.RFC3339),
		UserAgent: userAgent,
	}); err != nil {
		return "", err
	}
	return token, nil
}
