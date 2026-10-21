// Package insight writes the AI's reports (#696). The server computes every
// number, in SQL through the services that already compute them for the
// overview, the budget and the calendar; the model only turns them into a few
// paragraphs in the user's language. Reports are private to the user who asked
// for them, on the wallets they let the AI work on.
package insight

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/goal"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The kinds of report: one calendar month, one week from Monday to Sunday, one
// calendar year (#697).
const (
	KindMonthly = "monthly"
	KindWeekly  = "weekly"
	KindYearly  = "yearly"
)

// ErrBadPeriod is a month that is not a complete one from the last year.
var ErrBadPeriod = errors.New("insight: choose a complete month from the last twelve")

// ErrNoData is a period with nothing in it to report on.
var ErrNoData = errors.New("insight: the period has no transactions")

// Asker is the AI's one way to the model.
type Asker interface {
	Ask(ctx context.Context, c ai.Call) (ai.Answer, error)
}

// Service builds and keeps the reports.
type Service struct {
	q, rq    *db.Queries
	ai       Asker
	notify   Notifier
	reports  *report.Service
	budgets  *budget.Service
	calendar *schedule.Service
	goals    *goal.Service
	rules    *assignment.Service
	now      func() time.Time
}

// NewService wires the report writer to the services that hold the numbers.
func NewService(read, write *sql.DB, asker Asker, reports *report.Service,
	budgets *budget.Service, calendar *schedule.Service) *Service {
	return &Service{
		q: db.New(write), rq: db.New(read), ai: asker, reports: reports,
		budgets: budgets, calendar: calendar, now: time.Now,
	}
}

// Currency is how the report's amounts are written.
type Currency struct {
	Code         string `json:"code"`
	Symbol       string `json:"symbol"`
	SymbolPrefix bool   `json:"symbolPrefix"`
	DecimalChar  string `json:"decimalChar"`
	GroupChar    string `json:"groupChar"`
	FracDigits   int    `json:"fracDigits"`
}

// Figures are a period's money in and out, as positive amounts, and what was
// kept (in − out).
type Figures struct {
	Income  int64 `json:"income"`
	Expense int64 `json:"expense"`
	Net     int64 `json:"net"`
}

// CategoryFigure is one category's spending in the period, the one before, and
// on average over the six before it (none for a year).
type CategoryFigure struct {
	Name   string `json:"name"`
	Amount int64  `json:"amount"`
	Prev   int64  `json:"prev"`
	Avg    int64  `json:"avg"`
}

// Expense is one of the period's largest expenses.
type Expense struct {
	Date   string `json:"date"`
	Payee  string `json:"payee"`
	Amount int64  `json:"amount"`
}

// OverBudget is a category that spent more than its budget.
type OverBudget struct {
	Name   string `json:"name"`
	Budget int64  `json:"budget"`
	Actual int64  `json:"actual"`
}

// Bill is a schedule falling due after the period: the month after a month, the
// seven days after a week.
type Bill struct {
	Name   string `json:"name"`
	Date   string `json:"date"`
	Amount int64  `json:"amount"`
}

// Basis is every number a report rests on, in the wallet's base currency:
// what "Why?" shows, and all the model is told. Period is the month
// (YYYY-MM), the week's Monday (YYYY-MM-DD) or the year (YYYY).
type Basis struct {
	Kind       string           `json:"kind"`
	Period     string           `json:"period"`
	Currency   Currency         `json:"currency"`
	Figures    Figures          `json:"figures"`
	Prev       Figures          `json:"prev"`
	Avg        Figures          `json:"avg"`
	Categories []CategoryFigure `json:"categories"`
	Largest    []Expense        `json:"largest"`
	OverBudget []OverBudget     `json:"overBudget"`
	Bills      []Bill           `json:"bills"`
}

// Report is a report as the page shows it.
type Report struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	Period    string `json:"period"`
	Body      string `json:"body"`
	Basis     Basis  `json:"basis"`
	Model     string `json:"model"`
	Feedback  int64  `json:"feedback"`
	CreatedAt string `json:"createdAt"`
}

// lastMonths is how far back a report can be asked for.
const lastMonths = 12

