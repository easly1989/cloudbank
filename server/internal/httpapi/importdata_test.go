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
	cresp := c.do(http.MethodPost, base+"/import/commit", map[string]any{
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

type previewRowsResp struct {
	Rows []struct {
		Include   bool   `json:"include"`
		Duplicate bool   `json:"duplicate"`
		Date      string `json:"date"`
		Amount    int64  `json:"amount"`
		Payee     string `json:"payee"`
		ImportRef string `json:"importRef"`
	} `json:"rows"`
}

func TestQIFOFXImportEndpoints(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)

	qif := "!Type:Bank\nD2026-04-01\nT-9.99\nPCafe\nMcoffee\nLFood\n^\n"
	qresp := c.do(http.MethodPost, base+"/import/qif/preview", map[string]any{
		"accountId": acc, "content": qif,
	}, true)
	if qresp.StatusCode != http.StatusOK {
		t.Fatalf("qif preview = %d, want 200", qresp.StatusCode)
	}
	var qp previewRowsResp
	_ = json.NewDecoder(qresp.Body).Decode(&qp)
	qresp.Body.Close()
	if len(qp.Rows) != 1 || qp.Rows[0].Amount != -999 || qp.Rows[0].Payee != "Cafe" {
		t.Fatalf("qif rows = %+v", qp.Rows)
	}

	ofx := "<OFX><STMTTRN><DTPOSTED>20260402</DTPOSTED><TRNAMT>-5.00</TRNAMT>" +
		"<FITID>FIT-1</FITID><NAME>Bus</NAME></STMTTRN></OFX>"
	oresp := c.do(http.MethodPost, base+"/import/ofx/preview", map[string]any{
		"accountId": acc, "content": ofx,
	}, true)
	if oresp.StatusCode != http.StatusOK {
		t.Fatalf("ofx preview = %d, want 200", oresp.StatusCode)
	}
	var op previewRowsResp
	_ = json.NewDecoder(oresp.Body).Decode(&op)
	oresp.Body.Close()
	if len(op.Rows) != 1 || op.Rows[0].ImportRef != "FIT-1" {
		t.Fatalf("ofx rows = %+v", op.Rows)
	}

	// Commit the OFX row, then re-preview: FITID dedupe flags it.
	row := op.Rows[0]
	c.do(http.MethodPost, base+"/import/commit", map[string]any{
		"accountId": acc, "rows": []map[string]any{{
			"date": row.Date, "amount": row.Amount, "payee": row.Payee, "importRef": row.ImportRef,
		}},
	}, true).Body.Close()

	oresp2 := c.do(http.MethodPost, base+"/import/ofx/preview", map[string]any{
		"accountId": acc, "content": ofx,
	}, true)
	var op2 previewRowsResp
	_ = json.NewDecoder(oresp2.Body).Decode(&op2)
	oresp2.Body.Close()
	if !op2.Rows[0].Duplicate || op2.Rows[0].Include {
		t.Fatalf("re-imported OFX row should be a flagged duplicate: %+v", op2.Rows[0])
	}

	// QIF export returns a QIF attachment.
	eresp := c.do(http.MethodGet, base+"/export/qif?accountId="+strconv.FormatInt(acc, 10), nil, false)
	if eresp.StatusCode != http.StatusOK {
		t.Fatalf("qif export = %d, want 200", eresp.StatusCode)
	}
	body, _ := io.ReadAll(eresp.Body)
	eresp.Body.Close()
	if !strings.HasPrefix(string(body), "!Type:") {
		t.Fatalf("qif export body:\n%s", body)
	}

	// A non-OFX body is rejected.
	bad := c.do(http.MethodPost, base+"/import/ofx/preview", map[string]any{
		"accountId": acc, "content": "not ofx",
	}, true)
	defer bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad ofx = %d, want 400", bad.StatusCode)
	}
}
