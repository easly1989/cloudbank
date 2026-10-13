package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// The first SSO sign-in on an empty installation becomes its administrator,
// only under FirstAdmin, and only for AdminEmail when one is set (#620).
func TestOIDCFirstAdmin(t *testing.T) {
	ctx := context.Background()
	const iss = "https://idp.example.com"
	ann := OIDCClaims{Issuer: iss, Subject: "sub-ann", Email: "Ann@Example.com", EmailVerified: true}

	t.Run("without FirstAdmin an empty installation refuses SSO", func(t *testing.T) {
		s, _ := newTestService(t)
		if _, err := s.UpsertOIDCUser(ctx, ann, OIDCPolicy{AutoProvision: true}); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("err = %v; want ErrUnauthorized", err)
		}
		if need, _ := s.NeedsSetup(ctx); !need {
			t.Fatal("a refused sign-in created a user")
		}
	})

	t.Run("AdminEmail keeps everyone else out", func(t *testing.T) {
		s, _ := newTestService(t)
		p := OIDCPolicy{FirstAdmin: true, AdminEmail: "ann@example.com"}
		bob := OIDCClaims{Issuer: iss, Subject: "sub-bob", Email: "bob@example.com", EmailVerified: true}
		if _, err := s.UpsertOIDCUser(ctx, bob, p); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("other email err = %v; want ErrUnauthorized", err)
		}
		unverified := ann
		unverified.EmailVerified = false
		if _, err := s.UpsertOIDCUser(ctx, unverified, p); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("unverified email err = %v; want ErrUnauthorized", err)
		}
		u, err := s.UpsertOIDCUser(ctx, ann, p)
		if err != nil {
			t.Fatalf("admin email (other case): %v", err)
		}
		if !u.IsAdmin || u.Username != "ann" {
			t.Fatalf("first user = %+v; want admin named ann", u)
		}
	})

	t.Run("after the first, sign-ins follow the usual rules", func(t *testing.T) {
		s, _ := newTestService(t)
		p := OIDCPolicy{FirstAdmin: true}
		first, err := s.UpsertOIDCUser(ctx, ann, p)
		if err != nil || !first.IsAdmin {
			t.Fatalf("first = %+v, %v; want an admin", first, err)
		}
		// The same identity again: the same user, still the only one.
		again, err := s.UpsertOIDCUser(ctx, ann, p)
		if err != nil || again.ID != first.ID {
			t.Fatalf("again = %+v, %v; want user %d", again, err, first.ID)
		}
		bob := OIDCClaims{Issuer: iss, Subject: "sub-bob", Email: "bob@example.com", EmailVerified: true}
		if _, err := s.UpsertOIDCUser(ctx, bob, p); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("unknown second identity err = %v; want ErrUnauthorized", err)
		}
		p.AutoProvision = true
		b, err := s.UpsertOIDCUser(ctx, bob, p)
		if err != nil || b.IsAdmin {
			t.Fatalf("auto-provisioned second = %+v, %v; want a non-admin", b, err)
		}
	})

	t.Run("an account created by the admin is matched by email", func(t *testing.T) {
		s, _ := newTestService(t)
		if _, err := s.UpsertOIDCUser(ctx, ann, OIDCPolicy{FirstAdmin: true}); err != nil {
			t.Fatal(err)
		}
		carl, err := s.CreateSSOUser(ctx, "carl", "carl@example.com", false)
		if err != nil {
			t.Fatal(err)
		}
		// Its password is random: nobody can sign in with one.
		if _, _, err := s.Login(ctx, "1.2.3.4", "carl", "", "", ""); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("password login err = %v; want ErrInvalidCredentials", err)
		}
		u, err := s.UpsertOIDCUser(ctx, OIDCClaims{Issuer: iss, Subject: "sub-carl", Email: "carl@example.com", EmailVerified: true}, OIDCPolicy{FirstAdmin: true})
		if err != nil || u.ID != carl.ID {
			t.Fatalf("carl = %+v, %v; want user %d", u, err, carl.ID)
		}
	})
}

// Access recovery codes let a user in once each; new ones void the old (#620).
func TestAccessCodes(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	u, err := s.CreateSSOUser(ctx, "ann", "ann@example.com", true)
	if err != nil {
		t.Fatal(err)
	}

	if n, _ := s.AccessCodesRemaining(ctx, u.ID); n != 0 {
		t.Fatalf("remaining before any = %d; want 0", n)
	}
	codes, err := s.NewAccessCodes(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != recoveryCodeCount {
		t.Fatalf("got %d codes; want %d", len(codes), recoveryCodeCount)
	}

	got, token, left, err := s.LoginWithAccessCode(ctx, "1.2.3.4", "ann", codes[0], "test")
	if err != nil {
		t.Fatalf("login with a code: %v", err)
	}
	if got.ID != u.ID || left != recoveryCodeCount-1 {
		t.Fatalf("login = user %d, %d left; want user %d, %d left", got.ID, left, u.ID, recoveryCodeCount-1)
	}
	if _, err := s.Authenticate(ctx, token); err != nil {
		t.Fatalf("the code's session does not authenticate: %v", err)
	}
	// Used once, gone.
	if _, _, _, err := s.LoginWithAccessCode(ctx, "1.2.3.4", "ann", codes[0], "test"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("reused code err = %v; want ErrInvalidCredentials", err)
	}
	// Typed without dashes and in lower case, as someone might.
	loose := strings.ToLower(strings.ReplaceAll(codes[1], "-", ""))
	if _, _, _, err := s.LoginWithAccessCode(ctx, "1.2.3.4", "ann", " "+loose+" ", "test"); err != nil {
		t.Fatalf("code typed loosely: %v", err)
	}
	// The 2FA recovery codes are a different set.
	if _, _, err := s.Login(ctx, "1.2.3.4", "ann", "x", codes[2], ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("access code as password-login factor err = %v; want ErrInvalidCredentials", err)
	}

	// New codes void the old ones.
	fresh, err := s.NewAccessCodes(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := s.LoginWithAccessCode(ctx, "1.2.3.4", "ann", codes[2], "test"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("old code after renewal err = %v; want ErrInvalidCredentials", err)
	}
	if n, _ := s.AccessCodesRemaining(ctx, u.ID); n != recoveryCodeCount {
		t.Fatalf("remaining after renewal = %d; want %d", n, recoveryCodeCount)
	}

	// A disabled account stays out, whatever the code.
	if err := s.SetDisabled(ctx, u.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := s.LoginWithAccessCode(ctx, "1.2.3.4", "ann", fresh[0], "test"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("disabled account err = %v; want ErrInvalidCredentials", err)
	}
}

// Guessing codes runs into the same limit as guessing passwords.
func TestAccessCodesRateLimited(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	u, err := s.CreateSSOUser(ctx, "ann", "ann@example.com", false)
	if err != nil {
		t.Fatal(err)
	}
	codes, err := s.NewAccessCodes(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		if _, _, _, err := s.LoginWithAccessCode(ctx, "1.2.3.4", "ann", "zzzz-zzzz", ""); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("guess %d err = %v; want ErrInvalidCredentials", i, err)
		}
	}
	if _, _, _, err := s.LoginWithAccessCode(ctx, "1.2.3.4", "ann", codes[0], ""); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("after ten guesses err = %v; want ErrRateLimited", err)
	}
	// The limit is keyed apart from the password login's.
	if _, _, err := s.Login(ctx, "1.2.3.4", "ann", "wrong", "", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("password login err = %v; want ErrInvalidCredentials", err)
	}
}
