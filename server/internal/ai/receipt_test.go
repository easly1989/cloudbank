package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"net/http"
	"strings"
	"testing"
)

func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// A photo is told by its bytes: a PNG passes with its size, text or nothing
// does not, nor anything over 5 MB.
func TestCheckImage(t *testing.T) {
	img, err := CheckImage(pngOf(t, 40, 30))
	if err != nil || img.Type != "image/png" || img.Width != 40 || img.Height != 30 {
		t.Fatalf("png = %+v %v", img, err)
	}
	for name, data := range map[string][]byte{
		"text":  []byte("not a photo at all"),
		"empty": nil,
		"large": append(pngOf(t, 2, 2), make([]byte, ReceiptMax)...),
	} {
		if _, err := CheckImage(data); !errors.Is(err, ErrBadImage) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

// The photo goes to the provider beside the text; the log keeps a line about
// it, never its bytes; a provider that refuses images says so.
func TestParseReceipt(t *testing.T) {
	svc, _, uid, wid := newFixture(t)
	ctx := context.Background()
	key := "k"
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key, Features: &Features{Receipts: true},
	}); err != nil {
		t.Fatal(err)
	}
	data := pngOf(t, 40, 30)
	img, _ := CheckImage(data)
	doer := &mockDoer{reply: `{"amount":12.5,"direction":"expense","date":"2026-10-20","payee":"Corner Bakery","memo":"Bread"}`}
	svc.hc = doer
	got, err := svc.ParseReceipt(ctx, uid, wid, false, img, "2026-10-21")
	if err != nil || got.Amount != "12.5" || got.Date != "2026-10-20" || got.PayeeName != "Corner Bakery" {
		t.Fatalf("parsed = %+v %v", got, err)
	}
	body := string(doer.lastBody)
	if !strings.Contains(body, `"type":"image_url"`) || !strings.Contains(body, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(data)) ||
		!strings.Contains(body, "The receipt is in the photo.") {
		t.Fatalf("sent %s", body)
	}
	sends, _ := svc.Sends(ctx, uid, 1)
	one, _ := svc.SendOf(ctx, uid, sends[0].ID)
	if sends[0].Feature != FeatureReceipts || !strings.HasSuffix(one.Sent, "[photo PNG 40×30, 1 KB, not kept]") ||
		strings.Contains(one.Sent, "base64") {
		t.Fatalf("log = %q", one.Sent)
	}

	svc.hc = &mockDoer{status: http.StatusBadRequest}
	if _, err := svc.ParseReceipt(ctx, uid, wid, false, img, "2026-10-21"); !errors.Is(err, ErrNoVision) {
		t.Fatalf("refused = %v", err)
	}
	// Switched off: nothing goes.
	svc.hc = &mockDoer{reply: "{}"}
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", Features: &Features{Entry: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ParseReceipt(ctx, uid, wid, false, img, "2026-10-21"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("off = %v", err)
	}
}
