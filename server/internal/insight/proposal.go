package insight

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Proposals (#698, #699): CloudBank works out every row from the wallet's own
// numbers; the model only says, in two or three sentences, why. A proposal
// never writes: Apply opens the form filled in, and the row is done when the
// user saves it there.
//
// Budget proposals (#698) set budgets from what is really spent, from the
// budget report of the six complete months before this one.

// The kinds of proposal.
const (
	KindBudget        = "budget"
	KindSubscriptions = "subscriptions"
	KindSavings       = "savings"
	KindGoals         = "goals"
)

// proposalKind is what makes one kind of proposal: the AI job it is, its
// rows, what the model is told, and the notification's lines and link.
type proposalKind struct {
	feature string
	rows    func(s *Service, ctx context.Context, userID, walletID int64, today time.Time) (ProposalBasis, error)
	system  string
	prompt  func(b ProposalBasis, lang string) string
	notes   map[string][2]string
	url     string
}

var proposalKinds = map[string]proposalKind{
	KindBudget: {
		feature: ai.FeatureBudgets, rows: byWallet((*Service).budgetRows), system: proposalSystem,
		prompt: ProposalBasis.prompt, notes: proposalNotes, url: "/budget",
	},
	KindSubscriptions: {
		feature: ai.FeatureSubscriptions, rows: byWallet((*Service).subscriptionRows), system: subscriptionSystem,
		prompt: ProposalBasis.subscriptionPrompt, notes: subscriptionNotes, url: "/schedules?view=list",
	},
	KindSavings: {
		feature: ai.FeatureSavings, rows: (*Service).savingsRows, system: savingsSystem,
		prompt: ProposalBasis.savingsPrompt, notes: savingsNotes, url: "/insights",
	},
	KindGoals: {
		feature: ai.FeatureGoals, rows: byWallet((*Service).goalRows), system: goalSystem,
		prompt: ProposalBasis.goalPrompt, notes: goalNotes, url: "/goals",
	},
}

// byWallet is rows that look at the wallet alone, not at the person.
func byWallet(f func(s *Service, ctx context.Context, walletID int64, today time.Time) (ProposalBasis, error)) func(*Service, context.Context, int64, int64, time.Time) (ProposalBasis, error) {
	return func(s *Service, ctx context.Context, _, walletID int64, today time.Time) (ProposalBasis, error) {
		return f(s, ctx, walletID, today)
	}
}

const (
	proposalMonths = 6
	// A category with no budget is proposed one when it was spent on in at
	// least this many of the months; a budget is changed when it was gone over,
	// or not reached, in at least budgetMisses of them.
	regularMonths = 5
	budgetMisses  = 4
	proposalRows  = 5
	// laterDays is how long Later hides a proposal.
	laterDays = 7
	// changedShare is how much a proposed amount must move for an ignored
	// proposal to come back.
	changedShare = 0.2
)

// Why a row is proposed.
const (
	reasonNone  = "none"  // no budget, yet spent on most months
	reasonOver  = "over"  // the budget was gone over most months
	reasonUnder = "under" // the budget was not reached most months
)

// ProposalRow is one row of a proposal, in the base currency, as positive
// amounts: a category's proposed monthly budget, or a schedule to look at.
type ProposalRow struct {
	CategoryID int64   `json:"categoryId"`
	Name       string  `json:"name"`
	Reason     string  `json:"reason"`
	Budget     int64   `json:"budget"` // today's; 0 is none
	Median     int64   `json:"median"`
	Proposed   int64   `json:"proposed"`
	Months     []int64 `json:"months"` // what was spent, oldest first
	Hits       int     `json:"hits"`   // the months that made the reason
	// A subscription (#699): the schedule, the amount it saves, the payments
	// that raised it, the schedule it doubles, the last payment found and what
	// it costs a year at the amount saved.
	ScheduleID int64   `json:"scheduleId,omitempty"`
	Amount     int64   `json:"amount,omitempty"`
	Paid       []int64 `json:"paid,omitempty"`
	Other      string  `json:"other,omitempty"`
	Last       string  `json:"last,omitempty"`
	Yearly     int64   `json:"yearly,omitempty"`
	// Savings (#699): a category's average a month in the nine months before,
	// and in the last three.
	Before int64 `json:"before,omitempty"`
	Recent int64 `json:"recent,omitempty"`
	// A goal (#699): what is left, its pace a month, its date, and the date
	// its pace gets there; Proposed is the monthly share, or the pace for a
	// goal with no date.
	GoalID  int64  `json:"goalId,omitempty"`
	Left    int64  `json:"left,omitempty"`
	Pace    int64  `json:"pace,omitempty"`
	Date    string `json:"date,omitempty"`
	NewDate string `json:"newDate,omitempty"`
}

// key is what a row is about: its schedule, its goal, or its category. Saving it marks
// it applied by this key, and an ignored proposal is compared by it.
func (r ProposalRow) key() int64 {
	switch {
	case r.ScheduleID != 0:
		return r.ScheduleID
	case r.GoalID != 0:
		return r.GoalID
	}
	return r.CategoryID
}

// figure is the amount an ignored proposal's row is compared by: the one
// proposed, or what a schedule not raised costs a year.
func (r ProposalRow) figure() int64 {
	if r.ScheduleID != 0 && r.Reason != reasonRaised {
		return r.Yearly
	}
	return r.Proposed
}

// ProposalBasis is everything a proposal rests on.
type ProposalBasis struct {
	Months   []string      `json:"months"` // YYYY-MM, oldest first
	Currency Currency      `json:"currency"`
	Rows     []ProposalRow `json:"rows"`
	// Kept is what the wallet kept a month in the last three full months: a
	// goal proposal's yardstick.
	Kept int64 `json:"kept,omitempty"`
}

// Proposal is a proposal as the pages show it. Rows already saved are left
// out.
type Proposal struct {
	ID        int64         `json:"id"`
	Kind      string        `json:"kind"`
	Period    string        `json:"period"`
	Body      string        `json:"body"`
	Basis     ProposalBasis `json:"basis"`
	Model     string        `json:"model"`
	Feedback  int64         `json:"feedback"`
	CreatedAt string        `json:"createdAt"`
}

// ErrNoProposal is a wallet with nothing worth proposing.
var ErrNoProposal = errors.New("insight: nothing to propose")

// errUnchanged is a proposal like the last one ignored.
var errUnchanged = errors.New("insight: like the proposal ignored")

// roundTo5 rounds a positive minor amount to the nearest 5 of the currency.
func roundTo5(v int64, frac int) int64 {
	unit := int64(5)
	for range frac {
		unit *= 10
	}
	return (v + unit/2) / unit * unit
}

func median(v []int64) int64 {
	s := slices.Clone(v)
	slices.Sort(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

// spending is what each budget line of a wallet took in each of n complete
// months, oldest first, as positive amounts in the base currency, with the
// budget it had each month and the one it has today.
type spending struct {
	currency Currency
	months   []string          // YYYY-MM
	spent    map[int64][]int64 // per line
	budget   map[int64][]int64 // per line, 0 for none
	today    map[int64]int64   // today's budget lines
	names    map[int64]string  // Parent:Child
	parent   map[int64]int64
	children map[int64]bool
}

// spendingOf reads the n complete months before today's, the person's local
// date.
func (s *Service) spendingOf(ctx context.Context, walletID int64, today time.Time, n int) (spending, error) {
	month := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
	sp := spending{
		spent: map[int64][]int64{}, budget: map[int64][]int64{}, today: map[int64]int64{},
		names: map[int64]string{}, parent: map[int64]int64{}, children: map[int64]bool{},
	}
	var err error
	if sp.currency, _, err = s.baseCurrency(ctx, walletID); err != nil {
		return sp, err
	}
	cats, err := s.rq.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return sp, err
	}
	for _, c := range cats {
		sp.names[c.ID] = c.Name
		sp.parent[c.ID] = c.ParentID.Int64
		sp.children[c.ParentID.Int64] = true
	}
	for _, c := range cats {
		if c.ParentID.Valid {
			sp.names[c.ID] = sp.names[c.ParentID.Int64] + ":" + c.Name
		}
	}

	// Today's budgets, then each month's spending and budget per budget line.
	now, err := s.budgets.Report(ctx, walletID, month.Format(day), month.AddDate(0, 1, -1).Format(day), today.Format(day))
	if err != nil {
		return sp, err
	}
	for _, r := range now.Rows {
		if r.Budgeted && !r.IsIncome {
			sp.today[r.CategoryID] = abs(r.Budget)
		}
	}
	for i := range n {
		m := month.AddDate(0, i-n, 0)
		last := m.AddDate(0, 1, -1).Format(day)
		sp.months = append(sp.months, m.Format("2006-01"))
		rep, err := s.budgets.Report(ctx, walletID, m.Format(day), last, last)
		if err != nil {
			return sp, err
		}
		for _, r := range rep.Rows {
			if r.IsIncome {
				continue
			}
			if sp.spent[r.CategoryID] == nil {
				sp.spent[r.CategoryID] = make([]int64, n)
				sp.budget[r.CategoryID] = make([]int64, n)
			}
			sp.spent[r.CategoryID][i] = max(0, -r.Actual)
			if r.Budgeted {
				sp.budget[r.CategoryID][i] = abs(r.Budget)
			}
		}
	}
	return sp, nil
}

// proposable tells whether a line can be proposed a budget: one it has, or
// one of its own. A category its parent's budget covers is not; nor is a
// parent without one, as its budget would cover its subcategories too.
func (sp spending) proposable(id int64) bool {
	_, budgeted := sp.today[id]
	_, covered := sp.today[sp.parent[id]]
	return budgeted || (!covered && !sp.children[id])
}

// budgetRows works out the rows for a wallet, with today the person's local
// date: the six complete months before today's, against today's budgets.
func (s *Service) budgetRows(ctx context.Context, walletID int64, today time.Time) (ProposalBasis, error) {
	basis := ProposalBasis{Rows: []ProposalRow{}}
	sp, err := s.spendingOf(ctx, walletID, today, proposalMonths)
	if err != nil {
		return basis, err
	}
	basis.Currency, basis.Months = sp.currency, sp.months
	for id, spent := range sp.spent {
		if !sp.proposable(id) {
			continue
		}
		b, budgeted := sp.today[id]
		row := ProposalRow{CategoryID: id, Name: sp.names[id], Months: spent}
		row.Median = median(row.Months)
		row.Proposed = roundTo5(row.Median, basis.Currency.FracDigits)
		if row.Proposed == 0 {
			continue
		}
		if !budgeted {
			for _, v := range spent {
				if v > 0 {
					row.Hits++
				}
			}
			if row.Hits < regularMonths {
				continue
			}
			row.Reason = reasonNone
		} else {
			row.Budget = b
			over, under := 0, 0
			for i, v := range spent {
				switch b := sp.budget[id][i]; {
				case b == 0:
				case v > b:
					over++
				case v < b:
					under++
				}
			}
			// A change smaller than a tenth of the budget is not worth asking.
			gap := abs(row.Proposed - row.Budget)
			if gap*10 < row.Budget {
				continue
			}
			switch {
			case over >= budgetMisses && row.Proposed > row.Budget:
				row.Reason, row.Hits = reasonOver, over
			case under >= budgetMisses && row.Proposed < row.Budget:
				row.Reason, row.Hits = reasonUnder, under
			default:
				continue
			}
		}
		basis.Rows = append(basis.Rows, row)
	}
	sort.Slice(basis.Rows, func(i, j int) bool {
		gi, gj := abs(basis.Rows[i].Proposed-basis.Rows[i].Budget), abs(basis.Rows[j].Proposed-basis.Rows[j].Budget)
		if gi != gj {
			return gi > gj
		}
		return basis.Rows[i].Name < basis.Rows[j].Name
	})
	if len(basis.Rows) > proposalRows {
		basis.Rows = basis.Rows[:proposalRows]
	}
	return basis, nil
}

// baseCurrency is the wallet's base currency, and its id.
func (s *Service) baseCurrency(ctx context.Context, walletID int64) (Currency, int64, error) {
	currencies, err := s.rq.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return Currency{}, 0, err
	}
	for _, c := range currencies {
		if c.IsBase != 0 {
			return Currency{
				Code: c.IsoCode, Symbol: c.Symbol, SymbolPrefix: c.SymbolPrefix != 0,
				DecimalChar: c.DecimalChar, GroupChar: c.GroupChar, FracDigits: int(c.FracDigits),
			}, c.ID, nil
		}
	}
	return Currency{}, 0, nil
}

// changedFrom tells whether rows differ enough from an ignored proposal's to
// be proposed again: a row it did not have, or an amount moved by more than a
// fifth.
func changedFrom(rows, ignored []ProposalRow) bool {
	was := map[int64]int64{}
	for _, r := range ignored {
		was[r.key()] = r.figure()
	}
	for _, r := range rows {
		old, ok := was[r.key()]
		if !ok || float64(abs(r.figure()-old)) > changedShare*float64(old) {
			return true
		}
	}
	return false
}

const proposalSystem = "You explain budget proposals to the owner of a personal-finance wallet. " +
	"CloudBank worked out every number: use only those, never invent one. Write 2 or 3 short " +
	"sentences of plain text, with no headings, no lists and no markdown: say what the proposals " +
	"have in common and why they help. Give no investment advice. Write amounts as the reader's " +
	"language writes them, with the currency symbol."

func (b ProposalBasis) prompt(lang string) string {
	var w strings.Builder
	plain := Basis{Currency: b.Currency}.plain
	fmt.Fprintf(&w, "Budget proposals (currency %s, symbol %s), from the months %s to %s.\n",
		b.Currency.Code, b.Currency.Symbol, b.Months[0], b.Months[len(b.Months)-1])
	for _, r := range b.Rows {
		switch r.Reason {
		case reasonNone:
			fmt.Fprintf(&w, "- %s: no budget, spent on in %d of %d months", r.Name, r.Hits, len(b.Months))
		case reasonOver:
			fmt.Fprintf(&w, "- %s: budget %s, gone over in %d of %d months", r.Name, plain(r.Budget), r.Hits, len(b.Months))
		default:
			fmt.Fprintf(&w, "- %s: budget %s, not reached in %d of %d months", r.Name, plain(r.Budget), r.Hits, len(b.Months))
		}
		fmt.Fprintf(&w, "; usually (median) %s; proposed %s a month\n", plain(r.Median), plain(r.Proposed))
	}
	name := languages[lang]
	if name == "" {
		name = "English"
	}
	fmt.Fprintf(&w, "\nWrite the text in %s.", name)
	return w.String()
}

// propose makes this month's proposal of a kind for a wallet, today being the
// person's local date. It replaces the proposals of the kind still waiting.
func (s *Service) propose(ctx context.Context, kind string, userID, walletID int64, today time.Time) (int64, error) {
	k := proposalKinds[kind]
	basis, err := k.rows(s, ctx, userID, walletID, today)
	if err != nil {
		return 0, err
	}
	if len(basis.Rows) == 0 {
		return 0, ErrNoProposal
	}
	if raw, err := s.rq.LastIgnoredAIProposal(ctx, db.LastIgnoredAIProposalParams{UserID: userID, WalletID: walletID, Kind: kind}); err == nil {
		var was ProposalBasis
		if json.Unmarshal([]byte(raw), &was) == nil && !changedFrom(basis.Rows, was.Rows) {
			return 0, errUnchanged
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	lang := "en"
	if u, err := s.rq.GetUserByID(ctx, userID); err == nil && u.Locale != "" {
		lang = u.Locale
	}
	ans, err := s.ai.Ask(ctx, ai.Call{
		UserID: userID, WalletID: walletID, Feature: k.feature,
		System: k.system, User: k.prompt(basis, lang), MaxTokens: 300,
	})
	if err != nil {
		return 0, err
	}
	body := strings.TrimSpace(ans.Text)
	if len(body) > bodyMax {
		body = strings.ToValidUTF8(body[:bodyMax], "")
	}
	if body == "" {
		return 0, errors.New("ai: the model wrote nothing")
	}
	raw, err := json.Marshal(basis)
	if err != nil {
		return 0, err
	}
	period := today.Format("2006-01")
	id, err := s.q.InsertAIProposal(ctx, db.InsertAIProposalParams{
		UserID: userID, WalletID: walletID, Kind: kind, Period: period,
		Body: body, Basis: string(raw), Model: ans.Model,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return 0, errUnchanged // made meanwhile by another run
	}
	if err != nil {
		return 0, err
	}
	return id, s.q.ReplaceOpenAIProposals(ctx, db.ReplaceOpenAIProposalsParams{UserID: userID, WalletID: walletID, Kind: kind, Period: period})
}

// proposeFor makes this month's proposal of a kind on each wallet in the AI's
// reach that has none yet, and tells the person.
func (s *Service) proposeFor(ctx context.Context, u db.ListAIReportUsersRow, kind string, local time.Time, wallets []db.ListWalletsForUserRow, off map[int64]bool) error {
	period := local.Format("2006-01")
	sp := span{kind: kind, period: period}
	var errs []error
	for _, w := range wallets {
		if off[w.ID] {
			continue
		}
		done, err := s.rq.AIProposalDone(ctx, db.AIProposalDoneParams{UserID: u.UserID, WalletID: w.ID, Kind: kind, Period: period})
		if err != nil {
			return err
		}
		if done != 0 {
			continue
		}
		id, err := s.propose(ctx, kind, u.UserID, w.ID, local)
		switch {
		case err == nil:
			s.tellProposal(ctx, u, kind, id, w.ID, w.Title)
		case errors.Is(err, ErrNoProposal), errors.Is(err, errUnchanged):
			s.record(ctx, u.UserID, w.ID, sp, outcomeNoData)
		case errors.Is(err, ai.ErrLimit):
			// Skipped till next month; the reports already say the limit is reached.
			s.record(ctx, u.UserID, w.ID, sp, outcomeLimit)
			return nil
		case errors.Is(err, ai.ErrNotConfigured):
			return nil
		default:
			errs = append(errs, fmt.Errorf("%s proposal %s, wallet %d: %w", kind, period, w.ID, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Service) tellProposal(ctx context.Context, u db.ListAIReportUsersRow, kind string, id, walletID int64, walletName string) {
	if s.notify == nil {
		return
	}
	k := proposalKinds[kind]
	text := locale.Pick(k.notes, u.Locale)
	_ = s.notify.Notify(ctx, u.UserID, notify.Event{
		Kind: notify.KindAIProposal, Ref: fmt.Sprintf("ai-proposal:%d", id),
		Title: text[0], Body: fmt.Sprintf(text[1], walletName), URL: k.url, WalletID: walletID,
	})
}

// proposalNotes is a budget proposal's notification, two lines in each
// language; %s is the wallet.
var proposalNotes = map[string][2]string{
	"en":    {"Budget proposal ready", "%s: in Budget."},
	"it":    {"Proposta di budget pronta", "%s: la trovi in Budget."},
	"es":    {"Propuesta de presupuesto lista", "%s: la encontrarás en Presupuesto."},
	"fr":    {"Proposition de budget prête", "%s : à voir dans Budget."},
	"de":    {"Budgetvorschlag fertig", "%s: unter Budget."},
	"pt-BR": {"Proposta de orçamento pronta", "%s: está em Orçamento."},
}

// RunUser makes what is due for one person now: on turning a kind of
// proposal on, it comes at once rather than at the next run.
func (s *Service) RunUser(ctx context.Context, userID int64) error {
	users, err := s.rq.ListAIReportUsers(ctx)
	if err != nil {
		return err
	}
	for _, u := range users {
		if u.UserID == userID {
			return s.runFor(ctx, u)
		}
	}
	return nil
}

// Proposals returns the user's proposals waiting on a wallet, newest first,
// without the rows already saved.
func (s *Service) Proposals(ctx context.Context, userID, walletID int64) ([]Proposal, error) {
	rows, err := s.rq.ListOpenAIProposals(ctx, db.ListOpenAIProposalsParams{
		UserID: userID, WalletID: walletID, Now: s.now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return nil, err
	}
	out := make([]Proposal, 0, len(rows))
	for _, r := range rows {
		out = append(out, proposalOf(db.GetAIProposalRow(r)))
	}
	return out, nil
}

func appliedOf(raw string) []int64 {
	var ids []int64
	_ = json.Unmarshal([]byte(raw), &ids)
	return ids
}

func proposalOf(r db.GetAIProposalRow) Proposal {
	p := Proposal{ID: r.ID, Kind: r.Kind, Period: r.Period, Body: r.Body, Model: r.Model, Feedback: r.Feedback, CreatedAt: r.CreatedAt}
	_ = json.Unmarshal([]byte(r.Basis), &p.Basis)
	applied := appliedOf(r.Applied)
	p.Basis.Rows = slices.DeleteFunc(p.Basis.Rows, func(x ProposalRow) bool { return slices.Contains(applied, x.key()) })
	return p
}

// What the user can do with a proposal.
const (
	ActionLater   = "later"
	ActionIgnore  = "ignore"
	ActionApplied = "applied"
)

// ErrBadAction is an action a proposal does not take.
var ErrBadAction = errors.New("insight: the action is later, ignore or applied, with a row of the proposal")

// Act records what the user did: Later hides the proposal a week, Ignore puts
// it away until the numbers change, Applied marks a row saved from its form,
// the row being its category or schedule, and the whole proposal once every
// row is.
func (s *Service) Act(ctx context.Context, userID, walletID, id int64, action string, row int64) error {
	r, err := s.rq.GetAIProposal(ctx, db.GetAIProposalParams{ID: id, UserID: userID, WalletID: walletID})
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	// One put away, done or replaced is no longer the user's to act on.
	if r.State != "open" && r.State != "later" {
		return ErrNotFound
	}
	p := db.SetAIProposalStateParams{State: r.State, LaterUntil: "", Applied: r.Applied, ID: id, UserID: userID, WalletID: walletID}
	switch action {
	case ActionLater:
		p.State, p.LaterUntil = "later", s.now().UTC().AddDate(0, 0, laterDays).Format(time.RFC3339)
	case ActionIgnore:
		p.State = "ignored"
	case ActionApplied:
		var basis ProposalBasis
		_ = json.Unmarshal([]byte(r.Basis), &basis)
		if row == 0 || !slices.ContainsFunc(basis.Rows, func(x ProposalRow) bool { return x.key() == row }) {
			return ErrBadAction
		}
		applied := appliedOf(r.Applied)
		if !slices.Contains(applied, row) {
			applied = append(applied, row)
		}
		raw, _ := json.Marshal(applied)
		p.Applied = string(raw)
		if len(applied) >= len(basis.Rows) {
			p.State = "applied"
		}
	default:
		return ErrBadAction
	}
	return s.q.SetAIProposalState(ctx, p)
}

// SetProposalFeedback records a thumb on a proposal.
func (s *Service) SetProposalFeedback(ctx context.Context, userID, walletID, id, feedback int64) error {
	if feedback < -1 || feedback > 1 {
		return fmt.Errorf("insight: feedback is -1, 0 or 1")
	}
	n, err := s.q.SetAIProposalFeedback(ctx, db.SetAIProposalFeedbackParams{Feedback: feedback, ID: id, UserID: userID, WalletID: walletID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
