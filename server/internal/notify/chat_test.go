package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	sharedToken = "111111:shared-bot-token-0000000000"
	ownToken    = "222222:own-bot-token-000000000000"
)

// A pretend Bot API: two tokens it knows, chat "0" it does not.
func telegramAPI(t *testing.T, got *[]string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bot, method, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/bot"), "/")
		if bot != sharedToken && bot != ownToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch method {
		case "getMe":
			_, _ = w.Write([]byte(`{"ok":true,"result":{"username":"demo_bot"}}`))
		case "sendMessage":
			var m struct {
				ChatID string `json:"chat_id"`
				Text   string `json:"text"`
			}
			_ = json.NewDecoder(r.Body).Decode(&m)
			if m.ChatID == "0" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			*got = append(*got, bot[:6]+" "+m.ChatID+" "+m.Text)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// The shared bot sends when the person gave only the chat, their own bot
// when they gave its token; a refused token is a 401 and an unknown chat a
// refused message; anything that is not a token never reaches the URL.
func TestTelegramSender(t *testing.T) {
	var got []string
	api := telegramAPI(t, &got)
	ctx := context.Background()
	tg := NewTelegramSender(api.URL, sharedToken)
	e := Event{Title: "Bills <due>", Body: "Rent & co"}

	if name := tg.BotName(ctx); name != "@demo_bot" {
		t.Fatalf("bot name = %q", name)
	}
	if err := tg.Send(ctx, Recipient{Target: "12345"}, e); err != nil {
		t.Fatal(err)
	}
	if err := tg.Send(ctx, Recipient{Target: "-100777", Secret: ownToken}, e); err != nil {
		t.Fatal(err)
	}
	want := "111111 12345 <b>Bills &lt;due&gt;</b>\nRent &amp; co|222222 -100777 <b>Bills &lt;due&gt;</b>\nRent &amp; co"
	if strings.Join(got, "|") != want {
		t.Fatalf("sent %q", got)
	}
	var de *DeliveryError
	if err := tg.Send(ctx, Recipient{Target: "12345", Secret: "333333:refused-token-00000000000000"}, e); !errors.As(err, &de) || de.Error() != "401" {
		t.Fatalf("refused token = %v", err)
	}
	if err := tg.Send(ctx, Recipient{Target: "0"}, e); !errors.As(err, &de) || de.Reason != ReasonRejected || de.Status != 400 {
		t.Fatalf("unknown chat = %v", err)
	}
	if err := tg.Send(ctx, Recipient{Target: "12345", Secret: "1:../../x"}, e); !errors.As(err, &de) || de.Status != 0 {
		t.Fatalf("malformed token = %v", err)
	}
	if err := NewTelegramSender(api.URL, "").Send(ctx, Recipient{Target: "12345"}, e); !errors.As(err, &de) || de.Reason != ReasonRejected {
		t.Fatalf("no shared bot = %v", err)
	}
}

// Discord and Slack get their own body, with the event's text escaped; a
// local webhook is refused unless an administrator saved it.
func TestChatWebhooks(t *testing.T) {
	var body map[string]any
	status := http.StatusNoContent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body = nil
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(status)
	}))
	defer srv.Close()
	ctx := context.Background()
	e := Event{Title: "Bills_due", Body: "Rent <now>"}

	if err := NewDiscordSender().Send(ctx, Recipient{Target: srv.URL, LocalOK: true}, e); err != nil {
		t.Fatal(err)
	}
	if body["content"] != "**Bills\\_due**\nRent <now\\>" {
		t.Fatalf("discord body %v", body)
	}
	if err := NewSlackSender().Send(ctx, Recipient{Target: srv.URL, LocalOK: true}, e); err != nil {
		t.Fatal(err)
	}
	if body["text"] != "*Bills_due*\nRent &lt;now&gt;" {
		t.Fatalf("slack body %v", body)
	}
	status = http.StatusForbidden
	var de *DeliveryError
	if err := NewSlackSender().Send(ctx, Recipient{Target: srv.URL, LocalOK: true}, e); !errors.As(err, &de) || de.Error() != "403" {
		t.Fatalf("403 = %v", err)
	}
	if err := NewDiscordSender().Send(ctx, Recipient{Target: srv.URL}, e); !errors.As(err, &de) || de.Reason != ReasonLocal {
		t.Fatalf("local by a member = %v", err)
	}
}

