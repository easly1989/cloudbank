package transaction

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Merging two register rows into one, field by field (#786): the kept row takes
// the chosen fields from the dropped one, the attachments and mails of the
// dropped row move to it, and the dropped row goes. All at once, and the
// wallet's last merge is kept so it can be undone until the next one.

// Sentinel errors of a merge.
var (
	ErrMergeAccounts = errors.New("transaction: the rows are on different accounts")
	// ErrMergeKind means one of the rows is a transfer leg or a split.
	ErrMergeKind   = errors.New("transaction: a transfer or a split cannot be merged")
	ErrMergeField  = errors.New("transaction: unknown merge field")
	ErrNoMerge     = errors.New("transaction: no merge to undo")
	ErrUndoChanged = errors.New("transaction: the merged rows changed since")
	// ErrUndoStale means the merge asked about is no longer the wallet's last.
	ErrUndoStale = errors.New("transaction: a later merge replaced this one")
)

// MergeFields are the fields a merge can take from the dropped row.
var MergeFields = []string{"date", "amount", "status", "payee", "category", "memo", "tags"}

// mergeUndo is what undoing a merge needs: both rows as they were, every
// column, and the attachments and mails that moved from the dropped one.
type mergeUndo struct {
	// Token names this merge: an undo for another one is refused.
	Token string    `json:"token"`
	Keep  mergedRow `json:"keep"`
	Drop  mergedRow `json:"drop"`
	// Merged is the kept row as the merge left it: undo is refused once it
	// has changed, rather than overwrite the change.
	Merged      mergedRow `json:"merged"`
	Attachments []int64   `json:"attachments,omitempty"`
	Mails       []int64   `json:"mails,omitempty"`
	// LostRefs are the import refs no row keeps after the merge, recorded by
	// this merge so import and sync count them as already imported.
	LostRefs []string `json:"lostRefs,omitempty"`
	// What went with the dropped row: its snooze and waiting time on Review,
	// and the pairs marked "not a duplicate".
	Snooze     string                             `json:"snooze,omitempty"`
	Waiting    string                             `json:"waiting,omitempty"`
	Dismissals []db.ListDuplicateDismissalsForRow `json:"dismissals,omitempty"`
}

type mergedRow struct {
	Row  db.Transaction `json:"row"`
	Tags []string       `json:"tags,omitempty"`
}

// MergeRows folds dropID into keepID. The kept row takes the fields named in
// take from the dropped one and keeps its own others; it keeps its import ref,
// or inherits the dropped row's when it has none or only a mail's, so sync
// does not import the movement again. Both rows must be the wallet's, on one
// account, and neither a transfer leg nor a split.
// It returns the token that undoes it.
func (s *Service) MergeRows(ctx context.Context, walletID, keepID, dropID int64, take []string) (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	return token, s.mergeRows(ctx, walletID, keepID, dropID, take, token)
}

func (s *Service) mergeRows(ctx context.Context, walletID, keepID, dropID int64, take []string, token string) error {
	from := map[string]bool{}
	for _, f := range take {
		if !slices.Contains(MergeFields, f) {
			return ErrMergeField
		}
		from[f] = true
	}
	if keepID == dropID {
		return ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	var rows [2]mergedRow
	for i, id := range []int64{keepID, dropID} {
		r, err := qtx.GetTransaction(ctx, id)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && r.WalletID != walletID) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		// A transfer is two rows, deleted together; a split's amount is the sum
		// of its lines. Neither fits a field-by-field merge.
		_, err = qtx.GetTransferByTransaction(ctx, db.GetTransferByTransactionParams{TxnFromID: id, TxnToID: id})
		if err == nil || r.IsSplit != 0 {
			return ErrMergeKind
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		tags, err := qtx.ListTransactionTags(ctx, id)
		if err != nil {
			return err
		}
		rows[i] = mergedRow{Row: r, Tags: tags}
	}
	keep, drop := rows[0], rows[1]
	if keep.Row.AccountID != drop.Row.AccountID {
		return ErrMergeAccounts
	}
	undo := mergeUndo{Token: token, Keep: keep, Drop: drop}
	if undo.Attachments, undo.Mails, err = moveLinks(ctx, qtx, keepID, dropID); err != nil {
		return err
	}
	optional := func(v string, err error) (string, error) {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return v, err
	}
	if undo.Snooze, err = optional(qtx.GetReviewSnoozeUntil(ctx, dropID)); err != nil {
		return err
	}
	if undo.Waiting, err = optional(qtx.GetReviewWaitingSince(ctx, dropID)); err != nil {
		return err
	}
	if undo.Dismissals, err = qtx.ListDuplicateDismissalsFor(ctx, dropID); err != nil {
		return err
	}

	res, k, d := keep.Row, keep.Row, drop.Row
	if from["date"] {
		res.Date = d.Date
	}
	if from["amount"] {
		res.Amount = d.Amount
	}
	if from["status"] {
		res.Status = d.Status
	}
	if from["payee"] {
		res.PayeeID = d.PayeeID
	}
	if from["category"] {
		res.CategoryID = d.CategoryID
	}
	if from["memo"] {
		res.Memo = d.Memo
	}
	tags := keep.Tags
	if from["tags"] {
		tags = drop.Tags
	}
	if err := qtx.UpdateTransaction(ctx, db.UpdateTransactionParams{
		Date: res.Date, Amount: res.Amount, PaymentMode: k.PaymentMode, Status: res.Status,
		Info: k.Info, PayeeID: res.PayeeID, CategoryID: res.CategoryID, Memo: res.Memo,
		IsSplit: k.IsSplit, VehicleID: k.VehicleID, ID: keepID,
	}); err != nil {
		return err
	}
	mail := func(ref string) bool { return strings.HasPrefix(ref, MailRefPrefix) }
	ref := k.ImportRef
	if d.ImportRef != "" && (k.ImportRef == "" || (mail(k.ImportRef) && !mail(d.ImportRef))) {
		ref = d.ImportRef
		if err := qtx.SetTransactionImportRef(ctx, db.SetTransactionImportRefParams{
			ImportRef: ref, ID: keepID, WalletID: walletID,
		}); err != nil {
			return err
		}
	}
	for _, r := range []string{k.ImportRef, d.ImportRef} {
		if r == "" || r == ref {
			continue
		}
		n, err := qtx.InsertMergedImportRef(ctx, db.InsertMergedImportRefParams{
			AccountID: k.AccountID, ImportRef: r, TransactionID: sql.NullInt64{Int64: keepID, Valid: true},
		})
		if err != nil {
			return err
		}
		if n > 0 { // a ref an earlier merge recorded stays that merge's
			undo.LostRefs = append(undo.LostRefs, r)
		}
	}
	if err := s.setTags(ctx, qtx, walletID, keepID, tags); err != nil {
		return err
	}
	// Not s.Delete: it runs outside this transaction and removes the files of
	// the attachments, which have just moved to the kept row.
	if err := qtx.DeleteTransaction(ctx, dropID); err != nil {
		return err
	}
	if undo.Merged.Row, err = qtx.GetTransaction(ctx, keepID); err != nil {
		return err
	}
	if undo.Merged.Tags, err = qtx.ListTransactionTags(ctx, keepID); err != nil {
		return err
	}
	raw, err := json.Marshal(undo)
	if err != nil {
		return err
	}
	if err := qtx.UpsertTransactionMerge(ctx, db.UpsertTransactionMergeParams{WalletID: walletID, Undo: string(raw)}); err != nil {
		return err
	}
	return tx.Commit()
}

// moveLinks moves the attachments and mails of a row about to be dropped to
// the row it merges into, and returns their ids.
func moveLinks(ctx context.Context, qtx *db.Queries, keepID, dropID int64) (atts, mails []int64, err error) {
	rows, err := qtx.ListAttachmentsForTransaction(ctx, dropID)
	if err != nil {
		return nil, nil, err
	}
	for _, a := range rows {
		atts = append(atts, a.ID)
	}
	if mails, err = qtx.ListMailMessageIDsForTransaction(ctx, sql.NullInt64{Int64: dropID, Valid: true}); err != nil {
		return nil, nil, err
	}
	if len(atts) > 0 {
		if err := qtx.MoveAttachmentsByIDs(ctx, db.MoveAttachmentsByIDsParams{ToID: keepID, FromID: dropID, Ids: atts}); err != nil {
			return nil, nil, err
		}
	}
	if len(mails) > 0 {
		if err := qtx.MoveMailMessagesByIDs(ctx, db.MoveMailMessagesByIDsParams{
			ToID: sql.NullInt64{Int64: keepID, Valid: true}, FromID: sql.NullInt64{Int64: dropID, Valid: true}, Ids: mails,
		}); err != nil {
			return nil, nil, err
		}
	}
	return atts, mails, nil
}

// UndoMerge puts back the wallet's last merge, the one token names: both rows
// exactly as they were, import refs and timestamps included, with their tags,
// and the attachments and mails that moved return to the dropped row. It is
// refused once the kept row has changed since the merge.
func (s *Service) UndoMerge(ctx context.Context, walletID int64, token string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	m, err := qtx.GetTransactionMerge(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoMerge
	}
	if err != nil {
		return err
	}
	var undo mergeUndo
	if err := json.Unmarshal([]byte(m.Undo), &undo); err != nil {
		return err
	}
	if undo.Token != token {
		return ErrUndoStale
	}
	keepID, dropID := undo.Keep.Row.ID, undo.Drop.Row.ID
	// The kept row must still be there as the merge left it, and the dropped
	// one still gone.
	cur, err := qtx.GetTransaction(ctx, keepID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUndoChanged
	}
	if err != nil {
		return err
	}
	tags, err := qtx.ListTransactionTags(ctx, keepID)
	if err != nil {
		return err
	}
	if cur != undo.Merged.Row || !slices.Equal(tags, undo.Merged.Tags) {
		return ErrUndoChanged
	}
	if _, err := qtx.GetTransaction(ctx, dropID); !errors.Is(err, sql.ErrNoRows) {
		if err == nil {
			return ErrUndoChanged
		}
		return err
	}
	if _, err := qtx.GetTransferByTransaction(ctx, db.GetTransferByTransactionParams{TxnFromID: keepID, TxnToID: keepID}); !errors.Is(err, sql.ErrNoRows) {
		if err == nil {
			return ErrUndoChanged
		}
		return err
	}
	for _, r := range []mergedRow{undo.Drop, undo.Keep} {
		if err := qtx.RestoreTransaction(ctx, db.RestoreTransactionParams(r.Row)); err != nil {
			return err
		}
		if err := s.setTags(ctx, qtx, walletID, r.Row.ID, r.Tags); err != nil {
			return err
		}
	}
	if len(undo.Attachments) > 0 {
		if err := qtx.MoveAttachmentsByIDs(ctx, db.MoveAttachmentsByIDsParams{ToID: dropID, FromID: keepID, Ids: undo.Attachments}); err != nil {
			return err
		}
	}
	if len(undo.Mails) > 0 {
		if err := qtx.MoveMailMessagesByIDs(ctx, db.MoveMailMessagesByIDsParams{
			ToID: sql.NullInt64{Int64: dropID, Valid: true}, FromID: sql.NullInt64{Int64: keepID, Valid: true}, Ids: undo.Mails,
		}); err != nil {
			return err
		}
	}
	if undo.Snooze != "" {
		if err := qtx.UpsertReviewSnooze(ctx, db.UpsertReviewSnoozeParams{TransactionID: dropID, WalletID: walletID, Until: undo.Snooze}); err != nil {
			return err
		}
	}
	if undo.Waiting != "" {
		if err := qtx.InsertReviewWaiting(ctx, db.InsertReviewWaitingParams{TransactionID: dropID, WalletID: walletID, Since: undo.Waiting}); err != nil {
			return err
		}
	}
	for _, p := range undo.Dismissals {
		// The other row of the pair may have gone since.
		other := p.TxnAID
		if other == dropID {
			other = p.TxnBID
		}
		if _, err := qtx.GetTransaction(ctx, other); errors.Is(err, sql.ErrNoRows) {
			continue
		} else if err != nil {
			return err
		}
		if err := qtx.InsertDuplicateDismissal(ctx, db.InsertDuplicateDismissalParams{WalletID: walletID, TxnAID: p.TxnAID, TxnBID: p.TxnBID}); err != nil {
			return err
		}
	}
	for _, r := range undo.LostRefs {
		if err := qtx.DeleteMergedImportRef(ctx, db.DeleteMergedImportRefParams{AccountID: undo.Keep.Row.AccountID, ImportRef: r}); err != nil {
			return err
		}
	}
	if err := qtx.DeleteTransactionMerge(ctx, walletID); err != nil {
		return err
	}
	return tx.Commit()
}

// setTags makes a transaction's tags exactly names.
func (s *Service) setTags(ctx context.Context, qtx *db.Queries, walletID, txID int64, names []string) error {
	if err := qtx.DeleteTransactionTags(ctx, txID); err != nil {
		return err
	}
	return s.writeSplitsAndTags(ctx, qtx, walletID, txID, Input{Tags: names})
}
