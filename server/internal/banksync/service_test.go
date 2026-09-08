package banksync

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"testing"

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

func TestSyncDueRespectsAutoSyncAndInterval(t *testing.T) {
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
	// backdate ages the last successful sync so the due check can be exercised
	// without waiting real time.
	backdate := func(hours int) {
		if _, err := st.Write().ExecContext(ctx,
			`UPDATE bank_connections SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-' || ? || ' hours') WHERE id = ?`,
			hours, conn.ID); err != nil {
			t.Fatalf("backdate: %v", err)
		}
	}

	// Never synced → due → SyncDue imports its transactions.
	r1, err := svc.SyncDue(ctx)
	if err != nil {
		t.Fatalf("SyncDue: %v", err)
	}
	if r1.Connections != 1 || r1.Imported != 2 {
		t.Fatalf("first SyncDue = %+v, want connections 1 / imported 2", r1)
	}

	// Just synced → not due within the default daily interval.
	r2, _ := svc.SyncDue(ctx)
	if r2.Connections != 0 {
		t.Fatalf("second SyncDue synced %d, want 0 (not due)", r2.Connections)
	}

	// Older than the interval but auto-sync off → excluded.
	backdate(48)
	if err := svc.SetAutoSync(ctx, wid, conn.ID, false); err != nil {
		t.Fatalf("SetAutoSync off: %v", err)
	}
	r3, _ := svc.SyncDue(ctx)
	if r3.Connections != 0 {
		t.Fatalf("auto-sync off still synced: %+v", r3)
	}

	// Re-enabled and still overdue → synced (imports nothing new, deduped).
	if err := svc.SetAutoSync(ctx, wid, conn.ID, true); err != nil {
		t.Fatalf("SetAutoSync on: %v", err)
	}
	r4, _ := svc.SyncDue(ctx)
	if r4.Connections != 1 || r4.Imported != 0 {
		t.Fatalf("re-enabled SyncDue = %+v, want connections 1 / imported 0", r4)
	}

	// A longer per-connection interval defers the next sync: 48h old with a 72h
	// interval is not yet due, but 96h old is.
	if err := svc.SetSyncInterval(ctx, wid, conn.ID, 72); err != nil {
		t.Fatalf("SetSyncInterval: %v", err)
	}
	backdate(48)
	if r5, _ := svc.SyncDue(ctx); r5.Connections != 0 {
		t.Fatalf("72h interval synced at 48h: %+v", r5)
	}
	backdate(96)
	if r6, _ := svc.SyncDue(ctx); r6.Connections != 1 {
		t.Fatalf("72h interval not due at 96h: %+v", r6)
	}

	// Cross-wallet mutations are rejected.
	other, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	if err := svc.SetAutoSync(ctx, other.ID, conn.ID, false); err != ErrNotFound {
		t.Fatalf("cross-wallet SetAutoSync err = %v, want ErrNotFound", err)
	}
	if err := svc.SetSyncInterval(ctx, other.ID, conn.ID, 24); err != ErrNotFound {
		t.Fatalf("cross-wallet SetSyncInterval err = %v, want ErrNotFound", err)
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
