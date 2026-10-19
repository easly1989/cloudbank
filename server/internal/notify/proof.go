package notify

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// A channel that sends through one of the installation's own resources (its
// mail server, its shared Matrix or Telegram bot) sends nothing until its owner
// proves the address is theirs, so nobody can use the installation to write to
// people who did not ask (#716). Email and Matrix get a 6-digit code to type
// back; Telegram's shared bot is reached through a link that carries a code.

var (
	// ErrWrongCode means the code typed is not the one sent.
	ErrWrongCode = errors.New("notify: wrong code")
	// ErrCodeExpired means the code is past its time or was tried too often:
	// a new one is needed.
	ErrCodeExpired = errors.New("notify: the code expired")
	// ErrNotInvited means the shared Matrix bot has no invitation to the room.
	ErrNotInvited = errors.New("notify: the bot was not invited to the room")
	// ErrHourlyLimit means the person reached the hourly cap on a channel that
	// goes through the installation's resources.
	ErrHourlyLimit = errors.New("notify: hourly limit reached")
)

const (
	// codeTTL is how long a code or a Telegram link stays good.
	codeTTL = 15 * time.Minute
	// codeTries is how many times a code may be typed.
	codeTries = 5
	// defaultHourlyLimit is CB_NOTIFY_HOURLY_LIMIT's default.
	defaultHourlyLimit = 30
)

// viaInstallation reports whether delivering to `to` on ch goes through the
// installation's own resources rather than the person's.
func viaInstallation(ch Channel, to Recipient) bool {
	switch ch {
	case ChannelEmail:
		return true
	case ChannelMatrix:
		return to.Server == ""
	case ChannelTelegram:
		return to.Secret == ""
	}
	return false
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func sixDigits() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		panic(err) // crypto/rand does not fail on supported platforms
	}
	return fmt.Sprintf("%06d", n.Int64())
}

func expired(at sql.NullString, now time.Time) bool {
	t, err := time.Parse(timeLayout, at.String)
	return !at.Valid || err != nil || now.After(t)
}

// codeTexts is the message that carries a code, one per language; %s is the
// code.
var codeTexts = map[string]testText{
	"en":    {"CloudBank: your code %s", "Type %s in CloudBank's notification settings to confirm this address. It is good for 15 minutes. If you did not ask for it, ignore this message."},
	"it":    {"CloudBank: il tuo codice %s", "Inserisci %s nelle impostazioni delle notifiche di CloudBank per confermare questo indirizzo. Vale 15 minuti. Se non l'hai chiesto tu, ignora questo messaggio."},
	"es":    {"CloudBank: tu código %s", "Escribe %s en los ajustes de notificaciones de CloudBank para confirmar esta dirección. Vale 15 minutos. Si no lo has pedido, ignora este mensaje."},
	"fr":    {"CloudBank : votre code %s", "Saisissez %s dans les paramètres de notifications de CloudBank pour confirmer cette adresse. Il est valable 15 minutes. Si vous ne l’avez pas demandé, ignorez ce message."},
	"de":    {"CloudBank: dein Code %s", "Gib %s in den Benachrichtigungseinstellungen von CloudBank ein, um diese Adresse zu bestätigen. Er gilt 15 Minuten. Wenn du ihn nicht angefordert hast, ignoriere diese Nachricht."},
	"pt-BR": {"CloudBank: seu código %s", "Digite %s nas configurações de notificações do CloudBank para confirmar este endereço. Ele vale 15 minutos. Se você não pediu, ignore esta mensagem."},
}

// proofCode is a fresh proof to store on a channel.
type proofCode struct {
	hash, link string
	expires    sql.NullString
}

// issueCode makes a new code for the channel and, for email and Matrix, sends
// it. One per channel every few seconds, like the tests, and each one sent
// counts toward the hourly cap; one that could not go out does not count, so
// the person can invite the bot and try again at once.
func (s *Service) issueCode(ctx context.Context, lang string, ch Channel, to Recipient) (proofCode, error) {
	key := fmt.Sprint("code", to.UserID, ch)
	s.testMu.Lock()
	last, seen := s.tested[key]
	s.testMu.Unlock()
	if seen && s.now().Sub(last) < testEvery {
		return proofCode{}, ErrTooSoon
	}
	c, err := s.makeCode(ctx, lang, ch, to)
	if err == nil {
		s.testMu.Lock()
		s.tested[key] = s.now()
		s.testMu.Unlock()
	}
	return c, err
}

func (s *Service) makeCode(ctx context.Context, lang string, ch Channel, to Recipient) (proofCode, error) {
	c := proofCode{expires: sql.NullString{String: stamp(s.now().Add(codeTTL)), Valid: true}}
	if ch == ChannelTelegram {
		raw := make([]byte, 16)
		_, _ = rand.Read(raw)
		v := hex.EncodeToString(raw)
		c.hash, c.link = hashCode(v), secrets.Seal(v)
		return c, nil
	}
	if ok, _ := s.allow(ch, to); !ok {
		return proofCode{}, ErrHourlyLimit
	}
	if m, ok := s.senders[ch].(*MatrixSender); ok {
		if err := m.Admit(ctx, to.Target); err != nil {
			return proofCode{}, err
		}
	}
	v := sixDigits()
	text := locale.Pick(codeTexts, lang)
	e := Event{Kind: "code", Title: fmt.Sprintf(text.title, v), Body: fmt.Sprintf(text.body, v), URL: "/settings/notifications/" + string(ch)}
	if err := s.senders[ch].Send(ctx, to, e); err != nil {
		return proofCode{}, asDeliveryError(err)
	}
	c.hash = hashCode(v)
	return c, nil
}

