package mailingest

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// testMails is how many of a sender's latest mails a pattern is tried on.
const testMails = 15

// Patterns returns a source's patterns in the order they are tried.
func (s *Service) Patterns(ctx context.Context, walletID, mailboxID, sourceID int64) ([]Pattern, error) {
	if _, _, err := s.getSource(ctx, walletID, mailboxID, sourceID); err != nil {
		return nil, err
	}
	rows, err := s.rq.ListMailPatterns(ctx, nullable(sourceID))
	if err != nil {
		return nil, err
	}
	out := make([]Pattern, 0, len(rows))
	for _, r := range rows {
		out = append(out, patternOf(r))
	}
	return out, nil
}

// validate compiles a pattern and checks that its accounts are the wallet's.
func (s *Service) validate(ctx context.Context, walletID int64, p Pattern) (*compiled, error) {
	c, err := compile(p)
	if err != nil {
		return nil, err
	}
	frac := s.fracOf(ctx, walletID)
	if _, ok := frac(c.p.AccountID); !ok {
		return nil, errPattern("the account is not in this wallet")
	}
	for _, card := range c.p.Cards {
		if _, ok := frac(card.AccountID); !ok {
			return nil, errPattern("the account of card %s is not in this wallet", card.Digits)
		}
	}
	return c, nil
}

