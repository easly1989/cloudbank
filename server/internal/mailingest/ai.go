package mailingest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// How a mailbox's mails are read (#659): with the patterns only, the patterns
// and then the AI for what none read, the AI and then the patterns for what
// it did not take for a payment, or the AI only.
const (
	AIModePatterns   = "patterns"
	AIModePatternsAI = "patterns_ai"
	AIModeAIPatterns = "ai_patterns"
	AIModeAI         = "ai"

	// The field the AI's description of a payment fills.
	AIFieldMemo  = "memo"
	AIFieldPayee = "payee"
)

// ErrAINotConfigured means a mode with the AI was chosen, and whoever
// connected the mailbox has no AI set up.
var ErrAINotConfigured = errors.New("mailingest: the AI is not set up")

// AIReader asks the AI of the person who connected a mailbox what payment a
// mail reports. It is the AI service.
type AIReader interface {
	Configured(ctx context.Context, userID int64) bool
	ReadBankMail(ctx context.Context, userID int64, subject, body, received string) (*ai.MailReading, error)
}

// SetAI wires the AI. Without it a mailbox reads with its patterns only.
func (s *Service) SetAI(r AIReader) { s.reader = r }

// MailboxAI is how a mailbox uses the AI. The AI never chooses the account:
// what it reads goes to AccountID. Only mails from Senders (addresses or
// domains) are ever sent to it.
type MailboxAI struct {
	Mode      string   `json:"mode"`
	AccountID *int64   `json:"accountId"`
	Field     string   `json:"field"`
	Senders   []string `json:"senders"`
}

func aiOf(m db.Mailbox) MailboxAI {
	out := MailboxAI{Mode: m.AiMode, Field: m.AiField, Senders: splitSenders(m.AiSenders)}
	if m.AiAccountID.Valid {
		out.AccountID = &m.AiAccountID.Int64
	}
	return out
}

