package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/easly1989/cloudbank/server/internal/netguard"
)

// postJSON posts v to url, with the headers in h, and returns nil for a 2xx.
// Only the status is read: the answer may repeat the URL, which is the key for
// Discord and Slack.
func postJSON(ctx context.Context, hc *http.Client, url string, v any, h http.Header) error {
	body, err := json.Marshal(v)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return &DeliveryError{Reason: ReasonRejected}
	}
	for k, vs := range h {
		req.Header[k] = vs
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CloudBank")
	resp, err := hc.Do(req)
	if err != nil {
		// The error names the URL: keep only its cause.
		return asDeliveryError(err)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return httpStatusError(resp.StatusCode)
	}
	return nil
}

// ChatWebhookSender posts the event to a chat service's incoming webhook
// (#688): Discord or Slack, which differ only in the body they take.
type ChatWebhookSender struct {
	body          func(Event) any
	public, local *http.Client
}

func newChatWebhookSender(body func(Event) any) *ChatWebhookSender {
	return &ChatWebhookSender{
		body:   body,
		public: &http.Client{Timeout: 15 * time.Second, Transport: netguard.Transport()},
		local:  &http.Client{Timeout: 15 * time.Second},
	}
}

// NewDiscordSender posts to a Discord channel's webhook.
func NewDiscordSender() *ChatWebhookSender {
	return newChatWebhookSender(func(e Event) any {
		return map[string]any{
			"content":          "**" + discordEscape(e.Title) + "**\n" + discordEscape(e.Body),
			"allowed_mentions": map[string]any{"parse": []string{}},
		}
	})
}

// NewSlackSender posts to a Slack incoming webhook.
func NewSlackSender() *ChatWebhookSender {
	return newChatWebhookSender(func(e Event) any {
		return map[string]any{"text": "*" + slackEscape(e.Title) + "*\n" + slackEscape(e.Body)}
	})
}

// Send posts e to the webhook URL in to.Target.
func (c *ChatWebhookSender) Send(ctx context.Context, to Recipient, e Event) error {
	hc := c.public
	if to.LocalOK {
		hc = c.local
	}
	return postJSON(ctx, hc, to.Target, c.body(e), nil)
}

// discordEscape keeps a payee's asterisks or underscores from turning into
// Markdown.
func discordEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, "*", `\*`, "_", `\_`, "~", `\~`, "`", "\\`", "|", `\|`, ">", `\>`).Replace(s)
}

// slackEscape escapes the three characters Slack's mrkdwn reserves.
func slackEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

// TelegramSender sends the event as a bot message to the person's chat
// (#688): through the installation's shared bot when the person gave only
// the chat, else through their own bot's token.
type TelegramSender struct {
	// api is the Bot API root, https://api.telegram.org unless testing.
	api string
	// shared is the shared bot's token, "" for none.
	shared string
	hc     *http.Client

	mu sync.Mutex
	// botName is the shared bot's username, once Telegram said it.
	botName string

	updMu sync.Mutex
	// offset is the next update the shared bot has not read (getUpdates).
	offset int64
}

// NewTelegramSender returns a sender for the Bot API at api; shared is the
// installation's bot token, "" for none. The API root is the administrator's,
// so it is called without the public-internet check.
func NewTelegramSender(api, shared string) *TelegramSender {
	return &TelegramSender{api: strings.TrimRight(api, "/"), shared: shared, hc: &http.Client{Timeout: 15 * time.Second}}
}

var (
	telegramToken = regexp.MustCompile(`^[0-9]{1,20}:[A-Za-z0-9_-]{20,100}$`)
	telegramChat  = regexp.MustCompile(`^(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$`)
)

// Shared reports whether the installation has a shared bot.
func (t *TelegramSender) Shared() bool { return t.shared != "" }

// BotName is the shared bot's @username, for people to start a chat with;
// empty without a shared bot, or while Telegram does not answer.
func (t *TelegramSender) BotName(ctx context.Context) string {
	if t.shared == "" {
		return ""
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.botName != "" {
		return t.botName
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.api+"/bot"+t.shared+"/getMe", nil)
	if err != nil {
		return ""
	}
	resp, err := t.hc.Do(req)
	if err != nil {
		return ""
	}
	defer func() { _ = resp.Body.Close() }()
	var me struct {
		Result struct {
			Username string `json:"username"`
		} `json:"result"`
	}
	if resp.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&me) == nil && me.Result.Username != "" {
		t.botName = "@" + me.Result.Username
	}
	return t.botName
}

// Send posts e to the chat in to.Target, as the person's bot when to.Secret
// holds its token.
func (t *TelegramSender) Send(ctx context.Context, to Recipient, e Event) error {
	token := to.Secret
	if token == "" {
		token = t.shared
	}
	// The token goes in the path: refuse anything that is not one.
	if !telegramToken.MatchString(token) {
		return &DeliveryError{Reason: ReasonRejected}
	}
	msg := map[string]any{
		"chat_id":                  to.Target,
		"text":                     "<b>" + html.EscapeString(e.Title) + "</b>\n" + html.EscapeString(e.Body),
		"parse_mode":               "HTML",
		"disable_web_page_preview": true,
		"disable_notification":     to.Options.Silent,
	}
	if to.Options.Topic > 0 {
		msg["message_thread_id"] = to.Options.Topic
	}
	return postJSON(ctx, t.hc, t.api+"/bot"+token+"/sendMessage", msg, nil)
}

// TelegramStart is a /start with a code, sent to the shared bot from a chat:
// a private one, or a group the bot was added to with the link.
type TelegramStart struct{ Chat, Code string }

// Starts reads what was sent to the shared bot since the last call and
// returns the /start commands that carry a code. Anything else is skipped.
func (t *TelegramSender) Starts(ctx context.Context) []TelegramStart {
	if t.shared == "" {
		return nil
	}
	t.updMu.Lock()
	defer t.updMu.Unlock()
	u := fmt.Sprintf("%s/bot%s/getUpdates?offset=%d&timeout=0&allowed_updates=%s", t.api, t.shared, t.offset, url.QueryEscape(`["message"]`))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil
	}
	resp, err := t.hc.Do(req)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	var got struct {
		Result []struct {
			UpdateID int64 `json:"update_id"`
			Message  struct {
				Text string `json:"text"`
				Chat struct {
					ID int64 `json:"id"`
				} `json:"chat"`
			} `json:"message"`
		} `json:"result"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&got) != nil {
		return nil
	}
	var out []TelegramStart
	for _, up := range got.Result {
		t.offset = max(t.offset, up.UpdateID+1)
		// "/start <code>" in a private chat, "/start@bot <code>" in a group.
		f := strings.Fields(up.Message.Text)
		if len(f) == 2 && (f[0] == "/start" || strings.HasPrefix(f[0], "/start@")) && up.Message.Chat.ID != 0 {
			out = append(out, TelegramStart{Chat: strconv.FormatInt(up.Message.Chat.ID, 10), Code: f[1]})
		}
	}
	return out
}