// checkPeriod accepts a complete month (YYYY-MM) from the last twelve.
func (s *Service) checkPeriod(period string) (time.Time, error) {
	m, err := time.Parse("2006-01", period)
	if err != nil {
		return time.Time{}, ErrBadPeriod
	}
	n := s.now().UTC()
	this := time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, time.UTC)
	if !m.Before(this) || m.Before(this.AddDate(0, -lastMonths, 0)) {
		return time.Time{}, ErrBadPeriod
	}
	return m, nil
}

const day = "2006-01-02"

// span is the stretch of time a report is about, and what it is set against.
type span struct {
	kind, period       string
	from, to           time.Time // the period, both days included
	prevFrom, prevTo   time.Time // the one before
	avgFrom            time.Time // the average runs from here to prevTo...
	avgN               int64     // ...over this many periods; 0 is none
	billsFrom, billsTo time.Time // zero: no bills
	budgets            bool
}

func monthSpan(m time.Time) span {
	return span{
		kind: KindMonthly, period: m.Format("2006-01"), from: m, to: m.AddDate(0, 1, -1),
		prevFrom: m.AddDate(0, -1, 0), prevTo: m.AddDate(0, 0, -1), avgFrom: m.AddDate(0, -6, 0), avgN: 6,
		billsFrom: m.AddDate(0, 1, 0), billsTo: m.AddDate(0, 2, -1), budgets: true,
	}
}

// weekSpan is the week starting on Monday mon.
func weekSpan(mon time.Time) span {
	return span{
		kind: KindWeekly, period: mon.Format(day), from: mon, to: mon.AddDate(0, 0, 6),
		prevFrom: mon.AddDate(0, 0, -7), prevTo: mon.AddDate(0, 0, -1), avgFrom: mon.AddDate(0, 0, -42), avgN: 6,
		billsFrom: mon.AddDate(0, 0, 7), billsTo: mon.AddDate(0, 0, 13),
	}
}

func yearSpan(y int) span {
	jan := time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC)
	return span{
		kind: KindYearly, period: strconv.Itoa(y), from: jan, to: jan.AddDate(1, 0, -1),
		prevFrom: jan.AddDate(-1, 0, 0), prevTo: jan.AddDate(0, 0, -1),
	}
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func convertToBase(amount int64, cur, base db.Currency) int64 {
	if cur.ID == base.ID || cur.ID == 0 {
		return amount
	}
	scaled := float64(amount) * cur.Rate * math.Pow10(int(base.FracDigits)-int(cur.FracDigits))
	return int64(math.Round(scaled))
}

// figures is the money in and out from one day to another, as the overview's
// chart counts it: transfers and categories kept out of the reports left out.
func (s *Service) figures(ctx context.Context, walletID int64, from, to time.Time, curByID map[int64]db.Currency, base db.Currency) (Figures, error) {
	rows, err := s.rq.MonthlyIncomeExpense(ctx, db.MonthlyIncomeExpenseParams{
		WalletID: walletID, FromDate: from.Format(day), ToDate: to.Format(day),
	})
	if err != nil {
		return Figures{}, err
	}
	var f Figures
	for _, r := range rows {
		f.Income += convertToBase(r.Income, curByID[r.CurrencyID], base)
		f.Expense -= convertToBase(r.Expense, curByID[r.CurrencyID], base)
	}
	f.Net = f.Income - f.Expense
	return f, nil
}

// Basis computes the numbers for a month of a wallet.
func (s *Service) Basis(ctx context.Context, walletID int64, m time.Time) (Basis, error) {
	return s.basis(ctx, walletID, monthSpan(m))
}

