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

func TestCurrencyRefreshEndpoint(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/currencies"
	for _, code := range []string{"USD", "GBP", "CAD"} {
		c.do(http.MethodPost, base, map[string]any{"isoCode": code}, true).Body.Close()
	}

	resp := c.do(http.MethodPost, base+"/refresh", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("refresh = %d, want 200", resp.StatusCode)
	}
	var res struct {
		Date          string   `json:"date"`
		Updated       []string `json:"updated"`
		Unsupported   []string `json:"unsupported"`
		ProviderError string   `json:"providerError"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	resp.Body.Close()
	if res.ProviderError != "" {
		t.Fatalf("unexpected provider error: %q", res.ProviderError)
	}
	if len(res.Updated) != 2 { // USD, GBP from the stub
		t.Fatalf("updated = %v, want USD+GBP", res.Updated)
	}
	if len(res.Unsupported) != 1 || res.Unsupported[0] != "CAD" {
		t.Fatalf("unsupported = %v, want [CAD]", res.Unsupported)
	}

	// USD now carries the inverted provider rate (1/1.10) from the stub.
	lresp := c.do(http.MethodGet, base, nil, false)
	var list []currencyResponse
	if err := json.NewDecoder(lresp.Body).Decode(&list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	lresp.Body.Close()
	for _, cur := range list {
		if cur.IsoCode == "USD" && (cur.Rate < 0.9 || cur.Rate > 0.92) {
			t.Fatalf("USD rate = %v, want ~0.909", cur.Rate)
		}
		if cur.IsoCode == "CAD" && cur.Rate != 1 {
			t.Fatalf("CAD rate = %v, want 1 (manual, unsupported)", cur.Rate)
		}
	}
}

func TestCurrencyRefreshUnsupportedBase(t *testing.T) {
	c := newTestAPI(t)
	// The stub provider only supports an EUR base.
	wid := createWalletWithBase(t, c, "USD")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/currencies"
	c.do(http.MethodPost, base, map[string]any{"isoCode": "EUR"}, true).Body.Close()

	resp := c.do(http.MethodPost, base+"/refresh", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("refresh = %d, want 200", resp.StatusCode)
	}
	var res struct {
		Updated       []string `json:"updated"`
		ProviderError string   `json:"providerError"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&res)
	resp.Body.Close()
	if res.ProviderError == "" || len(res.Updated) != 0 {
		t.Fatalf("expected graceful degradation for unsupported base, got %+v", res)
	}
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

func TestCurrencyPageFlows(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	wbase := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	base := wbase + "/currencies"

	// Added, it comes with the provider's rate at once (the stub: 1 € = 1.10 $).
	resp := c.do(http.MethodPost, base, map[string]any{"isoCode": "USD"}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add USD = %d, want 201", resp.StatusCode)
	}
	usd := decodeWalletCurrency(t, resp)
	if usd.Rate < 0.9 || usd.Rate > 0.92 || usd.RateSource != "frankfurter" || usd.RateDate == "" {
		t.Fatalf("added USD = %+v, want the provider's rate", usd)
	}
	id := strconv.FormatInt(usd.ID, 10)

	// Its history reads as the contract says.
	resp = c.do(http.MethodGet, base+"/"+id+"/rates", nil, false)
	var hist []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&hist); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(hist) != 1 || hist[0]["source"] != "frankfurter" || hist[0]["date"] == nil || hist[0]["rate"] == nil {
		t.Fatalf("history = %+v", hist)
	}

	// A format that cannot show an amount is refused.
	if r := c.do(http.MethodPatch, base+"/"+id, map[string]any{"decimalChar": ",", "groupChar": ","}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad format = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// An account kept in dollars: the dollar cannot go.
	c.do(http.MethodPost, wbase+"/accounts", map[string]any{"name": "Card", "type": "creditcard", "currencyId": usd.ID}, true).Body.Close()
	if r := c.do(http.MethodDelete, base+"/"+id, nil, true); r.StatusCode != http.StatusConflict {
		t.Fatalf("delete in use = %d, want 409", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// The dollar becomes the base: the euro now reads against it (the stub
	// has no dollar base, so the rate is the one worked out: 1.10).
	if r := c.do(http.MethodPost, base+"/"+id+"/base", nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("set base = %d, want 204", r.StatusCode)
	} else {
		r.Body.Close()
	}
	for _, cur := range decodeCurrencies(t, c.do(http.MethodGet, base, nil, false)) {
		if cur.IsoCode == "EUR" && (cur.IsBase || cur.Rate < 1.09 || cur.Rate > 1.11) {
			t.Fatalf("EUR after the switch = %+v, want 1.10 against the dollar", cur)
		}
		if cur.IsoCode == "USD" && (!cur.IsBase || cur.Rate != 1) {
			t.Fatalf("USD after the switch = %+v", cur)
		}
	}
}
