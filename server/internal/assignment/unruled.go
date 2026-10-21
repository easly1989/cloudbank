package assignment

import (
	"context"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// PayeeTally is one payee's transactions that no rule decides: how many, how
// many have no category, and how many each category has.
type PayeeTally struct {
	PayeeID    int64
	Payee      string
	Total      int
	Without    int
	Categories map[int64]int
}

// Unruled tallies, payee by payee, the wallet's transactions since a day that
// no rule matches, split ones left out: the ones a new rule, which goes last,
// would decide. The AI's rule proposals (#705) are made from them.
func (s *Service) Unruled(ctx context.Context, walletID int64, since string) ([]PayeeTally, error) {
	rules, err := s.rules(ctx, s.rq, walletID, func(db.Assignment) bool { return true })
	if err != nil {
		return nil, err
	}
	rows, err := s.rq.ListPayeeTransactionsSince(ctx, db.ListPayeeTransactionsSinceParams{WalletID: walletID, Date: since})
	if err != nil {
		return nil, err
	}
	var out []PayeeTally
	at := map[int64]int{}
	for _, r := range rows {
		if _, taken := FirstMatch(rules, subjectOf(db.ListWalletTransactionsForRulesRow(r))); taken {
			continue
		}
		i, ok := at[r.PayeeID.Int64]
		if !ok {
			i = len(out)
			at[r.PayeeID.Int64] = i
			out = append(out, PayeeTally{PayeeID: r.PayeeID.Int64, Payee: r.PayeeName, Categories: map[int64]int{}})
		}
		out[i].Total++
		if r.CategoryID.Valid {
			out[i].Categories[r.CategoryID.Int64]++
		} else {
			out[i].Without++
		}
	}
	return out, nil
}
