package notify

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

var sixDigitCode = regexp.MustCompile(`\b\d{6}\b`)

// clock lets a test move the service's time.
func clock(f fixture) *time.Time {
	now := time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	return &now
}

func lastCode(t *testing.T, s *fakeSender) string {
	t.Helper()
	if len(s.got) == 0 {
		t.Fatal("no code sent")
	}
	c := sixDigitCode.FindString(s.got[len(s.got)-1].Title)
	if c == "" {
		t.Fatalf("no code in %q", s.got[len(s.got)-1].Title)
	}
	return c
}

// An email address gets nothing until its code comes back: a wrong code does
// not do it, the sixth try is refused even with the right code, an expired
// code is refused, and saving the same address again changes nothing.
func TestEmailNeedsItsCode(t *testing.T) {
	f := newFixture(t)
	now := clock(f)
	ctx := context.Background()
	u := f.user(t, "u")
	mail := &fakeSender{}
	f.svc.SetSender(ChannelEmail, mail)
	save := func(addr string) error {
		return f.svc.SaveChannel(ctx, u.ID, false, ChannelEmail, ChannelInput{Target: ptr(addr), Lang: "it"})
	}

	if err := save("demo@example.com"); err != nil {
		t.Fatal(err)
	}
	code := lastCode(t, mail)
	wrong := "111111"
	if code == wrong {
		wrong = "222222"
	}
	if !strings.Contains(mail.got[0].Body, "15 minuti") || mail.to[0].Target != "demo@example.com" {
		t.Fatalf("code mail %+v to %+v", mail.got[0], mail.to[0])
	}
	if err := f.svc.TestChannel(ctx, u.ID, "en", ChannelEmail); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("test before the code = %v", err)
	}
	if err := f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "Bills"}); err != nil {
		t.Fatal(err)
	}
	f.svc.deliverDue(ctx)
	if len(mail.got) != 1 {
		t.Fatalf("an unconfirmed address got %d mails", len(mail.got))
	}
	if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelEmail, wrong); !errors.Is(err, ErrWrongCode) {
		t.Fatalf("wrong code = %v", err)
	}
	if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelEmail, " "+code+" "); err != nil {
		t.Fatalf("right code = %v", err)
	}
	if err := f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: "Bills"}); err != nil {
		t.Fatal(err)
	}
	f.svc.deliverDue(ctx)
	if len(mail.got) != 2 || mail.got[1].Title != "Bills" {
		t.Fatalf("after the code: %+v", mail.got)
	}
	if err := save("demo@example.com"); err != nil || len(mail.got) != 2 {
		t.Fatalf("same address again = %v, %d mails", err, len(mail.got))
	}

	// A new address needs a new code; five wrong tries use it up.
	*now = now.Add(time.Minute)
	if err := save("other@example.com"); err != nil {
		t.Fatal(err)
	}
	code = lastCode(t, mail)
	if code == wrong {
		wrong = "333333"
	}
	for i := 1; i <= 4; i++ {
		if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelEmail, wrong); !errors.Is(err, ErrWrongCode) {
			t.Fatalf("wrong try %d = %v", i, err)
		}
	}
	if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelEmail, wrong); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("fifth wrong try = %v", err)
	}
	if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelEmail, code); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("sixth try = %v", err)
	}

	// A new code, but not twice in a row, and not after 15 minutes.
	if err := f.svc.ResendCode(ctx, u.ID, "en", ChannelEmail); !errors.Is(err, ErrTooSoon) {
		t.Fatalf("a new code moments after = %v", err)
	}
	*now = now.Add(time.Minute)
	if err := f.svc.ResendCode(ctx, u.ID, "en", ChannelEmail); err != nil {
		t.Fatal(err)
	}
	code = lastCode(t, mail)
	*now = now.Add(codeTTL + time.Second)
	if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelEmail, code); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("expired code = %v", err)
	}
	*now = now.Add(time.Minute)
	if err := f.svc.ResendCode(ctx, u.ID, "en", ChannelEmail); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelEmail, lastCode(t, mail)); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ResendCode(ctx, u.ID, "en", ChannelEmail); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("a code for a confirmed address = %v", err)
	}

	// A code that cannot be sent saves nothing.
	*now = now.Add(time.Minute)
	mail.err = &DeliveryError{Reason: ReasonUnauthorized, Status: 535}
	var de *DeliveryError
	if err := save("third@example.com"); !errors.As(err, &de) || de.Status != 535 {
		t.Fatalf("unsendable code = %v", err)
	}
	if to, ok, _ := f.svc.recipient(ctx, u.ID, ChannelEmail); !ok || to.Target != "other@example.com" {
		t.Fatalf("after a failed code: %+v %v", to, ok)
	}
}

