package auth

import (
	"context"
	"errors"
	"testing"
)

func TestUpsertOIDCUser(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	const iss = "https://idp.example.com"

	// 1. Unknown identity with auto-provision off is refused.
	if _, err := s.UpsertOIDCUser(ctx, OIDCClaims{Issuer: iss, Subject: "sub-1", Email: "a@example.com", EmailVerified: true}, false); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("unknown identity (no provision) err = %v; want ErrUnauthorized", err)
	}

	// 2. Auto-provision creates a non-admin user; a repeat login resolves to the
	//    same user through the stored identity link (no provisioning needed).
	u, err := s.UpsertOIDCUser(ctx, OIDCClaims{Issuer: iss, Subject: "sub-1", Email: "a@example.com", EmailVerified: true, Name: "Alice"}, true)
	if err != nil {
		t.Fatalf("auto-provision: %v", err)
	}
	if u.IsAdmin {
		t.Fatal("auto-provisioned user must not be admin")
	}
	u2, err := s.UpsertOIDCUser(ctx, OIDCClaims{Issuer: iss, Subject: "sub-1"}, false)
	if err != nil || u2.ID != u.ID {
		t.Fatalf("repeat login = %+v, %v; want same user id %d", u2, err, u.ID)
	}

	// 3. An existing local account is linked by verified email (no provisioning).
	local, err := s.CreateUser(ctx, "bob", "bob@example.com", "pw-bob-123", false)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	linked, err := s.UpsertOIDCUser(ctx, OIDCClaims{Issuer: iss, Subject: "sub-bob", Email: "bob@example.com", EmailVerified: true}, false)
	if err != nil || linked.ID != local.ID {
		t.Fatalf("email link = %+v, %v; want user id %d", linked, err, local.ID)
	}

	// 4. An unverified email does not link.
	if _, err := s.UpsertOIDCUser(ctx, OIDCClaims{Issuer: iss, Subject: "sub-x", Email: "bob@example.com", EmailVerified: false}, false); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("unverified email err = %v; want ErrUnauthorized", err)
	}

	// 5. An ambiguous email (two matching accounts) is refused rather than guessed.
	if _, err := s.CreateUser(ctx, "carol", "dup@example.com", "pw-carol-1", false); err != nil {
		t.Fatalf("CreateUser carol: %v", err)
	}
	if _, err := s.CreateUser(ctx, "dave", "dup@example.com", "pw-dave-12", false); err != nil {
		t.Fatalf("CreateUser dave: %v", err)
	}
	if _, err := s.UpsertOIDCUser(ctx, OIDCClaims{Issuer: iss, Subject: "sub-dup", Email: "dup@example.com", EmailVerified: true}, false); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("ambiguous email err = %v; want ErrUnauthorized", err)
	}

	// 6. A disabled account (resolved via its identity link) is refused.
	if err := s.SetDisabled(ctx, local.ID, true); err != nil {
		t.Fatalf("SetDisabled: %v", err)
	}
	if _, err := s.UpsertOIDCUser(ctx, OIDCClaims{Issuer: iss, Subject: "sub-bob"}, false); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("disabled account err = %v; want ErrUnauthorized", err)
	}
}
