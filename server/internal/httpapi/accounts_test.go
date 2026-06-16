package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func decodeAccount(t *testing.T, resp *http.Response) accountResponse {
	t.Helper()
	defer resp.Body.Close()
	var a accountResponse
	if err := json.NewDecoder(resp.Body).Decode(&a); err != nil {
		t.Fatalf("decode account: %v", err)
	}
	return a
}

func decodeAccounts(t *testing.T, resp *http.Response) []accountResponse {
	t.Helper()
	defer resp.Body.Close()
	var a []accountResponse
	if err := json.NewDecoder(resp.Body).Decode(&a); err != nil {
		t.Fatalf("decode accounts: %v", err)
	}
	return a
}

func TestAccountCrud(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/accounts"

	// Create with the default (base) currency and an initial balance.
	resp := c.do(http.MethodPost, base, map[string]any{
		"name": "Checking", "type": "checking", "initialBalance": 12040, "minimumBalance": -5000,
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create account = %d, want 201", resp.StatusCode)
	}
	acc := decodeAccount(t, resp)
	if acc.Type != "checking" || acc.Balance != 12040 || acc.CurrencyCode != "EUR" {
		t.Fatalf("created account = %+v", acc)
	}

	// List.
	accounts := decodeAccounts(t, c.do(http.MethodGet, base, nil, false))
	if len(accounts) != 1 || accounts[0].ID != acc.ID {
		t.Fatalf("list = %+v", accounts)
	}

	// Update (rename, close).
	resp = c.do(http.MethodPatch, base+"/"+strconv.FormatInt(acc.ID, 10), map[string]any{
		"name": "Main checking", "type": "checking", "currencyId": acc.CurrencyID,
		"initialBalance": 12040, "closed": true,
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update = %d, want 200", resp.StatusCode)
	}
	if u := decodeAccount(t, resp); u.Name != "Main checking" || !u.Closed {
		t.Fatalf("updated = %+v", u)
	}

	// Delete.
	resp = c.do(http.MethodDelete, base+"/"+strconv.FormatInt(acc.ID, 10), nil, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()
	if got := decodeAccounts(t, c.do(http.MethodGet, base, nil, false)); len(got) != 0 {
		t.Fatalf("accounts after delete = %+v", got)
	}
}

func TestAccountInvalidType(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	resp := c.do(http.MethodPost, "/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/accounts",
		map[string]any{"name": "X", "type": "notreal"}, true)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid type = %d, want 400", resp.StatusCode)
	}
}

func TestAccountForeignCurrencyRejected(t *testing.T) {
	// An account cannot use a currency from another wallet.
	c := newTestAPI(t)
	w1 := createWalletWithBase(t, c, "EUR")
	// Second wallet with its own base currency.
	w2resp := c.do(http.MethodPost, "/api/v1/wallets", map[string]any{"title": "Other", "baseCurrency": "USD"}, true)
	w2 := decodeWallet(t, w2resp)
	// Find w2's currency id.
	w2curs := decodeCurrencies(t, c.do(http.MethodGet,
		"/api/v1/wallets/"+strconv.FormatInt(w2.ID, 10)+"/currencies", nil, false))
	foreign := w2curs[0].ID

	resp := c.do(http.MethodPost, "/api/v1/wallets/"+strconv.FormatInt(w1, 10)+"/accounts",
		map[string]any{"name": "Bad", "type": "bank", "currencyId": foreign}, true)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("foreign currency = %d, want 400", resp.StatusCode)
	}
}

func TestAccountCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid := createWalletWithBase(t, admin, "EUR")
	acc := decodeAccount(t, admin.do(http.MethodPost,
		"/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/accounts",
		map[string]any{"name": "Secret", "type": "bank"}, true))

	admin.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	// Bob cannot reach the admin wallet's accounts (wallet membership → 404).
	apath := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/accounts"
	if resp := bob.do(http.MethodGet, apath, nil, false); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("bob list accounts = %d, want 404", resp.StatusCode)
	}
	if resp := bob.do(http.MethodGet, apath+"/"+strconv.FormatInt(acc.ID, 10), nil, false); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("bob get account = %d, want 404", resp.StatusCode)
	}
}
