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

// Patterns returns a mailbox's patterns in the order they are tried.
func (s *Service) Patterns(ctx context.Context, walletID, mailboxID int64) ([]Pattern, error) {
	if _, err := s.get(ctx, walletID, mailboxID); err != nil {
		return nil, err
	}
	rows, err := s.rq.ListMailPatterns(ctx, mailboxID)
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

// CreatePattern adds a pattern at the end of the mailbox's list.
func (s *Service) CreatePattern(ctx context.Context, walletID, mailboxID int64, p Pattern) (Pattern, error) {
	if _, err := s.get(ctx, walletID, mailboxID); err != nil {
		return Pattern{}, err
	}
	c, err := s.validate(ctx, walletID, p)
	if err != nil {
		return Pattern{}, err
	}
	p = c.p
	row, err := s.q.InsertMailPattern(ctx, db.InsertMailPatternParams{
		MailboxID: mailboxID, Name: p.Name, Sender: p.Sender, SubjectMode: p.SubjectMode, Subject: p.Subject,
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
func (s *Service) UpdatePattern(ctx context.Context, walletID, mailboxID, id int64, p Pattern) (Pattern, error) {
	if _, err := s.get(ctx, walletID, mailboxID); err != nil {
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
		ID: id, MailboxID: mailboxID,
	})
	if err != nil {
		return Pattern{}, err
	}
	if n == 0 {
		return Pattern{}, ErrNotFound
	}
	row, err := s.q.GetMailPattern(ctx, db.GetMailPatternParams{ID: id, MailboxID: mailboxID})
	if err != nil {
		return Pattern{}, err
	}
	return patternOf(row), nil
}

// DeletePattern removes a pattern. The mails it read keep their outcome and
// their transaction.
func (s *Service) DeletePattern(ctx context.Context, walletID, mailboxID, id int64) error {
	if _, err := s.get(ctx, walletID, mailboxID); err != nil {
		return err
	}
	n, err := s.q.DeleteMailPattern(ctx, db.DeleteMailPatternParams{ID: id, MailboxID: mailboxID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ReorderPatterns puts the mailbox's patterns in the given order, which must
// name each of them once.
func (s *Service) ReorderPatterns(ctx context.Context, walletID, mailboxID int64, ids []int64) ([]Pattern, error) {
	current, err := s.Patterns(ctx, walletID, mailboxID)
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
		if err := s.q.SetMailPatternPosition(ctx, db.SetMailPatternPositionParams{Position: int64(i), ID: id, MailboxID: mailboxID}); err != nil {
			return nil, err
		}
	}
	return s.Patterns(ctx, walletID, mailboxID)
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

// TestPattern tries a pattern, saved or not, on the mailbox's mails.
func (s *Service) TestPattern(ctx context.Context, walletID, mailboxID int64, p Pattern) (TestResult, error) {
	if _, err := s.get(ctx, walletID, mailboxID); err != nil {
		return TestResult{}, err
	}
	c, err := s.validate(ctx, walletID, p)
	if err != nil {
		return TestResult{}, err
	}
	frac := s.fracOf(ctx, walletID)
	mails, err := s.rq.ListMailMessagesFrom(ctx, db.ListMailMessagesFromParams{MailboxID: mailboxID, Sender: c.p.Sender, Limit: testMails})
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
	retry, err := s.rq.ListMailMessagesToRetry(ctx, mailboxID)
	if err != nil {
		return TestResult{}, err
	}
	for _, m := range retry {
		if evaluate([]*compiled{c}, inputOf(m), frac).pattern != nil {
			res.Retry++
		}
	}
	return res, nil
}

// ApplyResult says what applying a pattern to the waiting mails made.
type ApplyResult struct {
	Created   int `json:"created"`
	Duplicate int `json:"duplicate"`
	Failed    int `json:"failed"`
}

// ApplyPattern reads with a saved pattern the mails that made no transaction
// so far, as if it had been there when they arrived: those no pattern read,
// and those one read but could not write (after the pattern is corrected).
func (s *Service) ApplyPattern(ctx context.Context, walletID, mailboxID, id int64) (ApplyResult, error) {
	if _, err := s.get(ctx, walletID, mailboxID); err != nil {
		return ApplyResult{}, err
	}
	row, err := s.q.GetMailPattern(ctx, db.GetMailPatternParams{ID: id, MailboxID: mailboxID})
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
	// The mailbox's lock: a check reading the same mails waits.
	lock := s.lockFor(mailboxID)
	lock.Lock()
	defer lock.Unlock()
	retry, err := s.q.ListMailMessagesToRetry(ctx, mailboxID)
	if err != nil {
		return ApplyResult{}, err
	}
	only := []*compiled{c}
	frac := s.fracOf(ctx, walletID)
	var res ApplyResult
	for _, m := range retry {
		// A mail this pattern does not read keeps its outcome: "unverified"
		// from another pattern stays so.
		if evaluate(only, inputOf(m), frac).pattern == nil {
			continue
		}
		switch s.process(ctx, walletID, m, only).name {
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
