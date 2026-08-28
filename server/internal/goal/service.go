// Package goal implements savings goals ("piggy banks"): a manual target the
// user tops up or draws down by hand. A goal's saved amount is the sum of its
// signed contributions; progress = saved / target. Amounts are in the wallet's
// base currency. Split out as a first-class entity, mirroring the vehicle
// package's shape.
package goal

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors.
var (
	ErrNotFound        = errors.New("goal: not found")
	ErrInvalid         = errors.New("goal: name and a positive target are required")
	ErrBadContribution = errors.New("goal: a contribution needs a date and a non-zero amount")
)

// Goal is a savings goal with its current saved total.
type Goal struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	TargetAmount int64   `json:"targetAmount"`
	TargetDate   *string `json:"targetDate"`
	AccountID    *int64  `json:"accountId"`
	Note         string  `json:"note"`
	Position     int64   `json:"position"`
	Saved        int64   `json:"saved"`
}

// Contribution is a signed movement toward a goal (+ added / − withdrawn).
type Contribution struct {
	ID     int64  `json:"id"`
	GoalID int64  `json:"goalId"`
	Date   string `json:"date"`
	Amount int64  `json:"amount"`
	Note   string `json:"note"`
}

// Input is the editable part of a goal.
type Input struct {
	Name         string
	TargetAmount int64
	TargetDate   *string
	AccountID    *int64
	Note         string
}

func nullStr(s *string) sql.NullString {
	if s == nil || strings.TrimSpace(*s) == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: strings.TrimSpace(*s), Valid: true}
}
func nullID(id *int64) sql.NullInt64 {
	if id == nil || *id == 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *id, Valid: true}
}
func strPtr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	s := n.String
	return &s
}
func idPtr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

func toGoal(g db.Goal, saved int64) Goal {
	return Goal{
		ID: g.ID, Name: g.Name, TargetAmount: g.TargetAmount, TargetDate: strPtr(g.TargetDate),
		AccountID: idPtr(g.AccountID), Note: g.Note, Position: g.Position, Saved: saved,
	}
}
func toContribution(c db.GoalContribution) Contribution {
	return Contribution{ID: c.ID, GoalID: c.GoalID, Date: c.Date, Amount: c.Amount, Note: c.Note}
}

// Service implements savings-goal CRUD and contribution management.
type Service struct {
	q  *db.Queries // write pool (mutations)
	rq *db.Queries // read pool (read-only methods)
}

// NewService builds a Service backed by the write connection pool for both.
func NewService(write *sql.DB) *Service { return &Service{q: db.New(write), rq: db.New(write)} }

// NewServiceWithRead runs read-only methods on the read pool and mutations on
// the write connection.
func NewServiceWithRead(read, write *sql.DB) *Service {
	return &Service{q: db.New(write), rq: db.New(read)}
}

func validate(in Input) error {
	if strings.TrimSpace(in.Name) == "" || in.TargetAmount <= 0 {
		return ErrInvalid
	}
	return nil
}

// List returns the wallet's goals, each with its saved total.
func (s *Service) List(ctx context.Context, walletID int64) ([]Goal, error) {
	rows, err := s.rq.ListGoalsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Goal, 0, len(rows))
	for _, r := range rows {
		out = append(out, Goal{
			ID: r.ID, Name: r.Name, TargetAmount: r.TargetAmount, TargetDate: strPtr(r.TargetDate),
			AccountID: idPtr(r.AccountID), Note: r.Note, Position: r.Position, Saved: r.Saved,
		})
	}
	return out, nil
}

func (s *Service) inWallet(ctx context.Context, walletID, id int64) (db.Goal, error) {
	g, err := s.q.GetGoal(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && g.WalletID != walletID) {
		return db.Goal{}, ErrNotFound
	}
	return g, err
}

// Get returns a single goal with its saved total.
func (s *Service) Get(ctx context.Context, walletID, id int64) (Goal, error) {
	g, err := s.inWallet(ctx, walletID, id)
	if err != nil {
		return Goal{}, err
	}
	saved, err := s.rq.GoalSaved(ctx, id)
	if err != nil {
		return Goal{}, err
	}
	return toGoal(g, saved), nil
}

// Create adds a goal.
func (s *Service) Create(ctx context.Context, walletID int64, in Input) (Goal, error) {
	if err := validate(in); err != nil {
		return Goal{}, err
	}
	g, err := s.q.InsertGoal(ctx, db.InsertGoalParams{
		WalletID: walletID, Name: strings.TrimSpace(in.Name), TargetAmount: in.TargetAmount,
		TargetDate: nullStr(in.TargetDate), AccountID: nullID(in.AccountID), Note: in.Note, Position: 0,
	})
	if err != nil {
		return Goal{}, err
	}
	return toGoal(g, 0), nil
}

// Update edits a goal (position is preserved).
func (s *Service) Update(ctx context.Context, walletID, id int64, in Input) (Goal, error) {
	if err := validate(in); err != nil {
		return Goal{}, err
	}
	cur, err := s.inWallet(ctx, walletID, id)
	if err != nil {
		return Goal{}, err
	}
	if err := s.q.UpdateGoal(ctx, db.UpdateGoalParams{
		Name: strings.TrimSpace(in.Name), TargetAmount: in.TargetAmount, TargetDate: nullStr(in.TargetDate),
		AccountID: nullID(in.AccountID), Note: in.Note, Position: cur.Position, ID: id,
	}); err != nil {
		return Goal{}, err
	}
	return s.Get(ctx, walletID, id)
}

// Delete removes a goal; its contributions cascade away.
func (s *Service) Delete(ctx context.Context, walletID, id int64) error {
	if _, err := s.inWallet(ctx, walletID, id); err != nil {
		return err
	}
	return s.q.DeleteGoal(ctx, id)
}

// Contributions lists a goal's contributions (newest first).
func (s *Service) Contributions(ctx context.Context, walletID, goalID int64) ([]Contribution, error) {
	if _, err := s.inWallet(ctx, walletID, goalID); err != nil {
		return nil, err
	}
	rows, err := s.rq.ListContributionsForGoal(ctx, goalID)
	if err != nil {
		return nil, err
	}
	out := make([]Contribution, 0, len(rows))
	for _, c := range rows {
		out = append(out, toContribution(c))
	}
	return out, nil
}

// AddContribution records a signed movement toward a goal.
func (s *Service) AddContribution(ctx context.Context, walletID, goalID int64, date string, amount int64, note string) (Contribution, error) {
	if _, err := s.inWallet(ctx, walletID, goalID); err != nil {
		return Contribution{}, err
	}
	if strings.TrimSpace(date) == "" || amount == 0 {
		return Contribution{}, ErrBadContribution
	}
	c, err := s.q.InsertContribution(ctx, db.InsertContributionParams{
		GoalID: goalID, Date: date, Amount: amount, Note: note,
	})
	if err != nil {
		return Contribution{}, err
	}
	return toContribution(c), nil
}

// DeleteContribution removes one contribution from a goal.
func (s *Service) DeleteContribution(ctx context.Context, walletID, goalID, contribID int64) error {
	if _, err := s.inWallet(ctx, walletID, goalID); err != nil {
		return err
	}
	c, err := s.q.GetContribution(ctx, contribID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && c.GoalID != goalID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	return s.q.DeleteContribution(ctx, contribID)
}
