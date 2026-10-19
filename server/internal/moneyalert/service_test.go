package moneyalert

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/goal"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/provenance"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// The watch runs against the real dispatcher: what it announces is read back
// from each person's bell, with the money events turned on.
type fixture struct {
	st      *store.Store
	q       *db.Queries
	n       *notify.Service
	w       *Service
	txns    *transaction.Service
	goals   *goal.Service
	budgets *budget.Service
	wallet  int64
	account int64
	a, b    int64
	now     time.Time
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ctx := context.Background()
	q := db.New(st.Write())
	f := &fixture{st: st, q: q, now: time.Now().UTC()}
	for i, name := range []string{"anna", "bruno"} {
		u, err := q.CreateUser(ctx, db.CreateUserParams{Username: name, PasswordHash: "x", Locale: "it"})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			f.a = u.ID
		} else {
			f.b = u.ID
		}
	}
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Casa"})
	f.wallet = w.ID
	_ = q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: f.a, Role: "owner"})
	_ = q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: f.b, Role: "member"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Conto corrente", Type: "checking", CurrencyID: cur.ID, Position: 1, InitialBalance: 15000,
	})
	f.account = acc.ID
	f.n = notify.NewService(st.Read(), st.Write(), nil)
	for _, u := range []int64{f.a, f.b} {
		for _, k := range []notify.Kind{notify.KindLargeTransaction, notify.KindLowBalance, notify.KindBudget, notify.KindGoal} {
			if err := f.n.SetPreference(ctx, u, k, notify.ChannelInApp, true); err != nil {
				t.Fatal(err)
			}
		}
	}
	f.txns = transaction.NewService(st.Write())
	f.goals = goal.NewServiceWithRead(st.Read(), st.Write())
	f.budgets = budget.NewServiceWithRead(st.Read(), st.Write())
	f.w = New(st.Read(), st.Write(), f.budgets, f.goals, f.n, nil)
	return f
}

func (f *fixture) sweep(t *testing.T) {
	t.Helper()
	if err := f.w.Sweep(context.Background(), f.now); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) spend(ctx context.Context, t *testing.T, amount int64, category *int64) {
	t.Helper()
	if _, err := f.txns.Create(ctx, f.wallet, transaction.Input{
		AccountID: f.account, Date: f.now.Format("2006-01-02"), Amount: amount, Memo: "Elettronica Demo", CategoryID: category,
	}); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) bell(t *testing.T, user int64, kind notify.Kind) []notify.Notification {
	t.Helper()
	items, _, err := f.n.List(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	var out []notify.Notification
	for _, n := range items {
		if n.Kind == kind {
			out = append(out, n)
		}
	}
	return out
}

func ptr(v int64) *int64 { return &v }

// A large expense is told to each reader whose threshold it reaches, when
// someone else or CloudBank wrote it: not their own, not a file import, and
// once only.
func TestLargeExpense(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	for _, u := range []int64{f.a, f.b} {
		if err := f.n.SetThreshold(ctx, u, f.wallet, notify.Threshold{AccountID: f.account, LargeOver: ptr(30000)}); err != nil {
			t.Fatal(err)
		}
	}
	f.spend(ctx, t, -99900, nil) // before the first look: history, not news
	f.sweep(t)

	f.spend(provenance.WithUser(ctx, f.a), t, -40000, nil)                  // anna's own
	f.spend(provenance.WithOrigin(ctx, provenance.Bank), t, -50000, nil)    // the bank
	f.spend(provenance.WithOrigin(ctx, provenance.Import), t, -60000, nil)  // a file import
	f.spend(provenance.WithUser(ctx, f.b), t, -10000, nil)                  // below the threshold
	f.spend(provenance.WithOrigin(ctx, provenance.Schedule), t, 70000, nil) // an income
	f.sweep(t)
	f.sweep(t)

	a := f.bell(t, f.a, notify.KindLargeTransaction)
	if len(a) != 1 || a[0].Title != "Uscita grande" || a[0].Body != "-500,00 € su Conto corrente: Elettronica Demo." ||
		!strings.HasPrefix(a[0].URL, "/transactions?account=") || a[0].WalletID != f.wallet {
		t.Fatalf("anna's bell = %+v", a)
	}
	if b := f.bell(t, f.b, notify.KindLargeTransaction); len(b) != 2 {
		t.Fatalf("bruno's bell = %+v, want anna's and the bank's", b)
	}
}

// A low balance is told once when today's balance drops below the
// threshold, and again only after it has been back above.
func TestLowBalance(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	if err := f.n.SetThreshold(ctx, f.a, f.wallet, notify.Threshold{AccountID: f.account, LowUnder: ptr(10000)}); err != nil {
		t.Fatal(err)
	}
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindLowBalance); len(got) != 0 {
		t.Fatalf("150 € is not below 100 €: %+v", got)
	}
	f.spend(ctx, t, -8000, nil)
	f.sweep(t)
	f.sweep(t)
	got := f.bell(t, f.a, notify.KindLowBalance)
	if len(got) != 1 || got[0].Body != "Conto corrente è a 70,00 €, sotto 100,00 €." {
		t.Fatalf("after dropping below = %+v", got)
	}
	f.spend(ctx, t, 5000, nil)
	f.sweep(t)
	f.spend(ctx, t, -5000, nil)
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindLowBalance); len(got) != 2 {
		t.Fatalf("after going back above and below = %d, want 2", len(got))
	}
	if got := f.bell(t, f.b, notify.KindLowBalance); len(got) != 0 {
		t.Fatalf("bruno set no threshold: %+v", got)
	}
}

