package ai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Only an administrator may point AI at the local network, on save and on
// every call; and a failing provider's reply is never echoed back (#543).
func TestLocalProvidersAreForAdministrators(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	_, _ = q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})
	key := "k"

	for _, u := range []string{"http://127.0.0.1:11434/v1", "http://localhost:11434/v1", "http://192.168.1.14/v1", "http://169.254.169.254/latest"} {
		if _, err := svc.UpdateSettings(ctx, uid, false, SettingsInput{Enabled: true, BaseURL: u, Model: "m", APIKey: &key}); !errors.Is(err, ErrLocalURL) {
			t.Errorf("non-admin save of %s: err = %v, want ErrLocalURL", u, err)
		}
	}
	if _, err := svc.UpdateSettings(ctx, uid, false, SettingsInput{Enabled: true, BaseURL: "ftp://8.8.8.8/", Model: "m", APIKey: &key}); !errors.Is(err, ErrBadURL) {
		t.Errorf("ftp URL: err = %v, want ErrBadURL", err)
	}

	// A local provider, as an administrator configures one (Ollama).
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		if status == http.StatusOK {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Food"}}]}`))
			return
		}
		_, _ = w.Write([]byte("internal secret page"))
	}))
	defer srv.Close()
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{Enabled: true, BaseURL: srv.URL, Model: "m", APIKey: &key}); err != nil {
		t.Fatalf("admin save of a local URL: %v", err)
	}
	if got, err := svc.SuggestCategory(ctx, uid, true, wid, SuggestInput{Payee: "Market"}); err != nil || got == nil {
		t.Fatalf("admin call = %+v, %v; want a suggestion", got, err)
	}
	// The same settings, used by someone who is no longer an administrator.
	if _, err := svc.SuggestCategory(ctx, uid, false, wid, SuggestInput{Payee: "Market"}); !errors.Is(err, ErrLocalURL) {
		t.Errorf("non-admin call to a local URL: err = %v, want ErrLocalURL", err)
	}

	status = http.StatusTeapot
	_, err := svc.SuggestCategory(ctx, uid, true, wid, SuggestInput{Payee: "Market"})
	if err == nil || strings.Contains(err.Error(), "secret") || !strings.Contains(err.Error(), "418") {
		t.Errorf("failing provider: err = %v, want the status and not the body", err)
	}
}
