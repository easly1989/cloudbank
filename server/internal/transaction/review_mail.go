package transaction

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// MailRefPrefix starts the import ref of a transaction read from a bank mail
// (#657). Bank sync replaces it with the bank's own ref when it merges its row
// into it, which is how a mail row becomes confirmed.
const MailRefPrefix = "mail:"

const (
	// unconfirmedAfterDays is how long the bank gets to book a mail row before
	// the review asks about it (#660).
	unconfirmedAfterDays = 5
	// bankRowWindowDays bounds how far from a mail row a bank row may be dated
	// to be offered for merging: the bank-sync merge window (importio).
	bankRowWindowDays = 7
	// bankRowsOffered caps the bank rows offered per mail row.
	bankRowsOffered = 3
	// reversalWindowDays bounds how far apart a payment and its reversal may be.
	reversalWindowDays = 3
)

// ErrNotMailPair means a merge was asked of rows that are not a mail row and a
// bank row of the same account.
var ErrNotMailPair = errors.New("transaction: not a mail row and a bank row of one account")

// ErrNotMailRow means a snooze was asked of a row not read from a bank mail.
var ErrNotMailRow = errors.New("transaction: not a row read from a mail")

// ErrInvalidSnooze means a snooze day that is not a YYYY-MM-DD date, or is
// before today.
var ErrInvalidSnooze = errors.New("transaction: snooze until a date from today on")

// UnconfirmedRow is a mail row the bank has not booked after
// unconfirmedAfterDays, with the bank rows near it it may be merged with,
// nearest amount first.
type UnconfirmedRow struct {
	ReviewTxn
	BankRows []ReviewTxn `json:"bankRows"`
}

// ReversalPair is a refused card's payment and its reversal, both read from
// mails and never booked: they cancel out, and are removed together.
type ReversalPair struct {
	Payment  ReviewTxn `json:"payment"`
	Reversal ReviewTxn `json:"reversal"`
}

// SnoozedRow is an unconfirmed row, or a reversal pair, that someone in the
// wallet put off until a day (#775): it leaves the list, its count and the
// reminders until then. A pair is its payment, with its reversal alongside.
type SnoozedRow struct {
	ReviewTxn
	Until    string     `json:"until"`
	Reversal *ReviewTxn `json:"reversal,omitempty"`
}

// unconfirmed lists the wallet's mail rows the bank has not booked after
// unconfirmedAfterDays, pairing the ones that cancel out. Pairs are sought
// among every unbooked mail row, so a payment whose reversal came a few days
// later is never offered alone, to be deleted without it. The rows and pairs
// snoozed past today are set apart, the soonest back first.
func (s *Service) unconfirmed(ctx context.Context, walletID int64, today time.Time) ([]UnconfirmedRow, []ReversalPair, []SnoozedRow, error) {
	cutoff := today.AddDate(0, 0, -unconfirmedAfterDays).Format(dateLayout)
	rows, err := s.rq.ListUnconfirmedMailRows(ctx, db.ListUnconfirmedMailRowsParams{
		WalletID: walletID, Date: today.Format(dateLayout),
	})
	if err != nil {
		return nil, nil, nil, err
	}
	snoozes, err := s.rq.ListReviewSnoozes(ctx, db.ListReviewSnoozesParams{
		WalletID: walletID, Until: today.Format(dateLayout),
	})
	if err != nil {
		return nil, nil, nil, err
	}
	until := make(map[int64]string, len(snoozes))
	for _, z := range snoozes {
		until[z.TransactionID] = z.Until
	}
	snoozed := []SnoozedRow{}
	paired := map[int64]bool{}
	reversals := []ReversalPair{}
	for i, a := range rows {
		if paired[a.ID] || a.Amount == 0 {
			continue
		}
		// The nearest unpaired row of the same account with the opposite amount.
		best := -1
		for j := i + 1; j < len(rows); j++ {
			b := rows[j]
			if paired[b.ID] || b.AccountID != a.AccountID || b.Amount != -a.Amount {
				continue
			}
			if d := daysApart(a.Date, b.Date); d <= reversalWindowDays && (best < 0 || d < daysApart(a.Date, rows[best].Date)) {
				best = j
			}
		}
		if best < 0 {
			continue
		}
		pay, rev := a, rows[best]
		if pay.Amount > 0 {
			pay, rev = rev, pay
		}
		paired[pay.ID], paired[rev.ID] = true, true
		// Shown once its older row is past the cutoff; put off while either
		// row is snoozed, until the sooner of their days: a pair is snoozed
		// as one, so a stale day on one half never outlasts the day just picked.
		if min(pay.Date, rev.Date) <= cutoff {
			p, r := reviewTxn(pay), reviewTxn(rev)
			day := until[pay.ID]
			if o := until[rev.ID]; day == "" || (o != "" && o < day) {
				day = o
			}
			if day != "" {
				snoozed = append(snoozed, SnoozedRow{ReviewTxn: p, Until: day, Reversal: &r})
			} else {
				reversals = append(reversals, ReversalPair{Payment: p, Reversal: r})
			}
		}
	}

	out := []UnconfirmedRow{}
	for _, r := range rows {
		if paired[r.ID] || r.Date > cutoff {
			continue
		}
		if day := until[r.ID]; day != "" {
			snoozed = append(snoozed, SnoozedRow{ReviewTxn: reviewTxn(r), Until: day})
			continue
		}
		u := UnconfirmedRow{ReviewTxn: reviewTxn(r), BankRows: []ReviewTxn{}}
		d, err := time.Parse(dateLayout, r.Date)
		if err != nil {
			out = append(out, u)
			continue
		}
		near, err := s.rq.ListBankRowsNear(ctx, db.ListBankRowsNearParams{
			AccountID: r.AccountID,
			DateFrom:  d.AddDate(0, 0, -bankRowWindowDays).Format(dateLayout),
			DateTo:    d.AddDate(0, 0, bankRowWindowDays).Format(dateLayout),
		})
		if err != nil {
			return nil, nil, nil, err
		}
		// The nearest amount first (a held 100 is often charged 40, but a hotel's
		// 180 is not the pump's 40), then the nearest date.
		gap := func(b db.Transaction) int64 { return max(b.Amount-r.Amount, r.Amount-b.Amount) }
		sort.SliceStable(near, func(i, j int) bool {
			if gi, gj := gap(near[i]), gap(near[j]); gi != gj {
				return gi < gj
			}
			return daysApart(near[i].Date, r.Date) < daysApart(near[j].Date, r.Date)
		})
		for _, b := range near[:min(len(near), bankRowsOffered)] {
			u.BankRows = append(u.BankRows, reviewTxn(b))
		}
		out = append(out, u)
	}
	sort.SliceStable(snoozed, func(i, j int) bool { return snoozed[i].Until < snoozed[j].Until })
	return out, reversals, snoozed, nil
}