// A budget is told at 80% and at 100%, once each, to every member; a wallet
// a member turned off tells them nothing.
func TestBudgetSteps(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	cat, _ := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.wallet, Name: "Spesa"})
	if err := f.budgets.SetCategoryBudget(ctx, f.wallet, cat.ID, 0, budget.Input{Mode: budget.ModeSame, Same: -10000}); err != nil {
		t.Fatal(err)
	}
	if err := f.n.SetWalletIncluded(ctx, f.b, f.wallet, false); err != nil {
		t.Fatal(err)
	}
	f.spend(ctx, t, -7000, &cat.ID)
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindBudget); len(got) != 0 {
		t.Fatalf("70%% told: %+v", got)
	}
	f.spend(ctx, t, -1500, &cat.ID)
	f.sweep(t)
	f.sweep(t)
	got := f.bell(t, f.a, notify.KindBudget)
	if len(got) != 1 || got[0].Title != "Budget all’80%" || got[0].Body != "Spesa: 85,00 € su 100,00 € questo mese." || got[0].URL != "/budget" {
		t.Fatalf("at 85%% = %+v", got)
	}
	f.spend(ctx, t, -2000, &cat.ID)
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindBudget); len(got) != 2 || got[0].Title != "Budget esaurito" {
		t.Fatalf("at 105%% = %+v", got)
	}
	if got := f.bell(t, f.b, notify.KindBudget); len(got) != 0 {
		t.Fatalf("bruno turned the wallet off: %+v", got)
	}
}

// A goal is told once when reached, and on the first of a month when its
// pace falls short of its monthly share.
func TestGoals(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.now = time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	date := "2027-04-30"
	behind, err := f.goals.Create(ctx, f.wallet, goal.Input{Name: "Vacanze", TargetAmount: 120000, TargetDate: &date})
	if err != nil {
		t.Fatal(err)
	}
	// 100 € a month lately, against 900 € left over 5 months.
	for _, d := range []string{"2026-08-10", "2026-09-10", "2026-10-10"} {
		if _, err := f.goals.AddContribution(ctx, f.wallet, behind.ID, d, 10000, ""); err != nil {
			t.Fatal(err)
		}
	}
	done, _ := f.goals.Create(ctx, f.wallet, goal.Input{Name: "Bici", TargetAmount: 30000})
	_, _ = f.goals.AddContribution(ctx, f.wallet, done.ID, "2026-10-20", 30000, "")
	f.sweep(t)
	f.sweep(t)
	got := f.bell(t, f.a, notify.KindGoal)
	if len(got) != 2 {
		t.Fatalf("goals told = %+v", got)
	}
	var reached, late bool
	for _, n := range got {
		reached = reached || n.Body == "Bici ha raggiunto il traguardo di 300,00 €."
		late = late || n.Body == "Vacanze richiede 180,00 € al mese; ultimamente ne sono entrati 100,00 €."
	}
	if !reached || !late {
		t.Fatalf("goals told = %+v", got)
	}

	// Mid-month, a late goal is not told again.
	f.now = time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindGoal); len(got) != 2 {
		t.Fatalf("mid-month = %d, want still 2", len(got))
	}
}

func TestShareAndPace(t *testing.T) {
	date := "2027-04-30"
	g := goal.Goal{TargetAmount: 120000, Saved: 30000, TargetDate: &date}
	moves := []goal.Contribution{{Date: "2026-08-10", Amount: 10001}, {Date: "2026-09-10", Amount: 10000}, {Date: "2026-10-10", Amount: 10000}, {Date: "2026-11-01", Amount: 50000}}
	need, pace := shareAndPace(g, moves, "2026-11-01", 2)
	if need != 18000 || pace != 10000 {
		t.Fatalf("need %d pace %d", need, pace)
	}
	past := "2026-10-01"
	g.TargetDate = &past
	if need, _ := shareAndPace(g, nil, "2026-11-01", 2); need != 90000 {
		t.Fatalf("past date need = %d", need)
	}
}

func TestTells(t *testing.T) {
	anna := int64(1)
	for _, c := range []struct {
		origin string
		by     int64
		want   bool
	}{
		{"", 0, false}, {"", 1, false}, {"", 2, true},
		{provenance.Import, 2, false}, {provenance.Bank, 1, true}, {provenance.Mail, 0, true}, {provenance.Schedule, 0, true},
	} {
		by := provenance.User(provenance.WithUser(context.Background(), c.by))
		if got := tells(c.origin, by, anna); got != c.want {
			t.Errorf("tells(%q, %d) = %v", c.origin, c.by, got)
		}
	}
}

// Every language CloudBank speaks has the money notifications' wording.
func TestAlertLanguages(t *testing.T) {
	for _, lang := range locale.Supported {
		x, ok := alertTexts[lang]
		if !ok || x.largeTitle == "" || x.large == "" || x.largeBare == "" || x.largePrivate == "" ||
			x.lowTitle == "" || x.low == "" || x.lowPrivate == "" || x.budget80Title == "" || x.budget100Title == "" ||
			x.budget == "" || x.budget80Private == "" || x.budget100Private == "" || x.reachedTitle == "" ||
			x.reached == "" || x.reachedPrivate == "" || x.behindTitle == "" || x.behind == "" || x.behindPrivate == "" {
			t.Errorf("no complete money wording for %q", lang)
		}
	}
}
