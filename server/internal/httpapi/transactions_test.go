package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
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