func (s *Service) basis(ctx context.Context, walletID int64, sp span) (Basis, error) {
	from, to := sp.from.Format(day), sp.to.Format(day)
	out := Basis{Kind: sp.kind, Period: sp.period, Categories: []CategoryFigure{}, Largest: []Expense{}, OverBudget: []OverBudget{}, Bills: []Bill{}}

	currencies, err := s.rq.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return Basis{}, err
	}
	curByID := map[int64]db.Currency{}
	var base db.Currency
	for _, c := range currencies {
		curByID[c.ID] = c
		if c.IsBase != 0 {
			base = c
		}
	}
	out.Currency = Currency{
		Code: base.IsoCode, Symbol: base.Symbol, SymbolPrefix: base.SymbolPrefix != 0,
		DecimalChar: base.DecimalChar, GroupChar: base.GroupChar, FracDigits: int(base.FracDigits),
	}

	// The period, the one before, and the average of the six before.
	if out.Figures, err = s.figures(ctx, walletID, sp.from, sp.to, curByID, base); err != nil {
		return Basis{}, err
	}
	if out.Figures.Income == 0 && out.Figures.Expense == 0 {
		return Basis{}, ErrNoData
	}
	if out.Prev, err = s.figures(ctx, walletID, sp.prevFrom, sp.prevTo, curByID, base); err != nil {
		return Basis{}, err
	}
	if sp.avgN > 0 {
		six, err := s.figures(ctx, walletID, sp.avgFrom, sp.prevTo, curByID, base)
		if err != nil {
			return Basis{}, err
		}
		out.Avg = Figures{Income: six.Income / sp.avgN, Expense: six.Expense / sp.avgN}
		out.Avg.Net = out.Avg.Income - out.Avg.Expense
	}

	// Spending by category: the period, the one before, the six before.
	cats, err := s.rq.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return Basis{}, err
	}
	names := map[int64]string{}
	hidden := map[int64]bool{}
	for _, c := range cats {
		names[c.ID] = c.Name
		hidden[c.ID] = c.NoReport != 0 || c.IsIncome != 0
	}
	for _, c := range cats {
		if c.ParentID.Valid {
			names[c.ID] = names[c.ParentID.Int64] + ":" + c.Name
			hidden[c.ID] = hidden[c.ID] || hidden[c.ParentID.Int64]
		}
	}
	spent := func(from, to string) (map[int64]int64, error) {
		res, err := s.reports.CategoryActivity(ctx, walletID, from, to)
		if err != nil {
			return nil, err
		}
		out := map[int64]int64{}
		for _, a := range res.Categories {
			if !hidden[a.CategoryID] && a.Amount < 0 {
				out[a.CategoryID] = -a.Amount
			}
		}
		return out, nil
	}
	now, err := spent(from, to)
	if err != nil {
		return Basis{}, err
	}
	prev, err := spent(sp.prevFrom.Format(day), sp.prevTo.Format(day))
	if err != nil {
		return Basis{}, err
	}
	six := map[int64]int64{}
	if sp.avgN > 0 {
		if six, err = spent(sp.avgFrom.Format(day), sp.prevTo.Format(day)); err != nil {
			return Basis{}, err
		}
	}
	for id, v := range now {
		c := CategoryFigure{Name: names[id], Amount: v, Prev: prev[id]}
		if sp.avgN > 0 {
			c.Avg = six[id] / sp.avgN
		}
		out.Categories = append(out.Categories, c)
	}
	sort.Slice(out.Categories, func(i, j int) bool {
		if out.Categories[i].Amount != out.Categories[j].Amount {
			return out.Categories[i].Amount > out.Categories[j].Amount
		}
		return out.Categories[i].Name < out.Categories[j].Name
	})
	if len(out.Categories) > 5 {
		out.Categories = out.Categories[:5]
	}

	// The largest expenses, converted, the top three.
	rows, err := s.rq.LargestExpenses(ctx, db.LargestExpensesParams{WalletID: walletID, FromDate: from, ToDate: to})
	if err != nil {
		return Basis{}, err
	}
	for _, r := range rows {
		out.Largest = append(out.Largest, Expense{Date: r.Date, Payee: r.Payee, Amount: -convertToBase(r.Amount, curByID[r.CurrencyID], base)})
	}
	sort.SliceStable(out.Largest, func(i, j int) bool { return out.Largest[i].Amount > out.Largest[j].Amount })
	if len(out.Largest) > 3 {
		out.Largest = out.Largest[:3]
	}

	// The budgets a month went over; budgets are monthly, so only a month's.
	if sp.budgets {
		b, err := s.budgets.Report(ctx, walletID, from, to, to)
		if err != nil {
			return Basis{}, err
		}
		for _, r := range b.Rows {
			if r.IsIncome || !r.Budgeted || r.Budget == 0 || abs(r.Actual) <= abs(r.Budget) {
				continue
			}
			out.OverBudget = append(out.OverBudget, OverBudget{Name: r.Name, Budget: abs(r.Budget), Actual: abs(r.Actual)})
		}
	}

	// The schedules due after the period: what is coming.
	if sp.billsFrom.IsZero() {
		return out, nil
	}
	cal, err := s.calendar.Calendar(ctx, walletID, sp.billsFrom.Format(day), sp.billsTo.Format(day), s.now().UTC())
	if err != nil {
		return Basis{}, err
	}
	accounts, err := s.rq.ListAccountsForWallet(ctx, walletID)
	if err != nil {
		return Basis{}, err
	}
	accCur := map[int64]db.Currency{}
	for _, a := range accounts {
		accCur[a.ID] = curByID[a.CurrencyID]
	}
	for _, o := range cal.Occurrences {
		if o.IsTransfer || o.Amount >= 0 {
			continue
		}
		out.Bills = append(out.Bills, Bill{Name: o.Name, Date: o.Date, Amount: -convertToBase(o.Amount, accCur[o.AccountID], base)})
		if len(out.Bills) == 10 {
			break
		}
	}
	return out, nil
}

