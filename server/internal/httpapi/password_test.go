package httpapi

import (
	"net/http"
	"testing"
)

// A user changes their own password (#530): only knowing the current one, never
// shorter than 8 characters, and every other session of theirs is signed out
// while this one stays.
func TestChangeOwnPassword(t *testing.T) {
	c := newTestAPI(t)
	resp := c.do(http.MethodPost, "/api/v1/setup",
		map[string]any{"username": "admin", "password": "supersecret"}, true)
	resp.Body.Close()

	// A second device, signed in with the old password.
	other := c.fork()
	resp = other.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "admin", "password": "supersecret"}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("second login = %d", resp.StatusCode)
	}
	resp.Body.Close()

	change := func(current, next string) int {
		t.Helper()
		resp := c.do(http.MethodPost, "/api/v1/auth/me/password",
			map[string]any{"currentPassword": current, "newPassword": next}, true)
		resp.Body.Close()
		return resp.StatusCode
	}
	if got := change("wrong-password", "anewpassword"); got != http.StatusForbidden {
		t.Fatalf("wrong current password = %d, want 403", got)
	}
	if got := change("supersecret", "short"); got != http.StatusBadRequest {
		t.Fatalf("short new password = %d, want 400", got)
	}
	// Neither failure signed anyone out.
	resp = other.do(http.MethodGet, "/api/v1/auth/me", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("other session after failed changes = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	if got := change("supersecret", "anewpassword"); got != http.StatusNoContent {
		t.Fatalf("change = %d, want 204", got)
	}

	// This session stays; the other is signed out.
	resp = c.do(http.MethodGet, "/api/v1/auth/me", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("this session after the change = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
	resp = other.do(http.MethodGet, "/api/v1/auth/me", nil, false)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("other session after the change = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	// The old password no longer works; the new one does.
	fresh := c.fork()
	resp = fresh.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "admin", "password": "supersecret"}, true)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("login with the old password = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
	resp = fresh.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "admin", "password": "anewpassword"}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login with the new password = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestMeSaysWhetherTheUserSignsInWithSSO(t *testing.T) {
	c := newTestAPI(t)
	resp := c.do(http.MethodPost, "/api/v1/setup",
		map[string]any{"username": "admin", "password": "supersecret"}, true)
	resp.Body.Close()
	resp = c.do(http.MethodGet, "/api/v1/auth/me", nil, false)
	if u := decodeUser(t, resp); u.SignsInWithSSO {
		t.Fatal("a local user is reported as signing in with SSO")
	}
}