// rowOf returns a transaction of the wallet, or ErrNotFound.
func (s *Service) rowOf(ctx context.Context, walletID, id int64) (db.Transaction, error) {
	row, err := s.rq.GetTransaction(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && row.WalletID != walletID) {
		return db.Transaction{}, ErrNotFound
	}
	return row, err
}

// Snooze puts a mail row of the review off until a day from today on (#775),
// for everyone in the wallet; snoozing it again moves the day. The row is
// back in the review on that day.
func (s *Service) Snooze(ctx context.Context, walletID, id int64, until string, today time.Time) error {
	// The client picks days on its own civil calendar, up to a day off the UTC
	// one, so a day back from UTC today is still its "today": accept it.
	// The row stays hidden only while until > UTC today.
	if d, err := time.Parse(dateLayout, until); err != nil || d.Format(dateLayout) != until || until < today.AddDate(0, 0, -1).Format(dateLayout) {
		return ErrInvalidSnooze
	}
	row, err := s.rowOf(ctx, walletID, id)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(row.ImportRef, MailRefPrefix) {
		return ErrNotMailRow
	}
	return s.q.UpsertReviewSnooze(ctx, db.UpsertReviewSnoozeParams{TransactionID: id, WalletID: walletID, Until: until})
}

// Unsnooze brings a snoozed row back into the review now.
func (s *Service) Unsnooze(ctx context.Context, walletID, id int64) error {
	if _, err := s.rowOf(ctx, walletID, id); err != nil {
		return err
	}
	return s.q.DeleteReviewSnooze(ctx, db.DeleteReviewSnoozeParams{TransactionID: id, WalletID: walletID})
}

// MergeMail folds an unconfirmed mail row into the bank row that booked it
// (#660): the bank row keeps its amount, date, ref and status, and takes the
// mail row's memo, category, payee and tags where the mail row has them. The
// mails that wrote the mail row then point at the bank row, and the mail row
// is deleted.
func (s *Service) MergeMail(ctx context.Context, walletID, mailID, bankID int64) error {
	get := func(id int64) (db.Transaction, error) {
		row, err := s.rq.GetTransaction(ctx, id)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && row.WalletID != walletID) {
			return db.Transaction{}, ErrNotFound
		}
		return row, err
	}
	mail, err := get(mailID)
	if err != nil {
		return err
	}
	bank, err := get(bankID)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(mail.ImportRef, MailRefPrefix) || bank.ImportRef == "" ||
		strings.HasPrefix(bank.ImportRef, MailRefPrefix) || mail.AccountID != bank.AccountID {
		return ErrNotMailPair
	}
	tags, err := s.rq.ListTransactionTags(ctx, mail.ID)
	if err != nil {
		return err
	}

	memo, payee, category := bank.Memo, bank.PayeeID, bank.CategoryID
	if strings.TrimSpace(mail.Memo) != "" {
		memo = mail.Memo
	}
	if mail.PayeeID.Valid {
		payee = mail.PayeeID
	}
	// A split keeps its categories on its lines: neither side's is moved.
	if mail.CategoryID.Valid && mail.IsSplit == 0 && bank.IsSplit == 0 {
		category = mail.CategoryID
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	if err := qtx.UpdateTransaction(ctx, db.UpdateTransactionParams{
		Date: bank.Date, Amount: bank.Amount, PaymentMode: bank.PaymentMode, Status: bank.Status,
		Info: bank.Info, PayeeID: payee, CategoryID: category, Memo: memo,
		IsSplit: bank.IsSplit, VehicleID: bank.VehicleID, ID: bank.ID,
	}); err != nil {
		return err
	}
	for _, name := range tags {
		tag, err := s.getOrCreateTag(ctx, qtx, walletID, name)
		if err != nil {
			return err
		}
		if err := qtx.AddTransactionTag(ctx, db.AddTransactionTagParams{TransactionID: bank.ID, TagID: tag.ID}); err != nil {
			return err
		}
	}
	if err := qtx.MoveMailMessagesToTransaction(ctx, db.MoveMailMessagesToTransactionParams{
		ToID: sql.NullInt64{Int64: bank.ID, Valid: true}, FromID: sql.NullInt64{Int64: mail.ID, Valid: true},
	}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return s.Delete(ctx, mail.ID)
}
