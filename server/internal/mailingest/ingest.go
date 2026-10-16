package mailingest

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// Importer writes a transaction the way every import does: assignment rules,
// payees, categories and tags created by name, and the duplicate check on the
// import ref. It is the import service.
type Importer interface {
	PreviewParsed(ctx context.Context, walletID, accountID int64, rows []importio.Row, applyRules, reconcileExisting bool) (importio.Preview, error)
	Commit(ctx context.Context, walletID, accountID int64, rows []importio.CommitRow) (importio.CommitResult, error)
}

// SetImporter wires the import pipeline. Without it no mail becomes a
// transaction: every mail stays in the history as one no pattern read.
func (s *Service) SetImporter(im Importer) { s.importer = im }

// importRef marks a transaction as read from one mail, so the same mail never
// makes a second one. The Message-ID is hashed: it is the sender's to choose,
// and the ref is shown in exports.
func importRef(messageID string) string {
	sum := sha256.Sum256([]byte(messageID))
	return importio.MailRefPrefix + hex.EncodeToString(sum[:16])
}

// patternOf turns a stored pattern into the API's.
func patternOf(r db.MailPattern) Pattern {
	p := Pattern{
		ID: r.ID, MailboxID: r.MailboxID, Position: int(r.Position), Name: r.Name, Sender: r.Sender,
		SubjectMode: r.SubjectMode, Subject: r.Subject, Body: r.Body, AccountID: r.AccountID,
		Direction: r.Direction, InWords: r.InWords, PaymentMode: int(r.PaymentMode),
		ApplyRules: r.ApplyRules != 0, DateFormat: r.DateFormat, RequireAuth: r.RequireAuth != 0,
		Editor: r.Editor, Cards: []CardAccount{},
	}
	_ = json.Unmarshal([]byte(r.Cards), &p.Cards)
	if p.Cards == nil {
		p.Cards = []CardAccount{}
	}
	return p
}

