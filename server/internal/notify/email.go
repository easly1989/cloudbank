package notify

import (
	"context"
	"errors"
	"time"

	"github.com/wneessen/go-mail"
)

// SMTPConfig is the installation's mail server, set by the administrator with
// CB_SMTP_* (internal/config). Host empty means no email channel.
type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	// TLS is "starttls" (the default: required, never plain), "tls" (implicit,
	// port 465) or "none" (a relay on a trusted network only).
	TLS string
}

// EmailSender sends the event as a plain-text mail to the person's address.
type EmailSender struct {
	cfg SMTPConfig
}

// NewEmailSender returns a sender for cfg, or nil when cfg names no server.
func NewEmailSender(cfg SMTPConfig) *EmailSender {
	if cfg.Host == "" || cfg.From == "" {
		return nil
	}
	return &EmailSender{cfg: cfg}
}

// Send mails e to the person's address.
func (m *EmailSender) Send(ctx context.Context, to Recipient, e Event) error {
	msg := mail.NewMsg()
	if err := msg.From(m.cfg.From); err != nil {
		return &DeliveryError{Reason: ReasonRejected}
	}
	if err := msg.To(to.Target); err != nil {
		return &DeliveryError{Reason: ReasonRejected}
	}
	msg.Subject(e.Title)
	msg.SetBodyString(mail.TypeTextPlain, e.Body)

	opts := []mail.Option{mail.WithTimeout(20 * time.Second)}
	if m.cfg.Port != 0 {
		opts = append(opts, mail.WithPort(m.cfg.Port))
	}
	auth := mail.SMTPAuthPlain
	switch m.cfg.TLS {
	case "tls":
		opts = append(opts, mail.WithSSL())
	case "none":
		opts = append(opts, mail.WithTLSPolicy(mail.NoTLS))
		auth = mail.SMTPAuthPlainNoEnc
	default:
		opts = append(opts, mail.WithTLSPolicy(mail.TLSMandatory))
	}
	if m.cfg.Username != "" {
		opts = append(opts, mail.WithSMTPAuth(auth), mail.WithUsername(m.cfg.Username), mail.WithPassword(m.cfg.Password))
	}
	c, err := mail.NewClient(m.cfg.Host, opts...)
	if err != nil {
		return &DeliveryError{Reason: ReasonRejected}
	}
	if err := c.DialAndSendWithContext(ctx, msg); err != nil {
		var se *mail.SendError
		if errors.As(err, &se) && se.ErrorCode() != 0 {
			return smtpStatusError(se.ErrorCode())
		}
		return asDeliveryError(err)
	}
	return nil
}
