package httpapi

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// A receipt's photo: not an image is refused before the AI is asked; the
// switch off asks nothing; on, the photo reaches the provider and the fields
// come back; a stranger to the wallet gets 404.
func TestAIReceipt(t *testing.T) {
	c := newTestAPI(t)
	var told []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		told = append(told, string(b))
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"amount\":12.5,\"payee\":\"Corner Bakery\",\"date\":\"2026-10-20\"}"}}]}`))
	}))
	t.Cleanup(srv.Close)
	wid, _ := makeAccount(t, c)
	path := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/ai/parse-receipt"
	var pic bytes.Buffer
	_ = png.Encode(&pic, image.NewRGBA(image.Rect(0, 0, 8, 6)))
	send := func(cl *testClient, photo []byte) (int, map[string]any) {
		t.Helper()
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("photo", "receipt.jpg")
		_, _ = fw.Write(photo)
		_ = mw.WriteField("confirm", "false")
		_ = mw.Close()
		req, _ := http.NewRequest(http.MethodPost, cl.base+path, &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
		r, err := cl.hc.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(r.Body).Decode(&out)
		return r.StatusCode, out
	}
	if code, out := send(c, []byte("plain text, not a photo")); code != http.StatusBadRequest || codeOf(out) != "invalid_file" {
		t.Fatalf("text = %d %v", code, out)
	}
	if code, out := send(c, pic.Bytes()); code != http.StatusBadRequest || codeOf(out) != "ai_disabled" || len(told) != 0 {
		t.Fatalf("AI off = %d %v", code, out)
	}
	r := c.do(http.MethodPut, "/api/v1/ai/settings", map[string]any{
		"enabled": true, "baseUrl": srv.URL, "model": "m", "apiKey": "k", "features": map[string]bool{"receipts": true},
	}, true)
	r.Body.Close()
	code, out := send(c, pic.Bytes())
	entry, _ := out["entry"].(map[string]any)
	if code != http.StatusOK || entry["amount"] != "12.5" || entry["payeeName"] != "Corner Bakery" || len(told) != 1 ||
		!strings.Contains(told[0], "data:image/png;base64,") {
		t.Fatalf("receipt = %d %v", code, out)
	}
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "eve", "password": "evessecret"}, true).Body.Close()
	eve := c.fork()
	eve.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "eve", "password": "evessecret"}, true).Body.Close()
	if code, _ := send(eve, pic.Bytes()); code != http.StatusNotFound {
		t.Fatalf("eve = %d, want 404", code)
	}
}
