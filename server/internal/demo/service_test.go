package demo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/banksync"
	"github.com/easly1989/cloudbank/server/internal/config"
	"github.com/easly1989/cloudbank/server/internal/goal"
	"github.com/easly1989/cloudbank/server/internal/importer"
	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/wallet"
)

func limits() config.Demo {
	return config.Demo{
		Idle: 2 * time.Hour, MaxUsers: 10, SessionsPerHour: 10,
		MaxTransactions: 5000, MaxWallets: 3, MaxBody: 1 << 20,
	}
}

func newFixture(t *testing.T, cfg config.Demo) (*Service, *store.Store, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := Prepare(context.Background(), st.Write(), dir, cfg); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	a := auth.NewService(db.New(st.Write()))
	a.SetSessionTTL(cfg.Idle)
	imp := importio.NewService(st.Write(), transaction.NewService(st.Write()),
		assignment.NewService(st.Write()), account.NewServiceWithRead(st.Read(), st.Write()))
	bank := banksync.NewService(st.Read(), st.Write(), imp)
	bank.OnlyDemoBank()
	svc := New(cfg, st.Write(), a, importer.NewService(st.Write()),
		goal.NewServiceWithRead(st.Read(), st.Write()), bank)
	return svc, st, dir
}

func count(t *testing.T, st *store.Store, query string, args ...any) int {
	t.Helper()
	var n int
	if err := st.Read().QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func TestStartFillsAnAccountOfItsOwn(t *testing.T) {
	svc, st, _ := newFixture(t, limits())
	ctx := context.Background()

	u, token, err := svc.Start(ctx, "10.0.0.1", "it-IT,it;q=0.9,en;q=0.8", "test")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if u.IsAdmin || u.Locale != "it" || token == "" {
		t.Fatalf("user = %+v, token %q: want a non-admin Italian account with a session", u, token)
	}
	wallets, err := wallet.NewService(st.Write()).List(ctx, u.ID)
	if err != nil || len(wallets) != 1 || wallets[0].Title != "Portafoglio demo" {
		t.Fatalf("wallets = %+v (%v), want the one Italian demo wallet", wallets, err)
	}
	wid := wallets[0].ID

	if n := count(t, st, "SELECT COUNT(*) FROM transactions WHERE wallet_id = ?", wid); n < 300 {
		t.Errorf("%d transactions, want a year's worth", n)
	}
	var first, last string
	if err := st.Read().QueryRow("SELECT MIN(date), MAX(date) FROM transactions WHERE wallet_id = ?", wid).Scan(&first, &last); err != nil {
		t.Fatal(err)
	}
	today := time.Now().UTC()
	if last > today.Format("2006-01-02") || first < today.AddDate(-1, 0, 0).Format("2006-01-02") {
		t.Errorf("dates run %s to %s, want the year ending today", first, last)
	}
	for what, n := range map[string]int{
		"accounts":   count(t, st, "SELECT COUNT(*) FROM accounts WHERE wallet_id = ?", wid),
		"goals":      count(t, st, "SELECT COUNT(*) FROM goals WHERE wallet_id = ?", wid),
		"budgets":    count(t, st, "SELECT COUNT(*) FROM budgets WHERE wallet_id = ?", wid),
		"schedules":  count(t, st, "SELECT COUNT(*) FROM schedules WHERE wallet_id = ?", wid),
		"transfers":  count(t, st, "SELECT COUNT(*) FROM transfers t JOIN transactions x ON x.id = t.txn_from_id WHERE x.wallet_id = ?", wid),
		"splits":     count(t, st, "SELECT COUNT(*) FROM transactions WHERE wallet_id = ? AND is_split = 1", wid),
		"tagged":     count(t, st, "SELECT COUNT(*) FROM transaction_tags tt JOIN transactions x ON x.id = tt.transaction_id WHERE x.wallet_id = ?", wid),
		"bank links": count(t, st, "SELECT COUNT(*) FROM bank_links l JOIN bank_connections c ON c.id = l.connection_id WHERE c.wallet_id = ? AND c.provider = 'demo'", wid),
	} {
		if n == 0 {
			t.Errorf("no %s in the demo wallet", what)
		}
	}

	// No account ends the year overdrawn or buried in cash.
	rows, err := st.Read().Query(`SELECT a.name, a.initial_balance + COALESCE(SUM(t.amount), 0)
		FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
		WHERE a.wallet_id = ? GROUP BY a.id`, wid)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var name string
		var balance int64
		if err := rows.Scan(&name, &balance); err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: %d", name, balance)
		if name != "Carta di credito" && (balance < 0 || (name == "Contanti" && balance > 50000)) {
			t.Errorf("%s ends at %d", name, balance)
		}
	}
}

