package httpapi

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/locale"
)

// The language a client saves is one CloudBank speaks: a variant is stored as
// its language, an unknown one is refused and leaves the saved one alone
// (#607).
func TestUpdateMeLocale(t *testing.T) {
	c := newTestAPI(t)
	setupAdmin(c)

	patch := func(tag string) (int, string, string) {
		t.Helper()
		resp := c.do(http.MethodPatch, "/api/v1/auth/me", map[string]any{"locale": tag}, true)
		defer resp.Body.Close()
		var body struct {
			Locale string `json:"locale"`
			Error  struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return resp.StatusCode, body.Locale, body.Error.Code
	}

	if status, got, _ := patch("it-CH"); status != http.StatusOK || got != "it" {
		t.Fatalf("it-CH = %d %q, want 200 it", status, got)
	}
	if status, _, code := patch("xx"); status != http.StatusBadRequest || code != "invalid_locale" {
		t.Fatalf("xx = %d %q, want 400 invalid_locale", status, code)
	}
	if status, got, _ := patch("EN-gb"); status != http.StatusOK || got != "en" {
		t.Fatalf("EN-gb = %d %q, want 200 en", status, got)
	}

	// Once Brazilian Portuguese is on the list, European Portuguese reads it.
	saved := locale.Supported
	locale.Supported = append(slices.Clone(saved), "pt-BR")
	t.Cleanup(func() { locale.Supported = saved })
	if status, got, _ := patch("pt-PT"); status != http.StatusOK || got != "pt-BR" {
		t.Fatalf("pt-PT = %d %q, want 200 pt-BR", status, got)
	}
}
