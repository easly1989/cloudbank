package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

// The remembered CSV mapping (#709) over HTTP: kept, handed back by the next
// preview of a file with the same header, forgotten; and the routes, the AI's
// included, are the wallet's members' alone.
func TestCSVMapping(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	content := "Booking date;Description;Amount\n03/10/2026;CARD PAYMENT;-42,30\n"
	preview := func() map[string]any {
		t.Helper()
		r := c.do(http.MethodPost, base+"/import/csv/preview", map[string]any{
			"accountId": acc, "content": content, "dialect": "generic", "delimiter": ";", "hasHeader": true,
		}, true)
		defer r.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(r.Body).Decode(&out)
		return out
	}
	if p := preview(); p["remembered"] != nil || len(p["sample"].([]any)) != 3 {
		t.Fatalf("first preview = %v", p)
	}

	keep := map[string]any{
		"columns": []string{"Booking date", "Description", "Amount"},
		"mapping": map[string]int{"date": 0, "memo": 1, "amount": 2}, "dateFormat": "dmy", "decimalChar": ",",
	}
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	for _, r := range []*http.Response{
		bob.do(http.MethodPut, base+"/import/csv-mappings", keep, true),
		bob.do(http.MethodDelete, base+"/import/csv-mappings/1", nil, true),
		bob.do(http.MethodPost, base+"/ai/csv-mapping", map[string]any{"content": content, "delimiter": ";", "hasHeader": true}, true),
	} {
		r.Body.Close()
		if r.StatusCode != http.StatusNotFound {
			t.Fatalf("bob %s %s = %d, want 404", r.Request.Method, r.Request.URL.Path, r.StatusCode)
		}
	}
	if r := c.do(http.MethodPost, base+"/ai/csv-mapping", map[string]any{"content": content, "delimiter": ";", "hasHeader": true}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("proposal with the AI off = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}

	bad := c.do(http.MethodPut, base+"/import/csv-mappings", map[string]any{"columns": []string{"A"}, "mapping": map[string]int{"date": 4}, "decimalChar": "."}, true)
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad mapping = %d, want 400", bad.StatusCode)
	}
	kept := decodeTxn(t, c.do(http.MethodPut, base+"/import/csv-mappings", keep, true))
	id := strconv.FormatInt(int64(kept["id"].(float64)), 10)
	rem, _ := preview()["remembered"].(map[string]any)
	if rem == nil || rem["decimalChar"] != "," || rem["mapping"].(map[string]any)["amount"] != float64(2) {
		t.Fatalf("remembered = %v", rem)
	}

	for want, path := range map[int]string{http.StatusNoContent: id, http.StatusNotFound: "x"} {
		r := c.do(http.MethodDelete, base+"/import/csv-mappings/"+path, nil, true)
		r.Body.Close()
		if r.StatusCode != want {
			t.Fatalf("forget %s = %d, want %d", path, r.StatusCode, want)
		}
	}
	if p := preview(); p["remembered"] != nil {
		t.Fatalf("after forget = %v", p["remembered"])
	}
}
