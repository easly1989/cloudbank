package banksync

import (
	"context"
	"database/sql"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

const accountsJSON = `{"accounts":[{"id":"ACT-1","name":"Checking Demo","currency":"EUR","balance":"100.00","transactions":[
	{"id":"t1","posted":1718000000,"amount":"-12.34","description":"Coffee"},
	{"id":"t2","posted":1718100000,"amount":"50.00","description":"Refund"}
]}]}`

// mockDoer answers the claim POST with an access URL and the /accounts GET with
// a fixed account set; it counts /accounts fetches.
type mockDoer struct {
	fetches int
}

func (m *mockDoer) Do(r *http.Request) (*http.Response, error) {
	body := ""
	switch {
	case r.Method == http.MethodPost:
		body = "https://demo:demo@example.test/simplefin"
	case strings.Contains(r.URL.Path, "/accounts"):
		m.fetches++
		body = accountsJSON
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func newFixture(t *testing.T) (*Service, *db.Queries, *store.Store, int64, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Checking", Type: "checking", CurrencyID: cur.ID, Position: 1,
	})
	imp := importio.NewService(st.Write(), transaction.NewService(st.Write()),
		assignment.NewService(st.Write()), account.NewServiceWithRead(st.Read(), st.Write()))
	svc := NewService(st.Read(), st.Write(), imp)
	svc.hc = &mockDoer{}
	svc.syncStagger = 0
	return svc, q, st, w.ID, acc.ID
}

func TestConnectLinkSyncDedup(t *testing.T) {
	svc, q, _, wid, acc := newFixture(t)
	ctx := context.Background()
	setupToken := base64.StdEncoding.EncodeToString([]byte("https://example.test/claim/x"))

	// Connect: claims the token and discovers the remote account.
	conn, remotes, err := svc.Connect(ctx, wid, setupToken, "Demo bank")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if conn.Name != "Demo bank" || len(remotes) != 1 || remotes[0].ExternalID != "ACT-1" {
		t.Fatalf("connect result: %+v / %+v", conn, remotes)
	}
	// The access URL (a secret) is never in the public Connection.
	if conn.LastSyncedAt != "" {
		t.Fatalf("unexpected lastSyncedAt")
	}

	// Link the remote account to the CloudBank account.
	if err := svc.Link(ctx, wid, conn.ID, "ACT-1", acc); err != nil {
		t.Fatalf("Link: %v", err)
	}

	// First sync imports both transactions.
	res, err := svc.Sync(ctx, wid, conn.ID)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if res.Imported != 2 || res.Accounts != 1 {
		t.Fatalf("first sync = %+v, want imported 2 / accounts 1", res)
	}
	// The transactions really landed on the account with amounts rescaled to 2 dp.
	rows, _ := q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: acc, Limit: 100})
	if len(rows) != 2 {
		t.Fatalf("account has %d transactions, want 2", len(rows))
	}
	var sum int64
	for _, r := range rows {
		sum += r.Amount
	}
	if sum != -1234+5000 {
		t.Fatalf("amount sum = %d, want %d", sum, -1234+5000)
	}

	// Re-sync imports nothing new (dedup by the provider transaction id).
	res2, err := svc.Sync(ctx, wid, conn.ID)
	if err != nil {
		t.Fatalf("Sync 2: %v", err)
	}
	if res2.Imported != 0 {
		t.Fatalf("re-sync imported %d, want 0 (deduped)", res2.Imported)
	}
}