// Saving: a Telegram chat needs a chat ID and, without a shared bot, a token
// shaped like one; a Discord or Slack URL is shown by its host only.
func TestSaveChatChannels(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	save := func(ch Channel, admin bool, in ChannelInput) error {
		return f.svc.SaveChannel(ctx, u.ID, admin, ch, in)
	}

	f.svc.SetSender(ChannelTelegram, NewTelegramSender("https://api.telegram.org", ""))
	if err := save(ChannelTelegram, false, ChannelInput{Target: ptr("12345")}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("chat only without a shared bot = %v", err)
	}
	if err := save(ChannelTelegram, false, ChannelInput{Target: ptr("12345"), Secret: ptr("not a token")}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("bad token = %v", err)
	}
	for _, bad := range []string{"", "abc", "12 34", "@ab"} {
		if err := save(ChannelTelegram, false, ChannelInput{Target: ptr(bad), Secret: ptr(ownToken)}); !errors.Is(err, ErrBadTarget) {
			t.Errorf("chat %q = %v", bad, err)
		}
	}
	if err := save(ChannelTelegram, false, ChannelInput{Target: ptr("-100777"), Secret: ptr(ownToken)}); err != nil {
		t.Fatal(err)
	}
	if err := save(ChannelTelegram, false, ChannelInput{Target: ptr("@my_channel")}); err != nil {
		t.Fatalf("a new chat keeps the token: %v", err)
	}

	f.svc.SetSender(ChannelDiscord, NewDiscordSender())
	if err := save(ChannelDiscord, false, ChannelInput{Target: ptr("http://10.0.0.5/api/webhooks/1/key")}); !errors.Is(err, ErrLocalTarget) {
		t.Fatalf("local discord by a member = %v", err)
	}
	if err := save(ChannelDiscord, true, ChannelInput{Target: ptr("http://10.0.0.5/api/webhooks/1/key"), Secret: ptr("ignored")}); err != nil {
		t.Fatal(err)
	}
	chans, _ := f.svc.AddressedChannels(ctx, u.ID)
	for _, c := range chans {
		switch c.Channel {
		case ChannelDiscord:
			if c.Target != "10.0.0.5" || c.HasSecret {
				t.Errorf("discord = %+v", c)
			}
		case ChannelTelegram:
			if c.Target != "@my_channel" || !c.HasSecret || c.Shared {
				t.Errorf("telegram = %+v", c)
			}
		}
	}
}

// Telegram's options travel with the message, are kept by a save that does
// not name them, and belong to Telegram only.
func TestTelegramOptions(t *testing.T) {
	var sent map[string]any
	api := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		sent = nil
		_ = json.NewDecoder(r.Body).Decode(&sent)
	}))
	defer api.Close()
	ctx := context.Background()
	tg := NewTelegramSender(api.URL, sharedToken)
	if err := tg.Send(ctx, Recipient{Target: "-100777", Options: ChannelOptions{Topic: 42, Silent: true}}, Event{Title: "t"}); err != nil {
		t.Fatal(err)
	}
	if sent["message_thread_id"] != float64(42) || sent["disable_notification"] != true {
		t.Fatalf("sent %v", sent)
	}
	if err := tg.Send(ctx, Recipient{Target: "-100777"}, Event{Title: "t"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := sent["message_thread_id"]; ok || sent["disable_notification"] != false {
		t.Fatalf("sent without options %v", sent)
	}

	f := newFixture(t)
	u := f.user(t, "u")
	f.svc.SetSender(ChannelTelegram, tg)
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelTelegram, ChannelInput{Target: ptr("-100777"), Options: &ChannelOptions{Topic: -1}}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("negative topic = %v", err)
	}
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelTelegram, ChannelInput{Target: ptr("-100777"), Options: &ChannelOptions{Topic: 42, Silent: true}}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SaveChannel(ctx, u.ID, false, ChannelTelegram, ChannelInput{Target: ptr("-100888")}); err != nil {
		t.Fatal(err)
	}
	to, _, _ := f.svc.recipient(ctx, u.ID, ChannelTelegram)
	if to.Options != (ChannelOptions{Topic: 42, Silent: true}) {
		t.Fatalf("options after a save without them = %+v", to.Options)
	}
	f.svc.SetSender(ChannelDiscord, NewDiscordSender())
	if err := f.svc.SaveChannel(ctx, u.ID, true, ChannelDiscord, ChannelInput{Target: ptr("http://10.0.0.5/x"), Options: &ChannelOptions{Silent: true}}); err != nil {
		t.Fatal(err)
	}
	if to, _, _ := f.svc.recipient(ctx, u.ID, ChannelDiscord); to.Options != (ChannelOptions{}) {
		t.Fatalf("discord kept options %+v", to.Options)
	}
}
