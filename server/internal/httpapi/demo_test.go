package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/backup"
	"github.com/easly1989/cloudbank/server/internal/banksync"
	"github.com/easly1989/cloudbank/server/internal/config"
	"github.com/easly1989/cloudbank/server/internal/currency"
	"github.com/easly1989/cloudbank/server/internal/demo"
	"github.com/easly1989/cloudbank/server/internal/goal"
	"github.com/easly1989/cloudbank/server/internal/importer"
	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/wallet"
)

// newDemoAPI builds the router as the demo build does.
func newDemoAPI(t *testing.T, cfg config.Demo) (*testClient, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := demo.Prepare(context.Background(), st.Write(), dir, cfg); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	a := auth.NewService(db.New(st.Write()))
	a.SetSessionTTL(cfg.Idle)
	tsvc := transaction.NewService(st.Write())
	accts := account.NewService(st.Write())
	csv := importio.NewService(st.Write(), tsvc, assignment.NewService(st.Write()), accts)
	bank := banksync.NewService(st.Read(), st.Write(), csv)
	bank.OnlyDemoBank()
	imp := importer.NewService(st.Write())
	goals := goal.NewService(st.Write())
	srv := httptest.NewServer(New(Options{
		Auth: a, Wallets: wallet.NewService(st.Write()), Currencies: currency.NewService(st.Write()),
		Accounts: accts, Transactions: tsvc, Goals: goals, Import: imp, CSV: csv, BankSync: bank,
		Backup: backup.NewService(st.Write()),
		Demo:   demo.New(cfg, st.Write(), a, imp, goals, bank),
	}))
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return &testClient{t: t, base: srv.URL, hc: &http.Client{Jar: jar}}, st
}

func demoLimits() config.Demo {
	return config.Demo{
		Idle: 2 * time.Hour, MaxUsers: 10, SessionsPerHour: 10,
		MaxTransactions: 5000, MaxWallets: 3, MaxBody: 64 << 10,
	}
}

func decodeInto(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatalf("decode: %v", err)
	}
}

func errCode(t *testing.T, resp *http.Response) string {
	t.Helper()
	var out struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeInto(t, resp, &out)
	return out.Error.Code
}

// startDemo presses the demo's one button.
func startDemo(t *testing.T, c *testClient) (userResponse, int64) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, c.base+"/api/v1/demo/session", nil)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Accept-Language", "it-IT,it;q=0.9")
	resp, err := c.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /demo/session = %d", resp.StatusCode)
	}
	u := decodeUser(t, resp)
	var wallets []walletResponse
	decodeInto(t, c.do(http.MethodGet, "/api/v1/wallets", nil, false), &wallets)
	if len(wallets) != 1 {
		t.Fatalf("%d wallets, want the demo's one", len(wallets))
	}
	return u, wallets[0].ID
}

func TestDemoStartsWithOneButton(t *testing.T) {
	c, _ := newDemoAPI(t, demoLimits())

	if needsSetup(t, c) {
		t.Fatal("the demo asks for a first administrator")
	}
	u, wid := startDemo(t, c)
	if u.IsAdmin || u.Locale != "it" {
		t.Fatalf("demo user = %+v, want a non-admin in Italian", u)
	}
	me := decodeUser(t, c.do(http.MethodGet, "/api/v1/auth/me", nil, false))
	if me.ID != u.ID {
		t.Fatalf("the session is not the demo account's: %+v", me)
	}

	var conns []banksync.Connection
	decodeInto(t, c.do(http.MethodGet, fmt.Sprintf("/api/v1/wallets/%d/bank/connections", wid), nil, false), &conns)
	if len(conns) != 1 || conns[0].Provider != "demo" {
		t.Fatalf("connections = %+v, want the pretend bank", conns)
	}
	resp := c.do(http.MethodPost, fmt.Sprintf("/api/v1/wallets/%d/bank/connections/%d/sync", wid, conns[0].ID), nil, true)
	var res banksync.SyncResult
	decodeInto(t, resp, &res)
	if resp.StatusCode != http.StatusOK || res.Imported == 0 {
		t.Fatalf("sync = %d %+v, want the pretend bank's lines", resp.StatusCode, res)
	}
}

