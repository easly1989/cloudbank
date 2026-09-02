package banksync

import (
	"context"
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

func newFixture(t *testing.T) (*Service, *db.Queries, int64, int64) {
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
	return svc, q, w.ID, acc.ID
}

func TestConnectLinkSyncDedup(t *testing.T) {
	svc, q, wid, acc := newFixture(t)
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

func TestSyncDueRespectsAutoSyncAndRecency(t *testing.T) {
	svc, q, wid, acc := newFixture(t)
	ctx := context.Background()
	setupToken := base64.StdEncoding.EncodeToString([]byte("https://example.test/claim/x"))
	conn, _, err := svc.Connect(ctx, wid, setupToken, "Bank")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if err := svc.Link(ctx, wid, conn.ID, "ACT-1", acc); err != nil {
		t.Fatalf("Link: %v", err)
	}

	// Never synced → due → SyncDue imports its transactions.
	r1, err := svc.SyncDue(ctx, time.Hour)
	if err != nil {
		t.Fatalf("SyncDue: %v", err)
	}
	if r1.Connections != 1 || r1.Imported != 2 {
		t.Fatalf("first SyncDue = %+v, want connections 1 / imported 2", r1)
	}

	// Just synced → not due within the hour.
	r2, _ := svc.SyncDue(ctx, time.Hour)
	if r2.Connections != 0 {
		t.Fatalf("second SyncDue synced %d, want 0 (not due)", r2.Connections)
	}

	// Auto-sync off excludes it even when otherwise due (negative age = force due).
	if err := svc.SetAutoSync(ctx, wid, conn.ID, false); err != nil {
		t.Fatalf("SetAutoSync off: %v", err)
	}
	r3, _ := svc.SyncDue(ctx, -time.Hour)
	if r3.Connections != 0 {
		t.Fatalf("auto-sync off still synced: %+v", r3)
	}

	// Re-enabled → due again → synced (imports nothing new, deduped).
	if err := svc.SetAutoSync(ctx, wid, conn.ID, true); err != nil {
		t.Fatalf("SetAutoSync on: %v", err)
	}
	r4, _ := svc.SyncDue(ctx, -time.Hour)
	if r4.Connections != 1 || r4.Imported != 0 {
		t.Fatalf("re-enabled SyncDue = %+v, want connections 1 / imported 0", r4)
	}

	// Cross-wallet toggle is rejected.
	other, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	if err := svc.SetAutoSync(ctx, other.ID, conn.ID, false); err != ErrNotFound {
		t.Fatalf("cross-wallet SetAutoSync err = %v, want ErrNotFound", err)
	}
}

func TestConnectionWalletIsolation(t *testing.T) {
	svc, q, wid, _ := newFixture(t)
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