// loadPatterns returns a mailbox's patterns in the order they are tried. One
// that no longer compiles is left out, not allowed to stop the others.
func (s *Service) loadPatterns(ctx context.Context, mailboxID int64) ([]*compiled, error) {
	rows, err := s.q.ListMailPatterns(ctx, mailboxID)
	if err != nil {
		return nil, err
	}
	out := make([]*compiled, 0, len(rows))
	for _, r := range rows {
		c, err := compile(patternOf(r))
		if err != nil {
			slog.Warn("mail: pattern left out", "pattern", r.ID, "error", err)
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

// fracOf gives an account's currency decimals, when the account is in the
// wallet.
func (s *Service) fracOf(ctx context.Context, walletID int64) func(int64) (int, bool) {
	return func(accountID int64) (int, bool) {
		f, err := s.q.GetAccountFracDigits(ctx, db.GetAccountFracDigitsParams{ID: accountID, WalletID: walletID})
		if err != nil {
			return 0, false
		}
		return int(f), true
	}
}

// inputOf is a stored mail as a pattern reads it. The arrival time keeps the
// offset the mail was written with, so its calendar day is the sender's.
func inputOf(m db.MailMessage) mailInput {
	at, err := time.Parse(time.RFC3339, m.ReceivedAt)
	if err != nil {
		at, _ = time.Parse(time.RFC3339, m.CreatedAt)
	}
	return mailInput{From: m.Sender, Subject: m.Subject, Body: m.Body, Date: at, Authenticated: m.Authenticated != 0}
}

// outcome is what became of one mail.
type outcome struct {
	name          string
	detail        string
	patternID     int64
	transactionID int64
	byAI          bool
}

// process reads one stored mail with the given patterns only and records what
// became of it. The caller holds the mailbox's lock.
func (s *Service) process(ctx context.Context, walletID int64, m db.MailMessage, patterns []*compiled) outcome {
	return s.save(ctx, m, s.byPatterns(ctx, walletID, m, patterns))
}

// byPatterns reads a mail with the patterns and writes what the first that
// reads it makes.
func (s *Service) byPatterns(ctx context.Context, walletID int64, m db.MailMessage, patterns []*compiled) outcome {
	ev := evaluate(patterns, inputOf(m), s.fracOf(ctx, walletID))
	if ev.pattern == nil {
		return outcome{name: ev.outcome}
	}
	if ev.err != nil {
		return outcome{name: OutcomeFailed, detail: errorText(ev.err), patternID: ev.pattern.p.ID}
	}
	return s.insertTx(ctx, walletID, m, ev.tx, ev.pattern.p.ID)
}

// save records what became of a mail.
func (s *Service) save(ctx context.Context, m db.MailMessage, out outcome) outcome {
	err := s.q.SetMailMessageOutcome(ctx, db.SetMailMessageOutcomeParams{
		Outcome: out.name, Detail: out.detail,
		PatternID:     sql.NullInt64{Int64: out.patternID, Valid: out.patternID > 0},
		TransactionID: sql.NullInt64{Int64: out.transactionID, Valid: out.transactionID > 0},
		ByAi:          flag(out.byAI),
		ID:            m.ID,
	})
	if err != nil {
		slog.Warn("mail: could not record a mail's outcome", "mail", m.ID, "error", err)
	}
	return out
}

// insertTx turns a read mail into a Cleared transaction through the import
// pipeline. A mail whose ref the account already has is a duplicate; a same
// amount on the same day is not, since two coffees at one bar are two.
// patternID is the pattern that read it, or 0 for the AI.
func (s *Service) insertTx(ctx context.Context, walletID int64, m db.MailMessage, tx Extracted, patternID int64) outcome {
	out := outcome{patternID: patternID}
	fail := func(err error) outcome {
		out.name, out.detail = OutcomeFailed, errorText(err)
		return out
	}
	if s.importer == nil {
		return fail(errors.New("transactions cannot be written here"))
	}
	frac, _ := s.fracOf(ctx, walletID)(tx.AccountID)
	ref := importRef(m.MessageID)
	row := importio.Row{
		Line: 1, Date: tx.Date, Amount: toSixDecimals(tx.Amount, frac), PaymentMode: tx.PaymentMode,
		Info: tx.Info, Payee: tx.Payee, Memo: tx.Memo, Category: tx.Category, Tags: tx.Tags,
		FITID: ref, Status: transaction.StatusCleared,
	}
	pv, err := s.importer.PreviewParsed(ctx, walletID, tx.AccountID, []importio.Row{row}, tx.ApplyRules, false)
	if err != nil {
		return fail(err)
	}
	if len(pv.Rows) != 1 {
		return fail(errors.New("the import read no row"))
	}
	r := pv.Rows[0]
	switch {
	case r.Error != "":
		return fail(errors.New(r.Error))
	case r.Match == "imported":
		out.name = OutcomeDuplicate
	default:
		_, err := s.importer.Commit(ctx, walletID, tx.AccountID, []importio.CommitRow{{
			Date: r.Date, Amount: r.Amount, PaymentMode: r.PaymentMode, Info: r.Info, Payee: r.Payee,
			Memo: r.Memo, Category: r.Category, Tags: r.Tags, Status: r.Status, ImportRef: ref,
		}})
		if err != nil {
			return fail(err)
		}
		out.name = OutcomeCreated
	}
	if id, err := s.q.FindTransactionByImportRef(ctx, db.FindTransactionByImportRefParams{AccountID: tx.AccountID, ImportRef: ref}); err == nil {
		out.transactionID = id
	}
	return out
}

// toSixDecimals scales minor units to the import rows' six decimals.
func toSixDecimals(amount int64, frac int) int64 {
	for ; frac < 6; frac++ {
		amount *= 10
	}
	for ; frac > 6; frac-- {
		amount /= 10
	}
	return amount
}

// errorText is an error in the words the history shows.
func errorText(err error) string {
	msg := strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": ")
	return strings.TrimPrefix(msg, "mailingest: ")
}