func TestSyncDueRespectsScheduleAndAutoSync(t *testing.T) {
	svc, q, st, wid, acc := newFixture(t)
	ctx := context.Background()
	setupToken := base64.StdEncoding.EncodeToString([]byte("https://example.test/claim/x"))
	conn, _, err := svc.Connect(ctx, wid, setupToken, "Bank")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if err := svc.Link(ctx, wid, conn.ID, "ACT-1", acc); err != nil {
		t.Fatalf("Link: %v", err)
	}
	// Schedule it every day at hour 0 (UTC) so "the scheduled hour has arrived" is
	// always true and the test doesn't depend on the wall clock.
	allDays := []int{0, 1, 2, 3, 4, 5, 6}
	if err := svc.SetSchedule(ctx, wid, conn.ID, 0, allDays); err != nil {
		t.Fatalf("SetSchedule: %v", err)
	}
	// setLastSyncedDaysAgo moves last_synced_at back by whole days, so it lands
	// deterministically before (overdue) today's 00:00 slot.
	setLastSyncedDaysAgo := func(days int) {
		if _, err := st.Write().ExecContext(ctx,
			`UPDATE bank_connections SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-' || ? || ' days') WHERE id = ?`,
			days, conn.ID); err != nil {
			t.Fatalf("setLastSynced: %v", err)
		}
	}

	// Never synced → due today → imports its transactions.
	if r, err := svc.SyncDue(ctx); err != nil || r.Connections != 1 || r.Imported != 2 {
		t.Fatalf("first SyncDue = %+v err=%v, want connections 1 / imported 2", r, err)
	}
	// Just synced (in today's slot) → not due again today.
	if r, _ := svc.SyncDue(ctx); r.Connections != 0 {
		t.Fatalf("second SyncDue synced %d, want 0 (not due)", r.Connections)
	}
	// Last sync was yesterday → before today's slot → due (imports nothing, deduped).
	setLastSyncedDaysAgo(1)
	if r, _ := svc.SyncDue(ctx); r.Connections != 1 || r.Imported != 0 {
		t.Fatalf("overdue SyncDue = %+v, want connections 1 / imported 0", r)
	}

	// Auto-sync off → excluded even when overdue.
	setLastSyncedDaysAgo(1)
	if err := svc.SetAutoSync(ctx, wid, conn.ID, false); err != nil {
		t.Fatalf("SetAutoSync off: %v", err)
	}
	if r, _ := svc.SyncDue(ctx); r.Connections != 0 {
		t.Fatalf("auto-sync off still synced: %+v", r)
	}
	if err := svc.SetAutoSync(ctx, wid, conn.ID, true); err != nil {
		t.Fatalf("SetAutoSync on: %v", err)
	}

	// A schedule that excludes today's weekday → not due, even overdue.
	setLastSyncedDaysAgo(1)
	today := int(time.Now().UTC().Weekday())
	var notToday []int
	for d := 0; d <= 6; d++ {
		if d != today {
			notToday = append(notToday, d)
		}
	}
	if err := svc.SetSchedule(ctx, wid, conn.ID, 0, notToday); err != nil {
		t.Fatalf("SetSchedule (exclude today): %v", err)
	}
	if r, _ := svc.SyncDue(ctx); r.Connections != 0 {
		t.Fatalf("excluded weekday still synced: %+v", r)
	}

	// Cross-wallet mutation is rejected.
	other, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	if err := svc.SetSchedule(ctx, other.ID, conn.ID, 0, allDays); err != ErrNotFound {
		t.Fatalf("cross-wallet SetSchedule err = %v, want ErrNotFound", err)
	}
}

func TestScheduleDue(t *testing.T) {
	now := time.Date(2026, 9, 9, 10, 0, 0, 0, time.UTC) // Wednesday, 10:00 UTC
	none := sql.NullString{}
	if !scheduleDue(now, 3, allDaysMask, none) {
		t.Fatal("day enabled, hour reached, never synced → due")
	}
	if scheduleDue(now, 11, allDaysMask, none) {
		t.Fatal("hour not reached yet → not due")
	}
	if scheduleDue(now, 3, 1<<1 /* Monday only */, none) {
		t.Fatal("weekday not enabled → not due")
	}
	inSlot := sql.NullString{String: "2026-09-09T09:00:00.000Z", Valid: true}
	if scheduleDue(now, 3, allDaysMask, inSlot) {
		t.Fatal("already synced after today's slot → not due")
	}
	yesterday := sql.NullString{String: "2026-09-08T09:00:00.000Z", Valid: true}
	if !scheduleDue(now, 3, allDaysMask, yesterday) {
		t.Fatal("last sync before today's slot → due")
	}
}

