package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func TestBudgetSetListAndReport(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	cat := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Food"}, true))

	// Set a "same every month" budget.
	if r := c.do(http.MethodPut, base+"/budgets/"+strconv.FormatInt(cat.ID, 10),
		map[string]any{"mode": "same", "same": -10000}, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("set = %d, want 204", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// List returns the configured budget.
	lr := c.do(http.MethodGet, base+"/budgets", nil, false)
	defer lr.Body.Close()
	var list []map[string]any
	_ = json.NewDecoder(lr.Body).Decode(&list)
	if len(list) != 1 || list[0]["mode"] != "same" || int64(list[0]["same"].(float64)) != -10000 {
		t.Fatalf("list = %+v", list)
	}

	// A spend transaction in the period.
	c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": "2026-03-10", "amount": -4000, "categoryId": cat.ID,
	}, true).Body.Close()

	// Report for Jan-Mar: budget = 3 × -100 = -300, actual = -40.
	rr := c.do(http.MethodGet, base+"/budgets/report?from=2026-01-01&to=2026-03-31&rollup=true", nil, false)
	defer rr.Body.Close()
	var rep struct {
		Rows []struct {
			CategoryID     int64 `json:"categoryId"`
			Budget, Actual int64
		} `json:"rows"`
		TotalBudget int64                  `json:"totalBudget"`
		Currency    *struct{ Code string } `json:"currency"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&rep); err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if len(rep.Rows) != 1 || rep.Rows[0].Budget != -30000 || rep.Rows[0].Actual != -4000 {
		t.Fatalf("report row = %+v", rep.Rows)
	}
	if rep.Currency == nil || rep.Currency.Code != "EUR" {
		t.Fatalf("currency = %+v", rep.Currency)
	}

	// Clear the budget.
	if r := c.do(http.MethodDelete, base+"/budgets/"+strconv.FormatInt(cat.ID, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("clear = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
	lr2 := c.do(http.MethodGet, base+"/budgets", nil, false)
	defer lr2.Body.Close()
	var list2 []map[string]any
	_ = json.NewDecoder(lr2.Body).Decode(&list2)
	if len(list2) != 0 {
		t.Fatalf("after clear list = %+v", list2)
	}
}

func TestBudgetCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid, _ := makeAccount(t, admin)
	cat := decodeCategory(t, admin.do(http.MethodPost,
		"/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/categories", map[string]any{"name": "Food"}, true))

	admin.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	r := bob.do(http.MethodPut, "/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/budgets/"+strconv.FormatInt(cat.ID, 10),
		map[string]any{"mode": "same", "same": -100}, true)
	defer r.Body.Close()
	if r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob set = %d, want 404", r.StatusCode)
	}
}
