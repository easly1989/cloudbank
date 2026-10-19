package notify

import (
	"context"
	"database/sql"
	"errors"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The person's choices about wallets and accounts (#691): which wallets they
// hear from, and their thresholds per account.

// Threshold is one person's limits on one account; nil is none.
type Threshold struct {
	AccountID int64
	// LargeOver announces an expense of at least this much.
	LargeOver *int64
	// LowUnder announces today's balance dropping below this.
	LowUnder *int64
}

// WalletSettings is what a person chose about one wallet.
type WalletSettings struct {
	Included   bool
	Thresholds []Threshold
}

// ErrUnknownAccount is returned for an account that is not in the wallet.
var ErrUnknownAccount = errors.New("notify: no such account in this wallet")

// ErrBadThreshold is returned for a large-expense threshold that is not
// above zero.
var ErrBadThreshold = errors.New("notify: a large expense threshold must be above zero")

func fromNull(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	return &n.Int64
}

func toNull(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

// Wallet returns the person's choices about a wallet they are a member of;
// the caller has checked the membership.
func (s *Service) Wallet(ctx context.Context, userID, walletID int64) (WalletSettings, error) {
	off, err := s.rq.IsNotificationWalletOff(ctx, db.IsNotificationWalletOffParams{UserID: userID, WalletID: walletID})
	if err != nil {
		return WalletSettings{}, err
	}
	rows, err := s.rq.ListNotificationThresholds(ctx, db.ListNotificationThresholdsParams{UserID: userID, WalletID: walletID})
	if err != nil {
		return WalletSettings{}, err
	}
	out := WalletSettings{Included: off == 0, Thresholds: make([]Threshold, 0, len(rows))}
	for _, r := range rows {
		if r.LargeOver.Valid || r.LowUnder.Valid {
			out.Thresholds = append(out.Thresholds, Threshold{AccountID: r.AccountID, LargeOver: fromNull(r.LargeOver), LowUnder: fromNull(r.LowUnder)})
		}
	}
	return out, nil
}

// SetWalletIncluded lets a wallet's events reach the person, or not.
func (s *Service) SetWalletIncluded(ctx context.Context, userID, walletID int64, on bool) error {
	if on {
		return s.q.SetNotificationWalletOn(ctx, db.SetNotificationWalletOnParams{UserID: userID, WalletID: walletID})
	}
	return s.q.SetNotificationWalletOff(ctx, db.SetNotificationWalletOffParams{UserID: userID, WalletID: walletID})
}

// SetThreshold saves the person's limits on an account of a wallet; the
// caller has checked they are a member of it.
func (s *Service) SetThreshold(ctx context.Context, userID, walletID int64, t Threshold) error {
	if t.LargeOver != nil && *t.LargeOver <= 0 {
		return ErrBadThreshold
	}
	a, err := s.rq.GetAccount(ctx, t.AccountID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && a.WalletID != walletID) {
		return ErrUnknownAccount
	}
	if err != nil {
		return err
	}
	return s.q.SetNotificationThreshold(ctx, db.SetNotificationThresholdParams{
		UserID: userID, AccountID: t.AccountID, LargeOver: toNull(t.LargeOver), LowUnder: toNull(t.LowUnder),
	})
}