func TestDemoMountsNothingItSwitchedOff(t *testing.T) {
	c, _ := newDemoAPI(t, demoLimits())
	_, wid := startDemo(t, c)
	w := fmt.Sprintf("/api/v1/wallets/%d", wid)

	for _, r := range []struct{ method, path string }{
		{http.MethodPost, "/api/v1/setup"},
		{http.MethodPost, "/api/v1/auth/login"},
		{http.MethodGet, "/api/v1/auth/tokens"},
		{http.MethodPost, "/api/v1/auth/2fa/setup"},
		{http.MethodGet, "/api/v1/admin/users"},
		{http.MethodPost, "/api/v1/backup/restore"},
		{http.MethodPost, w + "/bank/connections"},
		{http.MethodGet, w + "/bank/enablebanking/config"},
		{http.MethodPost, w + "/bank/pluggy/connect"},
		{http.MethodPost, w + "/bank/connections/1/reauth"},
	} {
		resp := c.do(r.method, r.path, map[string]any{}, true)
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("%s %s = %d, want it not to exist", r.method, r.path, resp.StatusCode)
		}
	}
}

func TestDemoLimits(t *testing.T) {
	cfg := demoLimits()
	cfg.MaxWallets = 1
	cfg.MaxTransactions = 1000
	c, st := newDemoAPI(t, cfg)
	_, wid := startDemo(t, c)

	if resp := c.do(http.MethodPost, "/api/v1/wallets", map[string]any{"title": "Second"}, true); resp.StatusCode != http.StatusConflict || errCode(t, resp) != "demo_limit" {
		t.Fatalf("a wallet past the cap was not refused as a demo limit (%d)", resp.StatusCode)
	}

	big := bytes.Repeat([]byte("x"), int(cfg.MaxBody)+1)
	req, _ := http.NewRequest(http.MethodPost, c.base+"/api/v1/import/xhb", bytes.NewReader(big))
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	resp, err := c.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("an upload past the cap = %d, want it refused", resp.StatusCode)
	}
	resp.Body.Close()

	// Fill the wallet to its cap; then nothing new goes in, but it can be read.
	var acc int64
	if err := st.Read().QueryRow("SELECT id FROM accounts WHERE wallet_id = ? LIMIT 1", wid).Scan(&acc); err != nil {
		t.Fatal(err)
	}
	q := db.New(st.Write())
	for {
		if _, err := q.InsertTransaction(context.Background(), db.InsertTransactionParams{
			WalletID: wid, AccountID: acc, Date: "2026-01-01", Amount: -100,
		}); err != nil {
			if !demo.IsLimit(err) {
				t.Fatal(err)
			}
			break
		}
	}
	w := fmt.Sprintf("/api/v1/wallets/%d", wid)
	txn := map[string]any{"accountId": acc, "date": "2026-01-02", "amount": -500}
	if resp := c.do(http.MethodPost, w+"/transactions", txn, true); resp.StatusCode != http.StatusConflict || errCode(t, resp) != "demo_limit" {
		t.Fatalf("a transaction in a full wallet was not refused as a demo limit (%d)", resp.StatusCode)
	}
	if resp := c.do(http.MethodGet, w+"/accounts", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("a full wallet cannot be read (%d)", resp.StatusCode)
	}
}

func TestNormalBuildHasNoDemo(t *testing.T) {
	c := newTestAPI(t)
	resp := c.do(http.MethodPost, "/api/v1/demo/session", nil, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST /demo/session on a normal server = %d, want it not to exist", resp.StatusCode)
	}
	if !needsSetup(t, c) {
		t.Fatal("a fresh normal server should still ask for setup")
	}
}