// botUpdates is a pretend Bot API that hands out the updates a test queues.
type botUpdates struct {
	mu      sync.Mutex
	updates []string
}

func (b *botUpdates) start(chat int64, text string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.updates = append(b.updates, fmt.Sprintf(`{"update_id":%d,"message":{"text":%q,"chat":{"id":%d}}}`, len(b.updates)+1, text, chat))
}

func (b *botUpdates) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch {
	case strings.HasSuffix(r.URL.Path, "/getMe"):
		_, _ = w.Write([]byte(`{"ok":true,"result":{"username":"demo_bot"}}`))
	case strings.HasSuffix(r.URL.Path, "/getUpdates"):
		var offset int
		_, _ = fmt.Sscan(r.URL.Query().Get("offset"), &offset)
		if offset > 0 {
			offset--
		}
		if offset > len(b.updates) {
			offset = len(b.updates)
		}
		_, _ = w.Write([]byte(`{"ok":true,"result":[` + strings.Join(b.updates[offset:], ",") + `]}`))
	default:
		_, _ = w.Write([]byte(`{"ok":true}`))
	}
}

// The shared Telegram bot links the chat that sends /start with the person's
// code, and no other: not a /start without it, nor a code past its time.
func TestTelegramLinksByCode(t *testing.T) {
	bot := &botUpdates{}
	api := httptest.NewServer(bot)
	defer api.Close()
	f := newFixture(t)
	now := clock(f)
	ctx := context.Background()
	u := f.user(t, "u")
	f.svc.SetSender(ChannelTelegram, NewTelegramSender(api.URL, sharedToken))
	telegram := func() ChannelInfo {
		chans, err := f.svc.AddressedChannels(ctx, u.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range chans {
			if c.Channel == ChannelTelegram {
				return c
			}
		}
		t.Fatal("no telegram")
		return ChannelInfo{}
	}

	// A chat ID typed in is ignored: the chat comes from the link.
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelTelegram, ChannelInput{Target: ptr("12345"), Secret: ptr("")}); err != nil {
		t.Fatal(err)
	}
	c := telegram()
	if !c.Pending || c.Target != "" || !strings.HasPrefix(c.Link, "https://t.me/demo_bot?start=") || !strings.HasPrefix(c.GroupLink, "https://t.me/demo_bot?startgroup=") {
		t.Fatalf("pending telegram = %+v", c)
	}
	code := strings.TrimPrefix(c.Link, "https://t.me/demo_bot?start=")

	bot.start(666, "/start")
	bot.start(666, "/start not-the-code")
	if c := telegram(); !c.Pending || c.Target != "" {
		t.Fatalf("after a /start without the code = %+v", c)
	}
	bot.start(-100777, "/start@demo_bot "+code)
	if c := telegram(); c.Pending || c.Target != "-100777" || c.Link != "" {
		t.Fatalf("after the code = %+v", c)
	}
	// Topic and sound change; the chat stays linked.
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelTelegram, ChannelInput{Target: ptr(""), Secret: ptr(""), Options: &ChannelOptions{Topic: 3}}); err != nil {
		t.Fatal(err)
	}
	if c := telegram(); c.Pending || c.Target != "-100777" || c.Options.Topic != 3 {
		t.Fatalf("after an options save = %+v", c)
	}

	// From a bot of one's own back to the shared one: a new link, and an old
	// one's code does nothing once expired.
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelTelegram, ChannelInput{Target: ptr("424242"), Secret: ptr(ownToken)}); err != nil {
		t.Fatal(err)
	}
	if c := telegram(); c.Pending || c.Target != "424242" {
		t.Fatalf("own bot = %+v", c)
	}
	*now = now.Add(time.Minute)
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelTelegram, ChannelInput{Target: ptr(""), Secret: ptr("")}); err != nil {
		t.Fatal(err)
	}
	c = telegram()
	if !c.Pending || c.Target != "" || c.Link == "" {
		t.Fatalf("back to the shared bot = %+v", c)
	}
	*now = now.Add(codeTTL + time.Second)
	bot.start(888, "/start "+strings.TrimPrefix(c.Link, "https://t.me/demo_bot?start="))
	if c := telegram(); !c.Pending || c.Link != "" {
		t.Fatalf("an expired link = %+v", c)
	}
}

