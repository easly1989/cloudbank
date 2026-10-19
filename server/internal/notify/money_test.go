package notify

import (
	"context"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// A wallet turned off tells nothing; amounts stay in the bell but leave the
// app only for someone who lets them.
func TestWalletFilterAndPrivateBody(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	w, _ := f.q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	_ = f.q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: u.ID, Role: "owner"})
	e := Event{Kind: KindBills, Title: "Large", Body: "-480,00 € on Checking", Private: "An expense on Checking", WalletID: w.ID}

	if err := f.svc.SetWalletIncluded(ctx, u.ID, w.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Notify(ctx, u.ID, e); err != nil {
		t.Fatal(err)
	}
	if items, _ := f.bell(t, u.ID); len(items) != 0 {
		t.Fatalf("a wallet turned off told %+v", items)
	}
	if st, _ := f.svc.Wallet(ctx, u.ID, w.ID); st.Included {
		t.Fatal("the wallet still reads included")
	}

	_ = f.svc.SetWalletIncluded(ctx, u.ID, w.ID, true)
	_ = f.svc.Notify(ctx, u.ID, e)
	if err := f.svc.SetAmountsOutside(ctx, u.ID, false); err != nil {
		t.Fatal(err)
	}
	_ = f.svc.Notify(ctx, u.ID, e)
	f.svc.deliverDue(ctx)
	items, _ := f.bell(t, u.ID)
	if len(items) != 2 || items[0].Body != e.Body || items[1].Body != e.Body {
		t.Fatalf("bell = %+v", items)
	}
	if len(f.push.got) != 2 || f.push.got[0].Body != e.Body || f.push.got[1].Body != e.Private {
		t.Fatalf("push got %+v", f.push.got)
	}
	if st, _ := f.svc.GetSettings(ctx, u.ID); st.AmountsOutside {
		t.Fatal("amounts outside still on")
	}
}

// Thresholds are saved per person and account, only on an account of the
// wallet, with a large-expense threshold above zero.
func TestThresholds(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u, v := f.user(t, "u"), f.user(t, "v")
	var acc [2]int64
	var wid [2]int64
	for i := range 2 {
		w, _ := f.q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
		cur, _ := f.q.InsertCurrency(ctx, db.InsertCurrencyParams{WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€", DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1})
		a, _ := f.q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "A", Type: "checking", CurrencyID: cur.ID})
		wid[i], acc[i] = w.ID, a.ID
	}
	over, under, zero := int64(30000), int64(-5000), int64(0)
	if err := f.svc.SetThreshold(ctx, u.ID, wid[0], Threshold{AccountID: acc[1], LargeOver: &over}); !errors.Is(err, ErrUnknownAccount) {
		t.Fatalf("another wallet's account = %v", err)
	}
	if err := f.svc.SetThreshold(ctx, u.ID, wid[0], Threshold{AccountID: acc[0], LargeOver: &zero}); !errors.Is(err, ErrBadThreshold) {
		t.Fatalf("zero threshold = %v", err)
	}
	if err := f.svc.SetThreshold(ctx, u.ID, wid[0], Threshold{AccountID: acc[0], LargeOver: &over, LowUnder: &under}); err != nil {
		t.Fatal(err)
	}
	st, _ := f.svc.Wallet(ctx, u.ID, wid[0])
	if !st.Included || len(st.Thresholds) != 1 || *st.Thresholds[0].LargeOver != over || *st.Thresholds[0].LowUnder != under {
		t.Fatalf("u's wallet = %+v", st)
	}
	if st, _ := f.svc.Wallet(ctx, v.ID, wid[0]); len(st.Thresholds) != 0 {
		t.Fatalf("v sees u's thresholds: %+v", st)
	}
	// Clearing both leaves nothing listed.
	_ = f.svc.SetThreshold(ctx, u.ID, wid[0], Threshold{AccountID: acc[0]})
	if st, _ := f.svc.Wallet(ctx, u.ID, wid[0]); len(st.Thresholds) != 0 {
		t.Fatalf("cleared = %+v", st)
	}
}