func flag(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func cardsJSON(cards []CardAccount) string {
	if cards == nil {
		cards = []CardAccount{}
	}
	b, _ := json.Marshal(cards)
	return string(b)
}

// CreatePattern adds a pattern at the end of the source's list.
func (s *Service) CreatePattern(ctx context.Context, walletID, mailboxID, sourceID int64, p Pattern) (Pattern, error) {
	if _, _, err := s.getSource(ctx, walletID, mailboxID, sourceID); err != nil {
		return Pattern{}, err
	}
	c, err := s.validate(ctx, walletID, p)
	if err != nil {
		return Pattern{}, err
	}
	p = c.p
	row, err := s.q.InsertMailPattern(ctx, db.InsertMailPatternParams{
		MailboxID: mailboxID, SourceID: nullable(sourceID), Name: p.Name, Sender: p.Sender, SubjectMode: p.SubjectMode, Subject: p.Subject,
		Body: p.Body, AccountID: p.AccountID, Cards: cardsJSON(p.Cards), Direction: p.Direction,
		InWords: p.InWords, PaymentMode: int64(p.PaymentMode), ApplyRules: flag(p.ApplyRules),
		DateFormat: p.DateFormat, RequireAuth: flag(p.RequireAuth), Editor: p.Editor,
	})
	if err != nil {
		return Pattern{}, err
	}
	return patternOf(row), nil
}

// UpdatePattern replaces a pattern, keeping its place in the list.
func (s *Service) UpdatePattern(ctx context.Context, walletID, mailboxID, sourceID, id int64, p Pattern) (Pattern, error) {
	if _, _, err := s.getSource(ctx, walletID, mailboxID, sourceID); err != nil {
		return Pattern{}, err
	}
	c, err := s.validate(ctx, walletID, p)
	if err != nil {
		return Pattern{}, err
	}
	p = c.p
	n, err := s.q.UpdateMailPattern(ctx, db.UpdateMailPatternParams{
		Name: p.Name, Sender: p.Sender, SubjectMode: p.SubjectMode, Subject: p.Subject,
		Body: p.Body, AccountID: p.AccountID, Cards: cardsJSON(p.Cards), Direction: p.Direction,
		InWords: p.InWords, PaymentMode: int64(p.PaymentMode), ApplyRules: flag(p.ApplyRules),
		DateFormat: p.DateFormat, RequireAuth: flag(p.RequireAuth), Editor: p.Editor,
		ID: id, SourceID: nullable(sourceID),
	})
	if err != nil {
		return Pattern{}, err
	}
	if n == 0 {
		return Pattern{}, ErrNotFound
	}
	row, err := s.q.GetMailPattern(ctx, db.GetMailPatternParams{ID: id, SourceID: nullable(sourceID)})
	if err != nil {
		return Pattern{}, err
	}
	return patternOf(row), nil
}

// DeletePattern removes a pattern. The mails it read keep their outcome and
// their transaction.
func (s *Service) DeletePattern(ctx context.Context, walletID, mailboxID, sourceID, id int64) error {
	if _, _, err := s.getSource(ctx, walletID, mailboxID, sourceID); err != nil {
		return err
	}
	n, err := s.q.DeleteMailPattern(ctx, db.DeleteMailPatternParams{ID: id, SourceID: nullable(sourceID)})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ReorderPatterns puts the source's patterns in the given order, which must
// name each of them once.
func (s *Service) ReorderPatterns(ctx context.Context, walletID, mailboxID, sourceID int64, ids []int64) ([]Pattern, error) {
	current, err := s.Patterns(ctx, walletID, mailboxID, sourceID)
	if err != nil {
		return nil, err
	}
	known := map[int64]bool{}
	for _, p := range current {
		known[p.ID] = true
	}
	if len(ids) != len(current) {
		return nil, errPattern("the order must name every pattern once")
	}
	for _, id := range ids {
		if !known[id] {
			return nil, errPattern("the order must name every pattern once")
		}
		delete(known, id)
	}
	for i, id := range ids {
		if err := s.q.SetMailPatternPosition(ctx, db.SetMailPatternPositionParams{Position: int64(i), ID: id, SourceID: nullable(sourceID)}); err != nil {
			return nil, err
		}
	}
	return s.Patterns(ctx, walletID, mailboxID, sourceID)
}

// TestMail is what a pattern makes of one mail.
type TestMail struct {
	ID            int64  `json:"id"`
	Subject       string `json:"subject"`
	ReceivedAt    string `json:"receivedAt"`
	Authenticated bool   `json:"authenticated"`
	// Matched says the pattern reads the mail; Transaction is what it reads,
	// or Error why that cannot become a transaction.
	Matched     bool       `json:"matched"`
	Transaction *Extracted `json:"transaction,omitempty"`
	Error       string     `json:"error,omitempty"`
}

// TestResult is a pattern tried before it is saved: on the sender's latest
// mails, and how many of the mails no pattern read it would read.
type TestResult struct {
	Matched int        `json:"matched"`
	Total   int        `json:"total"`
	Mails   []TestMail `json:"mails"`
	Retry   int        `json:"retry"`
}

// TestPattern tries a pattern, saved or not, on the mails of the source's
// folder: the sender's latest, and how many of the waiting ones it would read
// that no source before it would take.
func (s *Service) TestPattern(ctx context.Context, walletID, mailboxID, sourceID int64, p Pattern) (TestResult, error) {
	mb, src, err := s.getSource(ctx, walletID, mailboxID, sourceID)
	if err != nil {
		return TestResult{}, err
	}
	c, err := s.validate(ctx, walletID, p)
	if err != nil {
		return TestResult{}, err
	}
	frac := s.fracOf(ctx, walletID)
	mails, err := s.q.ListMailMessagesFrom(ctx, db.ListMailMessagesFromParams{MailboxID: mailboxID, Folder: src.Folder, Sender: c.p.Sender, Limit: testMails})
	if err != nil {
		return TestResult{}, err
	}
	res := TestResult{Mails: make([]TestMail, 0, len(mails))}
	for _, m := range mails {
		in := inputOf(m)
		t := TestMail{ID: m.ID, Subject: m.Subject, ReceivedAt: m.ReceivedAt, Authenticated: in.Authenticated}
		if c.appliesTo(in) {
			tx, ok, err := c.read(in, frac)
			if ok {
				t.Matched = true
				res.Matched++
				if err != nil {
					t.Error = errorText(err)
				} else {
					t.Transaction = &tx
				}
			}
		}
		res.Mails = append(res.Mails, t)
	}
	res.Total = len(mails)
	waiting, err := s.waiting(ctx, mb, src, []*compiled{c})
	if err != nil {
		return TestResult{}, err
	}
	res.Retry = len(waiting)
	return res, nil
}

// waiting returns the mails of the source's folder that made no transaction,
// that the patterns read, and that no source before this one on the folder
// claims: those the source would have read had it had the patterns when they
// arrived.
func (s *Service) waiting(ctx context.Context, mb db.Mailbox, src db.MailSource, patterns []*compiled) ([]db.MailMessage, error) {
	retry, err := s.q.ListMailMessagesToRetry(ctx, db.ListMailMessagesToRetryParams{MailboxID: mb.ID, Folder: src.Folder})
	if err != nil {
		return nil, err
	}
	all, err := s.q.ListMailSources(ctx, mb.ID)
	if err != nil {
		return nil, err
	}
	var before []db.MailSource
	for _, o := range all {
		if o.ID == src.ID {
			break
		}
		if o.Folder == src.Folder {
			before = append(before, o)
		}
	}
	frac := s.fracOf(ctx, mb.WalletID)
	cache := patternCache{}
	var out []db.MailMessage
	for _, m := range retry {
		in := inputOf(m)
		if evaluate(patterns, in, frac).pattern == nil {
			continue
		}
		if len(before) > 0 {
			_, claimed, err := s.firstClaimer(ctx, before, cache, in, frac)
			if err != nil {
				return nil, err
			}
			if claimed {
				continue
			}
		}
		out = append(out, m)
	}
	return out, nil
}

// ApplyResult says what applying a pattern to the waiting mails made.
type ApplyResult struct {
	Created   int `json:"created"`
	Duplicate int `json:"duplicate"`
	Failed    int `json:"failed"`
}

// ApplyPattern reads with a saved pattern the mails of the source's folder
// that made no transaction so far, as if it had been there when they arrived:
// those no pattern read, and those one read but could not write (after the
// pattern is corrected). A mail a source before this one claims stays its.
func (s *Service) ApplyPattern(ctx context.Context, walletID, mailboxID, sourceID, id int64) (ApplyResult, error) {
	// The mailbox's lock: a check reading the same mails waits.
	lock := s.lockFor(mailboxID)
	lock.Lock()
	defer lock.Unlock()
	mb, src, err := s.getSource(ctx, walletID, mailboxID, sourceID)
	if err != nil {
		return ApplyResult{}, err
	}
	row, err := s.q.GetMailPattern(ctx, db.GetMailPatternParams{ID: id, SourceID: nullable(sourceID)})
	if errors.Is(err, sql.ErrNoRows) {
		return ApplyResult{}, ErrNotFound
	}
	if err != nil {
		return ApplyResult{}, err
	}
	c, err := s.validate(ctx, walletID, patternOf(row))
	if err != nil {
		return ApplyResult{}, err
	}
	only := []*compiled{c}
	// A mail this pattern does not read keeps its outcome: "unverified" from
	// another pattern stays so.
	mails, err := s.waiting(ctx, mb, src, only)
	if err != nil {
		return ApplyResult{}, err
	}
	var res ApplyResult
	for _, m := range mails {
		switch s.process(ctx, walletID, src.ID, m, only).name {
		case OutcomeCreated:
			res.Created++
		case OutcomeDuplicate:
			res.Duplicate++
		case OutcomeFailed:
			res.Failed++
		}
	}
	return res, nil
}

func nullable(id int64) sql.NullInt64 { return sql.NullInt64{Int64: id, Valid: true} }