func TestSyncHistory(t *testing.T) {
	svc, q, _, wid, acc := newFixture(t)
	ctx := context.Background()
	setupToken := base64.StdEncoding.EncodeToString([]byte("https://example.test/claim/x"))
	conn, _, err := svc.Connect(ctx, wid, setupToken, "Bank")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if err := svc.Link(ctx, wid, conn.ID, "ACT-1", acc); err != nil {
		t.Fatalf("Link: %v", err)
	}

	// First manual sync: a run with the per-account breakdown.
	if _, err := svc.Sync(ctx, wid, conn.ID); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	runs, err := svc.History(ctx, wid, conn.ID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("history len = %d, want 1", len(runs))
	}
	if r := runs[0]; r.TriggeredBy != "manual" || r.Status != "ok" || r.Imported != 2 {
		t.Fatalf("run = %+v, want manual / ok / imported 2", r)
	}
	if len(runs[0].Accounts) != 1 {
		t.Fatalf("run accounts = %d, want 1", len(runs[0].Accounts))
	}
	if a := runs[0].Accounts[0]; a.ExternalID != "ACT-1" || a.Name != "Checking" || a.Fetched != 2 || a.Imported != 2 {
		t.Fatalf("account detail = %+v, want ACT-1 / Checking / fetched 2 / imported 2", a)
	}

	// A second sync dedups the same rows → imported 0, and adds a second run.
	if _, err := svc.Sync(ctx, wid, conn.ID); err != nil {
		t.Fatalf("Sync 2: %v", err)
	}
	runs, _ = svc.History(ctx, wid, conn.ID)
	if len(runs) != 2 || runs[0].Imported != 0 {
		t.Fatalf("after 2 syncs: len=%d run0.imported=%d, want 2 / 0", len(runs), runs[0].Imported)
	}

	// Retention: only the most recent syncRunHistoryLimit runs are kept.
	for i := 0; i < syncRunHistoryLimit+3; i++ {
		if _, err := svc.Sync(ctx, wid, conn.ID); err != nil {
			t.Fatalf("Sync loop: %v", err)
		}
	}
	runs, _ = svc.History(ctx, wid, conn.ID)
	if len(runs) != syncRunHistoryLimit {
		t.Fatalf("history len after many = %d, want %d", len(runs), syncRunHistoryLimit)
	}
	if runs[0].ID < runs[len(runs)-1].ID {
		t.Fatalf("history not most-recent-first: %d then %d", runs[0].ID, runs[len(runs)-1].ID)
	}

	// Cross-wallet history is rejected.
	other, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	if _, err := svc.History(ctx, other.ID, conn.ID); err != ErrNotFound {
		t.Fatalf("cross-wallet History err = %v, want ErrNotFound", err)
	}
}

func TestConnectionWalletIsolation(t *testing.T) {
	svc, q, _, wid, _ := newFixture(t)
	ctx := context.Background()
	setupToken := base64.StdEncoding.EncodeToString([]byte("https://example.test/claim/x"))
	conn, _, err := svc.Connect(ctx, wid, setupToken, "Mine")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	// Another wallet cannot see, sync, or remove this connection.
	other, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	if _, err := svc.RemoteAccounts(ctx, other.ID, conn.ID); err != ErrNotFound {
		t.Fatalf("cross-wallet RemoteAccounts err = %v, want ErrNotFound", err)
	}
	if _, err := svc.Sync(ctx, other.ID, conn.ID); err != ErrNotFound {
		t.Fatalf("cross-wallet Sync err = %v, want ErrNotFound", err)
	}
	if err := svc.RemoveConnection(ctx, other.ID, conn.ID); err != ErrNotFound {
		t.Fatalf("cross-wallet Remove err = %v, want ErrNotFound", err)
	}
}
