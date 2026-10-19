package moneyalert

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/bills"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The review reminder and the weekly and monthly summaries (#692).

// Waiting lists what the Review page asks about in a wallet.
type Waiting interface {
	Waiting(ctx context.Context, walletID int64, today time.Time) ([]int64, error)
}

// review keeps since when each transaction has waited on the Review page,
// and tells each member once about the transactions that passed their wait;
// again only when more pass it.
func (s *Service) review(ctx context.Context, now time.Time) error {
	if s.waiting == nil {
		return nil
	}
	wallets, err := s.rq.ListAllWalletIDs(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, w := range wallets {
		errs = append(errs, s.reviewWallet(ctx, w, now))
	}
	return errors.Join(errs...)
}

func (s *Service) reviewWallet(ctx context.Context, walletID int64, now time.Time) error {
	ids, err := s.waiting.Waiting(ctx, walletID, now.UTC())
	if err != nil {
		return err
	}
	known, err := s.q.ListReviewWaiting(ctx, walletID)
	if err != nil {
		return err
	}
	since := map[int64]time.Time{}
	for _, k := range known {
		t, _ := time.Parse(stampLayout, k.Since)
		since[k.TransactionID] = t
	}
	waiting := map[int64]bool{}
	for _, id := range ids {
		waiting[id] = true
		if _, ok := since[id]; !ok {
			if err := s.q.InsertReviewWaiting(ctx, db.InsertReviewWaitingParams{TransactionID: id, WalletID: walletID, Since: now.UTC().Format(stampLayout)}); err != nil {
				return err
			}
			since[id] = now.UTC()
		}
	}
	for id := range since {
		if !waiting[id] {
			if err := s.q.DeleteReviewWaiting(ctx, id); err != nil {
				return err
			}
			delete(since, id)
		}
	}
	if len(since) == 0 {
		return nil
	}
	members, err := s.rq.ListWalletRecipients(ctx, walletID)
	if err != nil {
		return err
	}
	for _, m := range members {
		st, err := s.notify.GetSettings(ctx, m.ID)
		if err != nil {
			return err
		}
		cutoff := now.Add(-time.Duration(st.ReviewDays) * 24 * time.Hour)
		overdue, fresh := 0, 0
		for id, t := range since {
			if t.After(cutoff) {
				continue
			}
			overdue++
			n, err := s.q.InsertReminderIfNew(ctx, db.InsertReminderIfNewParams{UserID: m.ID, Ref: "review:" + strconv.FormatInt(id, 10)})
			if err != nil {
				return err
			}
			fresh += int(n)
		}
		if fresh == 0 {
			continue
		}
		x := locale.Pick(watchTexts, m.Locale)
		days := x.days
		if st.ReviewDays == 1 {
			days = x.day
		} else {
			days = fmt.Sprintf(days, st.ReviewDays)
		}
		body := fmt.Sprintf(x.reviewMany, overdue, days)
		if overdue == 1 {
			body = fmt.Sprintf(x.reviewOne, days)
		}
		if err := s.notify.Notify(ctx, m.ID, notify.Event{
			Kind: notify.KindReviewWaiting, Title: x.reviewTitle, Body: body, URL: "/review", WalletID: walletID,
		}); err != nil {
			return err
		}
	}
	return nil
}

// stampLayout is how review_waiting keeps its times.
const stampLayout = "2006-01-02T15:04:05.000Z"

// period is one summary's span and the one before it, civil dates included.
type period struct {
	kind                     notify.Kind
	from, to, prevFrom, prev string
	ref                      string
}

// summaryPeriods is what a person's last digest time asks for: on a Monday
// the week before it, on the 1st the month before it.
func summaryPeriods(digest time.Time) []period {
	day := time.Date(digest.Year(), digest.Month(), digest.Day(), 0, 0, 0, 0, time.UTC)
	f := func(t time.Time) string { return t.Format("2006-01-02") }
	var out []period
	if day.Weekday() == time.Monday {
		out = append(out, period{
			kind: notify.KindSummaryWeekly, from: f(day.AddDate(0, 0, -7)), to: f(day.AddDate(0, 0, -1)),
			prevFrom: f(day.AddDate(0, 0, -14)), prev: f(day.AddDate(0, 0, -8)), ref: "summary-weekly:" + f(day),
		})
	}
	if day.Day() == 1 {
		out = append(out, period{
			kind: notify.KindSummaryMonthly, from: f(day.AddDate(0, -1, 0)), to: f(day.AddDate(0, 0, -1)),
			prevFrom: f(day.AddDate(0, -2, 0)), prev: f(day.AddDate(0, -1, -1)), ref: "summary-monthly:" + f(day),
		})
	}
	return out
}

// summaries sends each person who wants them the week's summary on Monday
// and the month's on the 1st, at their digest time, one per wallet they hear
// from. A period with nothing in or out and no bills ahead sends nothing.
func (s *Service) summaries(ctx context.Context, now time.Time) error {
	if s.reports == nil {
		return nil
	}
	users, err := s.rq.ListUsers(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, u := range users {
		if u.Disabled != 0 {
			continue
		}
		st, err := s.notify.GetSettings(ctx, u.ID)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		digest := st.LastDigest(now)
		for _, p := range summaryPeriods(digest) {
			if wants, err := s.notify.Wants(ctx, u.ID, p.kind); err != nil || !wants {
				errs = append(errs, err)
				continue
			}
			errs = append(errs, s.summary(ctx, u, p, digest))
		}
	}
	return errors.Join(errs...)
}

func (s *Service) summary(ctx context.Context, u db.User, p period, digest time.Time) error {
	wallets, err := s.rq.ListWalletsForUser(ctx, u.ID)
	if err != nil {
		return err
	}
	x := locale.Pick(watchTexts, u.Locale)
	for _, w := range wallets {
		ref := p.ref + ":" + strconv.FormatInt(w.ID, 10)
		if n, err := s.rq.HasReminder(ctx, db.HasReminderParams{UserID: u.ID, Ref: ref}); err != nil || n > 0 {
			if err != nil {
				return err
			}
			continue
		}
		body, ok, err := s.summaryBody(ctx, x, w.ID, w.Title, p, digest)
		if err != nil {
			return err
		}
		if !ok {
			// Nothing to say: remembered, so the period is not looked at again.
			if _, err := s.q.InsertReminderIfNew(ctx, db.InsertReminderIfNewParams{UserID: u.ID, Ref: ref}); err != nil {
				return err
			}
			continue
		}
		title, private := x.weekTitle, fmt.Sprintf(x.weekPrivate, w.Title)
		if p.kind == notify.KindSummaryMonthly {
			title, private = x.monthTitle, fmt.Sprintf(x.monthPrivate, w.Title)
		}
		if err := s.notify.Notify(ctx, u.ID, notify.Event{
			Kind: p.kind, Ref: ref, Title: title, Body: body, Private: private, URL: "/reports", WalletID: w.ID,
		}); err != nil {
			return err
		}
	}
	return nil
}

// summaryBody is one wallet's summary: money in and out with the period
// before, the three categories that took most, and (weekly) the bills of the
// next seven days. ok is false when there is nothing to tell.
func (s *Service) summaryBody(ctx context.Context, x watchText, walletID int64, wallet string, p period, digest time.Time) (string, bool, error) {
	total := func(from, to, typ, by string) (report.Result, error) {
		return s.reports.Statistics(ctx, walletID, report.Filter{From: from, To: to, Transfers: report.TransfersNone, Type: typ}, by)
	}
	in, err := total(p.from, p.to, report.TypeIncome, report.GroupMonth)
	if err != nil {
		return "", false, err
	}
	out, err := total(p.from, p.to, report.TypeExpense, report.GroupMonth)
	if err != nil {
		return "", false, err
	}
	before, err := total(p.prevFrom, p.prev, report.TypeExpense, report.GroupMonth)
	if err != nil {
		return "", false, err
	}
	cats, err := total(p.from, p.to, report.TypeExpense, report.GroupCategory)
	if err != nil {
		return "", false, err
	}
	format := func(v int64) string { return fmt.Sprint(v) }
	if c := out.Currency; c != nil {
		format = func(v int64) string {
			return money.Format(v, c.FracDigits, c.DecimalChar, c.GroupChar, c.Symbol, c.SymbolPrefix)
		}
	}
	due := 0
	if p.kind == notify.KindSummaryWeekly && s.bills != nil {
		day := digest.Format("2006-01-02")
		horizon := digest.AddDate(0, 0, 7).Format("2006-01-02")
		sum, err := s.bills.Bills(ctx, walletID, day)
		if err != nil {
			return "", false, err
		}
		for _, b := range sum.Bills {
			if b.State != bills.StatePaid && b.DueDate <= horizon {
				due++
			}
		}
	}
	if in.Total == 0 && out.Total == 0 && due == 0 {
		return "", false, nil
	}
	parts := []string{fmt.Sprintf(x.inOut, wallet, format(in.Total), format(-out.Total))}
	prev := x.prevWeek
	if p.kind == notify.KindSummaryMonthly {
		prev = x.prevMonth
	}
	parts = append(parts, fmt.Sprintf(prev, format(-before.Total)))
	var top []string
	for _, g := range cats.Groups[:min(3, len(cats.Groups))] {
		top = append(top, g.Label+" "+format(-g.Amount))
	}
	if len(top) > 0 {
		parts = append(parts, fmt.Sprintf(x.top, strings.Join(top, ", ")))
	}
	switch {
	case due == 1:
		parts = append(parts, x.billsOne)
	case due > 1:
		parts = append(parts, fmt.Sprintf(x.billsMany, due))
	}
	return strings.Join(parts, " "), true, nil
}
