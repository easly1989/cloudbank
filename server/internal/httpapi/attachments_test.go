package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
	"testing"
)

// uploadAttachment posts a multipart file to a transaction and returns the response.
func uploadAttachment(t *testing.T, c *testClient, wid, txnID int64, filename, contentType string, data []byte) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("transactionId", strconv.FormatInt(txnID, 10))
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	h.Set("Content-Type", contentType)
	part, err := mw.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost,
		c.base+"/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/attachments", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	resp, err := c.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// makeTxn creates a transaction in the given account and returns its id.
func makeTxn(t *testing.T, c *testClient, wid, acc int64) int64 {
	t.Helper()
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	resp := c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": "2026-01-05", "amount": -1500, "paymentMode": 0, "status": 0,
		"memo": "receipt txn",
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create txn = %d", resp.StatusCode)
	}
	return int64(decodeTxn(t, resp)["id"].(float64))
}

func registerRows(t *testing.T, c *testClient, wid, acc int64) []map[string]any {
	t.Helper()
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	resp := c.do(http.MethodGet, base+"/transactions/register?accountId="+strconv.FormatInt(acc, 10), nil, false)
	defer resp.Body.Close()
	var out struct {
		Rows []map[string]any `json:"rows"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode register: %v", err)
	}
	return out.Rows
}

func TestAttachmentLifecycle(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txnID := makeTxn(t, c, wid, acc)

	content := []byte("%PDF-1.4 fake receipt bytes")
	// Upload.
	resp := uploadAttachment(t, c, wid, txnID, "receipt.pdf", "application/pdf", content)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload = %d, want 201", resp.StatusCode)
	}
	var att struct {
		ID            int64  `json:"id"`
		TransactionID int64  `json:"transactionId"`
		Filename      string `json:"filename"`
		ContentType   string `json:"contentType"`
		Size          int64  `json:"size"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&att); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if att.Filename != "receipt.pdf" || att.ContentType != "application/pdf" || att.Size != int64(len(content)) {
		t.Fatalf("attachment metadata = %+v", att)
	}

	// The register row shows the count.
	rows := registerRows(t, c, wid, acc)
	if len(rows) != 1 || int64(rows[0]["attachmentCount"].(float64)) != 1 {
		t.Fatalf("register attachmentCount = %v", rows[0]["attachmentCount"])
	}

	// List for the transaction.
	lresp := c.do(http.MethodGet, base+"/attachments?transactionId="+strconv.FormatInt(txnID, 10), nil, false)
	var list []map[string]any
	json.NewDecoder(lresp.Body).Decode(&list)
	lresp.Body.Close()
	if len(list) != 1 {
		t.Fatalf("list len = %d", len(list))
	}

	// Download streams the exact bytes.
	dresp := c.do(http.MethodGet, base+"/attachments/"+strconv.FormatInt(att.ID, 10), nil, false)
	got, _ := io.ReadAll(dresp.Body)
	dresp.Body.Close()
	if dresp.StatusCode != http.StatusOK || !bytes.Equal(got, content) {
		t.Fatalf("download status=%d bytes=%q", dresp.StatusCode, got)
	}
	if ct := dresp.Header.Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("download content-type = %q", ct)
	}

	// Delete.
	xresp := c.do(http.MethodDelete, base+"/attachments/"+strconv.FormatInt(att.ID, 10), nil, true)
	if xresp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", xresp.StatusCode)
	}
	xresp.Body.Close()
	rows = registerRows(t, c, wid, acc)
	if int64(rows[0]["attachmentCount"].(float64)) != 0 {
		t.Fatalf("attachmentCount after delete = %v", rows[0]["attachmentCount"])
	}
	// Download now 404.
	d2 := c.do(http.MethodGet, base+"/attachments/"+strconv.FormatInt(att.ID, 10), nil, false)
	if d2.StatusCode != http.StatusNotFound {
		t.Fatalf("download after delete = %d, want 404", d2.StatusCode)
	}
	d2.Body.Close()
}

func TestAttachmentDownloadDisposition(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txnID := makeTxn(t, c, wid, acc)

	cases := []struct {
		name        string
		filename    string
		contentType string
		wantInline  bool
	}{
		{"png previews inline", "shot.png", "image/png", true},
		{"pdf previews inline", "receipt.pdf", "application/pdf", true},
		{"jpeg with charset param inline", "photo.jpg", "image/jpeg; charset=binary", true},
		// The XSS vectors: an SVG or HTML upload must be forced to download so it
		// can never render and execute script in the app's origin (#230).
		{"svg forced to download", "evil.svg", "image/svg+xml", false},
		{"html forced to download", "evil.html", "text/html", false},
		{"unknown type forced to download", "blob.bin", "application/octet-stream", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			up := uploadAttachment(t, c, wid, txnID, tc.filename, tc.contentType, []byte("<data/>"))
			if up.StatusCode != http.StatusCreated {
				t.Fatalf("upload = %d", up.StatusCode)
			}
			var att struct {
				ID int64 `json:"id"`
			}
			json.NewDecoder(up.Body).Decode(&att)
			up.Body.Close()

			d := c.do(http.MethodGet, base+"/attachments/"+strconv.FormatInt(att.ID, 10), nil, false)
			d.Body.Close()
			disp := d.Header.Get("Content-Disposition")
			wantPrefix := "attachment;"
			if tc.wantInline {
				wantPrefix = "inline;"
			}
			if !strings.HasPrefix(disp, wantPrefix) {
				t.Fatalf("Content-Disposition = %q, want prefix %q", disp, wantPrefix)
			}
			// Every attachment response is locked down regardless of type.
			if csp := d.Header.Get("Content-Security-Policy"); csp != "default-src 'none'; sandbox" {
				t.Fatalf("CSP = %q", csp)
			}
			if d.Header.Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("missing nosniff header")
			}
		})
	}
}

func TestAttachmentDeletedWithTransaction(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txnID := makeTxn(t, c, wid, acc)

	up := uploadAttachment(t, c, wid, txnID, "note.txt", "text/plain", []byte("hello"))
	var att struct {
		ID int64 `json:"id"`
	}
	json.NewDecoder(up.Body).Decode(&att)
	up.Body.Close()

	// Deleting the transaction removes its attachment (row cascades + file purged).
	del := c.do(http.MethodDelete, base+"/transactions/"+strconv.FormatInt(txnID, 10), nil, true)
	if del.StatusCode != http.StatusNoContent {
		t.Fatalf("delete txn = %d", del.StatusCode)
	}
	del.Body.Close()
	d := c.do(http.MethodGet, base+"/attachments/"+strconv.FormatInt(att.ID, 10), nil, false)
	if d.StatusCode != http.StatusNotFound {
		t.Fatalf("attachment after txn delete = %d, want 404", d.StatusCode)
	}
	d.Body.Close()
}

func TestAttachmentCrossUserIsolation(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	txnID := makeTxn(t, c, wid, acc)
	up := uploadAttachment(t, c, wid, txnID, "secret.pdf", "application/pdf", []byte("private"))
	var att struct {
		ID int64 `json:"id"`
	}
	json.NewDecoder(up.Body).Decode(&att)
	up.Body.Close()

	// A second user is not a member of the wallet: every attachment route is 404.
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	other := c.fork()
	other.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	if r := other.do(http.MethodGet, base+"/attachments/"+strconv.FormatInt(att.ID, 10), nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("cross-user download = %d, want 404", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if r := other.do(http.MethodDelete, base+"/attachments/"+strconv.FormatInt(att.ID, 10), nil, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("cross-user delete = %d, want 404", r.StatusCode)
	} else {
		r.Body.Close()
	}
}
