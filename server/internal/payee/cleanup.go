package payee

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// A payee cleanup (#708): groups of payees, each given one clean name. A group
// with a payee that already has that name, in or out of the group, merges into
// it; otherwise its first payee takes the name and the others merge into it.
// A group may also leave a rule behind, "payee contains <text>", so the next
// import lands on the clean payee. The last cleanup of a wallet is kept, and
// undone until the next one.

// Sentinel errors of a cleanup.
var (
	ErrBadCleanup = errors.New("payee: invalid cleanup")
	ErrNoCleanup  = errors.New("payee: no cleanup to undo")
	// ErrUndoConflict means a name the undo would bring back is taken now.
	ErrUndoConflict = errors.New("payee: a name to restore is taken")
)

const (
	cleanupNameMax = 100
	cleanupRuleMax = 200
	// undoChunk bounds the ids of one undo query, well under SQLite's limit
	// on bound parameters.
	undoChunk = 500
)

// CleanupGroup is one clean name and the payees that take it, the first the
// one that keeps its row when none has the name yet; Rule, when set, is the
// text a new "payee contains" rule matches.
type CleanupGroup struct {
	Name     string  `json:"name"`
	PayeeIDs []int64 `json:"payeeIds"`
	Rule     string  `json:"rule,omitempty"`
}

// CleanupSummary is what a cleanup did: the clean payees, the payees it
// renamed or merged, the rules it made.
type CleanupSummary struct {
	Payees    int64  `json:"payees"`
	Names     int64  `json:"names"`
	Rules     int64  `json:"rules"`
	CreatedAt string `json:"createdAt"`
}

// cleanupUndo is what undoing a cleanup needs.
type cleanupUndo struct {
	Renamed []renamedPayee `json:"renamed,omitempty"`
	Merged  []mergedPayee  `json:"merged,omitempty"`
	Rules   []int64        `json:"rules,omitempty"`
}

// renamedPayee is a clean payee as it was: its name and default category.
type renamedPayee struct {
	ID                int64  `json:"id"`
	Name              string `json:"name"`
	DefaultCategoryID *int64 `json:"defaultCategoryId,omitempty"`
}

// mergedPayee is a payee merged away, with what pointed at it.
type mergedPayee struct {
	ID                 int64    `json:"id"`
	Target             int64    `json:"target"`
	Name               string   `json:"name"`
	DefaultCategoryID  *int64   `json:"defaultCategoryId,omitempty"`
	DefaultPaymentMode *int64   `json:"defaultPaymentMode,omitempty"`
	Transactions       []int64  `json:"transactions,omitempty"`
	Templates          []int64  `json:"templates,omitempty"`
	Rules              []int64  `json:"rules,omitempty"`
	Recurring          []string `json:"recurring,omitempty"`
}

