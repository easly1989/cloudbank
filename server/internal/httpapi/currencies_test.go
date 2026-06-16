package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func decodeCurrencies(t *testing.T, resp *http.Response) []currencyResponse {
	t.Helper()
	defer resp.Body.Close()
	var c []currencyResponse
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		t.Fatalf("decode currencies: %v", err)
	}
	return c
}

// createWallet sets up an admin and creates a wallet with the given base
// currency, returning the wallet id.
func createWalletWithBase(t *testing.T, c *testClient, base string) int64 {
	t.Helper()
	setupAdmin(c)
	resp := c.do(http.MethodPost, "/api/v1/wallets",
		map[string]any{"title": "Home", "baseCurrency": base}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create wallet = %d", resp.StatusCode)
	}
	return decodeWallet(t, resp).ID
}

func TestCatalogEndpoint(t *testing.T) {
	c := newTestAPI(t)
	setupAdmin(c)
	resp := c.do(http.MethodGet, "/api/v1/catalog/currencies", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("catalog = %d, want 200", resp.StatusCode)
	}
	defer resp.Body.Close()
	var entries []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) < 10 {
		t.Fatalf("catalog returned %d entries", len(entries))
	}
}

func TestWalletGetsBaseCurrency(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "USD")

	currencies := decodeCurrencies(t, c.do(http.MethodGet,
		"/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/currencies", nil, false))
	if len(currencies) != 1 || currencies[0].IsoCode != "USD" || !currencies[0].IsBase {
		t.Fatalf("wallet currencies = %+v, want [USD base]", currencies)
	}
}

func TestAddAndRateCurrency(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "USD")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/currencies"

	// Add EUR.
	resp := c.do(http.MethodPost, base, map[string]any{"isoCode": "EUR"}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add EUR = %d, want 201", resp.StatusCode)
	}
	eur := decodeWalletCurrency(t, resp)
	if eur.IsBase {
		t.Fatal("EUR should not be base")
	}

	// Set a manual rate.
	resp = c.do(http.MethodPatch, base+"/"+strconv.FormatInt(eur.ID, 10),
		map[string]any{"rate": 1.08}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("set rate = %d, want 200", resp.StatusCode)
	}
	if updated := decodeWalletCurrency(t, resp); updated.Rate != 1.08 {
		t.Fatalf("rate = %v, want 1.08", updated.Rate)
	}

	// Duplicate add is a conflict.
	resp = c.do(http.MethodPost, base, map[string]any{"isoCode": "EUR"}, true)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate add = %d, want 409", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestCurrencyCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid := createWalletWithBase(t, admin, "USD")
	admin.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	// Bob cannot list or add currencies on the admin's wallet — 404.
	path := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/currencies"
	if resp := bob.do(http.MethodGet, path, nil, false); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("bob list currencies = %d, want 404", resp.StatusCode)
	}
	if resp := bob.do(http.MethodPost, path, map[string]any{"isoCode": "EUR"}, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("bob add currency = %d, want 404", resp.StatusCode)
	}
}

func decodeWalletCurrency(t *testing.T, resp *http.Response) currencyResponse {
	t.Helper()
	defer resp.Body.Close()
	var c currencyResponse
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		t.Fatalf("decode currency: %v", err)
	}
	return c
}
