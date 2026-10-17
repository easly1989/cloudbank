package transaction

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// daysAgo is the civil date n days before today, as the review counts them.
func daysAgo(n int) string { return time.Now().UTC().AddDate(0, 0, -n).Format(dateLayout) }

// newMailReviewService is newTestService plus the raw database, for the mail
// tables the transaction service does not own.
func newMailReviewService(t *testing.T) (*Service, *db.Queries, *sql.DB, int64, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, err := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	if err != nil {
		t.Fatal(err)
	}
	cur, err := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	acc, err := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Checking", Type: "checking", CurrencyID: cur.ID, Position: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return NewService(st.Write()), q, st.Write(), w.ID, acc.ID
}

func ids(list []UnconfirmedRow) []int64 {
	out := []int64{}
	for _, u := range list {
		out = append(out, u.ID)
	}
	return out
}

func TestAMailRowTheBankHasNotBookedShowsAfterFiveDays(t *testing.T) {
	s, _, _, wid, acc := newMailReviewService(t)
	ctx := context.Background()
	mk := func(date, ref string, amount int64) int64 {
		t.Helper()
		tx, err := s.Create(ctx, wid, Input{AccountID: acc, Date: date, Amount: amount, Status: StatusCleared, ImportRef: ref})
		if err != nil {
			t.Fatal(err)
		}
		return tx.ID
	}
	old := mk(daysAgo(5), "mail:old", -10000)
	young := mk(daysAgo(4), "mail:young", -2000)
	// What a bank-sync merge leaves behind: the bank's ref in place of the mail's.
	confirmed := mk(daysAgo(12), "eb:confirmed", -100)
	manual := mk(daysAgo(9), "", -4000)
	// The bank rows near the old mail row: nearest amount first, then nearest
	// date, at most three; a row past the window is never offered.
	b1 := mk(daysAgo(1), "eb:b1", -4000)
	b2 := mk(daysAgo(4), "eb:b2", -2310)
	b3 := mk(daysAgo(8), "eb:b3", -2310)
	mk(daysAgo(2), "eb:b4", -999)
	mk(daysAgo(13), "eb:far", -10000)

	rev, err := s.Review(ctx, wid)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(rev.Unconfirmed); !slices.Equal(got, []int64{old}) {
		t.Fatalf("unconfirmed = %v, want only %d (not %d, %d, %d)", got, old, young, confirmed, manual)
	}
	var near []int64
	for _, b := range rev.Unconfirmed[0].BankRows {
		near = append(near, b.ID)
	}
	if !slices.Equal(near, []int64{b1, b2, b3}) {
		t.Errorf("bank rows offered = %v, want %v (nearest amount, then date, three at most)", near, []int64{b1, b2, b3})
	}
	if len(rev.Reversals) != 0 {
		t.Errorf("reversals = %+v, want none", rev.Reversals)
	}
}

func TestAPaymentAndItsReversalShowTogether(t *testing.T) {
	s, _, _, wid, acc := newMailReviewService(t)
	ctx := context.Background()
	mk := func(date, ref string, amount int64) int64 {
		t.Helper()
		tx, err := s.Create(ctx, wid, Input{AccountID: acc, Date: date, Amount: amount, ImportRef: ref})
		if err != nil {
			t.Fatal(err)
		}
		return tx.ID
	}
	// Two refused payments of the same amount on the same day, and their two
	// reversals: two pairs, nothing left over.
	p1 := mk(daysAgo(8), "mail:p1", -750)
	r1 := mk(daysAgo(8), "mail:r1", 750)
	p2 := mk(daysAgo(8), "mail:p2", -750)
	r2 := mk(daysAgo(7), "mail:r2", 750)
	// Too far apart to be one refused payment.
	far := mk(daysAgo(20), "mail:far", 3000)
	mk(daysAgo(10), "mail:far-pay", -3000)
	// A reversal that came two days after its payment: the payment is past the
	// cutoff, the reversal not yet, and the payment is never offered alone.
	late := mk(daysAgo(6), "mail:late-pay", -4200)
	lateRev := mk(daysAgo(4), "mail:late-rev", 4200)

	rev, err := s.Review(ctx, wid)
	if err != nil {
		t.Fatal(err)
	}
	if len(rev.Reversals) != 3 {
		t.Fatalf("reversals = %+v, want 3", rev.Reversals)
	}
	seen := map[int64]bool{}
	for _, p := range rev.Reversals {
		if p.Payment.Amount >= 0 || p.Reversal.Amount != -p.Payment.Amount {
			t.Errorf("pair = %+v, want the payment out and the reversal in", p)
		}
		seen[p.Payment.ID], seen[p.Reversal.ID] = true, true
	}
	for _, id := range []int64{p1, r1, p2, r2, late, lateRev} {
		if !seen[id] {
			t.Errorf("row %d is in no pair", id)
		}
	}
	if got := ids(rev.Unconfirmed); len(got) != 2 || !slices.Contains(got, far) {
		t.Errorf("unconfirmed = %v, want the two rows too far apart to pair", got)
	}
}