// plain writes an amount for the model: no grouping, so a large amount is not
// mistaken for a card number and hidden.
func (b Basis) plain(v int64) string { return b.Currency.plain(v) }

func (c Currency) plain(v int64) string {
	return money.Format(v, c.FracDigits, ".", "", "", false) + " " + c.Code
}

// languages names the app's languages for the model.
var languages = map[string]string{
	"en": "English", "it": "Italian", "es": "Spanish", "fr": "French", "de": "German", "pt-BR": "Brazilian Portuguese",
}

const system = "You write a short money report for the owner of a personal-finance wallet, on a month, " +
	"a week or a year. Use only the numbers given: never invent one, and compute nothing but simple " +
	"differences and percentages between them. Write 3 to 5 short paragraphs of plain text, with no " +
	"headings, no lists and no markdown, separated by a blank line. Say what changed and what stands " +
	"out; give no investment advice. Write amounts as the reader's language writes them, with the " +
	"currency symbol."

// words are how the prompt names a kind of period.
var words = map[string]struct{ unit, units, bills string }{
	KindMonthly: {"month", "months", "Bills due next month"},
	KindWeekly:  {"week", "weeks", "Bills due in the next 7 days"},
	KindYearly:  {"year", "years", ""},
}

// prompt is what the model is told about a period: the numbers, line by line.
func (b Basis) prompt(lang string) string {
	var w strings.Builder
	fig := func(f Figures) string {
		return fmt.Sprintf("income %s, expenses %s, kept %s", b.plain(f.Income), b.plain(f.Expense), b.plain(f.Net))
	}
	wd := words[b.Kind]
	what := b.Period
	if b.Kind == KindWeekly {
		if mon, err := time.Parse(day, b.Period); err == nil {
			what = b.Period + " to " + mon.AddDate(0, 0, 6).Format(day)
		}
	}
	fmt.Fprintf(&w, "%s%s: %s (currency %s, symbol %s)\n", strings.ToUpper(wd.unit[:1]), wd.unit[1:], what, b.Currency.Code, b.Currency.Symbol)
	fmt.Fprintf(&w, "This %s: %s\n", wd.unit, fig(b.Figures))
	fmt.Fprintf(&w, "The %s before: %s\n", wd.unit, fig(b.Prev))
	if b.Kind != KindYearly {
		fmt.Fprintf(&w, "Average of the six %s before: %s\n", wd.units, fig(b.Avg))
	}
	if len(b.Categories) > 0 {
		if b.Kind == KindYearly {
			w.WriteString("Spending by category (this year / the year before):\n")
		} else {
			fmt.Fprintf(&w, "Spending by category (this %s / the %s before / six-%s average):\n", wd.unit, wd.unit, wd.unit)
		}
		for _, c := range b.Categories {
			if b.Kind == KindYearly {
				fmt.Fprintf(&w, "- %s: %s / %s\n", c.Name, b.plain(c.Amount), b.plain(c.Prev))
			} else {
				fmt.Fprintf(&w, "- %s: %s / %s / %s\n", c.Name, b.plain(c.Amount), b.plain(c.Prev), b.plain(c.Avg))
			}
		}
	}
	if len(b.Largest) > 0 {
		w.WriteString("Largest expenses:\n")
		for _, e := range b.Largest {
			payee := e.Payee
			if payee == "" {
				payee = "(no payee)"
			}
			fmt.Fprintf(&w, "- %s %s %s\n", e.Date, payee, b.plain(e.Amount))
		}
	}
	if len(b.OverBudget) > 0 {
		w.WriteString("Budgets gone over:\n")
		for _, o := range b.OverBudget {
			fmt.Fprintf(&w, "- %s: spent %s of %s\n", o.Name, b.plain(o.Actual), b.plain(o.Budget))
		}
	}
	if len(b.Bills) > 0 && wd.bills != "" {
		w.WriteString(wd.bills + ":\n")
		for _, x := range b.Bills {
			fmt.Fprintf(&w, "- %s %s %s\n", x.Date, x.Name, b.plain(x.Amount))
		}
	}
	name := languages[lang]
	if name == "" {
		name = "English"
	}
	fmt.Fprintf(&w, "\nWrite the report in %s.", name)
	return w.String()
}

