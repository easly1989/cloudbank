// Package moneyalert watches the money and tells the dispatcher (#691): a
// large expense or a low balance against each person's thresholds, a budget
// at 80% and 100%, a goal reached or falling behind; and (#692) the
// transactions waiting on the Review page, and the weekly and monthly
// summaries. It looks every few minutes instead of hooking every place a
// transaction is written, so a bank sync, a mail, a schedule or another
// member are all caught alike.
package moneyalert

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/easly1989/cloudbank/server/internal/bills"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/goal"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/provenance"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Notifier is the dispatcher.
type Notifier interface {
	Notify(ctx context.Context, userID int64, e notify.Event) error
	NotifyWallet(ctx context.Context, walletID int64, build func(locale string) notify.Event) error
	GetSettings(ctx context.Context, userID int64) (notify.Settings, error)
	Wants(ctx context.Context, userID int64, k notify.Kind) (bool, error)
}

// lastKey stores the last transaction the large-expense check has seen.
const lastKey = "notify_money_last_txn"

// Service is the money watch.
type Service struct {
	q, rq   *db.Queries
	budgets *budget.Service
	goals   *goal.Service
	reports *report.Service
	bills   *bills.Service
	waiting Waiting
	notify  Notifier
	logger  *slog.Logger
}

// Deps are the services the watch reads.
type Deps struct {
	Budgets *budget.Service
	Goals   *goal.Service
	Reports *report.Service
	Bills   *bills.Service
	Waiting Waiting
}

// New returns the watch.
func New(read, write *sql.DB, d Deps, n Notifier, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		q: db.New(write), rq: db.New(read), budgets: d.Budgets, goals: d.Goals, reports: d.Reports,
		bills: d.Bills, waiting: d.Waiting, notify: n, logger: logger,
	}
}

