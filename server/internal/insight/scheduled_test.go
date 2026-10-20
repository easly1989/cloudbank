package insight

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// A pretend provider that answers every report, unless told to fail, and
// counts what it was asked.
type provider struct {
	mu    sync.Mutex
	asked []string
	down  bool
}

func (p *provider) calls() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.asked...)
}

// Each scheduled report is written on its day, at 07:00 in the person's time
// zone, once; nothing goes out with the reports off; at the limit the period is
// skipped, said once, and not caught up.
func TestScheduledReports(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	u, err := q.CreateUser(ctx, db.CreateUserParams{Username: "anna", PasswordHash: "x", Locale: "it"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Write().ExecContext(ctx, "UPDATE users SET is_admin = 1 WHERE id = ?", u.ID); err != nil {
		t.Fatal(err)
	}
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Casa"})
	_ = q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: u.ID, Role: "owner"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€", DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "Conto", Type: "checking", CurrencyID: cur.ID, Position: 1})
	txns := transaction.NewService(st.Write())
	for _, x := range []struct {
		date   string
		amount int64
	}{
		{"2026-03-10", -5000}, {"2026-09-02", 250000}, {"2026-09-09", -64050},
		{"2026-10-14", -12000}, {"2027-01-12", -3000}, {"2027-02-10", -2000},
	} {
		if _, err := txns.Create(ctx, w.ID, transaction.Input{AccountID: acc.ID, Date: x.date, Amount: x.amount, Memo: "a private note"}); err != nil {
			t.Fatal(err)
		}
	}

	model := &provider{}
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		model.mu.Lock()
		model.asked = append(model.asked, string(b))
		down := model.down
		model.mu.Unlock()
		if down {
			http.Error(rw, "down", http.StatusBadGateway)
			return
		}
		_, _ = rw.Write([]byte(`{"choices":[{"message":{"content":"Un mese tranquillo."}}]}`))
	}))
	defer srv.Close()
	aisvc := ai.NewService(st.Read(), st.Write())
	key := "k"
	settings := func(in ai.SettingsInput) {
		t.Helper()
		in.Enabled, in.BaseURL, in.Model, in.APIKey = true, srv.URL, "m", &key
		if _, err := aisvc.UpdateSettings(ctx, u.ID, true, in); err != nil {
			t.Fatal(err)
		}
	}
	settings(ai.SettingsInput{Features: &ai.Features{Reports: true}, Schedule: &ai.Schedule{Weekly: true, Yearly: true}})

	n := notify.NewService(st.Read(), st.Write(), nil)
	ns, _ := n.GetSettings(ctx, u.ID)
	ns.Timezone = "Europe/Rome"
	if err := n.SetSettings(ctx, u.ID, ns); err != nil {
		t.Fatal(err)
	}
	svc := NewService(st.Read(), st.Write(), aisvc, report.NewService(st.Read()), budget.NewServiceWithRead(st.Read(), st.Write()),
		schedule.NewServiceWithRead(st.Read(), st.Write(), txns, nil, slog.Default()))
	svc.SetNotify(n)
	var clock time.Time
	svc.now = func() time.Time { return clock }
	run := func(at time.Time) {
		t.Helper()
		clock = at
		if err := svc.RunScheduled(ctx); err != nil && !model.down {
			t.Fatal(err)
		}
	}
	reports := func() []Report {
		t.Helper()
		r, err := svc.List(ctx, u.ID, w.ID)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	bell := func() []notify.Notification {
		t.Helper()
		items, _, err := n.List(ctx, u.ID)
		if err != nil {
			t.Fatal(err)
		}
		var out []notify.Notification
		for _, x := range items {
			if x.Kind == notify.KindAIReport {
				out = append(out, x)
			}
		}
		return out
	}

	// Monday 19 October 2026, 06:30 in Rome: September is due (it has been all
	// month), the week of the 12th not before 07:00.
	run(time.Date(2026, 10, 19, 4, 30, 0, 0, time.UTC))
	r := reports()
	if len(r) != 1 || r[0].Kind != KindMonthly || r[0].Period != "2026-09" {
		t.Fatalf("at 06:30 = %+v", r)
	}
	if strings.Contains(model.calls()[0], "private note") {
		t.Fatal("the memo went to the model")
	}
	b := bell()
	if len(b) != 1 || b[0].Title != "Resoconto di settembre pronto" || b[0].Body != "Casa: lo trovi in Approfondimenti AI." ||
		b[0].WalletID != w.ID || b[0].URL != "/insights?report="+strconv.FormatInt(r[0].ID, 10) {
		t.Fatalf("bell = %+v", b)
	}

	// 07:10 in Rome: the week's report; run again, nothing more.
	run(time.Date(2026, 10, 19, 5, 10, 0, 0, time.UTC))
	run(time.Date(2026, 10, 19, 6, 10, 0, 0, time.UTC))
	r = reports()
	if len(r) != 2 || r[0].Kind != KindWeekly || r[0].Period != "2026-10-12" || len(model.calls()) != 2 {
		t.Fatalf("after 07:00 = %+v, %d calls", r, len(model.calls()))
	}
	if !strings.Contains(model.calls()[1], "Week: 2026-10-12 to 2026-10-18") || strings.Contains(model.calls()[1], "Budgets") {
		t.Fatalf("the week's prompt: %s", model.calls()[1])
	}
	if b := bell(); len(b) != 2 || b[0].Title != "Resoconto della settimana pronto" {
		t.Fatalf("bell = %+v", b)
	}

	// 1 January 2027: the year, from 07:00. December and the week of the 21st
	// have nothing in them: kept as such, nothing asked.
	run(time.Date(2027, 1, 1, 5, 30, 0, 0, time.UTC))
	if len(reports()) != 2 {
		t.Fatalf("before 07:00 on the 1st = %+v", reports())
	}
	run(time.Date(2027, 1, 1, 6, 10, 0, 0, time.UTC))
	r = reports()
	if len(r) != 3 || r[0].Kind != KindYearly || r[0].Period != "2026" || len(model.calls()) != 3 {
		t.Fatalf("the year = %+v, %d calls", r, len(model.calls()))
	}
	if r[0].Basis.Avg != (Figures{}) || !strings.Contains(model.calls()[2], "The year before") {
		t.Fatalf("the year's basis = %+v", r[0].Basis)
	}
	if b := bell(); b[0].Title != "Resoconto del 2026 pronto" {
		t.Fatalf("bell = %+v", b[0])
	}

	// At the limit: January is skipped, said once, and not caught up after.
	limit := int64(1)
	settings(ai.SettingsInput{MonthlyLimit: &limit})
	run(time.Date(2027, 2, 2, 9, 0, 0, 0, time.UTC))
	run(time.Date(2027, 2, 2, 10, 0, 0, 0, time.UTC))
	if len(reports()) != 3 || len(model.calls()) != 3 {
		t.Fatalf("at the limit = %d reports, %d calls", len(reports()), len(model.calls()))
	}
	b = bell()
	if len(b) != 4 || b[0].Title != "Resoconto di gennaio non scritto" || b[0].URL != "/settings/ai" {
		t.Fatalf("bell at the limit = %+v", b)
	}
	limit = 200
	settings(ai.SettingsInput{MonthlyLimit: &limit})
	run(time.Date(2027, 2, 2, 11, 0, 0, 0, time.UTC))
	if len(reports()) != 3 {
		t.Fatal("January was caught up after the limit")
	}

	// The provider down at 07:00: February is tried again, and written, later.
	model.down = true
	run(time.Date(2027, 3, 1, 6, 10, 0, 0, time.UTC))
	model.down = false
	if len(reports()) != 3 || len(model.calls()) != 4 {
		t.Fatalf("with the provider down = %d reports, %d calls", len(reports()), len(model.calls()))
	}
	run(time.Date(2027, 3, 1, 7, 10, 0, 0, time.UTC))
	if r := reports(); len(r) != 4 || r[0].Period != "2027-02" {
		t.Fatalf("after the provider is back = %+v", r)
	}

	// Reports off: nothing goes out, March is not written.
	settings(ai.SettingsInput{Features: &ai.Features{}})
	run(time.Date(2027, 4, 5, 9, 0, 0, 0, time.UTC))
	if len(model.calls()) != 5 {
		t.Fatalf("with reports off = %d calls", len(model.calls()))
	}
}

// Every language CloudBank speaks has the notifications' wording.
func TestReportNotesInEveryLanguage(t *testing.T) {
	for _, l := range locale.Supported {
		if _, ok := reportNotes[l]; !ok {
			t.Errorf("no wording for %s", l)
		}
	}
}
