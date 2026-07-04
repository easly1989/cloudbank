package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

// The integrity check and the auto-fix happy path are covered by
// databackup_test.go; this covers the not-auto-fixable branch and a healthy
// wallet reporting no issues.
func TestIntegrityFixUnknownType(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)

	// A healthy wallet reports no issues.
	cr := c.do(http.MethodGet, base+"/integrity", nil, false)
	var out struct {
		Issues []map[string]any `json:"issues"`
	}
	json.NewDecoder(cr.Body).Decode(&out)
	cr.Body.Close()
	if len(out.Issues) != 0 {
		t.Fatalf("healthy wallet issues = %+v, want none", out.Issues)
	}

	// A non-auto-fixable issue type is rejected with 400.
	if r := c.do(http.MethodPost, base+"/integrity/fix",
		map[string]any{"type": "split_sum"}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("fix split_sum = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}
}
