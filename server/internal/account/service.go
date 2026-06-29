// Package account manages accounts within a wallet. Each account has its own
// currency; balances are int64 minor units in that currency.
package account

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

const dateLayout = "2006-01-02"

// Sentinel errors.
var (
	ErrNotFound            = errors.New("account: not found")
	ErrInvalidType         = errors.New("account: invalid type")
	ErrCurrencyNotInWallet = errors.New("account: currency does not belong to the wallet")
	ErrDuplicateName       = errors.New("account: name already used in this wallet")
)

// Types is the set of supported account types (HomeBank parity).
var Types = []string{"bank", "cash", "checking", "savings", "creditcard", "liability", "asset", "investment"}

var typeSet = func() map[string]bool {
	m := make(map[string]bool, len(Types))
	for _, t := range Types {
		m[t] = true
	}
	return m
}()

// ValidType reports whether t is a supported account type.
func ValidType(t string) bool { return typeSet[t] }

// Account is the public representation of an account, including its currency's
// formatting metadata and current balance.
type Account struct {
	ID             int64
	WalletID       int64
	Name           string
	Type           string
	CurrencyID     int64
	Institution    string
	Number         string
	InitialBalance int64
	MinimumBalance int64
	Balance        int64 // today's balance: initial_balance + sum(transactions dated on/before today)
	FutureBalance  int64 // initial_balance + sum(all transactions, including future-dated)
	Closed         bool
	NoSummary      bool
	NoBudget       bool
	NoReport       bool
	Position       int64
	GroupName      string
	Notes          string
	Website        string
	CreatedAt      string

	CurrencyCode         string
	CurrencySymbol       string
	CurrencySymbolPrefix bool
	CurrencyDecimalChar  string
	CurrencyGroupChar    string
	CurrencyFracDigits   int
}

// Input carries the editable fields of an account.
type Input struct {
	Name           string
	Type           string
	CurrencyID     int64
	Institution    string
	Number         string
	InitialBalance int64
	MinimumBalance int64
	Closed         bool
	NoSummary      bool
	NoBudget       bool
	NoReport       bool
	GroupName      string
	Notes          string
	Website        string
}

