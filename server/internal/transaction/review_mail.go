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

// UnconfirmedRow is a mail row the bank has not booked after
// unconfirmedAfterDays, with the bank rows near it it may be merged with.
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

// unconfirmed lists the wallet's mail rows the bank has not booked after
// unconfirmedAfterDays, pairing the ones that cancel out. Pairs are sought
// among every unbooked mail row, so a payment whose reversal came a few days
// later is never offered alone, to be deleted without it.
func (s *Service) unconfirmed(ctx context.Context, walletID int64, today time.Time) ([]UnconfirmedRow, []ReversalPair, error) {
	cutoff := today.AddDate(0, 0, -unconfirmedAfterDays).Format(dateLayout)
	rows, err := s.rq.ListUnconfirmedMailRows(ctx, db.ListUnconfirmedMailRowsParams{
		WalletID: walletID, Date: today.Format(dateLayout),
	})
	if err != nil {
		return nil, nil, err
	}
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
		// Shown once its older row is past the cutoff.
		if min(pay.Date, rev.Date) <= cutoff {
			reversals = append(reversals, ReversalPair{Payment: reviewTxn(pay), Reversal: reviewTxn(rev)})
		}
	}

	out := []UnconfirmedRow{}
	for _, r := range rows {
		if paired[r.ID] || r.Date > cutoff {
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
			return nil, nil, err
		}
		sort.SliceStable(near, func(i, j int) bool { return daysApart(near[i].Date, r.Date) < daysApart(near[j].Date, r.Date) })
		for _, b := range near[:min(len(near), bankRowsOffered)] {
			u.BankRows = append(u.BankRows, reviewTxn(b))
		}
		out = append(out, u)
	}
	return out, reversals, nil
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
