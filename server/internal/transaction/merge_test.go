package transaction

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The bank's row and the one entered by hand for the same spending (#786),
// the hand row with a payee, category, memo, tags, a receipt and the mail
// that wrote it.
func mergePair(t *testing.T) (s *Service, q *db.Queries, raw *sql.DB, wid, acc, bank, hand int64) {
	t.Helper()
	s, q, raw, wid, acc = newMailReviewService(t)
	ctx := context.Background()
	cat, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Games"})
	pay, _ := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: wid, Name: "HUMBLE BUNDLE"})
	b, err := s.Create(ctx, wid, Input{
		AccountID: acc, Date: "2026-11-26", Amount: -1299, Status: StatusCleared, PaymentMode: 6,
		Memo: "PAG SU POS ESTERO PP*HUMBLEBUNDL", Info: "rif 1", ImportRef: "eb:humble",
	})
	if err != nil {
		t.Fatal(err)
	}
	h, err := s.Create(ctx, wid, Input{
		AccountID: acc, Date: "2026-11-29", Amount: -1349, Status: StatusNone,
		PayeeID: iptr(pay.ID), CategoryID: iptr(cat.ID), Memo: "Humble Choice", Tags: []string{"subscriptions", "games"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.InsertAttachment(ctx, db.InsertAttachmentParams{
		WalletID: wid, TransactionID: h.ID, Filename: "receipt.jpg", ContentType: "image/jpeg", Size: 1, StorageKey: "k1",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `INSERT INTO mailboxes (wallet_id, provider, address) VALUES (?, 'imap', 'avvisi.demo@example.net')`, wid); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `INSERT INTO mail_messages (mailbox_id, uid, message_id, received_at, transaction_id) VALUES (1, 1, '<1@example.net>', '2026-11-29', ?)`, h.ID); err != nil {
		t.Fatal(err)
	}
	return s, q, raw, wid, acc, b.ID, h.ID
}

// links is where the receipt and the mail point.
func links(t *testing.T, raw *sql.DB) (att, mail int64) {
	t.Helper()
	if err := raw.QueryRow(`SELECT transaction_id FROM attachments`).Scan(&att); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT transaction_id FROM mail_messages`).Scan(&mail); err != nil {
		t.Fatal(err)
	}
	return att, mail
}

// refsOf is the account's merged-away refs.
func refsOf(t *testing.T, q *db.Queries, acc int64) []string {
	t.Helper()
	rows, err := q.ListMergedImportRefs(context.Background(), acc)
	if err != nil {
		t.Fatal(err)
	}
	out := []string{}
	for _, r := range rows {
		out = append(out, r.ImportRef)
	}
	return out
}

func TestMergingRowsTakesTheChosenFieldsAndUndoPutsBothBack(t *testing.T) {
	s, q, raw, wid, _, bank, hand := mergePair(t)
	ctx := context.Background()
	// What goes with the hand row when it is deleted: its Review snooze and
	// waiting time, and a pair marked "not a duplicate".
	if err := q.UpsertReviewSnooze(ctx, db.UpsertReviewSnoozeParams{TransactionID: hand, WalletID: wid, Until: "2026-12-01"}); err != nil {
		t.Fatal(err)
	}
	if err := q.InsertReviewWaiting(ctx, db.InsertReviewWaitingParams{TransactionID: hand, WalletID: wid, Since: "2026-11-20T10:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	if err := s.DismissDuplicate(ctx, wid, bank, hand); err != nil {
		t.Fatal(err)
	}
	before := map[int64]db.Transaction{}
	tagsBefore := map[int64][]string{}
	for _, id := range []int64{bank, hand} {
		before[id], _ = q.GetTransaction(ctx, id)
		tagsBefore[id], _ = q.ListTransactionTags(ctx, id)
	}

	// Date, amount and status stay the bank's; the rest comes from the hand row.
	token, err := s.MergeRows(ctx, wid, bank, hand, []string{"payee", "category", "memo", "tags"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, bank)
	if err != nil {
		t.Fatal(err)
	}
	h := before[hand]
	if got.Date != "2026-11-26" || got.Amount != -1299 || got.Status != StatusCleared ||
		*got.PayeeID != h.PayeeID.Int64 || *got.CategoryID != h.CategoryID.Int64 || got.Memo != "Humble Choice" ||
		!slices.Equal(got.Tags, []string{"games", "subscriptions"}) || got.ImportRef != "eb:humble" || got.Info != "rif 1" {
		t.Errorf("merged = %+v", got)
	}
	if _, err := s.Get(ctx, hand); !errors.Is(err, ErrNotFound) {
		t.Errorf("the hand row is still there: %v", err)
	}
	if att, mail := links(t, raw); att != bank || mail != bank {
		t.Errorf("receipt on %d, mail on %d, want both on the kept row %d", att, mail, bank)
	}

	if err := s.UndoMerge(ctx, wid, "another"); !errors.Is(err, ErrUndoStale) {
		t.Errorf("undo with another merge's token = %v, want ErrUndoStale", err)
	}
	if err := s.UndoMerge(ctx, wid, token); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{bank, hand} {
		row, err := q.GetTransaction(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if row != before[id] {
			t.Errorf("row %d = %+v, want %+v", id, row, before[id])
		}
		tags, _ := q.ListTransactionTags(ctx, id)
		if !slices.Equal(tags, tagsBefore[id]) {
			t.Errorf("row %d tags = %v, want %v", id, tags, tagsBefore[id])
		}
	}
	if att, mail := links(t, raw); att != hand || mail != hand {
		t.Errorf("receipt on %d, mail on %d, want both back on %d", att, mail, hand)
	}
	if until, _ := q.GetReviewSnoozeUntil(ctx, hand); until != "2026-12-01" {
		t.Errorf("snooze = %q, want it back", until)
	}
	if since, _ := q.GetReviewWaitingSince(ctx, hand); since != "2026-11-20T10:00:00Z" {
		t.Errorf("waiting since = %q, want it back", since)
	}
	if d, _ := q.ListDuplicateDismissalsFor(ctx, hand); len(d) != 1 {
		t.Errorf("dismissals = %v, want the pair back", d)
	}
	if err := s.UndoMerge(ctx, wid, token); !errors.Is(err, ErrNoMerge) {
		t.Errorf("a second undo = %v, want ErrNoMerge", err)
	}
}

// Undo never overwrites what changed on the kept row after the merge.
func TestUndoIsRefusedOnceTheKeptRowChanged(t *testing.T) {
	for name, change := range map[string]func(s *Service, wid, id int64) error{
		"status": func(s *Service, _, id int64) error { return s.SetStatus(context.Background(), id, StatusReconciled) },
		"tags": func(s *Service, wid, id int64) error {
			_, err := s.BulkSetTags(context.Background(), wid, []int64{id}, []string{"late"}, false)
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			s, _, _, wid, _, bank, hand := mergePair(t)
			token, err := s.MergeRows(context.Background(), wid, bank, hand, []string{"memo"})
			if err != nil {
				t.Fatal(err)
			}
			if err := change(s, wid, bank); err != nil {
				t.Fatal(err)
			}
			if err := s.UndoMerge(context.Background(), wid, token); !errors.Is(err, ErrUndoChanged) {
				t.Fatalf("undo = %v, want ErrUndoChanged", err)
			}
		})
	}
}

// The Review's merge moves the dropped row's attachments instead of deleting
// their files, and ends the chance to undo the register's last merge.
func TestReviewMergeMovesAttachmentsAndEndsTheRegisterUndo(t *testing.T) {
	s, q, raw, wid, acc, bank, hand := mergePair(t)
	ctx := context.Background()
	x, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-11-01", Amount: -500})
	y, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-11-02", Amount: -500})
	token, err := s.MergeRows(ctx, wid, x.ID, y.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Merge(ctx, wid, bank, hand); err != nil {
		t.Fatal(err)
	}
	if att, mail := links(t, raw); att != bank || mail != bank {
		t.Errorf("receipt on %d, mail on %d, want both on the kept row %d", att, mail, bank)
	}
	// The purger finds no attachment left on the dropped row to remove.
	if atts, _ := q.ListAttachmentsForTransaction(ctx, bank); len(atts) != 1 {
		t.Errorf("attachments of the kept row = %v, want the receipt", atts)
	}
	if err := s.UndoMerge(ctx, wid, token); !errors.Is(err, ErrNoMerge) {
		t.Errorf("undo after a Review merge = %v, want ErrNoMerge", err)
	}
}

func TestMergingRowsRefusesWhatItCannotMerge(t *testing.T) {
	s, q, raw, wid, acc, bank, hand := mergePair(t)
	ctx := context.Background()
	if _, err := s.MergeRows(ctx, wid, bank, hand, []string{"info"}); !errors.Is(err, ErrMergeField) {
		t.Errorf("unknown field = %v", err)
	}
	other, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: wid, Name: "Card", Type: "card", CurrencyID: 1, Position: 2})
	elsewhere, _ := s.Create(ctx, wid, Input{AccountID: other.ID, Date: "2026-11-26", Amount: -1299})
	if _, err := s.MergeRows(ctx, wid, bank, elsewhere.ID, nil); !errors.Is(err, ErrMergeAccounts) {
		t.Errorf("different accounts = %v", err)
	}
	split, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-11-26", Amount: -1299, Splits: []Split{{Amount: -1299}}})
	if _, err := s.MergeRows(ctx, wid, bank, split.ID, nil); !errors.Is(err, ErrMergeKind) {
		t.Errorf("split = %v", err)
	}
	leg, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-11-26", Amount: -1299})
	if _, err := raw.ExecContext(ctx, `INSERT INTO transfers (txn_from_id, txn_to_id) VALUES (?, ?)`, leg.ID, elsewhere.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MergeRows(ctx, wid, leg.ID, hand, nil); !errors.Is(err, ErrMergeKind) {
		t.Errorf("transfer = %v", err)
	}
	if _, err := s.MergeRows(ctx, wid+1, bank, hand, nil); !errors.Is(err, ErrNotFound) {
		t.Errorf("another wallet = %v", err)
	}
	// Nothing was merged, so nothing is there to undo.
	if err := s.UndoMerge(ctx, wid, "x"); !errors.Is(err, ErrNoMerge) {
		t.Errorf("undo = %v, want ErrNoMerge", err)
	}
}

// Both rows from the bank: the kept row has one ref, and the dropped one is
// recorded so the next sync does not bring the dropped row back; undo forgets
// only what its merge recorded.
func TestMergingTwoBankRowsKeepsTheDroppedRefImported(t *testing.T) {
	s, q, _, wid, acc := newMailReviewService(t)
	ctx := context.Background()
	a, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-11-26", Amount: -1299, ImportRef: "eb:a"})
	b, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-11-27", Amount: -1299, ImportRef: "eb:b"})
	token, err := s.MergeRows(ctx, wid, a.ID, b.ID, []string{"date"})
	if err != nil {
		t.Fatal(err)
	}
	if refs := refsOf(t, q, acc); !slices.Equal(refs, []string{"eb:b"}) {
		t.Fatalf("merged refs = %v, want the dropped row's", refs)
	}
	if err := s.UndoMerge(ctx, wid, token); err != nil {
		t.Fatal(err)
	}
	if refs := refsOf(t, q, acc); len(refs) != 0 {
		t.Fatalf("merged refs after undo = %v, want none", refs)
	}
	// The Review's merge records it too, and it is that merge's: undoing a
	// later merge that drops a row with the same ref leaves it.
	if err := s.Merge(ctx, wid, a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	c, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-11-28", Amount: -1299, ImportRef: "eb:b"})
	if token, err = s.MergeRows(ctx, wid, a.ID, c.ID, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.UndoMerge(ctx, wid, token); err != nil {
		t.Fatal(err)
	}
	if refs := refsOf(t, q, acc); !slices.Equal(refs, []string{"eb:b"}) {
		t.Fatalf("merged refs = %v, want the Review merge's kept", refs)
	}
}
