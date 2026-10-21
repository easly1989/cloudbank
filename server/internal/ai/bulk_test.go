package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func TestProposeCategories(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	svc.now = func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: wid, IsoCode: "EUR", Name: "Euro", Symbol: "€", DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: wid, Name: "A", Type: "checking", CurrencyID: cur.ID, Position: 1})
	ts := transaction.NewService(svc.db)
	cat := func(name string) int64 {
		c, err := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return c.ID
	}
	payee := func(name string) int64 {
		p, err := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: wid, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	food, sport, home := cat("Food"), cat("Sport"), cat("Home")
	cafe, yoga, _ := payee("Café"), payee("Yoga studio"), payee("Bar")
	add := func(date string, p *int64, c *int64, memo, ref string) int64 {
		t.Helper()
		tx, err := ts.Create(ctx, wid, transaction.Input{AccountID: acc.ID, Date: date, Amount: -4500, PayeeID: p, CategoryID: c, Memo: memo})
		if err != nil {
			t.Fatal(err)
		}
		if ref != "" {
			if err := q.SetTransactionImportRef(ctx, db.SetTransactionImportRefParams{ImportRef: ref, ID: tx.ID, WalletID: wid}); err != nil {
				t.Fatal(err)
			}
		}
		return tx.ID
	}
	// The café's history: four of five in Food.
	for _, d := range []string{"2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"} {
		add(d, &cafe, &food, "", "")
	}
	add("2026-09-01", &cafe, &home, "", "")
	add("2026-09-02", &yoga, &sport, "", "") // one only: not enough history

	fromHistory := add("2026-10-18", nil, nil, "CARD PAYMENT CAFE CENTRALE 14:02", "r1")
	toModel := add("2026-10-16", nil, nil, "POS YOGA STUDIO ZEN", "r2")
	_ = add("2026-10-14", nil, nil, "ATM WITHDRAWAL 0091", "r3")               // no payee: nothing
	_ = add("2026-10-13", nil, nil, "BARCLAYS TRANSFER", "r4")                 // "Bar" is not a whole word here
	_ = add("2026-10-12", &yoga, &sport, "already filed", "r5")                // has a category: not a row
	ownPayee := add("2026-10-11", &yoga, nil, "SOMETHING ELSE ENTIRELY", "r6") // its own payee

	// Switched off: nothing is worked out.
	if _, err := svc.ProposeCategories(ctx, uid, wid, false); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("off: err = %v, want ErrNotConfigured", err)
	}
	key := "k"
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key, Features: &Features{Suggest: true},
	}); err != nil {
		t.Fatal(err)
	}
	mock := &mockDoer{reply: "1: Sport\n2) none\nnoise"}
	svc.hc = mock
	got, err := svc.ProposeCategories(ctx, uid, wid, false)
	if err != nil {
		t.Fatal(err)
	}
	// In the rows' order; the model's "none" keeps the payee, without a category.
	want := []struct {
		id, payee, cat int64
		source         string
	}{
		{fromHistory, cafe, food, SourceHistory},
		{toModel, yoga, sport, SourceAI},
		{ownPayee, yoga, 0, SourceAI},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i, w := range want {
		g := got[i]
		cat := int64(0)
		if g.CategoryID != nil {
			cat = *g.CategoryID
		}
		if g.ID != w.id || g.PayeeID != w.payee || cat != w.cat || g.Source != w.source {
			t.Errorf("row %d = %+v (category %d), want %+v", i, g, cat, w)
		}
	}
	// The model saw the payees, the amounts and the dates, never the bank's text.
	sent := string(mock.lastBody)
	for _, s := range []string{"1. Payee: Yoga studio; Amount: -45.00 EUR; Date: 2026-10-16", "2. Payee: Yoga studio; Amount: -45.00 EUR; Date: 2026-10-11"} {
		if !strings.Contains(sent, s) {
			t.Errorf("sent lacks %q: %s", s, sent)
		}
	}
	for _, s := range []string{"ZEN", "CAFE", "ATM", "SOMETHING", "Café"} {
		if strings.Contains(sent, s) {
			t.Errorf("sent carries %q: %s", s, sent)
		}
	}
}

