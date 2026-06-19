package auth

import (
	"context"
	"database/sql"
	"errors"
	"time"

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
)

// sessionTTL is the sliding lifetime of a session; each authenticated request
// extends it.
const sessionTTL = 7 * 24 * time.Hour

// User is the public representation of an account — never includes the hash.
type User struct {
	ID          int64
	Username    string
	Email       string
	IsAdmin     bool
	Locale      string
	Theme       string
	Preferences string // opaque JSON blob of UI preferences
	Disabled    bool
	CreatedAt   string
}

func toUser(u db.User) User {
	prefs := u.Preferences
	if prefs == "" {
		prefs = "{}"
	}
	return User{
		ID:          u.ID,
		Username:    u.Username,
		Email:       u.Email,
		IsAdmin:     u.IsAdmin != 0,
		Locale:      u.Locale,
		Theme:       u.Theme,
		Preferences: prefs,
		Disabled:    u.Disabled != 0,
		CreatedAt:   u.CreatedAt,
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
func (s *Service) Login(ctx context.Context, ip, username, password, userAgent string) (User, string, error) {
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
	s.limiter.reset(key)
	token, err := s.openSession(ctx, u.ID, userAgent)
	if err != nil {
		return User{}, "", err
	}
	return toUser(u), token, nil
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
