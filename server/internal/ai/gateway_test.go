package ai

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Ask is the one way to the model (#696): it sends no memo, hides card
// numbers, keeps to the wallets the user chose and the jobs they switched on,
// and counts every call — a failed one too — for the monthly limit.
func TestAskIsTheOneWayOut(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	if err := q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: wid, UserID: uid, Role: "owner"}); err != nil {
		t.Fatal(err)
	}
	_, _ = q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})
	clock := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }
	key := "k"
	limit := int64(3)
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key,
		Features: &Features{Suggest: true}, MonthlyLimit: &limit,
	}); err != nil {
		t.Fatal(err)
	}
	mock := &mockDoer{reply: "Food"}
	svc.hc = mock
	suggest := func(payee string, confirm bool) error {
		_, err := svc.SuggestCategory(ctx, uid, wid, confirm, SuggestInput{Payee: payee, Amount: "-12.00"})
		return err
	}

	// A card number in what goes out is hidden, in the request and in the log.
	if err := suggest("CARD 4111 1111 1111 1111 SHOP", false); err != nil {
		t.Fatal(err)
	}
	if got := sentText(t, mock); strings.Contains(got, "4111") || !strings.Contains(got, "[hidden]") {
		t.Fatalf("sent %q: the card number left the server", got)
	}
	sends, err := svc.Sends(ctx, uid, 10)
	if err != nil || len(sends) != 1 || sends[0].Feature != FeatureSuggest || *sends[0].WalletID != wid {
		t.Fatalf("log = %+v, %v", sends, err)
	}
	one, err := svc.SendOf(ctx, uid, sends[0].ID)
	if err != nil || strings.Contains(one.Sent, "4111") || !strings.Contains(one.Sent, "SHOP") {
		t.Fatalf("logged %q, %v", one.Sent, err)
	}
	if _, err := svc.SendOf(ctx, uid+1, sends[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another user read the log: %v", err)
	}

	// A wallet taken out, or a job switched off: nothing is sent or counted.
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", WalletsOff: []int64{wid, 999},
	}); err != nil {
		t.Fatal(err)
	}
	mock.lastBody = nil
	if err := suggest("X", false); !errors.Is(err, ErrFeatureOff) || mock.lastBody != nil {
		t.Fatalf("wallet off: err = %v, sent %q", err, mock.lastBody)
	}
	st, _ := svc.Settings(ctx, uid)
	if len(st.WalletsOff) != 1 || st.WalletsOff[0] != wid {
		t.Fatalf("walletsOff = %v, want only the user's own wallet", st.WalletsOff)
	}
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", WalletsOff: []int64{},
		Features: &Features{Entry: true},
	}); err != nil {
		t.Fatal(err)
	}
	if err := suggest("X", false); !errors.Is(err, ErrFeatureOff) || !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("feature off: err = %v", err)
	}
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", Features: &Features{Suggest: true},
	}); err != nil {
		t.Fatal(err)
	}

	// A provider that fails still costs a request: it was sent.
	mock.status = http.StatusInternalServerError
	if err := suggest("X", false); err == nil {
		t.Fatal("a failing provider returned no error")
	}
	mock.status = 0
	if err := suggest("X", false); err != nil {
		t.Fatal(err)
	}
	if st, _ := svc.Settings(ctx, uid); st.Used != 3 {
		t.Fatalf("used = %d, want 3", st.Used)
	}

	// At the limit nothing goes, unless the user said yes.
	mock.lastBody = nil
	if err := suggest("X", false); !errors.Is(err, ErrLimit) || mock.lastBody != nil {
		t.Fatalf("over the limit: err = %v, sent %q", err, mock.lastBody)
	}
	if err := suggest("X", true); err != nil {
		t.Fatalf("confirmed past the limit: %v", err)
	}
	if st, _ := svc.Settings(ctx, uid); st.Used != 4 {
		t.Fatalf("used = %d, want 4", st.Used)
	}

	// A new month starts the count again; the log keeps 90 days.
	clock = time.Date(2026, 11, 1, 0, 0, 1, 0, time.UTC)
	if st, _ := svc.Settings(ctx, uid); st.Used != 0 {
		t.Fatalf("used on the 1st = %d, want 0", st.Used)
	}
	clock = clock.AddDate(0, 3, 0)
	if err := suggest("X", false); err != nil {
		t.Fatal(err)
	}
	if sends, _ := svc.Sends(ctx, uid, 50); len(sends) != 1 {
		t.Fatalf("log after 90 days = %d entries, want only the new one", len(sends))
	}
}

// The memo has nowhere to go: a suggestion is asked with the payee and the
// amount only.
func TestSuggestSendsNoMemo(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	_, _ = q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})
	key := "k"
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key, Features: &Features{Suggest: true},
	}); err != nil {
		t.Fatal(err)
	}
	mock := &mockDoer{reply: "Food"}
	svc.hc = mock
	if _, err := svc.SuggestCategory(ctx, uid, wid, false, SuggestInput{Payee: "Shop", Amount: "-1.00"}); err != nil {
		t.Fatal(err)
	}
	if got := sentText(t, mock); strings.Contains(strings.ToLower(got), "memo") {
		t.Fatalf("sent %q", got)
	}
}
