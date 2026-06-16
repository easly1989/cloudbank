// Package category manages two-level categories within a wallet, including
// merge and delete-with-reassignment.
package category

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors.
var (
	ErrNotFound      = errors.New("category: not found")
	ErrDuplicate     = errors.New("category: name already used at this level")
	ErrTooDeep       = errors.New("category: subcategories cannot have children (max depth 2)")
	ErrHasChildren   = errors.New("category: has subcategories; reassign or delete them first")
	ErrSelfReference = errors.New("category: cannot merge a category into itself")
	ErrBadTarget     = errors.New("category: invalid merge/reassign target")
)

// Category is the public representation of a category.
type Category struct {
	ID       int64
	WalletID int64
	ParentID *int64
	Name     string
	IsIncome bool
	NoBudget bool
}

// Usage counts references to a category (shown before destructive operations).
// Transaction/split/budget references are added when those tables land.
type Usage struct {
	Subcategories int64 `json:"subcategories"`
	Payees        int64 `json:"payees"`
}

func toCategory(c db.Category) Category {
	out := Category{
		ID: c.ID, WalletID: c.WalletID, Name: c.Name,
		IsIncome: c.IsIncome != 0, NoBudget: c.NoBudget != 0,
	}
	if c.ParentID.Valid {
		p := c.ParentID.Int64
		out.ParentID = &p
	}
	return out
}

func nullID(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// Service implements category management.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// List returns a wallet's categories (the caller builds the two-level tree).
func (s *Service) List(ctx context.Context, walletID int64) ([]Category, error) {
	rows, err := s.q.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Category, 0, len(rows))
	for _, c := range rows {
		out = append(out, toCategory(c))
	}
	return out, nil
}

// Get returns a category by id.
func (s *Service) Get(ctx context.Context, id int64) (Category, error) {
	c, err := s.q.GetCategory(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Category{}, ErrNotFound
	}
	if err != nil {
		return Category{}, err
	}
	return toCategory(c), nil
}

// Create adds a category. A subcategory's parent must be a top-level category;
// the subcategory inherits its parent's income/expense type.
func (s *Service) Create(ctx context.Context, walletID int64, name string, parentID *int64, isIncome, noBudget bool) (Category, error) {
	if parentID != nil {
		parent, err := s.Get(ctx, *parentID)
		if err != nil {
			return Category{}, ErrBadTarget
		}
		if parent.WalletID != walletID {
			return Category{}, ErrBadTarget
		}
		if parent.ParentID != nil {
			return Category{}, ErrTooDeep
		}
		isIncome = parent.IsIncome // inherit
	}
	c, err := s.q.InsertCategory(ctx, db.InsertCategoryParams{
		WalletID: walletID, ParentID: nullID(parentID), Name: name,
		IsIncome: b2i(isIncome), NoBudget: b2i(noBudget),
	})
	if err != nil {
		if isUnique(err) {
			return Category{}, ErrDuplicate
		}
		return Category{}, err
	}
	return toCategory(c), nil
}

// Update renames a category and toggles its budget flag. For a top-level
// category the income/expense type can change and cascades to its children; a
// subcategory keeps its parent's type.
func (s *Service) Update(ctx context.Context, id int64, name string, isIncome, noBudget bool) (Category, error) {
	cur, err := s.Get(ctx, id)
	if err != nil {
		return Category{}, err
	}
	if cur.ParentID != nil {
		isIncome = cur.IsIncome // subcategory type is fixed by its parent
	}
	if err := s.q.UpdateCategory(ctx, db.UpdateCategoryParams{
		Name: name, IsIncome: b2i(isIncome), NoBudget: b2i(noBudget), ID: id,
	}); err != nil {
		if isUnique(err) {
			return Category{}, ErrDuplicate
		}
		return Category{}, err
	}
	if cur.ParentID == nil {
		if err := s.q.SetChildrenIncome(ctx, db.SetChildrenIncomeParams{IsIncome: b2i(isIncome), ParentID: nullID(&id)}); err != nil {
			return Category{}, err
		}
	}
	return s.Get(ctx, id)
}

// Usage reports how many things reference a category.
func (s *Service) Usage(ctx context.Context, id int64) (Usage, error) {
	subs, err := s.q.CountSubcategories(ctx, nullID(&id))
	if err != nil {
		return Usage{}, err
	}
	pays, err := s.q.CountPayeesWithCategory(ctx, nullID(&id))
	if err != nil {
		return Usage{}, err
	}
	return Usage{Subcategories: subs, Payees: pays}, nil
}

// Merge reassigns everything pointing at source to target, then deletes source.
func (s *Service) Merge(ctx context.Context, walletID, sourceID, targetID int64) error {
	if sourceID == targetID {
		return ErrSelfReference
	}
	source, err := s.Get(ctx, sourceID)
	if err != nil {
		return err
	}
	target, err := s.Get(ctx, targetID)
	if err != nil {
		return ErrBadTarget
	}
	if source.WalletID != walletID || target.WalletID != walletID {
		return ErrBadTarget
	}
	// Reparented children must not exceed depth 2.
	subs, err := s.q.CountSubcategories(ctx, nullID(&sourceID))
	if err != nil {
		return err
	}
	if subs > 0 && target.ParentID != nil {
		return ErrTooDeep
	}
	return s.reassignAndDelete(ctx, sourceID, &targetID)
}

// Delete removes a category. References are reassigned to reassignTo (or set to
// none when nil). A category with subcategories requires a reassign target.
func (s *Service) Delete(ctx context.Context, walletID, id int64, reassignTo *int64) error {
	cat, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if cat.WalletID != walletID {
		return ErrNotFound
	}
	subs, err := s.q.CountSubcategories(ctx, nullID(&id))
	if err != nil {
		return err
	}
	if subs > 0 {
		if reassignTo == nil {
			return ErrHasChildren
		}
		target, err := s.Get(ctx, *reassignTo)
		if err != nil || target.WalletID != walletID || target.ParentID != nil {
			return ErrBadTarget
		}
	}
	return s.reassignAndDelete(ctx, id, reassignTo)
}

// reassignAndDelete moves children and payee defaults from sourceID to target
// (NULL when target is nil) and deletes sourceID, atomically.
func (s *Service) reassignAndDelete(ctx context.Context, sourceID int64, target *int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if err := qtx.ReparentChildren(ctx, db.ReparentChildrenParams{ParentID: nullID(target), ParentID_2: nullID(&sourceID)}); err != nil {
		return err
	}
	if err := qtx.ReassignPayeeCategory(ctx, db.ReassignPayeeCategoryParams{DefaultCategoryID: nullID(target), DefaultCategoryID_2: nullID(&sourceID)}); err != nil {
		return err
	}
	// Future: reassign transactions.category_id, splits.category_id,
	// budgets.category_id and assignments.set_category_id here (#12+).
	if err := qtx.DeleteCategory(ctx, sourceID); err != nil {
		return err
	}
	return tx.Commit()
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}