// Run looks at once, then every interval, until ctx ends.
func (s *Service) Run(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		if err := s.Sweep(ctx, time.Now()); err != nil && ctx.Err() == nil {
			s.logger.Error("money notifications failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Sweep runs every check once, as of now.
func (s *Service) Sweep(ctx context.Context, now time.Time) error {
	today := now.Format("2006-01-02")
	return errors.Join(s.large(ctx), s.low(ctx, today), s.budget(ctx, now), s.goal(ctx, now),
		s.review(ctx, now), s.summaries(ctx, now))
}

// account is what the texts need of an account.
type account struct {
	name string
	fmt  func(int64) string
}

// sweep caches what a run looks up more than once.
type sweep struct {
	s        *Service
	accounts map[int64]account
	locales  map[int64]string
}

func (s *Service) newSweep() *sweep {
	return &sweep{s: s, accounts: map[int64]account{}, locales: map[int64]string{}}
}

func formatter(c db.Currency) func(int64) string {
	return func(v int64) string {
		return money.Format(v, int(c.FracDigits), c.DecimalChar, c.GroupChar, c.Symbol, c.SymbolPrefix != 0)
	}
}

func (w *sweep) account(ctx context.Context, id int64) (account, error) {
	if a, ok := w.accounts[id]; ok {
		return a, nil
	}
	a, err := w.s.rq.GetAccount(ctx, id)
	if err != nil {
		return account{}, err
	}
	c, err := w.s.rq.GetCurrency(ctx, a.CurrencyID)
	if err != nil {
		return account{}, err
	}
	out := account{name: a.Name, fmt: formatter(c)}
	w.accounts[id] = out
	return out, nil
}

func (w *sweep) text(ctx context.Context, userID int64) alertText {
	lang, ok := w.locales[userID]
	if !ok {
		if u, err := w.s.rq.GetUserByID(ctx, userID); err == nil {
			lang = u.Locale
		}
		w.locales[userID] = lang
	}
	return locale.Pick(alertTexts, lang)
}

// tells reports whether an expense is news to this reader: written by the
// bank, a mail or a schedule, or entered by someone else. Their own entries,
// file imports and rows from before CloudBank kept track are not.
func tells(origin string, createdBy sql.NullInt64, reader int64) bool {
	switch origin {
	case provenance.Import:
		return false
	case "":
		return createdBy.Valid && createdBy.Int64 != reader
	}
	return true
}

// large announces the expenses written since the last look that reach a
// reader's threshold. The first look only marks where to start.
func (s *Service) large(ctx context.Context) error {
	last, err := s.q.GetInstanceSetting(ctx, lastKey)
	if errors.Is(err, sql.ErrNoRows) {
		top, err := s.rq.MaxTransactionID(ctx)
		if err != nil {
			return err
		}
		return s.q.SetInstanceSetting(ctx, db.SetInstanceSettingParams{Key: lastKey, Value: strconv.FormatInt(top, 10)})
	}
	if err != nil {
		return err
	}
	from, _ := strconv.ParseInt(last, 10, 64)
	limits, err := s.rq.ListLargeThresholds(ctx)
	if err != nil {
		return err
	}
	byAccount := map[int64][]db.ListLargeThresholdsRow{}
	for _, l := range limits {
		byAccount[l.AccountID] = append(byAccount[l.AccountID], l)
	}
	w := s.newSweep()
	for {
		rows, err := s.rq.ListTransactionsSince(ctx, from)
		if err != nil || len(rows) == 0 {
			return err
		}
		for _, t := range rows {
			for _, l := range byAccount[t.AccountID] {
				if -t.Amount < l.LargeOver.Int64 || !tells(t.Origin, t.CreatedBy, l.UserID) {
					continue
				}
				if err := w.tellLarge(ctx, l.UserID, t); err != nil {
					s.logger.Warn("large expense notification failed", "transaction", t.ID, "error", err)
				}
			}
			from = t.ID
		}
		if err := s.q.SetInstanceSetting(ctx, db.SetInstanceSettingParams{Key: lastKey, Value: strconv.FormatInt(from, 10)}); err != nil {
			return err
		}
	}
}

func (w *sweep) tellLarge(ctx context.Context, userID int64, t db.ListTransactionsSinceRow) error {
	a, err := w.account(ctx, t.AccountID)
	if err != nil {
		return err
	}
	x := w.text(ctx, userID)
	what := t.Payee
	if what == "" {
		what = t.Memo
	}
	body := fmt.Sprintf(x.largeBare, a.fmt(t.Amount), a.name)
	if what != "" {
		body = fmt.Sprintf(x.large, a.fmt(t.Amount), a.name, what)
	}
	return w.s.notify.Notify(ctx, userID, notify.Event{
		Kind: notify.KindLargeTransaction, Ref: "large:" + strconv.FormatInt(t.ID, 10),
		Title: x.largeTitle, Body: body, Private: fmt.Sprintf(x.largePrivate, a.name),
		URL:      fmt.Sprintf("/transactions?account=%d&txn=%d", t.AccountID, t.ID),
		WalletID: t.WalletID,
	})
}

// low announces a balance that dropped below its reader's threshold, once,
// and re-arms when it is back above.
func (s *Service) low(ctx context.Context, today string) error {
	rows, err := s.rq.ListLowThresholds(ctx, today)
	if err != nil {
		return err
	}
	w := s.newSweep()
	for _, r := range rows {
		balance := r.InitialBalance + r.TodayDelta
		below := balance < r.LowUnder.Int64
		if below == (r.LowBelow != 0) {
			continue
		}
		if below {
			a, err := w.account(ctx, r.AccountID)
			if err != nil {
				return err
			}
			x := w.text(ctx, r.UserID)
			if err := s.notify.Notify(ctx, r.UserID, notify.Event{
				Kind: notify.KindLowBalance, Title: x.lowTitle,
				Body:    fmt.Sprintf(x.low, a.name, a.fmt(balance), a.fmt(r.LowUnder.Int64)),
				Private: fmt.Sprintf(x.lowPrivate, a.name),
				URL:     fmt.Sprintf("/transactions?account=%d", r.AccountID), WalletID: r.WalletID,
			}); err != nil {
				return err
			}
		}
		v := int64(0)
		if below {
			v = 1
		}
		if err := s.q.SetLowBelow(ctx, db.SetLowBelowParams{LowBelow: v, UserID: r.UserID, AccountID: r.AccountID}); err != nil {
			return err
		}
	}
	return nil
}

// budget announces a category's spending reaching 80% and 100% of this
// month's budget, once each per category and month.
func (s *Service) budget(ctx context.Context, now time.Time) error {
	if s.budgets == nil {
		return nil
	}
	wallets, err := s.rq.ListAllWalletIDs(ctx)
	if err != nil {
		return err
	}
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	from, to := first.Format("2006-01-02"), first.AddDate(0, 1, -1).Format("2006-01-02")
	month := first.Format("2006-01")
	for _, wid := range wallets {
		rep, err := s.budgets.Report(ctx, wid, from, to, now.Format("2006-01-02"))
		if err != nil {
			return err
		}
		if rep.Currency == nil {
			continue
		}
		c := rep.Currency
		f := func(v int64) string {
			return money.Format(v, c.FracDigits, c.DecimalChar, c.GroupChar, c.Symbol, c.SymbolPrefix)
		}
		for _, r := range rep.Rows {
			// Spending budgets are negative, like what is spent against them.
			spent := r.Actual - r.Coming
			if !r.Budgeted || r.IsIncome || r.Budget >= 0 || spent >= 0 {
				continue
			}
			step := 0
			switch pct := spent * 100 / r.Budget; {
			case pct >= 100:
				step = 100
			case pct >= 80:
				step = 80
			default:
				continue
			}
			row := r
			ref := fmt.Sprintf("budget:%d:%s:%d", r.CategoryID, month, step)
			err := s.notify.NotifyWallet(ctx, wid, func(lang string) notify.Event {
				x := locale.Pick(alertTexts, lang)
				title, private := x.budget80Title, x.budget80Private
				if step == 100 {
					title, private = x.budget100Title, x.budget100Private
				}
				return notify.Event{
					Kind: notify.KindBudget, Ref: ref, Title: title,
					Body:    fmt.Sprintf(x.budget, row.Name, f(-spent), f(-row.Budget)),
					Private: fmt.Sprintf(private, row.Name), URL: "/budget",
				}
			})
			if err != nil {
				return err
			}
		}
	}
	return nil
}

// goal announces a goal reached, once, and on the first of the month a goal
// whose pace over the last three full months falls short of its monthly
// share: the Goals page's rule.
func (s *Service) goal(ctx context.Context, now time.Time) error {
	if s.goals == nil {
		return nil
	}
	wallets, err := s.rq.ListAllWalletIDs(ctx)
	if err != nil {
		return err
	}
	today := now.Format("2006-01-02")
	for _, wid := range wallets {
		goals, err := s.goals.List(ctx, wid)
		if err != nil {
			return err
		}
		if len(goals) == 0 {
			continue
		}
		base, err := s.rq.GetBaseCurrency(ctx, wid)
		if err != nil {
			continue
		}
		f := formatter(base)
		for _, g := range goals {
			if g.ClosedOn != nil || g.TargetAmount <= 0 {
				continue
			}
			name := g.Name
			if g.Saved >= g.TargetAmount {
				target := f(g.TargetAmount)
				if err := s.notify.NotifyWallet(ctx, wid, func(lang string) notify.Event {
					x := locale.Pick(alertTexts, lang)
					return notify.Event{Kind: notify.KindGoal, Ref: "goal-reached:" + strconv.FormatInt(g.ID, 10),
						Title: x.reachedTitle, Body: fmt.Sprintf(x.reached, name, target),
						Private: fmt.Sprintf(x.reachedPrivate, name), URL: "/goals"}
				}); err != nil {
					return err
				}
				continue
			}
			if now.Day() != 1 || g.TargetDate == nil {
				continue
			}
			moves, err := s.goals.Contributions(ctx, wid, g.ID)
			if err != nil {
				return err
			}
			need, pace := goal.ShareAndPace(g, moves, today, int(base.FracDigits))
			if pace >= need {
				continue
			}
			ref := "goal-behind:" + strconv.FormatInt(g.ID, 10) + ":" + today[:7]
			if err := s.notify.NotifyWallet(ctx, wid, func(lang string) notify.Event {
				x := locale.Pick(alertTexts, lang)
				return notify.Event{Kind: notify.KindGoal, Ref: ref, Title: x.behindTitle,
					Body:    fmt.Sprintf(x.behind, name, f(need), f(pace)),
					Private: fmt.Sprintf(x.behindPrivate, name), URL: "/goals"}
			}); err != nil {
				return err
			}
		}
	}
	return nil
}
