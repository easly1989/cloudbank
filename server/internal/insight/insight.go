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
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/dashboard"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// KindMonthly is a report on one calendar month.
const KindMonthly = "monthly"

// ErrBadPeriod is a month that is not a complete one from the last year.
var ErrBadPeriod = errors.New("insight: choose a complete month from the last twelve")

// ErrNoData is a month with nothing in it to report on.
var ErrNoData = errors.New("insight: the month has no transactions")

// Asker is the AI's one way to the model.
type Asker interface {
	Ask(ctx context.Context, c ai.Call) (ai.Answer, error)
}

// Service builds and keeps the reports.
type Service struct {
	q, rq    *db.Queries
	ai       Asker
	dash     *dashboard.Service
	reports  *report.Service
	budgets  *budget.Service
	calendar *schedule.Service
	now      func() time.Time
}

// NewService wires the report writer to the services that hold the numbers.
func NewService(read, write *sql.DB, asker Asker, dash *dashboard.Service, reports *report.Service,
	budgets *budget.Service, calendar *schedule.Service) *Service {
	return &Service{
		q: db.New(write), rq: db.New(read), ai: asker, dash: dash, reports: reports,
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

// Figures are a month's money in and out, as positive amounts, and what was
// kept (in − out).
type Figures struct {
	Income  int64 `json:"income"`
	Expense int64 `json:"expense"`
	Net     int64 `json:"net"`
}

// CategoryFigure is one category's spending this month, the month before, and
// on average over the six months before this one.
type CategoryFigure struct {
	Name   string `json:"name"`
	Amount int64  `json:"amount"`
	Prev   int64  `json:"prev"`
	Avg    int64  `json:"avg"`
}

// Expense is one of the month's largest expenses.
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

// Bill is a schedule falling due the month after.
type Bill struct {
	Name   string `json:"name"`
	Date   string `json:"date"`
	Amount int64  `json:"amount"`
}

// Basis is every number a monthly report rests on, in the wallet's base
// currency: what "Why?" shows, and all the model is told.
type Basis struct {
	Month      string           `json:"month"`
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

func monthRange(m time.Time) (string, string) {
	return m.Format(day), m.AddDate(0, 1, -1).Format(day)
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

// Basis computes the numbers for a month of a wallet.
func (s *Service) Basis(ctx context.Context, walletID int64, m time.Time) (Basis, error) {
	from, to := monthRange(m)
	period := m.Format("2006-01")
	out := Basis{Month: period, Categories: []CategoryFigure{}, Largest: []Expense{}, OverBudget: []OverBudget{}, Bills: []Bill{}}

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

	// The month, the one before, and the six before it, from the overview's
	// income and expense series (transfers left out). The series ends today, so
	// it is asked for enough months to reach back six before the report's.
	n := s.now().UTC()
	back := (n.Year()-m.Year())*12 + int(n.Month()-m.Month()) + 7
	dash, err := s.dash.Build(ctx, walletID, from, to, dashboard.GroupByCategory, back)
	if err != nil {
		return Basis{}, err
	}
	byMonth := map[string]Figures{}
	for _, p := range dash.IncomeExpense {
		byMonth[p.Month] = Figures{Income: p.Income, Expense: p.Expense, Net: p.Income - p.Expense}
	}
	out.Figures = byMonth[period]
	out.Prev = byMonth[m.AddDate(0, -1, 0).Format("2006-01")]
	for i := 1; i <= 6; i++ {
		f := byMonth[m.AddDate(0, -i, 0).Format("2006-01")]
		out.Avg.Income += f.Income
		out.Avg.Expense += f.Expense
	}
	out.Avg.Income /= 6
	out.Avg.Expense /= 6
	out.Avg.Net = out.Avg.Income - out.Avg.Expense
	if out.Figures.Income == 0 && out.Figures.Expense == 0 {
		return Basis{}, ErrNoData
	}

	// Spending by category: this month, the one before, the six before.
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
	pf, pt := monthRange(m.AddDate(0, -1, 0))
	prev, err := spent(pf, pt)
	if err != nil {
		return Basis{}, err
	}
	sixFrom, _ := monthRange(m.AddDate(0, -6, 0))
	six, err := spent(sixFrom, pt)
	if err != nil {
		return Basis{}, err
	}
	for id, v := range now {
		out.Categories = append(out.Categories, CategoryFigure{Name: names[id], Amount: v, Prev: prev[id], Avg: six[id] / 6})
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

	// The budgets the month went over.
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

	// The schedules due the month after: what is coming.
	nf, nt := monthRange(m.AddDate(0, 1, 0))
	cal, err := s.calendar.Calendar(ctx, walletID, nf, nt, n)
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
func (b Basis) plain(v int64) string {
	return money.Format(v, b.Currency.FracDigits, ".", "", "", false) + " " + b.Currency.Code
}

// languages names the app's languages for the model.
var languages = map[string]string{
	"en": "English", "it": "Italian", "es": "Spanish", "fr": "French", "de": "German", "pt-BR": "Brazilian Portuguese",
}

const system = "You write a short monthly money report for the owner of a personal-finance wallet. " +
	"Use only the numbers given: never invent one, and compute nothing but simple differences " +
	"and percentages between them. Write 3 to 5 short paragraphs of plain text, with no headings, " +
	"no lists and no markdown, separated by a blank line. Say what changed and what stands out; " +
	"give no investment advice. Write amounts as the reader's language writes them, with the " +
	"currency symbol."

// prompt is what the model is told about a month: the numbers, line by line.
func (b Basis) prompt(lang string) string {
	var w strings.Builder
	fig := func(f Figures) string {
		return fmt.Sprintf("income %s, expenses %s, kept %s", b.plain(f.Income), b.plain(f.Expense), b.plain(f.Net))
	}
	fmt.Fprintf(&w, "Month: %s (currency %s, symbol %s)\n", b.Month, b.Currency.Code, b.Currency.Symbol)
	fmt.Fprintf(&w, "This month: %s\n", fig(b.Figures))
	fmt.Fprintf(&w, "The month before: %s\n", fig(b.Prev))
	fmt.Fprintf(&w, "Average of the six months before: %s\n", fig(b.Avg))
	if len(b.Categories) > 0 {
		w.WriteString("Spending by category (this month / the month before / six-month average):\n")
		for _, c := range b.Categories {
			fmt.Fprintf(&w, "- %s: %s / %s / %s\n", c.Name, b.plain(c.Amount), b.plain(c.Prev), b.plain(c.Avg))
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
	if len(b.Bills) > 0 {
		w.WriteString("Bills due next month:\n")
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
	basis, err := s.Basis(ctx, walletID, m)
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
		UserID: userID, WalletID: walletID, Kind: KindMonthly, Period: period,
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
