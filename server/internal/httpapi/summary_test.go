package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"
)

// The wallet summary for Home Assistant (#701), read with an API token:
// bills, the month's budget and Review in exact decimals; balances only when
// the URL asks; a revoked token is 401 and a non-member's token 404.
func TestWalletSummary(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccountWithBalance(t, c, 100000)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	day := func(d int) string { return time.Now().UTC().AddDate(0, 0, d).Format("2006-01-02") }

	// Food: 100.00 a month, 120.00 spent today.
	food := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Food"}, true))
	c.do(http.MethodPut, base+"/budgets/"+strconv.FormatInt(food.ID, 10), map[string]any{"mode": "same", "same": -10000}, true).Body.Close()
	c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": day(0), "amount": -12000, "categoryId": food.ID,
	}, true).Body.Close()
	// Bills: one overdue, one due in three days, one in a month.
	for _, b := range []struct {
		name   string
		amount int64
		due    int
	}{{"Rent", -70000, -2}, {"Gym", -3900, 3}, {"Insurance", -25000, 30}} {
		tpl := decodeTemplate(t, c.do(http.MethodPost, base+"/templates", map[string]any{
			"name": b.name, "accountId": acc, "amount": b.amount, "payeeId": makePayee(t, c, wid, b.name),
		}, true))
		c.do(http.MethodPost, base+"/schedules", map[string]any{
			"templateId": tpl["id"], "unit": "month", "everyN": 1, "nextDue": day(b.due), "autoPost": false,
		}, true).Body.Close()
	}
	// Review: a bank row with no category, and a pair that looks doubled.
	if r := c.do(http.MethodPost, base+"/import/commit", map[string]any{
		"accountId": acc, "rows": []map[string]any{{"date": day(0), "amount": -500, "payee": "Kiosk"}},
	}, true); r.StatusCode != http.StatusCreated {
		t.Fatalf("import = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
	// A file import carries no bank reference; bank sync would.
	if _, err := c.st.Write().Exec(`UPDATE transactions SET import_ref = 'bank-1' WHERE amount = -500`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": day(0), "amount": -700}, true).Body.Close()
	}

	mint := func(cl *testClient) (string, string) {
		r := cl.do(http.MethodPost, "/api/v1/auth/tokens", map[string]any{"name": "Home Assistant", "scope": "read"}, true)
		defer r.Body.Close()
		var out struct {
			Token string
			Info  struct{ ID string }
		}
		_ = json.NewDecoder(r.Body).Decode(&out)
		if out.Token == "" {
			t.Fatalf("mint = %d", r.StatusCode)
		}
		return out.Token, out.Info.ID
	}
	get := func(path, tok string) (int, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, c.base+path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r, err := (&http.Client{}).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		var m map[string]any
		d := json.NewDecoder(r.Body)
		d.UseNumber()
		_ = d.Decode(&m)
		return r.StatusCode, m
	}
	str := func(v any) string {
		b, _ := json.Marshal(v)
		return string(b)
	}
	tok, tokID := mint(c)

	code, m := get(base+"/summary", tok)
	if code != http.StatusOK {
		t.Fatalf("summary = %d %v", code, m)
	}
	if _, ok := m["balances"]; ok {
		t.Errorf("balances without asking: %v", m["balances"])
	}
	if m["wallet"] != "Home" || m["currency"] != "EUR" || m["today"] != day(0) {
		t.Errorf("head = %v %v %v", m["wallet"], m["currency"], m["today"])
	}
	if got, want := str(m["bills"]), `{"dueNext7Days":1,"next":{"amount":39.00,"date":"`+day(3)+`","name":"Gym"},"overdue":1,"totalDue":989.00}`; got != want {
		t.Errorf("bills = %s, want %s", got, want)
	}
	if got, want := str(m["budget"]), `{"budgeted":100.00,"left":-20.00,"month":"`+day(0)[:7]+`","over":1,"spent":120.00,"usedPercent":120}`; got != want {
		t.Errorf("budget = %s, want %s", got, want)
	}
	if got, want := str(m["review"]), `{"duplicates":1,"needsCategory":1,"unconfirmed":0}`; got != want {
		t.Errorf("review = %s, want %s", got, want)
	}

	// Balances when asked: 1000.00 - 120.00 - 5.00 - 2 × 7.00.
	if _, m := get(base+"/summary?balances=true", tok); str(m["balances"]) != `{"accounts":[{"balance":861.00,"currency":"EUR","name":"Main"}],"total":861.00}` {
		t.Errorf("balances = %s", str(m["balances"]))
	}

	// Another user's token reaches no wallet of ours.
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bobTok, _ := mint(bob)
	if code, _ := get(base+"/summary", bobTok); code != http.StatusNotFound {
		t.Errorf("non-member's token = %d, want 404", code)
	}

	// A revoked token is refused.
	c.do(http.MethodDelete, "/api/v1/auth/tokens/"+tokID, nil, true).Body.Close()
	if code, _ := get(base+"/summary", tok); code != http.StatusUnauthorized {
		t.Errorf("revoked token = %d, want 401", code)
	}
}
