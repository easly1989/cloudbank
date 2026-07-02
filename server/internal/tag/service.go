// Package tag implements management CRUD for transaction tags: listing (with
// usage counts), renaming, merging and deleting. Tag *creation* happens where
// transactions are written (the transaction service attaches tags during save);
// this package owns the standalone tag lifecycle, split out for single
// responsibility.
package tag

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors.
var (
	ErrNotFound  = errors.New("tag: not found")
	ErrDuplicate = errors.New("tag: a tag with that name already exists")
	ErrInvalid   = errors.New("tag: invalid name or target")
)

// Info is a tag with how many transactions use it.
type Info struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// Service implements tag management.
type Service struct {
	db *sql.DB
	q  *db.Queries // write pool (mutations)
	rq *db.Queries // read pool (read-only methods)
}

// NewService builds a Service backed by the write connection pool for both
// reads and writes.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write), rq: db.New(write)}
}

// NewServiceWithRead builds a Service whose read-only methods run on the read
// pool while mutations use the single write connection.
func NewServiceWithRead(read, write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write), rq: db.New(read)}
}

// List returns the wallet's tag names.
func (s *Service) List(ctx context.Context, walletID int64) ([]string, error) {
	rows, err := s.rq.ListTagsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, t := range rows {
		out = append(out, t.Name)
	}
	return out, nil
}

// ListWithCounts returns the wallet's tags with their usage counts.
func (s *Service) ListWithCounts(ctx context.Context, walletID int64) ([]Info, error) {
	rows, err := s.rq.ListTagsWithCounts(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Info, 0, len(rows))
	for _, r := range rows {
		out = append(out, Info{ID: r.ID, Name: r.Name, Count: r.Count})
	}
	return out, nil
}

// inWallet loads a tag and verifies it belongs to the wallet.
func (s *Service) inWallet(ctx context.Context, walletID, tagID int64) (db.Tag, error) {
	t, err := s.q.GetTag(ctx, tagID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && t.WalletID != walletID) {
		return db.Tag{}, ErrNotFound
	}
	return t, err
}

// Rename renames a tag. Renaming onto an existing name is rejected (use Merge to
// combine them).
func (s *Service) Rename(ctx context.Context, walletID, tagID int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrInvalid
	}
	if _, err := s.inWallet(ctx, walletID, tagID); err != nil {
		return err
	}
	if existing, err := s.q.GetTagByName(ctx, db.GetTagByNameParams{WalletID: walletID, Name: name}); err == nil && existing.ID != tagID {
		return ErrDuplicate
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return s.q.RenameTag(ctx, db.RenameTagParams{Name: name, ID: tagID})
}

// Merge moves every transaction tagged with sourceID onto targetID and deletes
// the source tag.
func (s *Service) Merge(ctx context.Context, walletID, sourceID, targetID int64) error {
	if sourceID == targetID {
		return ErrInvalid
	}
	if _, err := s.inWallet(ctx, walletID, sourceID); err != nil {
		return err
	}
	if _, err := s.inWallet(ctx, walletID, targetID); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	if err := qtx.ReassignTag(ctx, db.ReassignTagParams{TagID: targetID, TagID_2: sourceID}); err != nil {
		return err
	}
	if err := qtx.DeleteTag(ctx, sourceID); err != nil {
		return err
	}
	return tx.Commit()
}

// Delete removes a tag and untags it from every transaction.
func (s *Service) Delete(ctx context.Context, walletID, tagID int64) error {
	if _, err := s.inWallet(ctx, walletID, tagID); err != nil {
		return err
	}
	return s.q.DeleteTag(ctx, tagID)
}
