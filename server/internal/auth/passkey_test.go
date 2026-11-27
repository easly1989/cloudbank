package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/go-webauthn/webauthn/protocol"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// softKey is a software passkey: what a phone or a password manager does when
// the browser asks it to create a credential or sign a challenge.
type softKey struct {
	t      *testing.T
	priv   *ecdsa.PrivateKey
	id     []byte
	handle []byte
	count  uint32
}

var b64 = base64.RawURLEncoding

func newSoftKey(t *testing.T) *softKey {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return &softKey{t: t, priv: priv, id: id}
}

// authData is the authenticator data for rpID; with attested it carries the
// new credential's public key.
func (k *softKey) authData(rpID string, attested bool) []byte {
	k.t.Helper()
	h := sha256.Sum256([]byte(rpID))
	// User present, user verified, backup eligible and backed up: a synced passkey.
	flags := byte(0x01 | 0x04 | 0x08 | 0x10)
	if attested {
		flags |= 0x40
	}
	k.count++
	out := append(h[:], flags)
	out = binary.BigEndian.AppendUint32(out, k.count)
	if attested {
		out = append(out, make([]byte, 16)...) // AAGUID
		out = binary.BigEndian.AppendUint16(out, uint16(len(k.id)))
		out = append(out, k.id...)
		pub, err := cbor.Marshal(map[int]any{
			1: 2, 3: -7, -1: 1,
			-2: k.priv.X.FillBytes(make([]byte, 32)),
			-3: k.priv.Y.FillBytes(make([]byte, 32)),
		})
		if err != nil {
			k.t.Fatal(err)
		}
		out = append(out, pub...)
	}
	return out
}

func clientData(kind string, challenge []byte, origin string) []byte {
	b, _ := json.Marshal(map[string]any{"type": kind, "challenge": b64.EncodeToString(challenge), "origin": origin, "crossOrigin": false})
	return b
}

// create answers navigator.credentials.create.
func (k *softKey) create(opts *protocol.CredentialCreation, rpID, origin string) []byte {
	k.t.Helper()
	k.handle = []byte(opts.Response.User.ID.(protocol.URLEncodedBase64))
	att, err := cbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": k.authData(rpID, true)})
	if err != nil {
		k.t.Fatal(err)
	}
	b, _ := json.Marshal(map[string]any{
		"id": b64.EncodeToString(k.id), "rawId": b64.EncodeToString(k.id), "type": "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64.EncodeToString(clientData("webauthn.create", opts.Response.Challenge, origin)),
			"attestationObject": b64.EncodeToString(att),
			"transports":        []string{"internal"},
		},
		"clientExtensionResults": map[string]any{},
	})
	return b
}

// get answers navigator.credentials.get, signing for rpID.
func (k *softKey) get(opts *protocol.CredentialAssertion, rpID, origin string) []byte {
	k.t.Helper()
	ad := k.authData(rpID, false)
	cd := clientData("webauthn.get", opts.Response.Challenge, origin)
	ch := sha256.Sum256(cd)
	digest := sha256.Sum256(append(append([]byte{}, ad...), ch[:]...))
	sig, err := ecdsa.SignASN1(rand.Reader, k.priv, digest[:])
	if err != nil {
		k.t.Fatal(err)
	}
	b, _ := json.Marshal(map[string]any{
		"id": b64.EncodeToString(k.id), "rawId": b64.EncodeToString(k.id), "type": "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64.EncodeToString(cd),
			"authenticatorData": b64.EncodeToString(ad),
			"signature":         b64.EncodeToString(sig),
			"userHandle":        b64.EncodeToString(k.handle),
		},
		"clientExtensionResults": map[string]any{},
	})
	return b
}

var home = RelyingParty{ID: "cloudbank.test", Origin: "https://cloudbank.test"}

func addPasskey(t *testing.T, s *Service, userID int64, token string) *softKey {
	t.Helper()
	ctx := context.Background()
	opts, err := s.BeginPasskeyAdd(ctx, userID, token, home)
	if err != nil {
		t.Fatalf("BeginPasskeyAdd: %v", err)
	}
	k := newSoftKey(t)
	if _, err := s.FinishPasskeyAdd(ctx, userID, token, "  Laptop  ", k.create(opts, home.ID, home.Origin)); err != nil {
		t.Fatalf("FinishPasskeyAdd: %v", err)
	}
	return k
}

func signIn(s *Service, k *softKey, rp RelyingParty) (User, error) {
	opts, key, err := s.BeginPasskeyLogin("1.2.3.4", rp)
	if err != nil {
		return User{}, err
	}
	u, _, err := s.FinishPasskeyLogin(context.Background(), key, k.get(opts, rp.ID, rp.Origin), "test")
	return u, err
}

