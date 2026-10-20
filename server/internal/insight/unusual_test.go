package insight

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/provenance"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// Known cases: an amount out of scale for its payee, a new payee with a large
// amount, a payee charged twice, and one entered by another member are
// flagged; ordinary expenses, a small new payee and the reader's own entry are
// not. The first look tells nobody; a later flag reaches the bell; "It's fine"
// holds until the amount changes; a pair marked not a duplicate is gone.
func TestUnusualTransactions(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	u, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "anna", PasswordHash: "x", Locale: "it"})
	_, _ = st.Write().ExecContext(ctx, "UPDATE users SET is_admin = 1 WHERE id = ?", u.ID)
	bob, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "bob", PasswordHash: "x", Locale: "it"})
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Casa"})
	_ = q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: u.ID, Role: "owner"})
	_ = q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: bob.ID, Role: "owner"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€", DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "Conto", Type: "checking", CurrencyID: cur.ID, Position: 1})
	payee := func(name string) *int64 {
		p, err := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: w.ID, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return &p.ID
	}
	energy, cafe, streaming := payee("Energy"), payee("Café"), payee("Streaming")
	electronics, bakery, shop, garage := payee("Electronics"), payee("Bakery"), payee("Shop"), payee("Garage")

	txns := transaction.NewService(st.Write())
	bank := provenance.WithOrigin(ctx, provenance.Bank)
	add := func(ctx context.Context, p *int64, date string, amount int64) int64 {
		t.Helper()
		x, err := txns.Create(ctx, w.ID, transaction.Input{AccountID: acc.ID, Date: date, Amount: amount, PayeeID: p})
		if err != nil {
			t.Fatal(err)
		}
		return x.ID
	}
	for m := 0; m < 11; m++ {
		month := time.Date(2025, time.Month(11+m), 1, 0, 0, 0, 0, time.UTC)
		add(bank, energy, month.AddDate(0, 0, 16).Format(day), -7892)
		add(bank, streaming, month.AddDate(0, 0, 14).Format(day), -1349)
		add(bank, cafe, month.AddDate(0, 0, 4).Format(day), -314)
		add(bank, cafe, month.AddDate(0, 0, 20).Format(day), -314)
	}
	energyID := add(bank, energy, "2026-10-14", -23640) // 3 times the usual
	add(bank, cafe, "2026-10-05", -314)
	add(bank, cafe, "2026-10-17", -400) // a little more: ordinary
	add(bank, streaming, "2026-10-15", -1349)
	doubleID := add(bank, streaming, "2026-10-16", -1349)                           // charged twice
	add(bank, electronics, "2026-10-18", -48900)                                    // a new payee, large
	add(bank, bakery, "2026-10-19", -1200)                                          // a new payee, small
	add(provenance.WithUser(ctx, u.ID), shop, "2026-10-19", -90000)                 // typed in by the reader
	garageID := add(provenance.WithUser(ctx, bob.ID), garage, "2026-10-10", -60000) // by another member

	var mu sync.Mutex
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		asked = append(asked, string(b))
		mu.Unlock()
		_, _ = rw.Write([]byte(`{"choices":[{"message":{"content":"La bolletta è tre volte la solita."}}]}`))
	}))
	defer srv.Close()
	aisvc := ai.NewService(st.Read(), st.Write())
	key := "k"
	if _, err := aisvc.UpdateSettings(ctx, u.ID, true, ai.SettingsInput{
		Enabled: true, BaseURL: srv.URL, Model: "m", APIKey: &key, Features: &ai.Features{Unusual: true},
	}); err != nil {
		t.Fatal(err)
	}
	n := notify.NewService(st.Read(), st.Write(), nil)
	svc := NewService(st.Read(), st.Write(), aisvc, report.NewService(st.Read()), budget.NewServiceWithRead(st.Read(), st.Write()),
		schedule.NewServiceWithRead(st.Read(), st.Write(), txns, nil, slog.Default()))
	svc.SetNotify(n)
	clock := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }

	flagged := func() map[int64]UnusualRow {
		t.Helper()
		got, err := svc.UnusualOf(ctx, u.ID, w.ID)
		if err != nil {
			t.Fatal(err)
		}
		out := map[int64]UnusualRow{}
		for _, r := range got.Rows {
			out[r.TransactionID] = r
		}
		return out
	}
	run := func() {
		t.Helper()
		if err := svc.RunUnusual(ctx); err != nil {
			t.Fatal(err)
		}
	}

	// The first look: four flags, nobody told, the model asked once.
	run()
	rows := flagged()
	if len(rows) != 4 {
		t.Fatalf("flags = %+v", rows)
	}
	if r := rows[energyID]; r.Kind != unusualScale || r.Usual != 7892 || r.Payments != 11 || r.Amount != 23640 {
		t.Fatalf("energy = %+v", r)
	}
	if r := rows[doubleID]; r.Kind != unusualDouble || r.OtherDate != "2026-10-15" {
		t.Fatalf("double = %+v", r)
	}
	if r := rows[garageID]; r.Kind != unusualNew {
		t.Fatalf("garage = %+v", r)
	}
	var electronicsFlag UnusualRow
	for _, r := range rows {
		if r.Payee == "Electronics" {
			electronicsFlag = r
		}
	}
	if electronicsFlag.Kind != unusualNew || electronicsFlag.Usual < 5000 {
		t.Fatalf("electronics = %+v", electronicsFlag)
	}
	if items, _, _ := n.List(ctx, u.ID); len(items) != 0 {
		t.Fatalf("the first look told %+v", items)
	}
	if len(asked) != 1 ||
		!strings.Contains(asked[0], "Do not accuse anyone") ||
		!strings.Contains(asked[0], "Energy, 2026-10-14: 236.40 EUR; usually (median) 78.92 EUR over 11 payments in the year before") ||
		!strings.Contains(asked[0], "Streaming: 13.49 EUR charged twice, on 2026-10-15 and 2026-10-16") ||
		!strings.Contains(asked[0], "Electronics, 2026-10-18: 489.00 EUR; a new payee") {
		t.Fatalf("the model was asked %v", asked)
	}
	if got, _ := svc.UnusualOf(ctx, u.ID, w.ID); got.Body != "La bolletta è tre volte la solita." {
		t.Fatalf("body = %q", got.Body)
	}

	// Nothing new: no look, no call.
	run()
	if len(asked) != 1 {
		t.Fatalf("asked again: %d", len(asked))
	}

	// A new one is told in the bell, opening the register on it.
	cafeID := add(bank, cafe, "2026-10-20", -5000)
	run()
	items, _, _ := n.List(ctx, u.ID)
	if len(items) != 1 || items[0].Title != "Transazione insolita" ||
		!strings.Contains(items[0].Body, "Café: 16 volte il solito") ||
		!strings.HasSuffix(items[0].URL, "&txn="+strconv.FormatInt(cafeID, 10)) {
		t.Fatalf("bell = %+v", items)
	}
	if len(asked) != 2 {
		t.Fatalf("calls = %d", len(asked))
	}

	// "It's fine" holds, until the amount changes.
	if err := svc.UnusualFine(ctx, u.ID, w.ID, rows[energyID].ID); err != nil {
		t.Fatal(err)
	}
	add(bank, cafe, "2026-10-20", -314)
	run()
	if _, ok := flagged()[energyID]; ok {
		t.Fatal("a flag put away came back")
	}
	if _, err := st.Write().ExecContext(ctx, "UPDATE transactions SET amount = -30000 WHERE id = ?", energyID); err != nil {
		t.Fatal(err)
	}
	add(bank, cafe, "2026-10-20", -314)
	run()
	if r, ok := flagged()[energyID]; !ok || r.Amount != 30000 {
		t.Fatalf("energy after its amount changed = %+v", r)
	}

	// Not a duplicate, on Review: the double is gone.
	if _, err := st.Write().ExecContext(ctx, "INSERT INTO duplicate_dismissals (wallet_id, txn_a_id, txn_b_id) VALUES (?, ?, ?)",
		w.ID, doubleID-1, doubleID); err != nil {
		t.Fatal(err)
	}
	if _, ok := flagged()[doubleID]; ok {
		t.Fatal("the double is still flagged")
	}

	if err := svc.SetUnusualFeedback(ctx, u.ID, w.ID, 1); err != nil {
		t.Fatal(err)
	}
	if err := svc.UnusualFine(ctx, bob.ID, w.ID, rows[garageID].ID); err != ErrNotFound {
		t.Fatalf("another user's flag: %v", err)
	}
}