// PositionUpdate moves an account to a position/group (for reordering).
type PositionUpdate struct {
	ID        int64
	Position  int64
	GroupName string
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// Service implements account CRUD.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// List returns a wallet's accounts (ordered by position/group/name).
func (s *Service) List(ctx context.Context, walletID int64) ([]Account, error) {
	rows, err := s.q.ListAccountsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	// Compute each account's today/future balance from its transactions (same
	// definitions as the dashboard and register header). No transactions → the
	// zero-value delta leaves the balance at the initial balance.
	today := time.Now().UTC().Format(dateLayout)
	deltas, err := s.q.AccountBalanceDeltas(ctx, db.AccountBalanceDeltasParams{Today: today, WalletID: walletID})
	if err != nil {
		return nil, err
	}
	deltaByAccount := make(map[int64]db.AccountBalanceDeltasRow, len(deltas))
	for _, d := range deltas {
		deltaByAccount[d.AccountID] = d
	}
	out := make([]Account, 0, len(rows))
	for _, r := range rows {
		d := deltaByAccount[r.ID]
		out = append(out, Account{
			ID: r.ID, WalletID: r.WalletID, Name: r.Name, Type: r.Type, CurrencyID: r.CurrencyID,
			Institution: r.Institution, Number: r.Number,
			InitialBalance: r.InitialBalance, MinimumBalance: r.MinimumBalance,
			Balance: r.InitialBalance + d.TodayDelta, FutureBalance: r.InitialBalance + d.FutureDelta,
			Closed: r.Closed != 0, NoSummary: r.NoSummary != 0, NoBudget: r.NoBudget != 0, NoReport: r.NoReport != 0,
			Position: r.Position, GroupName: r.GroupName, Notes: r.Notes, Website: r.Website, CreatedAt: r.CreatedAt,
			CurrencyCode: r.CurrencyCode, CurrencySymbol: r.CurrencySymbol,
			CurrencySymbolPrefix: r.CurrencySymbolPrefix != 0,
			CurrencyDecimalChar:  r.CurrencyDecimalChar, CurrencyGroupChar: r.CurrencyGroupChar,
			CurrencyFracDigits: int(r.CurrencyFracDigits),
		})
	}
	return out, nil
}

// Get returns a single account with its currency metadata.
func (s *Service) Get(ctx context.Context, accountID int64) (Account, error) {
	a, err := s.q.GetAccount(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	cur, err := s.q.GetCurrency(ctx, a.CurrencyID)
	if err != nil {
		return Account{}, err
	}
	today := time.Now().UTC().Format(dateLayout)
	d, err := s.q.AccountBalanceDelta(ctx, db.AccountBalanceDeltaParams{Today: today, AccountID: accountID})
	if err != nil {
		return Account{}, err
	}
	return Account{
		ID: a.ID, WalletID: a.WalletID, Name: a.Name, Type: a.Type, CurrencyID: a.CurrencyID,
		Institution: a.Institution, Number: a.Number,
		InitialBalance: a.InitialBalance, MinimumBalance: a.MinimumBalance,
		Balance: a.InitialBalance + d.TodayDelta, FutureBalance: a.InitialBalance + d.FutureDelta,
		Closed: a.Closed != 0, NoSummary: a.NoSummary != 0, NoBudget: a.NoBudget != 0, NoReport: a.NoReport != 0,
		Position: a.Position, GroupName: a.GroupName, Notes: a.Notes, Website: a.Website, CreatedAt: a.CreatedAt,
		CurrencyCode: cur.IsoCode, CurrencySymbol: cur.Symbol, CurrencySymbolPrefix: cur.SymbolPrefix != 0,
		CurrencyDecimalChar: cur.DecimalChar, CurrencyGroupChar: cur.GroupChar, CurrencyFracDigits: int(cur.FracDigits),
	}, nil
}

// Create adds an account. The currency must belong to the wallet.
func (s *Service) Create(ctx context.Context, walletID int64, in Input) (Account, error) {
	if err := s.checkCurrency(ctx, walletID, in.CurrencyID); err != nil {
		return Account{}, err
	}
	pos, err := s.q.NextAccountPosition(ctx, walletID)
	if err != nil {
		return Account{}, err
	}
	a, err := s.q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: walletID, Name: in.Name, Type: in.Type, CurrencyID: in.CurrencyID,
		Institution: in.Institution, Number: in.Number,
		InitialBalance: in.InitialBalance, MinimumBalance: in.MinimumBalance,
		Closed: b2i(in.Closed), NoSummary: b2i(in.NoSummary), NoBudget: b2i(in.NoBudget), NoReport: b2i(in.NoReport),
		Position: pos, GroupName: in.GroupName, Notes: in.Notes, Website: in.Website,
	})
	if err != nil {
		if isUnique(err) {
			return Account{}, ErrDuplicateName
		}
		return Account{}, err
	}
	return s.Get(ctx, a.ID)
}

// Update changes an account's editable fields. The currency must belong to the
// wallet.
func (s *Service) Update(ctx context.Context, walletID, accountID int64, in Input) (Account, error) {
	if err := s.checkCurrency(ctx, walletID, in.CurrencyID); err != nil {
		return Account{}, err
	}
	if err := s.q.UpdateAccount(ctx, db.UpdateAccountParams{
		Name: in.Name, Type: in.Type, CurrencyID: in.CurrencyID,
		Institution: in.Institution, Number: in.Number,
		InitialBalance: in.InitialBalance, MinimumBalance: in.MinimumBalance,
		Closed: b2i(in.Closed), NoSummary: b2i(in.NoSummary), NoBudget: b2i(in.NoBudget), NoReport: b2i(in.NoReport),
		GroupName: in.GroupName, Notes: in.Notes, Website: in.Website, ID: accountID,
	}); err != nil {
		if isUnique(err) {
			return Account{}, ErrDuplicateName
		}
		return Account{}, err
	}
	return s.Get(ctx, accountID)
}

// Delete removes an account.
func (s *Service) Delete(ctx context.Context, accountID int64) error {
	return s.q.DeleteAccount(ctx, accountID)
}

// Reorder applies a batch of position/group changes atomically.
func (s *Service) Reorder(ctx context.Context, updates []PositionUpdate) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	for _, u := range updates {
		if err := qtx.UpdateAccountPosition(ctx, db.UpdateAccountPositionParams{
			Position: u.Position, GroupName: u.GroupName, ID: u.ID,
		}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// checkCurrency verifies that currencyID exists and belongs to walletID.
func (s *Service) checkCurrency(ctx context.Context, walletID, currencyID int64) error {
	c, err := s.q.GetCurrency(ctx, currencyID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && c.WalletID != walletID) {
		return ErrCurrencyNotInWallet
	}
	return err
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}