// bodyMax bounds the text kept from the model.
const bodyMax = 6000

// Generate writes the monthly report for period (YYYY-MM) on a wallet and
// keeps it. confirm is the user's yes to a call past this month's limit.
func (s *Service) Generate(ctx context.Context, userID, walletID int64, period string, confirm bool) (Report, error) {
	m, err := s.checkPeriod(period)
	if err != nil {
		return Report{}, err
	}
	return s.write(ctx, userID, walletID, monthSpan(m), confirm)
}

// write computes a period's numbers, has the model write about them and keeps
// the report.
func (s *Service) write(ctx context.Context, userID, walletID int64, sp span, confirm bool) (Report, error) {
	basis, err := s.basis(ctx, walletID, sp)
	if err != nil {
		return Report{}, err
	}
	lang := "en"
	if u, err := s.rq.GetUserByID(ctx, userID); err == nil && u.Locale != "" {
		lang = u.Locale
	}
	ans, err := s.ai.Ask(ctx, ai.Call{
		UserID: userID, WalletID: walletID, Feature: ai.FeatureReports, Confirm: confirm,
		System: system, User: basis.prompt(lang), MaxTokens: 900,
	})
	if err != nil {
		return Report{}, err
	}
	body := strings.TrimSpace(ans.Text)
	if len(body) > bodyMax {
		body = strings.ToValidUTF8(body[:bodyMax], "")
	}
	if body == "" {
		return Report{}, errors.New("ai: the model wrote nothing")
	}
	raw, err := json.Marshal(basis)
	if err != nil {
		return Report{}, err
	}
	row, err := s.q.InsertAIReport(ctx, db.InsertAIReportParams{
		UserID: userID, WalletID: walletID, Kind: sp.kind, Period: sp.period,
		Body: body, Basis: string(raw), Model: ans.Model,
	})
	if err != nil {
		return Report{}, err
	}
	return Report{
		ID: row.ID, Kind: row.Kind, Period: row.Period, Body: row.Body, Basis: basis,
		Model: row.Model, Feedback: row.Feedback, CreatedAt: row.CreatedAt,
	}, nil
}

// List returns the user's reports on a wallet, newest first.
func (s *Service) List(ctx context.Context, userID, walletID int64) ([]Report, error) {
	rows, err := s.rq.ListAIReports(ctx, db.ListAIReportsParams{UserID: userID, WalletID: walletID})
	if err != nil {
		return nil, err
	}
	out := make([]Report, 0, len(rows))
	for _, r := range rows {
		rep := Report{
			ID: r.ID, Kind: r.Kind, Period: r.Period, Body: r.Body, Model: r.Model,
			Feedback: r.Feedback, CreatedAt: r.CreatedAt,
		}
		_ = json.Unmarshal([]byte(r.Basis), &rep.Basis)
		out = append(out, rep)
	}
	return out, nil
}

// ErrNotFound is a report that is not the user's on this wallet.
var ErrNotFound = errors.New("insight: report not found")

// SetFeedback records a thumb: 1 up, -1 down, 0 neither.
func (s *Service) SetFeedback(ctx context.Context, userID, walletID, id, feedback int64) error {
	if feedback < -1 || feedback > 1 {
		return fmt.Errorf("insight: feedback is -1, 0 or 1")
	}
	n, err := s.q.SetAIReportFeedback(ctx, db.SetAIReportFeedbackParams{Feedback: feedback, ID: id, UserID: userID, WalletID: walletID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
