package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newTestService(t *testing.T) (*Service, *store.Store) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return NewService(db.New(st.Write())), st
}

func TestSetupThenLogin(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()

	need, err := s.NeedsSetup(ctx)
	if err != nil || !need {
		t.Fatalf("NeedsSetup before setup = %v, %v; want true", need, err)
	}

	admin, token, err := s.Setup(ctx, "admin", "a@example.com", "s3cret-pass", "test")
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if !admin.IsAdmin {
		t.Fatal("first user is not admin")
	}
	if token == "" {
		t.Fatal("Setup returned empty session token")
	}

	// Setup is one-shot.
	if _, _, err := s.Setup(ctx, "second", "", "x", ""); !errors.Is(err, ErrSetupNotAllowed) {
		t.Fatalf("second Setup err = %v; want ErrSetupNotAllowed", err)
	}
	if need, _ := s.NeedsSetup(ctx); need {
		t.Fatal("NeedsSetup still true after setup")
	}

	// The session from Setup authenticates.
	u, err := s.Authenticate(ctx, token)
	if err != nil || u.Username != "admin" {
		t.Fatalf("Authenticate setup token = %v, %v", u, err)
	}

	// Login with the right and wrong password.
	if _, _, err := s.Login(ctx, "1.2.3.4", "admin", "wrong", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("login wrong password err = %v; want ErrInvalidCredentials", err)
	}
	_, tok2, err := s.Login(ctx, "1.2.3.4", "admin", "s3cret-pass", "")
	if err != nil {
		t.Fatalf("login good password: %v", err)
	}
	if _, err := s.Authenticate(ctx, tok2); err != nil {
		t.Fatalf("authenticate login token: %v", err)
	}
}

func TestLogoutRevokesSession(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	_, token, _ := s.Setup(ctx, "admin", "", "password123", "")

	if err := s.Logout(ctx, token); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if _, err := s.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("Authenticate after logout = %v; want ErrUnauthorized", err)
	}
}

func TestSessionSurvivesStoreReopen(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	svc := NewService(db.New(st.Write()))
	_, token, err := svc.Setup(context.Background(), "admin", "", "password123", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	// Simulate a server restart: reopen the same database.
	st2, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	svc2 := NewService(db.New(st2.Write()))
	if _, err := svc2.Authenticate(context.Background(), token); err != nil {
		t.Fatalf("session did not survive reopen: %v", err)
	}
}

func TestDisabledUserCannotLoginOrStayAuthenticated(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	_, _, _ = s.Setup(ctx, "admin", "", "password123", "")

	bob, err := s.CreateUser(ctx, "bob", "bob@example.com", "bobpassword", false)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	_, bobToken, err := s.Login(ctx, "ip", "bob", "bobpassword", "")
	if err != nil {
		t.Fatalf("bob login: %v", err)
	}

	if err := s.SetDisabled(ctx, bob.ID, true); err != nil {
		t.Fatalf("SetDisabled: %v", err)
	}
	// Existing session is revoked.
	if _, err := s.Authenticate(ctx, bobToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("disabled user still authenticated: %v", err)
	}
	// And cannot log in again.
	if _, _, err := s.Login(ctx, "ip", "bob", "bobpassword", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("disabled user login err = %v; want ErrInvalidCredentials", err)
	}
}

func TestLoginRateLimited(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	_, _, _ = s.Setup(ctx, "admin", "", "password123", "")

	// 10 wrong attempts are allowed (and counted), the 11th is rate-limited.
	for i := 0; i < 10; i++ {
		if _, _, err := s.Login(ctx, "9.9.9.9", "admin", "wrong", ""); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("attempt %d err = %v; want ErrInvalidCredentials", i, err)
		}
	}
	if _, _, err := s.Login(ctx, "9.9.9.9", "admin", "wrong", ""); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("11th attempt err = %v; want ErrRateLimited", err)
	}
	// A different IP is unaffected.
	if _, _, err := s.Login(ctx, "8.8.8.8", "admin", "wrong", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("other IP err = %v; want ErrInvalidCredentials", err)
	}
}

func TestExpiredSessionRejected(t *testing.T) {
	s, st := newTestService(t)
	ctx := context.Background()
	_, token, _ := s.Setup(ctx, "admin", "", "password123", "")

	// Force the session to be expired in the past.
	if _, err := st.Write().ExecContext(ctx,
		`UPDATE sessions SET expires_at = ?`, time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expired session err = %v; want ErrUnauthorized", err)
	}
}

func TestAPITokens(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	admin, _, _ := s.Setup(ctx, "admin", "", "password123", "")

	// Create a read and a write token; the plaintext is prefixed and shown once.
	rt, rplain, err := s.CreateAPIToken(ctx, admin.ID, "reader", ScopeRead, "")
	if err != nil {
		t.Fatalf("create read token: %v", err)
	}
	if rt.Scope != ScopeRead || rt.Prefix == "" || !strings.HasPrefix(rplain, "cbp_") {
		t.Fatalf("read token = %+v plain=%q", rt, rplain)
	}
	_, wplain, err := s.CreateAPIToken(ctx, admin.ID, "writer", ScopeWrite, "")
	if err != nil {
		t.Fatalf("create write token: %v", err)
	}

	// Authenticate returns the owning user and the token's scope.
	u, scope, err := s.AuthenticateToken(ctx, rplain)
	if err != nil || u.ID != admin.ID || scope != ScopeRead {
		t.Fatalf("auth read token: u=%d scope=%q err=%v", u.ID, scope, err)
	}
	if _, scope, _ := s.AuthenticateToken(ctx, wplain); scope != ScopeWrite {
		t.Fatalf("write token scope = %q, want write", scope)
	}
	// Unknown token and invalid scope are rejected.
	if _, _, err := s.AuthenticateToken(ctx, "cbp_nope"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("unknown token err = %v, want ErrUnauthorized", err)
	}
	if _, _, err := s.CreateAPIToken(ctx, admin.ID, "x", "admin", ""); !errors.Is(err, ErrInvalidScope) {
		t.Fatalf("invalid scope err = %v, want ErrInvalidScope", err)
	}

	toks, _ := s.ListAPITokens(ctx, admin.ID)
	if len(toks) != 2 {
		t.Fatalf("token count = %d, want 2", len(toks))
	}
	var writerID string
	for _, tk := range toks {
		if tk.Name == "writer" {
			writerID = tk.ID
		}
	}

	// An already-expired token is rejected (and cleaned up).
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	_, eplain, _ := s.CreateAPIToken(ctx, admin.ID, "old", ScopeRead, past)
	if _, _, err := s.AuthenticateToken(ctx, eplain); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expired token err = %v, want ErrUnauthorized", err)
	}

	// Revoke the reader: it stops working; re-revoking is ErrNotFound.
	if err := s.RevokeAPIToken(ctx, admin.ID, rt.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, _, err := s.AuthenticateToken(ctx, rplain); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked token still valid: %v", err)
	}
	if err := s.RevokeAPIToken(ctx, admin.ID, rt.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("re-revoke err = %v, want ErrNotFound", err)
	}

	// Another user cannot revoke someone else's token.
	bob, _ := s.CreateUser(ctx, "bob", "", "bobpassword", false)
	if err := s.RevokeAPIToken(ctx, bob.ID, writerID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-user revoke err = %v, want ErrNotFound", err)
	}
	if _, _, err := s.AuthenticateToken(ctx, wplain); err != nil {
		t.Fatalf("writer token should still be valid: %v", err)
	}
}
