package notify

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func ptr(s string) *string { return &s }

// withWebhook gives the fixture a fake webhook channel and sets one up for u.
func (f fixture) withWebhook(t *testing.T, u db.User) *fakeSender {
	t.Helper()
	hook := &fakeSender{}
	f.svc.SetSender(ChannelWebhook, hook)
	// An administrator may name a local address; the fake never dials it.
	if err := f.svc.SaveChannel(context.Background(), u.ID, true, ChannelWebhook, ptr("http://127.0.0.1:8123/api/webhook/abc"), ptr("s3")); err != nil {
		t.Fatal(err)
	}
	return hook
}

func (f fixture) queued(t *testing.T) []db.NotificationDelivery {
	t.Helper()
	far := time.Now().Add(1000 * time.Hour)
	rows, err := f.q.ListDueNotificationDeliveries(context.Background(), db.ListDueNotificationDeliveriesParams{NextAt: stamp(far), Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

// An addressed channel carries events only once the person set it up, and
// gets their address opened.
func TestAddressedChannelOnlyOnceSetUp(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	hook := &fakeSender{}
	f.svc.SetSender(ChannelWebhook, hook)
	_ = f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "before"})
	f.svc.deliverDue(ctx)
	if len(hook.got) != 0 {
		t.Fatalf("webhook got %d before it was set up", len(hook.got))
	}
	if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, ptr("https://hooks.example/abc"), ptr("s3")); err != nil {
		t.Fatal(err)
	}
	_ = f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "after"})
	f.svc.deliverDue(ctx)
	if len(hook.got) != 1 || hook.got[0].Title != "after" || hook.to[0].Target != "https://hooks.example/abc" || hook.to[0].Secret != "s3" || !hook.to[0].LocalOK {
		t.Fatalf("webhook got %+v to %+v", hook.got, hook.to)
	}
	if rows := f.queued(t); len(rows) != 0 {
		t.Fatalf("queue left %d", len(rows))
	}
}

// A failure worth retrying is tried again after growing waits, survives a
// restart, and after the last try is dropped with its reason on the channel.
func TestDeliveryRetriesThenGivesUp(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	hook := f.withWebhook(t, u)
	hook.err = &DeliveryError{Reason: ReasonUnreachable, Status: 503}
	start := time.Date(2026, 10, 18, 10, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return start }

	_ = f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "t"})
	f.svc.deliverDue(ctx)
	rows := f.queued(t)
	if len(hook.got) != 1 || len(rows) != 1 || rows[0].Attempts != 1 || rows[0].NextAt != stamp(start.Add(time.Minute)) {
		t.Fatalf("after one failure: sends %d, queue %+v", len(hook.got), rows)
	}
	// Not due yet: nothing is tried.
	f.svc.deliverDue(ctx)
	if len(hook.got) != 1 {
		t.Fatalf("tried before it was due: %d", len(hook.got))
	}

	// A restart: a new service on the same database picks the delivery up.
	again := NewService(f.st.Read(), f.st.Write(), nil)
	again.SetSender(ChannelWebhook, hook)
	at := start
	for _, wait := range backoff {
		at = at.Add(wait)
		again.now = func() time.Time { return at }
		again.deliverDue(ctx)
	}
	if len(hook.got) != 1+len(backoff) {
		t.Fatalf("sends = %d, want %d", len(hook.got), 1+len(backoff))
	}
	if rows := f.queued(t); len(rows) != 0 {
		t.Fatalf("still queued after the last try: %+v", rows)
	}
	chans, _ := f.svc.AddressedChannels(ctx, u.ID)
	for _, c := range chans {
		if c.Channel == ChannelWebhook && c.LastError != "503" {
			t.Fatalf("webhook's last error = %q, want 503", c.LastError)
		}
	}
}

// A refusal of the credentials is not tried again; the next success clears
// the error.
func TestDeliveryUnauthorizedIsNotRetried(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	hook := f.withWebhook(t, u)
	hook.err = &DeliveryError{Reason: ReasonUnauthorized, Status: 401}
	_ = f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "t"})
	f.svc.deliverDue(ctx)
	if rows := f.queued(t); len(rows) != 0 {
		t.Fatalf("a 401 was queued again: %+v", rows)
	}
	info := func() ChannelInfo {
		chans, _ := f.svc.AddressedChannels(ctx, u.ID)
		for _, c := range chans {
			if c.Channel == ChannelWebhook {
				return c
			}
		}
		t.Fatal("no webhook channel")
		return ChannelInfo{}
	}
	if c := info(); c.LastError != "401" || c.LastErrorAt == "" {
		t.Fatalf("after a 401: %+v", c)
	}
	hook.err = nil
	if err := f.svc.TestChannel(ctx, u.ID, "it", ChannelWebhook); err != nil {
		t.Fatal(err)
	}
	if c := info(); c.LastError != "" || c.LastOKAt == "" || !hook.got[len(hook.got)-1].Test {
		t.Fatalf("after a good test: %+v", c)
	}
}