func TestMergingAMailRowKeepsTheBankRowWithTheMailsWords(t *testing.T) {
	s, q, raw, wid, acc := newMailReviewService(t)
	ctx := context.Background()
	fuel, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Fuel"})
	other, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Other"})
	mail, err := s.Create(ctx, wid, Input{
		AccountID: acc, Date: daysAgo(7), Amount: -10000, Status: StatusCleared, Memo: "Distributore Demo",
		CategoryID: iptr(fuel.ID), Tags: []string{"car"}, ImportRef: "mail:abc",
	})
	if err != nil {
		t.Fatal(err)
	}
	bank, err := s.Create(ctx, wid, Input{
		AccountID: acc, Date: daysAgo(6), Amount: -4000, Status: StatusReconciled, Memo: "PAGAMENTO POS STAZIONE DEMO",
		Info: "rif 42", CategoryID: iptr(other.ID), Tags: []string{"pos"}, ImportRef: "eb:xyz",
	})
	if err != nil {
		t.Fatal(err)
	}
	// The mail that wrote the mail row.
	if _, err := raw.ExecContext(ctx, `INSERT INTO mailboxes (wallet_id, provider, address) VALUES (?, 'imap', 'avvisi.demo@example.net')`, wid); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.ExecContext(ctx, `INSERT INTO mail_messages (mailbox_id, uid, message_id, received_at, transaction_id) VALUES (1, 1, '<1@example.net>', ?, ?)`, daysAgo(7), mail.ID); err != nil {
		t.Fatal(err)
	}

	if err := s.MergeMail(ctx, wid, mail.ID, bank.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, mail.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("the mail row is still there: %v", err)
	}
	got, err := s.Get(ctx, bank.ID)
	if err != nil {
		t.Fatal(err)
	}
	row, _ := q.GetTransaction(ctx, bank.ID)
	if got.Amount != -4000 || got.Date != daysAgo(6) || got.Status != StatusReconciled || row.ImportRef != "eb:xyz" || got.Info != "rif 42" {
		t.Errorf("the bank's side changed: %+v ref %q", got, row.ImportRef)
	}
	if got.Memo != "Distributore Demo" || got.CategoryID == nil || *got.CategoryID != fuel.ID {
		t.Errorf("the mail's words were not kept: memo %q category %v", got.Memo, got.CategoryID)
	}
	if !slices.Contains(got.Tags, "car") || !slices.Contains(got.Tags, "pos") {
		t.Errorf("tags = %v, want the mail's and the bank's", got.Tags)
	}
	var link sql.NullInt64
	if err := raw.QueryRowContext(ctx, `SELECT transaction_id FROM mail_messages`).Scan(&link); err != nil {
		t.Fatal(err)
	}
	if link.Int64 != bank.ID {
		t.Errorf("the mail points at %v, want the bank row %d", link, bank.ID)
	}
}

func TestMergeMailNeedsAMailRowAndABankRowOfOneAccount(t *testing.T) {
	s, q, _, wid, acc := newMailReviewService(t)
	ctx := context.Background()
	acc2, err := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: wid, Name: "Card", Type: "credit", CurrencyID: 1, Position: 2})
	if err != nil {
		t.Fatal(err)
	}
	mk := func(account int64, ref string) int64 {
		t.Helper()
		tx, err := s.Create(ctx, wid, Input{AccountID: account, Date: daysAgo(7), Amount: -100, ImportRef: ref})
		if err != nil {
			t.Fatal(err)
		}
		return tx.ID
	}
	mail, mail2, bank, manual, elsewhere := mk(acc, "mail:a"), mk(acc, "mail:b"), mk(acc, "eb:1"), mk(acc, ""), mk(acc2.ID, "eb:2")
	for _, c := range [][2]int64{{bank, mail}, {mail, mail2}, {mail, manual}, {mail, elsewhere}} {
		if err := s.MergeMail(ctx, wid, c[0], c[1]); !errors.Is(err, ErrNotMailPair) {
			t.Errorf("merge %v: err = %v, want ErrNotMailPair", c, err)
		}
	}
	if err := s.MergeMail(ctx, wid+1, mail, bank); !errors.Is(err, ErrNotFound) {
		t.Errorf("another wallet's merge: err = %v, want ErrNotFound", err)
	}
}