// Cleanup applies the groups at once, all or nothing, and keeps what undoes
// them in place of the wallet's last cleanup.
func (s *Service) Cleanup(ctx context.Context, walletID int64, groups []CleanupGroup) (CleanupSummary, error) {
	if len(groups) == 0 {
		return CleanupSummary{}, ErrBadCleanup
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CleanupSummary{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	all, err := qtx.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return CleanupSummary{}, err
	}
	byID := make(map[int64]db.Payee, len(all))
	for _, p := range all {
		byID[p.ID] = p
	}
	counts, err := qtx.CountTransactionsByPayee(ctx, walletID)
	if err != nil {
		return CleanupSummary{}, err
	}
	used := make(map[int64]int64, len(counts))
	for _, c := range counts {
		used[c.PayeeID.Int64] = c.TxnCount
	}

	var undo cleanupUndo
	seen := map[int64]bool{}
	var names int64
	for _, g := range groups {
		name, rule := strings.TrimSpace(g.Name), strings.TrimSpace(g.Rule)
		if name == "" || len(name) > cleanupNameMax || len(rule) > cleanupRuleMax || len(g.PayeeIDs) == 0 {
			return CleanupSummary{}, ErrBadCleanup
		}
		for _, id := range g.PayeeIDs {
			if _, ok := byID[id]; !ok || seen[id] {
				return CleanupSummary{}, ErrBadCleanup
			}
			seen[id] = true
		}
		target := cleanupTarget(name, all)
		if target == 0 {
			target = g.PayeeIDs[0]
		}
		if seen[target] && !contains(g.PayeeIDs, target) {
			// The payee with the name is another group's: one row each.
			return CleanupSummary{}, ErrBadCleanup
		}
		seen[target] = true
		t := byID[target]
		if !contains(g.PayeeIDs, target) {
			name = t.Name // merging into a payee of its own keeps its spelling
		}

		// The clean payee keeps its default category; without one it takes
		// that of the merged payee with the most transactions.
		def := t.DefaultCategoryID
		var best int64 = -1
		for _, id := range g.PayeeIDs {
			if p := byID[id]; id != target && !def.Valid && p.DefaultCategoryID.Valid && used[id] > best {
				def, best = p.DefaultCategoryID, used[id]
			}
		}
		if t.Name != name || def != t.DefaultCategoryID {
			undo.Renamed = append(undo.Renamed, renamedPayee{ID: target, Name: t.Name, DefaultCategoryID: idPtr(t.DefaultCategoryID)})
			if err := qtx.UpdatePayee(ctx, db.UpdatePayeeParams{
				Name: name, DefaultCategoryID: def, DefaultPaymentMode: t.DefaultPaymentMode, ID: target,
			}); err != nil {
				if isUnique(err) {
					return CleanupSummary{}, ErrBadCleanup
				}
				return CleanupSummary{}, err
			}
			if t.Name != name {
				names++
			}
		}
		for _, id := range g.PayeeIDs {
			if id == target {
				continue
			}
			m, err := mergedOf(ctx, qtx, byID[id], target)
			if err != nil {
				return CleanupSummary{}, err
			}
			undo.Merged = append(undo.Merged, m)
			if err := mergeInto(ctx, qtx, id, target); err != nil {
				return CleanupSummary{}, err
			}
			names++
		}
		if rule != "" {
			pos, err := qtx.NextAssignmentPosition(ctx, walletID)
			if err != nil {
				return CleanupSummary{}, err
			}
			a, err := qtx.InsertAssignment(ctx, db.InsertAssignmentParams{
				WalletID: walletID, Position: pos, MatchField: "payee", MatchType: "contains", Pattern: rule,
				SetPayeeID: sql.NullInt64{Int64: target, Valid: true}, ApplyOnManual: 1, ApplyOnImport: 1,
			})
			if err != nil {
				return CleanupSummary{}, err
			}
			undo.Rules = append(undo.Rules, a.ID)
		}
	}

	raw, err := json.Marshal(undo)
	if err != nil {
		return CleanupSummary{}, err
	}
	sum := CleanupSummary{Payees: int64(len(groups)), Names: names, Rules: int64(len(undo.Rules))}
	if err := qtx.UpsertPayeeCleanup(ctx, db.UpsertPayeeCleanupParams{
		WalletID: walletID, Payees: sum.Payees, Names: sum.Names, Rules: sum.Rules, Undo: string(raw),
	}); err != nil {
		return CleanupSummary{}, err
	}
	if err := tx.Commit(); err != nil {
		return CleanupSummary{}, err
	}
	return s.LastCleanup(ctx, walletID)
}

// cleanupTarget is the payee that already has the name: the exact spelling
// first, then any case; 0 when none has it.
func cleanupTarget(name string, all []db.Payee) int64 {
	var fold int64
	for _, p := range all {
		if p.Name == name {
			return p.ID
		}
		if fold == 0 && strings.EqualFold(p.Name, name) {
			fold = p.ID
		}
	}
	return fold
}

func contains(ids []int64, id int64) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func idPtr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	return &n.Int64
}

// mergedOf records a payee about to merge into target, with what points at it.
func mergedOf(ctx context.Context, qtx *db.Queries, p db.Payee, target int64) (mergedPayee, error) {
	m := mergedPayee{
		ID: p.ID, Target: target, Name: p.Name,
		DefaultCategoryID: idPtr(p.DefaultCategoryID), DefaultPaymentMode: idPtr(p.DefaultPaymentMode),
	}
	id := sql.NullInt64{Int64: p.ID, Valid: true}
	var err error
	if m.Transactions, err = qtx.ListTransactionIDsWithPayee(ctx, id); err != nil {
		return m, err
	}
	if m.Templates, err = qtx.ListTemplateIDsWithPayee(ctx, id); err != nil {
		return m, err
	}
	if m.Rules, err = qtx.ListAssignmentIDsSettingPayee(ctx, id); err != nil {
		return m, err
	}
	m.Recurring, err = qtx.ListRecurringIgnoredForPayee(ctx, p.ID)
	return m, err
}