// Saving checks the address; a webhook on the local network needs an
// administrator; the URL never comes back, only its host.
func TestSaveChannelChecksTheAddress(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	f.svc.SetSender(ChannelWebhook, &fakeSender{})

	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelWebhook, ptr("http://192.168.1.20:8123/api/webhook/key"), nil); !errors.Is(err, ErrLocalTarget) {
		t.Fatalf("local webhook by a member = %v, want ErrLocalTarget", err)
	}
	for _, bad := range []string{"ftp://x.example/a", "not a url", "https://user:pw@hooks.example/a"} {
		if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, ptr(bad), nil); !errors.Is(err, ErrBadTarget) {
			t.Errorf("SaveChannel(%q) = %v, want ErrBadTarget", bad, err)
		}
	}
	if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, nil, nil); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("no URL on first save = %v", err)
	}
	if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, ptr("http://192.168.1.20:8123/api/webhook/key"), ptr("s3")); err != nil {
		t.Fatal(err)
	}
	// Changing only the secret keeps the URL, checked again with the role now.
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelWebhook, nil, ptr("")); !errors.Is(err, ErrLocalTarget) {
		t.Fatalf("member keeping an admin's local URL = %v", err)
	}
	chans, _ := f.svc.AddressedChannels(ctx, u.ID)
	var hook ChannelInfo
	for _, c := range chans {
		if c.Channel == ChannelWebhook {
			hook = c
		}
		if c.Channel == ChannelEmail && c.Available {
			t.Error("email is available without a mail server")
		}
	}
	if !hook.Configured || hook.Target != "192.168.1.20:8123" || !hook.HasSecret {
		t.Fatalf("webhook info = %+v", hook)
	}

	f.svc.SetSender(ChannelEmail, &fakeSender{})
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelEmail, ptr("nope"), nil); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("bad email = %v", err)
	}
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelEmail, ptr(" Demo <demo@example.com> "), nil); err != nil {
		t.Fatal(err)
	}
	chans, _ = f.svc.AddressedChannels(ctx, u.ID)
	for _, c := range chans {
		if c.Channel == ChannelEmail && c.Target != "demo@example.com" {
			t.Fatalf("email target = %q", c.Target)
		}
	}
	if err := f.svc.DeleteChannel(ctx, u.ID, ChannelEmail); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.TestChannel(ctx, u.ID, "en", ChannelEmail); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("test of a removed channel = %v", err)
	}
}

// The webhook posts the documented JSON, signed when there is a secret; a
// 401 is a refused credential; a local URL is refused unless an
// administrator saved it.
func TestWebhookSender(t *testing.T) {
	var got []byte
	var sig string
	status := http.StatusNoContent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = io.ReadAll(r.Body)
		sig = r.Header.Get(SignatureHeader)
		w.WriteHeader(status)
	}))
	defer srv.Close()
	w := NewWebhookSender()
	ctx := context.Background()
	e := Event{Kind: KindBills, Title: "Bills due", Body: "Rent", URL: "/schedules", WalletID: 7}

	if err := w.Send(ctx, Recipient{Target: srv.URL, Secret: "s3", LocalOK: true}, e); err != nil {
		t.Fatal(err)
	}
	var p WebhookPayload
	if err := json.Unmarshal(got, &p); err != nil || p.Event != KindBills || p.Title != "Bills due" || p.Path != "/schedules" || p.WalletID != 7 || p.Test {
		t.Fatalf("payload %s (%v)", got, err)
	}
	mac := hmac.New(sha256.New, []byte("s3"))
	mac.Write(got)
	if sig != "sha256="+hex.EncodeToString(mac.Sum(nil)) {
		t.Fatalf("signature %q", sig)
	}

	status = http.StatusUnauthorized
	err := w.Send(ctx, Recipient{Target: srv.URL, LocalOK: true}, e)
	var de *DeliveryError
	if !errors.As(err, &de) || de.Reason != ReasonUnauthorized || de.Error() != "401" || sig != "" {
		t.Fatalf("401 = %v (signature %q)", err, sig)
	}

	err = w.Send(ctx, Recipient{Target: srv.URL}, e)
	if !errors.As(err, &de) || de.Reason != ReasonLocal || strings.Contains(err.Error(), "127.0.0.1") {
		t.Fatalf("local URL by a member = %v", err)
	}
}