// ResendCode replaces a pending channel's code with a new one: mailed, posted
// in the room, or a new Telegram link.
func (s *Service) ResendCode(ctx context.Context, userID int64, lang string, ch Channel) error {
	if !addressed(ch) || s.senders[ch] == nil {
		return ErrChannelUnavailable
	}
	row, err := s.rq.GetNotificationChannel(ctx, db.GetNotificationChannelParams{UserID: userID, Channel: string(ch)})
	if errors.Is(err, sql.ErrNoRows) || (err == nil && row.Verified != 0) {
		return ErrNotSetUp
	}
	if err != nil {
		return err
	}
	c, err := s.issueCode(ctx, lang, ch, rowRecipient(userID, row))
	if err != nil {
		return err
	}
	return s.q.SetNotificationChannelCode(ctx, db.SetNotificationChannelCodeParams{
		CodeHash: c.hash, CodeLink: c.link, CodeExpiresAt: c.expires, UserID: userID, Channel: string(ch),
	})
}

// ConfirmChannel checks the code typed for a pending email or Matrix channel
// and, when it is right, lets the channel send.
func (s *Service) ConfirmChannel(ctx context.Context, userID int64, ch Channel, typed string) error {
	if ch != ChannelEmail && ch != ChannelMatrix {
		return ErrChannelUnavailable
	}
	row, err := s.rq.GetNotificationChannel(ctx, db.GetNotificationChannelParams{UserID: userID, Channel: string(ch)})
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (row.Verified != 0 || row.CodeHash == "")) {
		return ErrNotSetUp
	}
	if err != nil {
		return err
	}
	// Spend the try before comparing, so tries made at once cannot exceed it.
	n, err := s.q.CountNotificationCodeAttempt(ctx, db.CountNotificationCodeAttemptParams{UserID: userID, Channel: string(ch), CodeAttempts: codeTries})
	if err != nil {
		return err
	}
	if n == 0 || expired(row.CodeExpiresAt, s.now()) {
		return ErrCodeExpired
	}
	if subtle.ConstantTimeCompare([]byte(hashCode(strings.TrimSpace(typed))), []byte(row.CodeHash)) != 1 {
		if row.CodeAttempts+1 >= codeTries {
			return ErrCodeExpired
		}
		return ErrWrongCode
	}
	return s.q.VerifyNotificationChannel(ctx, db.VerifyNotificationChannelParams{UserID: userID, Channel: string(ch)})
}

// linkTelegram reads what was sent to the shared Telegram bot and links each
// chat whose /start carries a pending code to that code's owner.
func (s *Service) linkTelegram(ctx context.Context) {
	tg, ok := s.senders[ChannelTelegram].(*TelegramSender)
	if !ok || !tg.Shared() {
		return
	}
	for _, st := range tg.Starts(ctx) {
		row, err := s.rq.FindNotificationCode(ctx, db.FindNotificationCodeParams{Channel: string(ChannelTelegram), CodeHash: hashCode(st.Code)})
		if err != nil || expired(row.CodeExpiresAt, s.now()) {
			continue
		}
		_ = s.q.VerifyNotificationChannel(ctx, db.VerifyNotificationChannelParams{
			Target: sql.NullString{String: secrets.Seal(st.Chat), Valid: true}, UserID: row.UserID, Channel: string(ChannelTelegram),
		})
	}
}

// telegramLinks are the deep links that start the shared bot with a pending
// code: in a private chat, and into a group. Empty once the code expired or
// while the bot's name is unknown.
func (s *Service) telegramLinks(row db.NotificationChannel, bot string) (string, string) {
	if row.CodeLink == "" || bot == "" || expired(row.CodeExpiresAt, s.now()) {
		return "", ""
	}
	base := "https://t.me/" + strings.TrimPrefix(bot, "@")
	c := secrets.Open(row.CodeLink)
	return base + "?start=" + c, base + "?startgroup=" + c
}

// SetHourlyLimit sets the hourly cap per person and channel on what goes
// through the installation's resources; 0 turns it off.
func (s *Service) SetHourlyLimit(n int) { s.limit = n }

// allow counts one delivery to `to` against the hourly cap and reports
// whether it may go now; when not, next is when it may. Deliveries through
// the person's own resources are not counted.
func (s *Service) allow(ch Channel, to Recipient) (ok bool, next time.Time) {
	if s.limit <= 0 || !viaInstallation(ch, to) {
		return true, time.Time{}
	}
	now := s.now()
	key := fmt.Sprint(to.UserID, ch)
	s.sentMu.Lock()
	defer s.sentMu.Unlock()
	recent := s.sent[key][:0]
	for _, t := range s.sent[key] {
		if now.Sub(t) < time.Hour {
			recent = append(recent, t)
		}
	}
	if len(recent) >= s.limit {
		s.sent[key] = recent
		return false, recent[0].Add(time.Hour)
	}
	s.sent[key] = append(recent, now)
	return true, time.Time{}
}
