package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"
)

// makeAccount sets up admin + wallet (EUR base) + an account, returning the
// wallet id and account id.
func makeAccount(t *testing.T, c *testClient) (int64, int64) {
	t.Helper()
	wid := createWalletWithBase(t, c, "EUR")
	acc := decodeAccount(t, c.do(http.MethodPost,
		"/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/accounts",
		map[string]any{"name": "Checking", "type": "checking"}, true))
	return wid, acc.ID
}

func decodeTxn(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("decode transaction: %v", err)
	}
	return m
}

func TestTransactionCrud(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txns := base + "/transactions"

	cat := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Food"}, true))

	resp := c.do(http.MethodPost, txns, map[string]any{
		"accountId": acc, "date": "2026-01-15", "amount": -5000, "paymentMode": 3, "status": 1,
		"categoryId": cat.ID, "memo": "lunch", "tags": []string{"food", "cash"},
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create txn = %d, want 201", resp.StatusCode)
	}
	tx := decodeTxn(t, resp)
	id := int64(tx["id"].(float64))
	if tags, ok := tx["tags"].([]any); !ok || len(tags) != 2 {
		t.Fatalf("tags = %v", tx["tags"])
	}

	// List for the account.
	lresp := c.do(http.MethodGet, txns+"?accountId="+strconv.FormatInt(acc, 10), nil, false)
	defer lresp.Body.Close()
	var list struct {
		Transactions []map[string]any `json:"transactions"`
		Total        int64            `json:"total"`
	}
	_ = json.NewDecoder(lresp.Body).Decode(&list)
	if list.Total != 1 || len(list.Transactions) != 1 {
		t.Fatalf("list = %+v", list)
	}

	// Get + update + delete.
	if r := c.do(http.MethodGet, txns+"/"+strconv.FormatInt(id, 10), nil, false); r.StatusCode != http.StatusOK {
		t.Fatalf("get = %d", r.StatusCode)
	}
	uresp := c.do(http.MethodPatch, txns+"/"+strconv.FormatInt(id, 10), map[string]any{
		"accountId": acc, "date": "2026-01-16", "amount": -6000, "tags": []string{"food"},
	}, true)
	if uresp.StatusCode != http.StatusOK {
		t.Fatalf("update = %d", uresp.StatusCode)
	}
	if u := decodeTxn(t, uresp); int64(u["amount"].(float64)) != -6000 {
		t.Fatalf("updated amount = %v", u["amount"])
	}
	if r := c.do(http.MethodDelete, txns+"/"+strconv.FormatInt(id, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// Tags endpoint returns the wallet's tags.
	tresp := c.do(http.MethodGet, base+"/tags", nil, false)
	defer tresp.Body.Close()
	var tags []string
	_ = json.NewDecoder(tresp.Body).Decode(&tags)
	if len(tags) != 2 {
		t.Fatalf("wallet tags = %v, want 2", tags)
	}
}

func TestTransactionSplitMismatchRejected(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	resp := c.do(http.MethodPost, "/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/transactions", map[string]any{
		"accountId": acc, "date": "2026-01-15", "amount": -10000,
		"splits": []map[string]any{{"amount": -6000}, {"amount": -3000}},
	}, true)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("split mismatch = %d, want 400", resp.StatusCode)
	}
}

func TestTransactionDuplicateCheck(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	txns := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/transactions"
	c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-01-15", "amount": -5000}, true).Body.Close()

	resp := c.do(http.MethodGet, txns+"/duplicates?accountId="+strconv.FormatInt(acc, 10)+"&date=2026-01-16&amount=-5000", nil, false)
	defer resp.Body.Close()
	var dups []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&dups)
	if len(dups) != 1 {
		t.Fatalf("duplicates = %d, want 1", len(dups))
	}
}

func TestTransactionRegisterAndStatus(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txns := base + "/transactions"

	// Insert out of date order; the register must order by (date, id).
	c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-01-10", "amount": 10000}, true).Body.Close()
	c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-01-05", "amount": -3000}, true).Body.Close()
	last := decodeTxn(t, c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-01-10", "amount": 2000}, true))
	lastID := int64(last["id"].(float64))

	resp := c.do(http.MethodGet, txns+"/register?accountId="+strconv.FormatInt(acc, 10), nil, false)
	defer resp.Body.Close()
	var reg struct {
		Rows []struct {
			ID             int64 `json:"id"`
			Date           string
			RunningBalance int64 `json:"runningBalance"`
		} `json:"rows"`
		Summary struct {
			Bank, Today, Future int64
		} `json:"summary"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&reg); err != nil {
		t.Fatalf("decode register: %v", err)
	}
	if len(reg.Rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(reg.Rows))
	}
	if reg.Rows[0].Date != "2026-01-05" || reg.Rows[0].RunningBalance != -3000 {
		t.Fatalf("row 0 = %+v", reg.Rows[0])
	}
	if reg.Rows[2].RunningBalance != 9000 || reg.Summary.Future != 9000 {
		t.Fatalf("final balance = %d / future = %d, want 9000", reg.Rows[2].RunningBalance, reg.Summary.Future)
	}

	// Inline status toggle.
	sresp := c.do(http.MethodPatch, txns+"/"+strconv.FormatInt(lastID, 10)+"/status", map[string]any{"status": 2}, true)
	if sresp.StatusCode != http.StatusNoContent {
		t.Fatalf("set status = %d, want 204", sresp.StatusCode)
	}
	sresp.Body.Close()
	got := decodeTxn(t, c.do(http.MethodGet, txns+"/"+strconv.FormatInt(lastID, 10), nil, false))
	if int64(got["status"].(float64)) != 2 {
		t.Fatalf("status after toggle = %v, want 2", got["status"])
	}
}

func TestTransactionBulkEdit(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txns := base + "/transactions"

	a := int64(decodeTxn(t, c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-01-15", "amount": -100}, true))["id"].(float64))
	b := int64(decodeTxn(t, c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-01-16", "amount": -200}, true))["id"].(float64))

	resp := c.do(http.MethodPost, txns+"/bulk", map[string]any{"ids": []int64{a, b}, "field": "status", "value": 2}, true)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bulk = %d, want 200", resp.StatusCode)
	}
	var out struct {
		Updated int `json:"updated"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.Updated != 2 {
		t.Fatalf("updated = %d, want 2", out.Updated)
	}
	got := decodeTxn(t, c.do(http.MethodGet, txns+"/"+strconv.FormatInt(a, 10), nil, false))
	if int64(got["status"].(float64)) != 2 {
		t.Fatalf("status = %v, want 2", got["status"])
	}

	// Unknown field → 400.
	bad := c.do(http.MethodPost, txns+"/bulk", map[string]any{"ids": []int64{a}, "field": "nope"}, true)
	defer bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad field = %d, want 400", bad.StatusCode)
	}
}

func TestTransactionBulkDelete(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txns := base + "/transactions"

	a := int64(decodeTxn(t, c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-02-01", "amount": -100}, true))["id"].(float64))
	b := int64(decodeTxn(t, c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-02-02", "amount": -200}, true))["id"].(float64))

	resp := c.do(http.MethodPost, txns+"/bulk-delete", map[string]any{"ids": []int64{a, b}}, true)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bulk-delete = %d, want 200", resp.StatusCode)
	}
	var out struct {
		Deleted int `json:"deleted"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.Deleted != 2 {
		t.Fatalf("deleted = %d, want 2", out.Deleted)
	}
	g := c.do(http.MethodGet, txns+"/"+strconv.FormatInt(a, 10), nil, false)
	g.Body.Close()
	if g.StatusCode != http.StatusNotFound {
		t.Fatalf("after delete, GET = %d, want 404", g.StatusCode)
	}

	// Empty ids → 400.
	bad := c.do(http.MethodPost, txns+"/bulk-delete", map[string]any{"ids": []int64{}}, true)
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty ids = %d, want 400", bad.StatusCode)
	}
}

func TestTransactionBulkCategorize(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txns := base + "/transactions"
	id := func(path string, body map[string]any) int64 {
		t.Helper()
		return int64(decodeTxn(t, c.do(http.MethodPost, path, body, true))["id"].(float64))
	}
	a := id(txns, map[string]any{"accountId": acc, "date": "2026-03-01", "amount": -100})
	cat := id(base+"/categories", map[string]any{"name": "Food"})
	payee := id(base+"/payees", map[string]any{"name": "Shop"})

	resp := c.do(http.MethodPost, txns+"/bulk-categorize", map[string]any{"rows": []map[string]any{{"id": a, "payeeId": payee, "categoryId": cat}}}, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bulk-categorize = %d, want 200", resp.StatusCode)
	}
	got := decodeTxn(t, c.do(http.MethodGet, txns+"/"+strconv.FormatInt(a, 10), nil, false))
	if got["categoryId"] != float64(cat) || got["payeeId"] != float64(payee) {
		t.Fatalf("after = %v/%v, want %d/%d", got["categoryId"], got["payeeId"], cat, payee)
	}
	bad := c.do(http.MethodPost, txns+"/bulk-categorize", map[string]any{"rows": []any{}}, true)
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty rows = %d, want 400", bad.StatusCode)
	}
}

func TestTransactionBulkTags(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txns := base + "/transactions"

	a := int64(decodeTxn(t, c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-03-01", "amount": -100}, true))["id"].(float64))
	b := int64(decodeTxn(t, c.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-03-02", "amount": -200, "tags": []string{"old"}}, true))["id"].(float64))

	// Add "shared" to both (b keeps its "old").
	resp := c.do(http.MethodPost, txns+"/bulk-tags", map[string]any{"ids": []int64{a, b}, "tags": []string{"shared"}, "replace": false}, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bulk-tags add = %d, want 200", resp.StatusCode)
	}
	gb := decodeTxn(t, c.do(http.MethodGet, txns+"/"+strconv.FormatInt(b, 10), nil, false))
	tags := toStrings(gb["tags"])
	if !contains(tags, "old") || !contains(tags, "shared") {
		t.Fatalf("b tags = %v, want both old and shared", tags)
	}

	// Replace b's tags with just "only".
	resp2 := c.do(http.MethodPost, txns+"/bulk-tags", map[string]any{"ids": []int64{b}, "tags": []string{"only"}, "replace": true}, true)
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("bulk-tags replace = %d, want 200", resp2.StatusCode)
	}
	gb2 := decodeTxn(t, c.do(http.MethodGet, txns+"/"+strconv.FormatInt(b, 10), nil, false))
	tags2 := toStrings(gb2["tags"])
	if len(tags2) != 1 || tags2[0] != "only" {
		t.Fatalf("b tags after replace = %v, want [only]", tags2)
	}
}

func toStrings(v any) []string {
	arr, _ := v.([]any)
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func contains(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}

func TestTransactionCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid, acc := makeAccount(t, admin)
	txns := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/transactions"
	tx := decodeTxn(t, admin.do(http.MethodPost, txns, map[string]any{"accountId": acc, "date": "2026-01-15", "amount": -100}, true))
	id := int64(tx["id"].(float64))

	admin.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	if r := bob.do(http.MethodGet, txns+"?accountId="+strconv.FormatInt(acc, 10), nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob list = %d, want 404", r.StatusCode)
	}
	if r := bob.do(http.MethodGet, txns+"/"+strconv.FormatInt(id, 10), nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob get = %d, want 404", r.StatusCode)
	}
}

// A row read from a bank mail that the bank has not booked shows in the review
// with the bank rows near it, and merges into one of them (#660).
func TestUnconfirmedMailRowsInTheReview(t *testing.T) {
	admin := newTestAPI(t)
	wid, acc := makeAccount(t, admin)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	day := func(n int) string { return time.Now().UTC().AddDate(0, 0, -n).Format("2006-01-02") }
	admin.do(http.MethodPost, base+"/import/commit", map[string]any{
		"accountId": acc, "rows": []map[string]any{
			{"date": day(7), "amount": -10000, "memo": "Distributore Demo", "importRef": "mail:1"},
			{"date": day(6), "amount": -4000, "memo": "POS STAZIONE DEMO", "importRef": "eb:1"},
			{"date": day(8), "amount": -750, "memo": "Bar Demo", "importRef": "mail:2"},
			{"date": day(8), "amount": 750, "memo": "Storno Bar Demo", "importRef": "mail:3"},
		},
	}, true).Body.Close()

	var rev struct {
		Unconfirmed []struct {
			ID       int64 `json:"id"`
			BankRows []struct {
				ID int64 `json:"id"`
			} `json:"bankRows"`
		} `json:"unconfirmed"`
		Reversals []struct {
			Payment  struct{ ID int64 } `json:"payment"`
			Reversal struct{ ID int64 } `json:"reversal"`
		} `json:"reversals"`
	}
	r := admin.do(http.MethodGet, base+"/transactions/review", nil, false)
	if err := json.NewDecoder(r.Body).Decode(&rev); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if len(rev.Unconfirmed) != 1 || len(rev.Unconfirmed[0].BankRows) != 1 || len(rev.Reversals) != 1 {
		t.Fatalf("review = %+v, want one unconfirmed row with one bank row, and one reversal", rev)
	}
	mail, bank := rev.Unconfirmed[0].ID, rev.Unconfirmed[0].BankRows[0].ID

	if r := admin.do(http.MethodPost, base+"/transactions/merge-mail", map[string]any{"mailId": bank, "bankId": mail}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("merge the wrong way round = %d, want 400", r.StatusCode)
	}
	admin.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	if r := bob.do(http.MethodPost, base+"/transactions/merge-mail", map[string]any{"mailId": mail, "bankId": bank}, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob merge = %d, want 404", r.StatusCode)
	}
	if r := admin.do(http.MethodPost, base+"/transactions/merge-mail", map[string]any{"mailId": mail, "bankId": bank}, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("merge = %d, want 204", r.StatusCode)
	}
	got := decodeTxn(t, admin.do(http.MethodGet, base+"/transactions/"+strconv.FormatInt(bank, 10), nil, false))
	if got["memo"] != "Distributore Demo" || got["amount"].(float64) != -4000 {
		t.Fatalf("merged = %+v, want the bank's amount with the mail's memo", got)
	}
}
