package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestImportXHBEndpoint(t *testing.T) {
	c := newTestAPI(t)
	// Admin setup (logs in).
	c.do(http.MethodPost, "/api/v1/setup", map[string]any{"username": "admin", "password": "supersecret"}, true).Body.Close()

	data, err := os.ReadFile("../importer/testdata/sample.xhb")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	resp := c.doRaw(http.MethodPost, "/api/v1/import/xhb", string(data))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("import = %d, want 201", resp.StatusCode)
	}
	var res struct {
		WalletID int64          `json:"walletId"`
		Counts   map[string]int `json:"counts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res.WalletID == 0 || res.Counts["accounts"] != 3 || res.Counts["transactions"] != 5 {
		t.Fatalf("import result = %+v", res)
	}

	// The imported wallet is listed for the user.
	lr := c.do(http.MethodGet, "/api/v1/wallets", nil, false)
	defer lr.Body.Close()
	var wallets []map[string]any
	_ = json.NewDecoder(lr.Body).Decode(&wallets)
	if len(wallets) != 1 || wallets[0]["title"] != "My Money" {
		t.Fatalf("wallets = %+v", wallets)
	}

	// Garbage body → 400.
	if r := c.doRaw(http.MethodPost, "/api/v1/import/xhb", "not xml"); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("garbage import = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}
}

// doRaw posts a raw body with the CSRF header.
func (c *testClient) doRaw(method, path, body string) *http.Response {
	c.t.Helper()
	req, err := http.NewRequest(method, c.base+path, strings.NewReader(body))
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Content-Type", "application/xml")
	resp, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	return resp
}
