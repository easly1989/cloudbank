package push

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/bills"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Valid example subscription keys (from webpush-go's own tests) so payload
// encryption succeeds; the mock transport captures the request instead of
// hitting the network.
const (
	testP256dh = "BNNL5ZaTfK81qhXOx23-wewhigUeFb632jN6LvRWCFH1ubQr77FE_9qV1FuojuRmHP42zmf34rXgW80OvUVDgTk"
	testAuth   = "zqbxT6JKstKSY9JKibZLSQ"
)

type mockClient struct {
	calls  int
	status int
}

func (m *mockClient) Do(r *http.Request) (*http.Response, error) {
	m.calls++
	return &http.Response{StatusCode: m.status, Body: io.NopCloser(strings.NewReader(""))}, nil
}

func newFixture(t *testing.T) (*store.Store, *Service) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	svc, err := NewService(st.Read(), st.Write(), "mailto:test@example.com", nil)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return st, svc
}

func TestVAPIDPersistedAndStable(t *testing.T) {
	st, svc := newFixture(t)
	if svc.PublicKey() == "" {
		t.Fatal("empty VAPID public key")
	}
	// A second service over the same DB reuses the stored keypair.
	svc2, err := NewService(st.Read(), st.Write(), "mailto:test@example.com", nil)
	if err != nil {
		t.Fatalf("NewService(2): %v", err)
	}
	if svc2.PublicKey() != svc.PublicKey() {
		t.Fatal("VAPID public key changed across restarts")
	}
}

func TestSubscribeSendAndPrune(t *testing.T) {
	st, svc := newFixture(t)
	ctx := context.Background()
	q := db.New(st.Write())
	u, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})

	if err := svc.Subscribe(ctx, u.ID, "https://push.example/ep1", testP256dh, testAuth); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	// Re-subscribing the same endpoint upserts (still one row).
	if err := svc.Subscribe(ctx, u.ID, "https://push.example/ep1", testP256dh, testAuth); err != nil {
		t.Fatalf("re-subscribe: %v", err)
	}
	subs, _ := q.ListPushSubscriptionsForUser(ctx, u.ID)
	if len(subs) != 1 {
		t.Fatalf("subscriptions = %d, want 1", len(subs))
	}

	// A 201 leaves the subscription in place.
	ok := &mockClient{status: http.StatusCreated}
	svc.client = ok
	if err := svc.sendToUser(ctx, u.ID, Payload{Title: "hi"}); err != nil {
		t.Fatalf("sendToUser: %v", err)
	}
	if ok.calls != 1 {
		t.Fatalf("send calls = %d, want 1", ok.calls)
	}
	if subs, _ := q.ListPushSubscriptionsForUser(ctx, u.ID); len(subs) != 1 {
		t.Fatalf("subscription should remain after 201")
	}

	// A 410 Gone prunes the dead subscription.
	gone := &mockClient{status: http.StatusGone}
	svc.client = gone
	if err := svc.sendToUser(ctx, u.ID, Payload{Title: "bye"}); err != nil {
		t.Fatalf("sendToUser(gone): %v", err)
	}
	if subs, _ := q.ListPushSubscriptionsForUser(ctx, u.ID); len(subs) != 0 {
		t.Fatalf("dead subscription should be pruned")
	}
}

func TestBillsRemindersDedup(t *testing.T) {
	st, svc := newFixture(t)
	ctx := context.Background()
	q := db.New(st.Write())
	svc.bills = bills.NewService(st.Read())
	mock := &mockClient{status: http.StatusCreated}
	svc.client = mock

	// A user with a wallet, an EUR account, and an overdue monthly rent schedule.
	u, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	_ = q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: u.ID, Role: "owner"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Checking", Type: "checking", CurrencyID: cur.ID, Position: 1,
	})
	tpl, _ := q.InsertTemplate(ctx, db.InsertTemplateParams{
		WalletID: w.ID, Name: "Rent", AccountID: sql.NullInt64{Int64: acc.ID, Valid: true}, Amount: -120000,
	})
	// Due yesterday → overdue relative to `now` below.
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	_, _ = q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: w.ID, TemplateID: tpl.ID, Unit: "month", EveryN: 1,
		NextDue: "2026-06-14", WeekendMode: 0, Remaining: sql.NullInt64{}, PostAdvance: 0, AutoPost: 1,
	})
	_ = svc.Subscribe(ctx, u.ID, "https://push.example/ep1", testP256dh, testAuth)

	// First run notifies once.
	if err := svc.RunBillsReminders(ctx, now); err != nil {
		t.Fatalf("run 1: %v", err)
	}
	if mock.calls != 1 {
		t.Fatalf("first run sends = %d, want 1", mock.calls)
	}
	// Second run the same day: the occurrence is already announced → no send.
	if err := svc.RunBillsReminders(ctx, now); err != nil {
		t.Fatalf("run 2: %v", err)
	}
	if mock.calls != 1 {
		t.Fatalf("second run sends = %d, want still 1 (deduped)", mock.calls)
	}
}
