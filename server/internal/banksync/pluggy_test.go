package banksync

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// stubDoer answers requests from a table keyed by "METHOD path?query", so a test
// states exactly the API conversation it expects. An unexpected request fails
// loudly rather than returning a zero value that quietly changes the outcome.
type stubDoer struct {
	t        *testing.T
	handlers map[string]func(*http.Request) (int, string)
	seen     []string
}

func (d *stubDoer) Do(req *http.Request) (*http.Response, error) {
	key := req.Method + " " + req.URL.Path
	if q := req.URL.RawQuery; q != "" {
		key += "?" + q
	}
	d.seen = append(d.seen, key)
	h, ok := d.handlers[key]
	if !ok {
		d.t.Errorf("unexpected request: %s", key)
		return &http.Response{StatusCode: 500, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	}
	status, body := h(req)
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}, nil
}

func ok(body string) func(*http.Request) (int, string) {
	return func(*http.Request) (int, string) { return http.StatusOK, body }
}

func TestPluggyAuthenticate(t *testing.T) {
	d := &stubDoer{t: t, handlers: map[string]func(*http.Request) (int, string){
		"POST /auth": func(r *http.Request) (int, string) {
			var in map[string]string
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if in["clientId"] != "cid" || in["clientSecret"] != "csecret" {
				t.Errorf("credentials sent = %v", in)
			}
			return http.StatusOK, `{"apiKey":"KEY-1"}`
		},
	}}
	key, err := newPluggyClient(d, "https://pluggy.test").authenticate(context.Background(), "cid", "csecret")
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if key.Key != "KEY-1" {
		t.Errorf("key = %q", key.Key)
	}
	if key.ExpiresAt.IsZero() {
		t.Error("expiry not set: a key with no deadline would be reused past its life")
	}
}

func TestPluggyAuthenticateRejectsBadCredentials(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		d := &stubDoer{t: t, handlers: map[string]func(*http.Request) (int, string){
			"POST /auth": func(*http.Request) (int, string) { return status, `{"message":"nope"}` },
		}}
		_, err := newPluggyClient(d, "https://pluggy.test").authenticate(context.Background(), "cid", "bad")
		if !errors.Is(err, ErrPluggyCredentials) {
			t.Errorf("status %d: err = %v, want ErrPluggyCredentials", status, err)
		}
	}

	// A 200 with no key is still a failure, not an empty success.
	d := &stubDoer{t: t, handlers: map[string]func(*http.Request) (int, string){
		"POST /auth": ok(`{}`),
	}}
	if _, err := newPluggyClient(d, "https://pluggy.test").authenticate(context.Background(), "cid", "s"); !errors.Is(err, ErrPluggyCredentials) {
		t.Errorf("empty apiKey: err = %v, want ErrPluggyCredentials", err)
	}
}

func TestPluggyAccounts(t *testing.T) {
	d := &stubDoer{t: t, handlers: map[string]func(*http.Request) (int, string){
		"GET /accounts?itemId=item-1": func(r *http.Request) (int, string) {
			if got := r.Header.Get("X-API-KEY"); got != "KEY-1" {
				t.Errorf("X-API-KEY = %q", got)
			}
			return http.StatusOK, `{"results":[
				{"id":"acc-1","type":"BANK","name":"Conta","marketingName":"Conta Fácil","balance":1234.56,"currencyCode":"BRL"},
				{"id":"acc-2","type":"CREDIT","name":"","marketingName":"","number":"**** 4321","balance":-200,"currencyCode":"BRL"}
			],"page":1,"total":2,"totalPages":1}`
		},
	}}
	accounts, err := newPluggyClient(d, "https://pluggy.test").accounts(context.Background(), "KEY-1", "item-1")
	if err != nil {
		t.Fatalf("accounts: %v", err)
	}
	if len(accounts) != 2 {
		t.Fatalf("accounts = %d, want 2", len(accounts))
	}
	if accounts[0].displayName() != "Conta Fácil" {
		t.Errorf("displayName = %q, want the marketing name", accounts[0].displayName())
	}
	// With no names at all, the number is more use to a human than the uuid.
	if accounts[1].displayName() != "**** 4321" {
		t.Errorf("displayName = %q, want the account number fallback", accounts[1].displayName())
	}
	// Balances stay decimal strings: a float must never touch money.
	if accounts[0].Balance.String() != "1234.56" {
		t.Errorf("balance = %q, want the literal decimal", accounts[0].Balance.String())
	}
}

func TestPluggyTransactionsFollowsCursor(t *testing.T) {
	first := "GET /v2/transactions?" + url.Values{"accountId": {"acc-1"}, "dateFrom": {"2026-01-01"}}.Encode()
	d := &stubDoer{t: t, handlers: map[string]func(*http.Request) (int, string){
		first: ok(`{"results":[{"id":"t1","amount":-10,"date":"2026-01-05T00:00:00.000Z","type":"DEBIT","status":"POSTED"}],
		            "next":"?accountId=acc-1&after=CURSOR2"}`),
		"GET /v2/transactions?accountId=acc-1&after=CURSOR2": ok(
			`{"results":[{"id":"t2","amount":-20,"date":"2026-01-06T00:00:00.000Z","type":"DEBIT","status":"POSTED"}],"next":null}`),
	}}
	txns, err := newPluggyClient(d, "https://pluggy.test").
		transactions(context.Background(), "KEY-1", "acc-1", "2026-01-01")
	if err != nil {
		t.Fatalf("transactions: %v", err)
	}
	if len(txns) != 2 {
		t.Fatalf("transactions = %d, want 2 across both pages", len(txns))
	}
	if txns[0].ID != "t1" || txns[1].ID != "t2" {
		t.Errorf("ids = %q, %q", txns[0].ID, txns[1].ID)
	}
	if len(d.seen) != 2 {
		t.Errorf("requests = %d (%v), want exactly 2", len(d.seen), d.seen)
	}
}

