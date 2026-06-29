// Package wallet manages wallets (the equivalent of a HomeBank .xhb file) and
// their membership, which is the basis for per-user isolation.
package wallet

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Membership roles.
const (
	RoleOwner  = "owner"
	RoleMember = "member"
)

// MaxScheduleMonths caps how far ahead scheduled transactions auto-post
// (HomeBank parity: at most three months in advance).
const MaxScheduleMonths = 3

func clampMonths(n int) int {
	if n < 0 {
		return 0
	}
	if n > MaxScheduleMonths {
		return MaxScheduleMonths
	}
	return n
}

// scheduleMonths reads the auto-post horizon from a wallet's settings JSON.
func scheduleMonths(settingsJSON string) int {
	var s struct {
		SchedulePostMonths int `json:"schedulePostMonths"`
	}
	if settingsJSON != "" {
		_ = json.Unmarshal([]byte(settingsJSON), &s)
	}
	return clampMonths(s.SchedulePostMonths)
}

// ErrNotFound is returned when a wallet does not exist.
var ErrNotFound = errors.New("wallet: not found")

// Wallet is the public representation of a wallet. Role, when set, is the
// requesting user's role for this wallet.
type Wallet struct {
	ID                 int64
	Title              string
	OwnerName          string
	BaseCurrencyID     *int64
	Role               string
	CreatedAt          string
	SchedulePostMonths int // auto-post scheduled transactions up to N months ahead (0..3)
}

func toWallet(w db.Wallet) Wallet {
	out := Wallet{
		ID:                 w.ID,
		Title:              w.Title,
		OwnerName:          w.OwnerName,
		CreatedAt:          w.CreatedAt,
		SchedulePostMonths: scheduleMonths(w.SettingsJson),
	}
	if w.BaseCurrencyID.Valid {
		id := w.BaseCurrencyID.Int64
		out.BaseCurrencyID = &id
	}
	return out
}

// Service implements wallet CRUD and membership lookups.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool (wallet
// operations are low-volume and a few need transactions).
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// Create makes a new wallet and records the creator as its owner, atomically.
func (s *Service) Create(ctx context.Context, userID int64, title, ownerName string) (Wallet, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Wallet{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	w, err := qtx.CreateWallet(ctx, db.CreateWalletParams{Title: title, OwnerName: ownerName})
	if err != nil {
		return Wallet{}, err
	}
	if err := qtx.AddWalletMember(ctx, db.AddWalletMemberParams{
		WalletID: w.ID, UserID: userID, Role: RoleOwner,
	}); err != nil {
		return Wallet{}, err
	}
	if err := tx.Commit(); err != nil {
		return Wallet{}, err
	}
	out := toWallet(w)
	out.Role = RoleOwner
	return out, nil
}

// List returns the wallets the user is a member of, with their role.
func (s *Service) List(ctx context.Context, userID int64) ([]Wallet, error) {
	rows, err := s.q.ListWalletsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Wallet, 0, len(rows))
	for _, r := range rows {
		w := toWallet(db.Wallet{
			ID:             r.ID,
			Title:          r.Title,
			OwnerName:      r.OwnerName,
			BaseCurrencyID: r.BaseCurrencyID,
			SettingsJson:   r.SettingsJson,
			CreatedAt:      r.CreatedAt,
		})
		w.Role = r.MemberRole
		out = append(out, w)
	}
	return out, nil
}

// Get returns a wallet by id (ErrNotFound when absent). Role is not populated.
func (s *Service) Get(ctx context.Context, walletID int64) (Wallet, error) {
	w, err := s.q.GetWallet(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return Wallet{}, ErrNotFound
	}
	if err != nil {
		return Wallet{}, err
	}
	return toWallet(w), nil
}

// Update changes a wallet's title, owner name and scheduling horizon. Other keys
// already in the settings JSON are preserved.
func (s *Service) Update(ctx context.Context, walletID int64, title, ownerName string, schedulePostMonths int) error {
	w, err := s.q.GetWallet(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	settings := map[string]any{}
	if w.SettingsJson != "" {
		_ = json.Unmarshal([]byte(w.SettingsJson), &settings)
	}
	settings["schedulePostMonths"] = clampMonths(schedulePostMonths)
	blob, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	return s.q.UpdateWallet(ctx, db.UpdateWalletParams{
		Title: title, OwnerName: ownerName, SettingsJson: string(blob), ID: walletID,
	})
}

// Delete removes a wallet; FK cascades drop its members and all scoped data.
func (s *Service) Delete(ctx context.Context, walletID int64) error {
	return s.q.DeleteWallet(ctx, walletID)
}

// Membership returns the user's role for a wallet and whether they are a member.
func (s *Service) Membership(ctx context.Context, walletID, userID int64) (string, bool, error) {
	role, err := s.q.GetWalletMembership(ctx, db.GetWalletMembershipParams{WalletID: walletID, UserID: userID})
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return role, true, nil
}