func TestPasskeyAddThenSignIn(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	admin, token, err := s.Setup(ctx, "admin", "", "s3cret-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	k := addPasskey(t, s, admin.ID, token)

	list, err := s.ListPasskeys(ctx, admin.ID)
	if err != nil || len(list) != 1 || list[0].Name != "Laptop" || list[0].LastUsedAt != "" {
		t.Fatalf("ListPasskeys = %+v, %v", list, err)
	}
	// Twice: the second sign-in checks against what the first wrote back.
	for range 2 {
		u, err := signIn(s, k, home)
		if err != nil || u.ID != admin.ID {
			t.Fatalf("signIn = %+v, %v", u, err)
		}
	}
	if list, _ = s.ListPasskeys(ctx, admin.ID); list[0].LastUsedAt == "" {
		t.Fatal("last use not recorded")
	}

	// A challenge answers once.
	opts, key, _ := s.BeginPasskeyLogin("1.2.3.4", home)
	answer := k.get(opts, home.ID, home.Origin)
	if _, _, err := s.FinishPasskeyLogin(ctx, key, answer, ""); err != nil {
		t.Fatalf("first answer: %v", err)
	}
	if _, _, err := s.FinishPasskeyLogin(ctx, key, answer, ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("replayed answer err = %v", err)
	}
}

func TestPasskeySignsInOnlyWhereMadeAndOnlyEnabledUsers(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	if _, _, err := s.Setup(ctx, "admin", "", "s3cret-pass", "test"); err != nil {
		t.Fatal(err)
	}
	other, _ := s.CreateUser(ctx, "giulia", "", "s3cret-pass", false)
	_, tok2, _ := s.Login(ctx, "1.2.3.4", "giulia", "s3cret-pass", "", "test")
	k := addPasskey(t, s, other.ID, tok2)

	elsewhere := RelyingParty{ID: "other.test", Origin: "https://other.test"}
	if _, err := signIn(s, k, elsewhere); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("sign-in on another host err = %v", err)
	}
	if err := s.SetDisabled(ctx, other.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := signIn(s, k, home); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("disabled user sign-in err = %v", err)
	}
	if err := s.SetDisabled(ctx, other.ID, false); err != nil {
		t.Fatal(err)
	}
	if n, err := s.DeleteUserPasskeys(ctx, other.ID); err != nil || n != 1 {
		t.Fatalf("DeleteUserPasskeys = %d, %v", n, err)
	}
	// The admin's removal also signs the user out: a lost device may hold a session.
	if _, err := s.Authenticate(ctx, tok2); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("session after the admin removed the passkeys: %v", err)
	}
	if _, err := signIn(s, k, home); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("removed passkey sign-in err = %v", err)
	}
}

func TestPasskeyAddNeedsRecentSignIn(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	admin, token, _ := s.Setup(ctx, "admin", "", "s3cret-pass", "test")

	opts, err := s.BeginPasskeyAdd(ctx, admin.ID, token, home)
	if err != nil {
		t.Fatalf("BeginPasskeyAdd at once: %v", err)
	}
	now = now.Add(11 * time.Minute)
	// Begun in time, finished too late: still refused.
	if _, err := s.FinishPasskeyAdd(ctx, admin.ID, token, "x", newSoftKey(t).create(opts, home.ID, home.Origin)); !errors.Is(err, ErrReauthRequired) {
		t.Fatalf("FinishPasskeyAdd after 11 min err = %v", err)
	}
	if _, err := s.BeginPasskeyAdd(ctx, admin.ID, token, home); !errors.Is(err, ErrReauthRequired) {
		t.Fatalf("BeginPasskeyAdd after 11 min err = %v", err)
	}
}

func TestPasskeyLimit(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	admin, token, _ := s.Setup(ctx, "admin", "", "s3cret-pass", "test")
	for i := range MaxPasskeys {
		if _, err := s.q.CreatePasskey(ctx, db.CreatePasskeyParams{
			UserID: admin.ID, CredentialID: []byte{byte(i)}, UserHandle: []byte("h"), RpID: home.ID,
			Name: "k", Credential: "{}", CreatedAt: "2026-11-27T12:00:00Z",
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.BeginPasskeyAdd(ctx, admin.ID, token, home); !errors.Is(err, ErrPasskeyLimit) {
		t.Fatalf("BeginPasskeyAdd at %d err = %v", MaxPasskeys, err)
	}
}

func TestCeremonyStoreDropsTheOldest(t *testing.T) {
	c := newCeremonyStore()
	now := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	for i := range ceremonyCap {
		c.put(string(rune(0x1000+i)), ceremony{expires: now.Add(time.Duration(i+1) * time.Second)}, now)
	}
	c.put("new", ceremony{expires: now.Add(time.Hour)}, now)
	if _, ok := c.take(string(rune(0x1000)), now); ok {
		t.Fatal("the challenge closest to expiring is still there")
	}
	for _, k := range []string{string(rune(0x1001)), "new"} {
		if _, ok := c.take(k, now); !ok {
			t.Fatalf("challenge %q was dropped", k)
		}
	}
}

func TestCleanPasskeyName(t *testing.T) {
	long := ""
	for range 70 {
		long += "è"
	}
	for in, want := range map[string]string{"": "Passkey", "  ": "Passkey", " Pixel 9 ": "Pixel 9", long: long[:120]} {
		if got := cleanPasskeyName(in); got != want {
			t.Errorf("cleanPasskeyName(%q) = %q, want %q", in, got, want)
		}
	}
}
