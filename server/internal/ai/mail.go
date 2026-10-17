package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// MailReading is what the model read in a bank's notification mail (#659):
// an amount as the mail writes it (positive), "out" or "in", the date when the
// mail gives one (else ""), and a short description of the payment.
type MailReading struct {
	Amount    string
	Direction string
	Date      string
	Text      string
}

// rawReading is the JSON shape asked of the model.
type rawReading struct {
	Payment   bool   `json:"payment"`
	Amount    any    `json:"amount"`
	Direction string `json:"direction"`
	Date      string `json:"date"`
	Text      string `json:"text"`
}

// mailMax bounds the mail text sent: a notification is short, and the rest of
// a long mail (footers, adverts) only costs tokens.
const mailMax = 4000

var (
	// An IBAN: two letters, two check digits, then groups of four, spaced or
	// not, ending in a shorter group.
	reIBAN = regexp.MustCompile(`\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b`)
	// A run of digits joined by spaces, dashes or the stars, underscores and
	// x's a bank masks a card with, which may come first ("XXXX XXXX 5678").
	reDigitRun = regexp.MustCompile(`[\d*•_xX][\d \-_*•xX]*\d`)
	reAmount   = regexp.MustCompile(`^\d[\d.,' ]*$`)
)

// hideNumbers blanks out every card number and IBAN, and any other long
// number, before a mail leaves the server: a run of eight digits or more, or a
// masked card ("**** 5678", "1234_*_*_5678") that still shows some. Amounts,
// dates and times keep their punctuation and stay.
func hideNumbers(s string) string {
	s = reIBAN.ReplaceAllString(s, "[IBAN]")
	return reDigitRun.ReplaceAllStringFunc(s, func(run string) string {
		digits, masked := 0, false
		for _, r := range run {
			switch {
			case r >= '0' && r <= '9':
				digits++
			case r == '*' || r == '•' || r == '_' || r == 'x' || r == 'X':
				masked = true
			}
		}
		if digits >= 8 || (masked && digits >= 4) {
			return "[hidden]"
		}
		return run
	})
}

// Configured reports whether the user has AI enabled and complete.
func (s *Service) Configured(ctx context.Context, userID int64) bool {
	cfg, err := s.load(ctx, userID)
	return err == nil && cfg.Enabled != 0 && cfg.ApiKey != "" && cfg.BaseUrl != "" && cfg.Model != ""
}

// ReadBankMail asks the user's model what payment a bank's mail reports.
// Card numbers and IBANs never leave: they are hidden first. It returns nil
// and no error when the model says the mail is no payment, or answers with
// something that cannot be one; an error means the provider could not be asked.
// received (YYYY-MM-DD) grounds a date the mail writes without its year.
func (s *Service) ReadBankMail(ctx context.Context, userID int64, subject, body, received string) (*MailReading, error) {
	cfg, err := s.load(ctx, userID)
	if err != nil {
		return nil, err
	}
	if cfg.Enabled == 0 || cfg.ApiKey == "" || cfg.BaseUrl == "" || cfg.Model == "" {
		return nil, ErrNotConfigured
	}
	// Only an administrator's own provider may be on the local network (#543).
	admin := false
	if u, err := s.rq.GetUserByID(ctx, userID); err == nil {
		admin = u.IsAdmin != 0
	}
	if len(body) > mailMax {
		// The cut can split a character; drop what is left of it.
		body = strings.ToValidUTF8(body[:mailMax], "")
	}
	system := "You read one notification mail from a bank and reply with ONLY a minified JSON object, " +
		"no prose, no code fences. If the mail reports one movement of money on the account (a card " +
		"payment, a transfer, a withdrawal, a direct debit, money received), reply " +
		"{\"payment\":true,\"amount\":<the amount as written, positive>,\"direction\":\"out\" or \"in\"," +
		"\"date\":\"YYYY-MM-DD\" or \"\",\"text\":\"<the merchant, the counterpart, or a short description>\"}. " +
		"\"out\" is money that left the account, \"in\" money that arrived. The date is the payment's, " +
		"if the mail gives one; use the received date's year when the mail leaves it out. " +
		"If the mail is anything else (an advert, a login or security notice, a statement ready, a " +
		"reminder), reply {\"payment\":false}. Never invent an amount. Card numbers, IBANs and other " +
		"long numbers are hidden as [hidden] and [IBAN]."
	user := fmt.Sprintf("Received: %s\nSubject: %s\n\n%s", received, hideNumbers(subject), hideNumbers(body))
	reply, err := newClient(cfg.BaseUrl, cfg.ApiKey, cfg.Model, s.hc, admin).chat(ctx, system, user)
	if err != nil {
		return nil, err
	}
	return readingOf(reply), nil
}

// readingOf checks the model's answer: anything incomplete is no reading.
func readingOf(reply string) *MailReading {
	start, end := strings.Index(reply, "{"), strings.LastIndex(reply, "}")
	if start < 0 || end <= start {
		return nil
	}
	var raw rawReading
	if err := json.Unmarshal([]byte(reply[start:end+1]), &raw); err != nil || !raw.Payment {
		return nil
	}
	out := MailReading{
		Amount:    amountString(raw.Amount),
		Direction: strings.ToLower(strings.TrimSpace(raw.Direction)),
		Text:      strings.TrimSpace(raw.Text),
	}
	if !reAmount.MatchString(out.Amount) || strings.Trim(out.Amount, "0.,' ") == "" {
		return nil
	}
	if out.Direction != "out" && out.Direction != "in" {
		return nil
	}
	if d := strings.TrimSpace(raw.Date); dateRe.MatchString(d) {
		out.Date = d
	}
	if utf8.RuneCountInString(out.Text) > 120 {
		out.Text = string([]rune(out.Text)[:120])
	}
	return &out
}
