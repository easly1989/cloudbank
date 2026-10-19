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
	if err := f.svc.SaveChannel(context.Background(), u.ID, true, ChannelWebhook, ChannelInput{Target: ptr("http://127.0.0.1:8123/api/webhook/abc"), Secret: ptr("s3")}); err != nil {
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
	if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, ChannelInput{Target: ptr("https://hooks.example/abc"), Secret: ptr("s3")}); err != nil {
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

	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelWebhook, ChannelInput{Target: ptr("http://192.168.1.20:8123/api/webhook/key"), Secret: nil}); !errors.Is(err, ErrLocalTarget) {
		t.Fatalf("local webhook by a member = %v, want ErrLocalTarget", err)
	}
	for _, bad := range []string{"ftp://x.example/a", "not a url", "https://user:pw@hooks.example/a"} {
		if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, ChannelInput{Target: ptr(bad), Secret: nil}); !errors.Is(err, ErrBadTarget) {
			t.Errorf("SaveChannel(%q) = %v, want ErrBadTarget", bad, err)
		}
	}
	if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, ChannelInput{Target: nil, Secret: nil}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("no URL on first save = %v", err)
	}
	if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, ChannelInput{Target: ptr("http://192.168.1.20:8123/api/webhook/key"), Secret: ptr("s3")}); err != nil {
		t.Fatal(err)
	}
	// Changing only the secret keeps the URL, checked again with the role now.
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelWebhook, ChannelInput{Target: nil, Secret: ptr("")}); !errors.Is(err, ErrLocalTarget) {
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
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelEmail, ChannelInput{Target: ptr("nope"), Secret: nil}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("bad email = %v", err)
	}
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelEmail, ChannelInput{Target: ptr(" Demo <demo@example.com> "), Secret: nil}); err != nil {
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

// A pretend homeserver: it knows two tokens; the shared bot is only invited
// to the room until it joins.
type homeserver struct {
	joined map[string]bool
	msgs   []string
}

func (h *homeserver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token != "bot" && token != "mine" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	switch {
	case r.URL.Path == "/_matrix/client/v3/account/whoami":
		_, _ = w.Write([]byte(`{"user_id":"@` + token + `:hs.example"}`))
		return
	case r.Method == http.MethodPost && r.URL.Path == "/_matrix/client/v3/join/!room:hs.example":
		h.joined[token] = true
	case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/_matrix/client/v3/rooms/!room:hs.example/send/m.room.message/"):
		if token == "bot" && !h.joined[token] {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		var m struct{ Msgtype, Body string }
		_ = json.NewDecoder(r.Body).Decode(&m)
		h.msgs = append(h.msgs, token+": "+m.Msgtype+" "+m.Body)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
	_, _ = w.Write([]byte("{}"))
}

// The shared bot accepts its invitation when it is not in the room yet; a
// person's own bot posts with its token; a wrong token is a 401.
func TestMatrixSender(t *testing.T) {
	hs := &homeserver{joined: map[string]bool{}}
	srv := httptest.NewServer(hs)
	defer srv.Close()
	ctx := context.Background()
	e := Event{Kind: KindBills, Title: "Bills due", Body: "Rent"}
	m := NewMatrixSender(&MatrixBot{Homeserver: srv.URL, Token: "bot"})

	if bot := m.BotUser(ctx); bot != "@bot:hs.example" {
		t.Fatalf("bot = %q", bot)
	}
	if err := m.Send(ctx, Recipient{Target: "!room:hs.example"}, e); err != nil {
		t.Fatal(err)
	}
	if err := m.Send(ctx, Recipient{Target: "!room:hs.example", Server: srv.URL, Secret: "mine", LocalOK: true}, e); err != nil {
		t.Fatal(err)
	}
	want := []string{"bot: m.text Bills due\nRent", "mine: m.text Bills due\nRent"}
	if strings.Join(hs.msgs, "|") != strings.Join(want, "|") {
		t.Fatalf("messages = %q", hs.msgs)
	}
	var de *DeliveryError
	err := m.Send(ctx, Recipient{Target: "!room:hs.example", Server: srv.URL, Secret: "wrong", LocalOK: true}, e)
	if !errors.As(err, &de) || de.Error() != "401" {
		t.Fatalf("wrong token = %v", err)
	}
	err = m.Send(ctx, Recipient{Target: "!room:hs.example", Server: srv.URL, Secret: "mine"}, e)
	if !errors.As(err, &de) || de.Reason != ReasonLocal {
		t.Fatalf("local homeserver by a member = %v", err)
	}
	if err := NewMatrixSender(nil).Send(ctx, Recipient{Target: "!room:hs.example"}, e); !errors.As(err, &de) || de.Reason != ReasonRejected {
		t.Fatalf("no shared bot = %v", err)
	}
}

// A Matrix room needs a room ID; only the room with a shared bot, else a
// homeserver and a token; a local homeserver needs an administrator; the
// token never comes back.
func TestSaveMatrixChannel(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	room := ptr("!room:hs.example")
	save := func(admin bool, in ChannelInput) error { return f.svc.SaveChannel(ctx, u.ID, admin, ChannelMatrix, in) }

	f.svc.SetSender(ChannelMatrix, NewMatrixSender(nil))
	if err := save(false, ChannelInput{Target: room}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("room only without a shared bot = %v", err)
	}
	if err := save(false, ChannelInput{Target: room, Server: ptr("https://hs.example")}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("homeserver without a token = %v", err)
	}
	if err := save(false, ChannelInput{Target: room, Server: ptr("http://192.168.1.5:8008"), Secret: ptr("tok")}); !errors.Is(err, ErrLocalTarget) {
		t.Fatalf("local homeserver by a member = %v", err)
	}
	if err := save(true, ChannelInput{Target: room, Server: ptr("http://192.168.1.5:8008/"), Secret: ptr("tok")}); err != nil {
		t.Fatal(err)
	}
	// A new room keeps the homeserver and the token.
	if err := save(true, ChannelInput{Target: ptr("!other:hs.example")}); err != nil {
		t.Fatal(err)
	}
	to, ok, err := f.svc.recipient(ctx, u.ID, ChannelMatrix)
	if err != nil || !ok || to.Target != "!other:hs.example" || to.Server != "http://192.168.1.5:8008" || to.Secret != "tok" || !to.LocalOK {
		t.Fatalf("recipient = %+v %v %v", to, ok, err)
	}
	for _, bad := range []string{"#alias:hs.example", "room", "!nocolon"} {
		if err := save(true, ChannelInput{Target: ptr(bad)}); !errors.Is(err, ErrBadTarget) {
			t.Errorf("room %q = %v", bad, err)
		}
	}

	f.svc.SetSender(ChannelMatrix, NewMatrixSender(&MatrixBot{Homeserver: "https://hs.example", Token: "bot"}))
	// Back to the shared bot: the person's token is dropped.
	if err := save(false, ChannelInput{Target: room, Server: ptr("")}); err != nil {
		t.Fatal(err)
	}
	chans, _ := f.svc.AddressedChannels(ctx, u.ID)
	for _, c := range chans {
		if c.Channel == ChannelMatrix && (!c.Shared || c.Server != "" || c.HasSecret || c.Target != "!room:hs.example") {
			t.Fatalf("matrix info = %+v", c)
		}
	}
}
