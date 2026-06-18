package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func TestCSVImportExportEndpoints(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)

	content := "2026-01-15;3;ref;Grocer;shop;-12.34;Food:Groceries;food cash\n" +
		"2026-01-16;0;;Employer;salary;2000.00;Salary;\n"

	// Preview the HomeBank CSV.
	presp := c.do(http.MethodPost, base+"/import/csv/preview", map[string]any{
		"accountId": acc, "content": content, "dialect": "homebank",
	}, true)
	if presp.StatusCode != http.StatusOK {
		t.Fatalf("preview = %d, want 200", presp.StatusCode)
	}
	var preview struct {
		Columns []string `json:"columns"`
		Rows    []struct {
			Include     bool     `json:"include"`
			Duplicate   bool     `json:"duplicate"`
			Date        string   `json:"date"`
			Amount      int64    `json:"amount"`
			PaymentMode int      `json:"paymentMode"`
			Payee       string   `json:"payee"`
			Memo        string   `json:"memo"`
			Category    string   `json:"category"`
			Tags        []string `json:"tags"`
		} `json:"rows"`
	}
	if err := json.NewDecoder(presp.Body).Decode(&preview); err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	presp.Body.Close()
	if len(preview.Rows) != 2 || preview.Rows[0].Amount != -1234 {
		t.Fatalf("preview rows = %+v", preview.Rows)
	}

	// Commit both rows.
	commitRows := make([]map[string]any, 0, 2)
	for _, r := range preview.Rows {
		commitRows = append(commitRows, map[string]any{
			"date": r.Date, "amount": r.Amount, "paymentMode": r.PaymentMode,
			"payee": r.Payee, "memo": r.Memo, "category": r.Category, "tags": r.Tags,
		})
	}
	cresp := c.do(http.MethodPost, base+"/import/csv/commit", map[string]any{
		"accountId": acc, "rows": commitRows,
	}, true)
	if cresp.StatusCode != http.StatusCreated {
		t.Fatalf("commit = %d, want 201", cresp.StatusCode)
	}
	var commit struct {
		Created int `json:"created"`
	}
	_ = json.NewDecoder(cresp.Body).Decode(&commit)
	cresp.Body.Close()
	if commit.Created != 2 {
		t.Fatalf("created = %d, want 2", commit.Created)
	}

	// Export the account as HomeBank CSV.
	eresp := c.do(http.MethodGet, base+"/export/csv?accountId="+strconv.FormatInt(acc, 10), nil, false)
	if eresp.StatusCode != http.StatusOK {
		t.Fatalf("export = %d, want 200", eresp.StatusCode)
	}
	if ct := eresp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("export content-type = %q", ct)
	}
	body, _ := io.ReadAll(eresp.Body)
	eresp.Body.Close()
	if !strings.Contains(string(body), "Food:Groceries") || !strings.Contains(string(body), "Grocer") {
		t.Fatalf("export body missing data:\n%s", body)
	}

	// Re-previewing the same content now flags both rows as duplicates.
	presp2 := c.do(http.MethodPost, base+"/import/csv/preview", map[string]any{
		"accountId": acc, "content": content, "dialect": "homebank",
	}, true)
	var preview2 struct {
		Rows []struct {
			Duplicate bool `json:"duplicate"`
			Include   bool `json:"include"`
		} `json:"rows"`
	}
	_ = json.NewDecoder(presp2.Body).Decode(&preview2)
	presp2.Body.Close()
	for i, r := range preview2.Rows {
		if !r.Duplicate || r.Include {
			t.Fatalf("row %d should be a flagged duplicate after import: %+v", i, r)
		}
	}
}

func TestCSVImportCrossWalletIsolation(t *testing.T) {
	c := newTestAPI(t)
	_, acc := makeAccount(t, c)

	// Importing must reject an account that belongs to a different wallet than
	// the one in the path, even for the same user.
	w2 := createWalletWithBase(t, c, "EUR")
	base2 := "/api/v1/wallets/" + strconv.FormatInt(w2, 10)
	resp := c.do(http.MethodPost, base2+"/import/csv/preview", map[string]any{
		"accountId": acc, "content": "2026-01-01;0;;P;m;1.00;Cat;\n", "dialect": "homebank",
	}, true)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("cross-wallet preview = %d, want 404", resp.StatusCode)
	}
}
