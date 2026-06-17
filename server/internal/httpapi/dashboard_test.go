package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func TestDashboardEndpoint(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c) // EUR base account
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)

	cat := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Food"}, true))
	c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": "2026-03-10", "amount": -2500, "categoryId": cat.ID, "status": 2,
	}, true).Body.Close()

	resp := c.do(http.MethodGet, base+"/dashboard?from=2026-03-01&to=2026-03-31", nil, false)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("dashboard = %d, want 200", resp.StatusCode)
	}
	var d struct {
		Accounts []struct {
			ID                  int64 `json:"id"`
			Bank, Today, Future int64
		} `json:"accounts"`
		Totals struct {
			Bank, Today, Future int64
		} `json:"totals"`
		BaseCurrency  *struct{ Code string } `json:"baseCurrency"`
		TopCategories []struct {
			CategoryID int64 `json:"categoryId"`
			Amount     int64
		} `json:"topCategories"`
		Upcoming []any `json:"upcoming"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(d.Accounts) != 1 || d.Accounts[0].ID != acc {
		t.Fatalf("accounts = %+v", d.Accounts)
	}
	// Reconciled expense → bank/today/future all -2500.
	if d.Accounts[0].Bank != -2500 || d.Accounts[0].Future != -2500 {
		t.Fatalf("balances = %+v", d.Accounts[0])
	}
	if d.BaseCurrency == nil || d.BaseCurrency.Code != "EUR" {
		t.Fatalf("base currency = %+v", d.BaseCurrency)
	}
	if len(d.TopCategories) != 1 || d.TopCategories[0].Amount != 2500 {
		t.Fatalf("top categories = %+v", d.TopCategories)
	}
	if d.Upcoming == nil {
		t.Fatalf("upcoming should be an empty array, not null")
	}
}

func TestDashboardCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid, _ := makeAccount(t, admin)
	admin.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	if r := bob.do(http.MethodGet, "/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/dashboard", nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob dashboard = %d, want 404", r.StatusCode)
	}
}