func TestPluggyTransactionsMapsErrors(t *testing.T) {
	q := "GET /v2/transactions?accountId=acc-1"
	for status, want := range map[int]error{
		http.StatusUnauthorized: ErrPluggyCredentials,
		http.StatusForbidden:    ErrPluggyCredentials,
		http.StatusNotFound:     ErrPluggyItemNotFound,
	} {
		d := &stubDoer{t: t, handlers: map[string]func(*http.Request) (int, string){
			q: func(*http.Request) (int, string) { return status, `{}` },
		}}
		_, err := newPluggyClient(d, "https://pluggy.test").transactions(context.Background(), "K", "acc-1", "")
		if !errors.Is(err, want) {
			t.Errorf("status %d: err = %v, want %v", status, err, want)
		}
	}
}

// The sign rules are the part of this provider most likely to be wrong in a way
// nobody notices, so they are pinned explicitly for both account types.
func TestPluggySignedAmount(t *testing.T) {
	for _, tc := range []struct {
		name        string
		amount      string
		txType      string
		accountType string
		want        string
	}{
		// A bank account takes its direction from the type field.
		{"bank debit", "10.50", "DEBIT", "BANK", "-10.50"},
		{"bank credit", "1500", "CREDIT", "BANK", "1500"},
		{"bank debit already signed", "-10.50", "DEBIT", "BANK", "-10.50"},
		{"bank credit signed oddly", "-1500", "CREDIT", "BANK", "1500"},

		// A credit card inverts: a positive amount is a new charge, i.e. spending.
		{"card charge", "42.30", "DEBIT", "CREDIT", "-42.30"},
		{"card payment", "-500", "CREDIT", "CREDIT", "500"},
		{"card refund", "-15.99", "DEBIT", "CREDIT", "15.99"},

		// With no usable type, the literal sign is the only honest guide.
		{"unknown type keeps sign", "-7.25", "", "BANK", "-7.25"},
		{"unknown type positive", "7.25", "WEIRD", "BANK", "7.25"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx := pluggyTransaction{Amount: json.Number(tc.amount), Type: tc.txType}
			if got := tx.signedAmount(tc.accountType); got != tc.want {
				t.Errorf("signedAmount(%s) = %q, want %q", tc.accountType, got, tc.want)
			}
		})
	}
}

func TestPluggyRows(t *testing.T) {
	txns := []pluggyTransaction{
		{ID: "t1", Description: "Padaria", Amount: "12.34", Date: "2026-02-03T00:00:00.000Z", Type: "DEBIT", Status: "POSTED"},
		{ID: "t2", Description: "", DescriptionRaw: "PIX RECEBIDO", Amount: "99", Date: "2026-02-04T00:00:00.000Z", Type: "CREDIT", Status: "PENDING"},
		{ID: "t3", Description: "no date", Amount: "1", Date: "", Type: "DEBIT", Status: "POSTED"},
	}
	rows := pluggyRows(txns, "BANK")
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2: the undated movement is unusable", len(rows))
	}

	// Amounts are 6-decimal fixed point, as the import pipeline expects.
	if rows[0].Amount != -12_340_000 {
		t.Errorf("amount = %d, want -12340000", rows[0].Amount)
	}
	if rows[0].Date != "2026-02-03" {
		t.Errorf("date = %q, want the calendar day only", rows[0].Date)
	}
	if rows[0].Status != 1 {
		t.Errorf("status = %d, want 1 for POSTED", rows[0].Status)
	}
	if rows[0].FITID != "pluggy:t1" {
		t.Errorf("FITID = %q, want the namespaced provider id", rows[0].FITID)
	}

	if rows[1].Memo != "PIX RECEBIDO" {
		t.Errorf("memo = %q, want the raw description when the clean one is empty", rows[1].Memo)
	}
	if rows[1].Status != 0 {
		t.Errorf("status = %d, want 0 for PENDING", rows[1].Status)
	}
	if rows[1].Amount != 99_000_000 {
		t.Errorf("amount = %d, want 99000000", rows[1].Amount)
	}
}

func TestPluggyRowsOnACreditCard(t *testing.T) {
	// The regression that matters: on a card, a positive amount is spending.
	// Booked as income it would silently inflate every report.
	rows := pluggyRows([]pluggyTransaction{
		{ID: "c1", Description: "Compra", Amount: "80", Date: "2026-02-10T00:00:00.000Z", Type: "DEBIT", Status: "POSTED"},
		{ID: "c2", Description: "Pagamento fatura", Amount: "-300", Date: "2026-02-11T00:00:00.000Z", Type: "CREDIT", Status: "POSTED"},
	}, "CREDIT")
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	if rows[0].Amount != -80_000_000 {
		t.Errorf("card charge = %d, want -80000000 (an expense)", rows[0].Amount)
	}
	if rows[1].Amount != 300_000_000 {
		t.Errorf("card payment = %d, want +300000000", rows[1].Amount)
	}
}

func TestEnsureLeadingQuery(t *testing.T) {
	for in, want := range map[string]string{
		"?a=1": "?a=1",
		"&a=1": "?a=1",
		"a=1":  "?a=1",
	} {
		if got := ensureLeadingQuery(in); got != want {
			t.Errorf("ensureLeadingQuery(%q) = %q, want %q", in, got, want)
		}
	}
}
