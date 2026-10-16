package mailingest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeIDToken builds an unsigned JWT carrying the claims Microsoft puts in an
// id_token; only the payload is read.
func fakeIDToken(claims map[string]string) string {
	payload, _ := json.Marshal(claims)
	return "e30." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}

// fakeMicrosoft answers the device-code and token endpoints. tokenReplies is
// consumed one per token request; the last one repeats.
func fakeMicrosoft(t *testing.T, tokenReplies ...func(w http.ResponseWriter, r *http.Request)) (*Microsoft, *[]http.Header) {
	t.Helper()
	var seen []http.Header
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("form: %v", err)
		}
		if r.Form.Get("client_id") != "test-client" {
			t.Errorf("client_id = %q", r.Form.Get("client_id"))
		}
		if r.Form.Get("client_secret") != "" {
			t.Errorf("a public client must not send a secret")
		}
		seen = append(seen, r.Header.Clone())
		switch r.URL.Path {
		case "/devicecode":
			if !strings.Contains(r.Form.Get("scope"), imapScope) || !strings.Contains(r.Form.Get("scope"), "offline_access") {
				t.Errorf("scope = %q", r.Form.Get("scope"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code": "dev-123", "user_code": "K7QF-2MXP",
				"verification_uri": "https://microsoft.com/devicelogin",
				"expires_in":       900, "interval": 5,
			})
		case "/token":
			i := n
			if i >= len(tokenReplies) {
				i = len(tokenReplies) - 1
			}
			n++
			tokenReplies[i](w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return NewMicrosoft("test-client", srv.URL, srv.Client()), &seen
}

func oauthError(code string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
	}
}

func tokenOK(refresh string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		body := map[string]any{
			"access_token": "access-1", "expires_in": 3600, "token_type": "Bearer",
			"id_token": fakeIDToken(map[string]string{"preferred_username": "notifiche.demo@example.com"}),
		}
		if refresh != "" {
			body["refresh_token"] = refresh
		}
		_ = json.NewEncoder(w).Encode(body)
	}
}

func TestMicrosoftStartDevice(t *testing.T) {
	ms, _ := fakeMicrosoft(t, tokenOK("r"))
	dc, err := ms.StartDevice(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if dc.DeviceCode != "dev-123" || dc.UserCode != "K7QF-2MXP" || dc.ExpiresIn != 900 || dc.Interval != 5 {
		t.Fatalf("device code = %+v", dc)
	}
	if dc.VerificationURI != "https://microsoft.com/devicelogin" {
		t.Fatalf("verification uri = %q", dc.VerificationURI)
	}
}

func TestMicrosoftPollDevice(t *testing.T) {
	cases := []struct {
		name  string
		reply func(http.ResponseWriter, *http.Request)
		want  PollState
	}{
		{"pending", oauthError("authorization_pending"), PollPending},
		{"slow down", oauthError("slow_down"), PollSlowDown},
		{"declined", oauthError("authorization_declined"), PollDeclined},
		{"denied", oauthError("access_denied"), PollDeclined},
		{"expired", oauthError("expired_token"), PollExpired},
		{"bad code", oauthError("bad_verification_code"), PollExpired},
		{"done", tokenOK("refresh-1"), PollDone},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ms, _ := fakeMicrosoft(t, c.reply)
			state, tok, err := ms.PollDevice(context.Background(), "dev-123")
			if err != nil {
				t.Fatal(err)
			}
			if state != c.want {
				t.Fatalf("state = %v, want %v", state, c.want)
			}
			if c.want == PollDone {
				if tok.AccessToken != "access-1" || tok.RefreshToken != "refresh-1" {
					t.Fatalf("token = %+v", tok)
				}
				if tok.Email != "notifiche.demo@example.com" {
					t.Fatalf("email = %q", tok.Email)
				}
				if tok.ExpiresIn != time.Hour {
					t.Fatal("no expiry")
				}
			}
		})
	}
}

func TestMicrosoftPollDeviceUnknownError(t *testing.T) {
	ms, _ := fakeMicrosoft(t, oauthError("invalid_client"))
	if _, _, err := ms.PollDevice(context.Background(), "dev-123"); err == nil {
		t.Fatal("an unexpected OAuth error must surface")
	}
}

func TestMicrosoftRefresh(t *testing.T) {
	t.Run("rotated", func(t *testing.T) {
		ms, _ := fakeMicrosoft(t, tokenOK("refresh-2"))
		tok, err := ms.Refresh(context.Background(), "refresh-1")
		if err != nil {
			t.Fatal(err)
		}
		if tok.RefreshToken != "refresh-2" || tok.AccessToken != "access-1" {
			t.Fatalf("token = %+v", tok)
		}
	})
	t.Run("kept when not rotated", func(t *testing.T) {
		ms, _ := fakeMicrosoft(t, tokenOK(""))
		tok, err := ms.Refresh(context.Background(), "refresh-1")
		if err != nil {
			t.Fatal(err)
		}
		if tok.RefreshToken != "refresh-1" {
			t.Fatalf("refresh token = %q", tok.RefreshToken)
		}
	})
	t.Run("revoked", func(t *testing.T) {
		ms, _ := fakeMicrosoft(t, oauthError("invalid_grant"))
		_, err := ms.Refresh(context.Background(), "refresh-1")
		if !errors.Is(err, ErrReauth) {
			t.Fatalf("err = %v, want ErrReauth", err)
		}
	})
}

func TestEmailFromIDToken(t *testing.T) {
	if got := emailFromIDToken(fakeIDToken(map[string]string{"email": "a@example.com"})); got != "a@example.com" {
		t.Fatalf("email claim: %q", got)
	}
	if got := emailFromIDToken(fakeIDToken(map[string]string{"preferred_username": "b@example.com", "email": "c@example.com"})); got != "b@example.com" {
		t.Fatalf("preferred_username first: %q", got)
	}
	if got := emailFromIDToken("not-a-jwt"); got != "" {
		t.Fatalf("garbage: %q", got)
	}
}

func TestMicrosoftErrorCarriesItsExplanation(t *testing.T) {
	// What Microsoft answers when the app registration does not allow public
	// client flows: the reader must see the sentence, not "401".
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":             "invalid_client",
			"error_description": "AADSTS70002: The client application must be marked as 'mobile.' Trace ID: abc Correlation ID: def",
		})
	}))
	defer srv.Close()
	_, err := NewMicrosoft("test-client", srv.URL, srv.Client()).StartDevice(context.Background())
	var oe *OAuthError
	if !errors.As(err, &oe) || oe.Code != "invalid_client" {
		t.Fatalf("err = %v", err)
	}
	if got := err.Error(); got != "mailingest: microsoft: AADSTS70002: The client application must be marked as 'mobile.'" {
		t.Fatalf("message = %q", got)
	}
}

func TestCheckAuthorityWantsHTTPSAwayFromThisMachine(t *testing.T) {
	for _, ok := range []string{"", MicrosoftAuthority, "http://localhost:9100", "http://127.0.0.1:9100/x"} {
		if err := CheckAuthority(ok); err != nil {
			t.Errorf("%q: %v", ok, err)
		}
	}
	for _, bad := range []string{"http://login.example.com", "ftp://localhost", "localhost:9100", "https://"} {
		if err := CheckAuthority(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}