func TestPayeeInText(t *testing.T) {
	payees := []db.Payee{{ID: 1, Name: "Bar"}, {ID: 2, Name: "Bar Roma"}, {ID: 3, Name: "Café"}, {ID: 4, Name: "Al"}, {ID: 5, Name: "Lodz"}, {ID: 6, Name: "Strasse"}}
	for text, want := range map[string]int64{
		"POS BAR ROMA 12":   2, // the longest wins
		"bar-roma":          2,
		"PAGAMENTO BAR":     1,
		"BARCLAYS":          0,
		"CAFFE":             0,
		"cafe' centrale":    3,
		"CAFÉ":              3,
		"Łódź":              5, // a mark that does not decompose
		"Straße":            6,
		"ADDEBITO AL CONTO": 0, // too short to look for
		"":                  0,
	} {
		if got := payeeInText(text, payees); got != want {
			t.Errorf("payeeInText(%q) = %d, want %d", text, got, want)
		}
	}
}

// batchDoer answers "1: Sport" to the first calls and fails from call failFrom.
type batchDoer struct{ calls, failFrom int }

func (d *batchDoer) Do(*http.Request) (*http.Response, error) {
	d.calls++
	if d.failFrom > 0 && d.calls >= d.failFrom {
		return &http.Response{StatusCode: http.StatusInternalServerError, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	}
	body, _ := json.Marshal(map[string]any{"choices": []map[string]any{{"message": map[string]string{"content": "1: Sport"}}}})
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader(body))}, nil
}

func TestProposeCategoriesInBatches(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: wid, IsoCode: "EUR", Name: "Euro", Symbol: "€", DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: wid, Name: "A", Type: "checking", CurrencyID: cur.ID, Position: 1})
	ts := transaction.NewService(svc.db)
	sport, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Sport"})
	yoga, _ := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: wid, Name: "Yoga"})
	// 2*bulkMax+1 rows for the model: three calls.
	for i := range 2*bulkMax + 1 {
		tx, err := ts.Create(ctx, wid, transaction.Input{AccountID: acc.ID, Date: fmt.Sprintf("2026-%02d-%02d", 1+i/28, 1+i%28), Amount: -100, PayeeID: &yoga.ID})
		if err != nil {
			t.Fatal(err)
		}
		_ = q.SetTransactionImportRef(ctx, db.SetTransactionImportRefParams{ImportRef: fmt.Sprint("r", i), ID: tx.ID, WalletID: wid})
	}
	key := "k"
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key, Features: &Features{Suggest: true},
	}); err != nil {
		t.Fatal(err)
	}
	filed := func(ps []BulkProposal) (n int) {
		for _, p := range ps {
			if p.CategoryID != nil && *p.CategoryID == sport.ID {
				n++
			}
		}
		return n
	}

	// Every batch is asked: the first row of each comes back Sport.
	d := &batchDoer{}
	svc.hc = d
	got, err := svc.ProposeCategories(ctx, uid, wid, false)
	if err != nil || len(got) != 2*bulkMax+1 || d.calls != 3 || filed(got) != 3 {
		t.Fatalf("got %d proposals, %d filed, %d calls, err %v; want %d, 3, 3", len(got), filed(got), d.calls, err, 2*bulkMax+1)
	}

	// A later call that fails keeps what came before; the rest keep their payee.
	d = &batchDoer{failFrom: 2}
	svc.hc = d
	got, err = svc.ProposeCategories(ctx, uid, wid, false)
	if err != nil || len(got) != 2*bulkMax+1 || d.calls != 2 || filed(got) != 1 {
		t.Fatalf("got %d proposals, %d filed, %d calls, err %v; want %d, 1, 2", len(got), filed(got), d.calls, err, 2*bulkMax+1)
	}

	// The first call failing is an error.
	svc.hc = &batchDoer{failFrom: 1}
	if _, err := svc.ProposeCategories(ctx, uid, wid, false); err == nil {
		t.Fatal("a failing first call should fail")
	}
}