func TestStartIsLimited(t *testing.T) {
	cfg := limits()
	cfg.SessionsPerHour = 2
	cfg.MaxUsers = 3
	svc, _, _ := newFixture(t, cfg)
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		if _, _, err := svc.Start(ctx, "10.0.0.1", "", ""); err != nil {
			t.Fatalf("Start %d: %v", i, err)
		}
	}
	if _, _, err := svc.Start(ctx, "10.0.0.1", "", ""); !errors.Is(err, ErrTooMany) {
		t.Fatalf("third start from one address: err = %v, want ErrTooMany", err)
	}
	if _, _, err := svc.Start(ctx, "10.0.0.2", "", ""); err != nil {
		t.Fatalf("start from another address: %v", err)
	}
	if _, _, err := svc.Start(ctx, "10.0.0.3", "", ""); !errors.Is(err, ErrFull) {
		t.Fatalf("fourth account: err = %v, want ErrFull", err)
	}
}

func TestPurge(t *testing.T) {
	svc, st, _ := newFixture(t, limits())
	ctx := context.Background()
	if _, _, err := svc.Start(ctx, "10.0.0.1", "en", ""); err != nil {
		t.Fatal(err)
	}

	if n, err := svc.Purge(ctx, false); err != nil || n != 0 {
		t.Fatalf("a sweep deleted %d accounts in use (%v)", n, err)
	}
	svc.now = func() time.Time { return time.Now().Add(3 * time.Hour) }
	if n, err := svc.Purge(ctx, false); err != nil || n != 1 {
		t.Fatalf("a sweep after three idle hours deleted %d (%v), want 1", n, err)
	}
	if n := count(t, st, "SELECT COUNT(*) FROM wallets"); n != 0 {
		t.Fatalf("%d wallets outlived their account", n)
	}
	if n := count(t, st, "SELECT COUNT(*) FROM transactions"); n != 0 {
		t.Fatalf("%d transactions outlived their wallet", n)
	}

	svc.now = time.Now
	for _, ip := range []string{"10.0.0.2", "10.0.0.3"} {
		if _, _, err := svc.Start(ctx, ip, "en", ""); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := svc.Purge(ctx, true); err != nil || n != 2 {
		t.Fatalf("the nightly purge deleted %d (%v), want every account", n, err)
	}
}

func TestPrepareRefusesARealDatabase(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = st.Close() }()
	if _, err := auth.NewService(db.New(st.Write())).CreateUser(context.Background(), "me", "", "password1", true); err != nil {
		t.Fatal(err)
	}
	if err := Prepare(context.Background(), st.Write(), dir, limits()); !errors.Is(err, ErrRealDatabase) {
		t.Fatalf("Prepare on a database with a real user: err = %v, want ErrRealDatabase", err)
	}
	if _, err := os.Stat(filepath.Join(dir, markerName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("the refused directory was marked as the demo's")
	}
}

func TestCapsHoldOnEveryPath(t *testing.T) {
	cfg := limits()
	cfg.MaxWallets = 1
	cfg.MaxTransactions = 400
	svc, st, dir := newFixture(t, cfg)
	ctx := context.Background()
	u, _, err := svc.Start(ctx, "10.0.0.1", "en", "")
	if err != nil {
		t.Fatal(err)
	}

	// A second wallet, however it is made, is refused by the database.
	if _, err := wallet.NewService(st.Write()).Create(ctx, u.ID, "Another", ""); !IsLimit(err) {
		t.Fatalf("second wallet: err = %v, want a demo limit", err)
	}
	if full, err := svc.WalletsFull(ctx, u.ID); err != nil || !full {
		t.Fatalf("WalletsFull = %v (%v), want true", full, err)
	}

	// So is the transaction past the cap.
	var wid, acc int64
	if err := st.Read().QueryRow("SELECT wallet_id, id FROM accounts LIMIT 1").Scan(&wid, &acc); err != nil {
		t.Fatal(err)
	}
	have := count(t, st, "SELECT COUNT(*) FROM transactions WHERE wallet_id = ?", wid)
	q := db.New(st.Write())
	var last error
	for i := have; i <= cfg.MaxTransactions && last == nil; i++ {
		_, last = q.InsertTransaction(ctx, db.InsertTransactionParams{
			WalletID: wid, AccountID: acc, Date: "2026-01-01", Amount: -100,
		})
	}
	if !IsLimit(last) {
		t.Fatalf("transaction past the cap: err = %v, want a demo limit", last)
	}
	if n := count(t, st, "SELECT COUNT(*) FROM transactions WHERE wallet_id = ?", wid); n != cfg.MaxTransactions {
		t.Fatalf("%d transactions, want the cap of %d", n, cfg.MaxTransactions)
	}

	// The same directory opens again as the demo's, caps and all.
	if err := Prepare(ctx, st.Write(), dir, cfg); err != nil {
		t.Fatalf("Prepare on the demo's own directory: %v", err)
	}
}

func TestLanguage(t *testing.T) {
	for header, want := range map[string]string{
		"":                           "en",
		"it":                         "it",
		"it-IT,it;q=0.9":             "it",
		"de-DE,it;q=0.8,en;q=0.7":    "it",
		"fr-FR,en-GB;q=0.8,it;q=0.5": "en",
		"italic":                     "en",
	} {
		if got := Language(header); got != want {
			t.Errorf("Language(%q) = %q, want %q", header, got, want)
		}
	}
}

func TestVisitor(t *testing.T) {
	cases := []struct {
		peer, xff string
		hops      int
		want      string
	}{
		{"10.1.1.1:5000", "", 0, "10.1.1.1"},
		{"10.1.1.1:5000", "203.0.113.9", 0, "10.1.1.1"},             // header ignored
		{"10.1.1.1:5000", "6.6.6.6, 203.0.113.9", 1, "203.0.113.9"}, // the proxy's entry, not the client's
		{"10.1.1.1:5000", "203.0.113.9, 10.2.2.2", 2, "203.0.113.9"},
		{"10.1.1.1:5000", "203.0.113.9", 3, "10.1.1.1"}, // fewer entries than hops
		{"10.1.1.1:5000", "not-an-ip", 1, "10.1.1.1"},
	}
	for _, c := range cases {
		if got := Visitor(c.peer, c.xff, c.hops); got != c.want {
			t.Errorf("Visitor(%q, %q, %d) = %q, want %q", c.peer, c.xff, c.hops, got, c.want)
		}
	}
}

func TestNextNightly(t *testing.T) {
	at := func(h, m int) time.Time { return time.Date(2026, 5, 10, h, m, 0, 0, time.UTC) }
	if got := NextNightly(at(1, 0)); !got.Equal(at(3, 0)) {
		t.Errorf("before 03:00: %v", got)
	}
	if got := NextNightly(at(3, 0)); !got.Equal(at(3, 0).AddDate(0, 0, 1)) {
		t.Errorf("at 03:00: %v", got)
	}
	if got := NextNightly(at(23, 30)); !got.Equal(at(3, 0).AddDate(0, 0, 1)) {
		t.Errorf("late evening: %v", got)
	}
}
