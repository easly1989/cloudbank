// Package walletref checks that the records a request names by id belong to the
// wallet it acts on (#543). A service calls Check before it stores an id it was
// handed, so a transaction, template, rule, payee or goal can only point at its
// own wallet's accounts, categories, payees and vehicles.
package walletref

import (
	"context"
	"errors"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// ErrForeign means an id names no record of the wallet: it belongs to another
// wallet or does not exist. Handlers answer it with 400.
var ErrForeign = errors.New("walletref: a referenced record does not belong to this wallet")

// chunk bounds the ids of one query, well under SQLite's limit on bound
// parameters.
const chunk = 500

// Refs collects the ids to check, by kind. Nil pointers are skipped, so a
// service can add every optional field as it is.
type Refs struct {
	accounts, categories, payees, vehicles, templates []int64
}

// Account adds an account id.
func (r *Refs) Account(id *int64) *Refs { r.accounts = appendID(r.accounts, id); return r }

// Category adds a category id.
func (r *Refs) Category(id *int64) *Refs { r.categories = appendID(r.categories, id); return r }

// Payee adds a payee id.
func (r *Refs) Payee(id *int64) *Refs { r.payees = appendID(r.payees, id); return r }

// Vehicle adds a vehicle id.
func (r *Refs) Vehicle(id *int64) *Refs { r.vehicles = appendID(r.vehicles, id); return r }

// Template adds a template id.
func (r *Refs) Template(id *int64) *Refs { r.templates = appendID(r.templates, id); return r }

func appendID(ids []int64, id *int64) []int64 {
	if id == nil {
		return ids
	}
	return append(ids, *id)
}

// counter is one of the generated Count…InWallet queries.
type counter func(ctx context.Context, walletID int64, ids []int64) (int64, error)

// Check returns ErrForeign unless every id in r is a record of walletID.
func Check(ctx context.Context, q *db.Queries, walletID int64, r *Refs) error {
	kinds := []struct {
		ids   []int64
		count counter
	}{
		{r.accounts, func(ctx context.Context, w int64, ids []int64) (int64, error) {
			return q.CountAccountsInWallet(ctx, db.CountAccountsInWalletParams{WalletID: w, Ids: ids})
		}},
		{r.categories, func(ctx context.Context, w int64, ids []int64) (int64, error) {
			return q.CountCategoriesInWallet(ctx, db.CountCategoriesInWalletParams{WalletID: w, Ids: ids})
		}},
		{r.payees, func(ctx context.Context, w int64, ids []int64) (int64, error) {
			return q.CountPayeesInWallet(ctx, db.CountPayeesInWalletParams{WalletID: w, Ids: ids})
		}},
		{r.vehicles, func(ctx context.Context, w int64, ids []int64) (int64, error) {
			return q.CountVehiclesInWallet(ctx, db.CountVehiclesInWalletParams{WalletID: w, Ids: ids})
		}},
		{r.templates, func(ctx context.Context, w int64, ids []int64) (int64, error) {
			return q.CountTemplatesInWallet(ctx, db.CountTemplatesInWalletParams{WalletID: w, Ids: ids})
		}},
	}
	for _, k := range kinds {
		ids := unique(k.ids)
		for start := 0; start < len(ids); start += chunk {
			part := ids[start:min(start+chunk, len(ids))]
			n, err := k.count(ctx, walletID, part)
			if err != nil {
				return err
			}
			if n != int64(len(part)) {
				return ErrForeign
			}
		}
	}
	return nil
}

func unique(ids []int64) []int64 {
	if len(ids) < 2 {
		return ids
	}
	seen := make(map[int64]bool, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