// LastCleanup is the wallet's last cleanup, ErrNoCleanup when there is none.
func (s *Service) LastCleanup(ctx context.Context, walletID int64) (CleanupSummary, error) {
	c, err := s.q.GetPayeeCleanup(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return CleanupSummary{}, ErrNoCleanup
	}
	if err != nil {
		return CleanupSummary{}, err
	}
	return CleanupSummary{Payees: c.Payees, Names: c.Names, Rules: c.Rules, CreatedAt: c.CreatedAt}, nil
}

// UndoCleanup puts the wallet's last cleanup back: the rules it made go, the
// merged payees return with the transactions, templates and rules it moved
// that still point where it moved them, and the clean payees get their names
// and default categories back.
func (s *Service) UndoCleanup(ctx context.Context, walletID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	c, err := qtx.GetPayeeCleanup(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoCleanup
	}
	if err != nil {
		return err
	}
	var undo cleanupUndo
	if err := json.Unmarshal([]byte(c.Undo), &undo); err != nil {
		return err
	}

	for ids := range chunks(undo.Rules) {
		if err := qtx.DeleteAssignmentsByIDs(ctx, db.DeleteAssignmentsByIDsParams{WalletID: walletID, Ids: ids}); err != nil {
			return err
		}
	}
	// Names first, so a merged payee's old name is free again.
	for _, r := range undo.Renamed {
		p, err := qtx.GetPayee(ctx, r.ID)
		if errors.Is(err, sql.ErrNoRows) {
			continue // deleted since: nothing to rename
		}
		if err != nil {
			return err
		}
		if err := qtx.UpdatePayee(ctx, db.UpdatePayeeParams{
			Name: r.Name, DefaultCategoryID: nullID(r.DefaultCategoryID), DefaultPaymentMode: p.DefaultPaymentMode, ID: r.ID,
		}); err != nil {
			if isUnique(err) {
				return ErrUndoConflict
			}
			return err
		}
	}
	for _, m := range undo.Merged {
		if err := qtx.InsertPayeeWithID(ctx, db.InsertPayeeWithIDParams{
			ID: m.ID, WalletID: walletID, Name: m.Name,
			DefaultCategoryID: nullID(m.DefaultCategoryID), DefaultPaymentMode: nullID(m.DefaultPaymentMode),
		}); err != nil {
			if isUnique(err) {
				return ErrUndoConflict
			}
			return err
		}
		to, from := sql.NullInt64{Int64: m.ID, Valid: true}, sql.NullInt64{Int64: m.Target, Valid: true}
		for ids := range chunks(m.Transactions) {
			if err := qtx.MoveTransactionsToPayee(ctx, db.MoveTransactionsToPayeeParams{ToID: to, FromID: from, Ids: ids}); err != nil {
				return err
			}
		}
		for ids := range chunks(m.Templates) {
			if err := qtx.MoveTemplatesToPayee(ctx, db.MoveTemplatesToPayeeParams{ToID: to, FromID: from, Ids: ids}); err != nil {
				return err
			}
		}
		for ids := range chunks(m.Rules) {
			if err := qtx.MoveAssignmentsToPayee(ctx, db.MoveAssignmentsToPayeeParams{ToID: to, FromID: from, Ids: ids}); err != nil {
				return err
			}
		}
		for _, cad := range m.Recurring {
			if err := qtx.InsertRecurringIgnored(ctx, db.InsertRecurringIgnoredParams{WalletID: walletID, PayeeID: m.ID, Cadence: cad}); err != nil {
				return err
			}
		}
	}
	if err := qtx.DeletePayeeCleanup(ctx, walletID); err != nil {
		return err
	}
	return tx.Commit()
}

// chunks yields ids undoChunk at a time.
func chunks(ids []int64) func(func([]int64) bool) {
	return func(yield func([]int64) bool) {
		for len(ids) > 0 {
			n := min(undoChunk, len(ids))
			if !yield(ids[:n]) {
				return
			}
			ids = ids[n:]
		}
	}
}