func splitSenders(s string) []string {
	out := []string{}
	for _, part := range strings.Split(s, ",") {
		if p := strings.ToLower(strings.TrimSpace(part)); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// aiReady reports whether the person who connected the mailbox has AI set up.
func (s *Service) aiReady(ctx context.Context, m db.Mailbox) bool {
	return s.reader != nil && m.CreatedBy.Valid && s.reader.Configured(ctx, m.CreatedBy.Int64)
}

// UpdateAI sets how a mailbox uses the AI. A mode with the AI needs it set up
// by whoever connected the mailbox, an account of the wallet and at least one
// sender.
func (s *Service) UpdateAI(ctx context.Context, walletID, id int64, in MailboxAI) (Mailbox, error) {
	lock := s.lockFor(id)
	lock.Lock()
	defer lock.Unlock()
	mb, err := s.get(ctx, walletID, id)
	if err != nil {
		return Mailbox{}, err
	}
	if in.Field == "" {
		in.Field = AIFieldMemo
	}
	var senders []string
	for _, raw := range in.Senders {
		for _, p := range splitSenders(raw) {
			if strings.ContainsAny(p, " /\\") || !strings.Contains(p, ".") {
				return Mailbox{}, fmt.Errorf("%w: %q is not an address or a domain", ErrInvalid, p)
			}
			senders = append(senders, p)
		}
	}
	account := sql.NullInt64{}
	if in.AccountID != nil {
		if _, ok := s.fracOf(ctx, walletID)(*in.AccountID); !ok {
			return Mailbox{}, fmt.Errorf("%w: the account is not in this wallet", ErrInvalid)
		}
		account = sql.NullInt64{Int64: *in.AccountID, Valid: true}
	}
	switch in.Mode {
	case AIModePatterns:
	case AIModePatternsAI, AIModeAIPatterns, AIModeAI:
		if !s.aiReady(ctx, mb) {
			return Mailbox{}, ErrAINotConfigured
		}
		if !account.Valid {
			return Mailbox{}, fmt.Errorf("%w: choose the account for what the AI reads", ErrInvalid)
		}
		if len(senders) == 0 {
			return Mailbox{}, fmt.Errorf("%w: name the bank's senders", ErrInvalid)
		}
	default:
		return Mailbox{}, fmt.Errorf("%w: unknown mode %q", ErrInvalid, in.Mode)
	}
	if in.Field != AIFieldMemo && in.Field != AIFieldPayee {
		return Mailbox{}, fmt.Errorf("%w: the AI fills the memo or the payee", ErrInvalid)
	}
	if err := s.q.SetMailboxAI(ctx, db.SetMailboxAIParams{
		AiMode: in.Mode, AiAccountID: account, AiField: in.Field, AiSenders: strings.Join(senders, ","), ID: id,
	}); err != nil {
		return Mailbox{}, err
	}
	return s.reload(ctx, walletID, id)
}

// senderListed reports whether a mail's sender is one of the listed addresses
// or comes from one of the listed domains (or a subdomain of one).
func senderListed(listed []string, sender string) bool {
	sender = strings.ToLower(strings.TrimSpace(sender))
	_, domain, _ := strings.Cut(sender, "@")
	for _, l := range listed {
		switch {
		case strings.Contains(l, "@"):
			if sender == l {
				return true
			}
		case domain == l || strings.HasSuffix(domain, "."+l):
			return true
		}
	}
	return false
}

// readMail reads one stored mail the way its mailbox is set to, and records
// what became of it. The caller holds the mailbox's lock.
func (s *Service) readMail(ctx context.Context, mb db.Mailbox, m db.MailMessage, patterns []*compiled) outcome {
	byPatterns := func() outcome { return s.byPatterns(ctx, mb.WalletID, m, patterns) }
	if mb.AiMode == AIModePatterns || mb.AiMode == "" {
		return s.save(ctx, m, byPatterns())
	}
	// Whether this mail may go to the AI: one of the bank's senders, which the
	// receiving server vouched for, with somewhere for it to go.
	listed := senderListed(splitSenders(mb.AiSenders), m.Sender)
	usable := listed && m.Authenticated != 0 && mb.AiAccountID.Valid && mb.CreatedBy.Valid && s.reader != nil
	byAI := func() outcome {
		if !usable {
			return outcome{name: OutcomeUnrecognized}
		}
		return s.byAI(ctx, mb, m)
	}
	var out outcome
	switch mb.AiMode {
	case AIModePatternsAI:
		if out = byPatterns(); out.name == OutcomeUnrecognized {
			out = byAI()
		}
	case AIModeAIPatterns:
		if out = byAI(); out.name != OutcomeCreated && out.name != OutcomeDuplicate {
			// A pattern still gets the mail; the AI's failure shows only when
			// no pattern read it either.
			if p := byPatterns(); p.name != OutcomeUnrecognized || out.name == OutcomeUnrecognized {
				out = p
			}
		}
	default: // AIModeAI
		out = byAI()
	}
	if out.name == OutcomeUnrecognized && listed && m.Authenticated == 0 {
		out.name = OutcomeUnverified
	}
	return s.save(ctx, m, out)
}

// byAI asks the AI what payment the mail reports and writes it. An answer
// that is not a usable payment leaves the mail unrecognised; a provider that
// cannot be asked leaves it failed, with the reason.
func (s *Service) byAI(ctx context.Context, mb db.Mailbox, m db.MailMessage) outcome {
	in := inputOf(m)
	reading, err := s.reader.ReadBankMail(ctx, mb.CreatedBy.Int64, m.Subject, m.Body, in.Date.Format("2006-01-02"))
	switch {
	case errors.Is(err, ai.ErrNotConfigured):
		return outcome{name: OutcomeUnrecognized}
	case err != nil:
		return outcome{name: OutcomeFailed, detail: "AI: " + strings.TrimPrefix(err.Error(), "ai: "), byAI: true}
	case reading == nil:
		return outcome{name: OutcomeUnrecognized}
	}
	accountID := mb.AiAccountID.Int64
	frac, ok := s.fracOf(ctx, mb.WalletID)(accountID)
	if !ok {
		return outcome{name: OutcomeFailed, detail: "the AI's account is not in this wallet", byAI: true}
	}
	amount, err := parseAmount(reading.Amount, frac)
	if err != nil || amount == 0 {
		return outcome{name: OutcomeUnrecognized}
	}
	if reading.Direction == "out" {
		amount = -amount
	}
	tx := Extracted{
		AccountID: accountID, Date: aiDate(reading.Date, in.Date), Amount: amount,
		ApplyRules: true, Tags: []string{},
	}
	if mb.AiField == AIFieldPayee {
		tx.Payee = reading.Text
	} else {
		tx.Memo = reading.Text
	}
	out := s.insertTx(ctx, mb.WalletID, m, tx, 0)
	out.byAI = true
	return out
}

// aiDate is the date the AI read, unless it is far from when the mail
// arrived: a notice comes within days of the payment, so anything else is
// taken as a misreading and the arrival day is used.
func aiDate(read string, arrived time.Time) string {
	day := arrived.Format("2006-01-02")
	d, err := time.Parse("2006-01-02", read)
	if err != nil {
		return day
	}
	a, _ := time.Parse("2006-01-02", day)
	if d.After(a.AddDate(0, 0, 1)) || d.Before(a.AddDate(0, 0, -31)) {
		return day
	}
	return read
}
