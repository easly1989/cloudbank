package ai

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

type mockDoer struct {
	lastBody []byte
	reply    string
	status   int
}

func (m *mockDoer) Do(r *http.Request) (*http.Response, error) {
	if r.Body != nil {
		m.lastBody, _ = io.ReadAll(r.Body)
	}
	body, _ := json.Marshal(map[string]any{
		"choices": []map[string]any{{"message": map[string]string{"content": m.reply}}},
	})
	st := m.status
	if st == 0 {
		st = http.StatusOK
	}
	return &http.Response{StatusCode: st, Body: io.NopCloser(bytes.NewReader(body))}, nil
}

func newFixture(t *testing.T) (*Service, *db.Queries, int64, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	u, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	return NewService(st.Read(), st.Write()), q, u.ID, w.ID
}

func TestSettingsHidesKeyAndPreservesIt(t *testing.T) {
	svc, _, uid, _ := newFixture(t)
	ctx := context.Background()

	key := "sk-secret"
	st, err := svc.UpdateSettings(ctx, uid, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "gpt-x", APIKey: &key,
	})
	if err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if !st.Enabled || !st.HasKey || st.BaseURL != "https://api.example/v1" || st.Model != "gpt-x" {
		t.Fatalf("settings = %+v", st)
	}
	// The safe view never carries the key.
	if b, _ := json.Marshal(st); strings.Contains(string(b), "sk-secret") {
		t.Fatal("settings JSON leaked the api key")
	}
	// Updating with a nil key keeps the stored one.
	st2, _ := svc.UpdateSettings(ctx, uid, SettingsInput{Enabled: false, BaseURL: "https://api.example/v1", Model: "gpt-x"})
	if st2.HasKey != true || st2.Enabled {
		t.Fatalf("key not preserved / enabled not cleared: %+v", st2)
	}
}

func TestSuggestCategory(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	food, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})
	groceries, _ := q.InsertCategory(ctx, db.InsertCategoryParams{
		WalletID: wid, Name: "Groceries", ParentID: nullID(food.ID),
	})
	_, _ = q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Salary"})

	key := "k"
	if _, err := svc.UpdateSettings(ctx, uid, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key,
	}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	// The model replies with the full "Parent:Sub" name.
	mock := &mockDoer{reply: "Food:Groceries"}
	svc.hc = mock
	got, err := svc.SuggestCategory(ctx, uid, wid, SuggestInput{Payee: "Local Market", Memo: "weekly shop", Amount: "-42.00 €"})
	if err != nil {
		t.Fatalf("SuggestCategory: %v", err)
	}
	if got == nil || got.ID != groceries.ID || got.Name != "Food:Groceries" {
		t.Fatalf("suggestion = %+v, want Food:Groceries (%d)", got, groceries.ID)
	}
	// The request carried the model and the prompt (payee + the category list).
	body := string(mock.lastBody)
	if !strings.Contains(body, "\"model\":\"m\"") || !strings.Contains(body, "Local Market") || !strings.Contains(body, "Food:Groceries") {
		t.Fatalf("request body missing expected content: %s", body)
	}

	// A leaf-name reply also resolves, tolerating quotes/case.
	svc.hc = &mockDoer{reply: "\"salary\""}
	if got, err := svc.SuggestCategory(ctx, uid, wid, SuggestInput{Payee: "ACME"}); err != nil || got == nil || got.Name != "Salary" {
		t.Fatalf("leaf-name suggestion = %+v, err %v", got, err)
	}

	// "none" (or an unlisted name) yields no suggestion, no error.
	svc.hc = &mockDoer{reply: "none"}
	if got, err := svc.SuggestCategory(ctx, uid, wid, SuggestInput{Payee: "Mystery"}); err != nil || got != nil {
		t.Fatalf("none reply = %+v, err %v; want nil/nil", got, err)
	}
	svc.hc = &mockDoer{reply: "Something Not In The List"}
	if got, _ := svc.SuggestCategory(ctx, uid, wid, SuggestInput{Payee: "X"}); got != nil {
		t.Fatalf("unlisted reply should not match, got %+v", got)
	}
}

func TestSuggestCategoryDisabled(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	_, _ = q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})
	// Not configured at all.
	if _, err := svc.SuggestCategory(ctx, uid, wid, SuggestInput{Payee: "X"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
	// Enabled but no key → still not configured.
	if _, err := svc.UpdateSettings(ctx, uid, SettingsInput{Enabled: true, BaseURL: "u", Model: "m"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SuggestCategory(ctx, uid, wid, SuggestInput{Payee: "X"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("no-key err = %v, want ErrNotConfigured", err)
	}
}

func nullID(v int64) sql.NullInt64 { return sql.NullInt64{Int64: v, Valid: true} }