// The shared Matrix bot posts its code only in a room it was invited to, and
// the code makes the channel send.
func TestMatrixNeedsItsCode(t *testing.T) {
	hs := &homeserver{joined: map[string]bool{}}
	srv := httptest.NewServer(hs)
	defer srv.Close()
	f := newFixture(t)
	now := clock(f)
	ctx := context.Background()
	u := f.user(t, "u")
	f.svc.SetSender(ChannelMatrix, NewMatrixSender(&MatrixBot{Homeserver: srv.URL, Token: "bot"}))
	save := func() error {
		return f.svc.SaveChannel(ctx, u.ID, false, ChannelMatrix, ChannelInput{Target: ptr("!room:hs.example"), Lang: "en"})
	}

	if err := save(); !errors.Is(err, ErrNotInvited) || hs.joined["bot"] {
		t.Fatalf("a room without an invitation = %v (joined %v)", err, hs.joined["bot"])
	}
	if _, ok, _ := f.svc.recipient(ctx, u.ID, ChannelMatrix); ok {
		t.Fatal("saved anyway")
	}
	hs.invited = true
	*now = now.Add(time.Minute)
	if err := save(); err != nil {
		t.Fatal(err)
	}
	if len(hs.msgs) != 1 || !strings.HasPrefix(hs.msgs[0], "bot: m.text CloudBank: your code ") {
		t.Fatalf("messages = %q", hs.msgs)
	}
	if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelMatrix, sixDigitCode.FindString(hs.msgs[0])); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := f.svc.recipient(ctx, u.ID, ChannelMatrix); !ok {
		t.Fatal("not confirmed")
	}
}

// Over the hourly cap, deliveries through the installation wait for the next
// hour, and the page says so; the person's own webhook is not capped.
func TestHourlyLimit(t *testing.T) {
	f := newFixture(t)
	now := clock(f)
	ctx := context.Background()
	u := f.user(t, "u")
	mail, hook := &fakeSender{}, &fakeSender{}
	f.svc.SetSender(ChannelEmail, mail)
	f.svc.SetSender(ChannelWebhook, hook)
	f.svc.SetHourlyLimit(3)
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelEmail, ChannelInput{Target: ptr("demo@example.com")}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ConfirmChannel(ctx, u.ID, ChannelEmail, lastCode(t, mail)); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelWebhook, ChannelInput{Target: ptr("http://10.0.0.5/hook")}); err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		if err := f.svc.Notify(ctx, u.ID, Event{Kind: KindBills, Title: fmt.Sprint("n", i)}); err != nil {
			t.Fatal(err)
		}
	}
	f.svc.deliverDue(ctx)
	// The code counted: two of the three went.
	if len(mail.got) != 3 || len(hook.got) != 3 {
		t.Fatalf("mails %d, hooks %d", len(mail.got), len(hook.got))
	}
	for _, c := range must(f.svc.AddressedChannels(ctx, u.ID)) {
		if c.Channel == ChannelEmail && c.LastError != "limited" {
			t.Fatalf("email state = %+v", c)
		}
	}
	if err := f.svc.TestChannel(ctx, u.ID, "en", ChannelEmail); !errors.Is(err, ErrHourlyLimit) {
		t.Fatalf("test over the cap = %v", err)
	}
	*now = now.Add(time.Hour)
	f.svc.deliverDue(ctx)
	if len(mail.got) != 4 || mail.got[3].Title != "n2" {
		t.Fatalf("after the hour: %+v", mail.got)
	}
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}
