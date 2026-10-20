package insight

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Subscription proposals (#699): the schedules worth a look. CloudBank has no
// usage data, so it goes by what the bank shows: a schedule whose last two
// payments came in at least 5% over what it saves, two schedules that pay the
// same payee, or the same amount just as often, and a schedule registered by
// hand whose payee has not been paid for two of its periods.

// Why a schedule is proposed.
const (
	reasonRaised = "raised" // the last two payments are over the amount saved
	reasonDouble = "double" // the same payee as another
	reasonAlike  = "alike"  // the same amount just as often as another
	reasonUnused = "unused" // not paid for two periods
)

// raisedPercent is how much of the amount saved the last two payments must
// at least be.
const raisedPercent = 105

// perYear is how many times a year a schedule repeating every n units comes.
func perYear(unit string, n int64) float64 {
	n = max(n, 1)
	switch unit {
	case schedule.UnitDay:
		return 365.25 / float64(n)
	case schedule.UnitWeek:
		return 365.25 / 7 / float64(n)
	case schedule.UnitMonth:
		return 12 / float64(n)
	}
	return 1 / float64(n)
}

func daysBetween(a, b string) float64 {
	ta, _ := time.Parse(day, a)
	tb, _ := time.Parse(day, b)
	return tb.Sub(ta).Hours() / 24
}

// subscriptionRows works out the rows for a wallet, with today the person's
// local date: at most five, raised first, then doubles, then unused, the
// costliest first within each.
func (s *Service) subscriptionRows(ctx context.Context, walletID int64, today time.Time) (ProposalBasis, error) {
	basis := ProposalBasis{Months: []string{}, Rows: []ProposalRow{}}
	var (
		baseID int64
		err    error
	)
	if basis.Currency, baseID, err = s.baseCurrency(ctx, walletID); err != nil {
		return basis, err
	}
	all, err := s.rq.ListSubscriptionSchedules(ctx, walletID)
	if err != nil {
		return basis, err
	}
	// shortcut: schedules in another currency than the base are left out, as the
	// rows are in the base currency; convert them if anyone keeps one.
	var list []db.ListSubscriptionSchedulesRow
	for _, sc := range all {
		if sc.CurrencyID == baseID {
			list = append(list, sc)
		}
	}
	pays, err := s.rq.ListSubscriptionPayments(ctx, db.ListSubscriptionPaymentsParams{
		WalletID: walletID, FromDate: today.AddDate(-5, 0, 0).Format(day), ToDate: today.Format(day),
	})
	if err != nil {
		return basis, err
	}
	paid := map[int64][]db.ListSubscriptionPaymentsRow{}
	for _, p := range pays {
		paid[p.PayeeID] = append(paid[p.PayeeID], p)
	}

	rank := map[string]int{reasonRaised: 0, reasonDouble: 1, reasonAlike: 1, reasonUnused: 2}
	row := func(sc db.ListSubscriptionSchedulesRow, reason string) ProposalRow {
		amount := -sc.Amount
		return ProposalRow{
			ScheduleID: sc.ID, Name: sc.Name, Reason: reason, Amount: amount, Months: []int64{},
			Yearly: int64(math.Round(float64(amount) * perYear(sc.Unit, sc.EveryN))),
		}
	}
	// A double is the later of two schedules; the earlier one is still looked at.
	doubled := map[int64]bool{}
	for i, b := range list {
		for _, a := range list[:i] {
			reason := reasonDouble
			if a.PayeeID != b.PayeeID {
				reason = reasonAlike
			}
			if a.PayeeID == b.PayeeID || (a.Amount == b.Amount && a.Unit == b.Unit && a.EveryN == b.EveryN) {
				r := row(b, reason)
				r.Other = a.Name
				basis.Rows = append(basis.Rows, r)
				doubled[b.ID] = true
				break
			}
		}
	}
	for _, sc := range list {
		if doubled[sc.ID] {
			continue
		}
		// The payee's payments that can be this schedule's: half to twice its amount.
		amount := -sc.Amount
		var near []db.ListSubscriptionPaymentsRow
		for _, p := range paid[sc.PayeeID] {
			if v := -p.Amount; v*2 >= amount && v <= amount*2 {
				near = append(near, p)
			}
		}
		if len(near) == 0 {
			continue
		}
		last := near[len(near)-1]
		cutoff := schedule.AddInterval(today, sc.Unit, -2*int(sc.EveryN)).Format(day)
		switch {
		case sc.AutoPost == 0 && last.Date < cutoff:
			r := row(sc, reasonUnused)
			r.Last = last.Date
			basis.Rows = append(basis.Rows, r)
		case len(near) >= 2 && last.Date >= cutoff:
			prev := near[len(near)-2]
			a, b := -prev.Amount, -last.Amount
			// Two payments of two periods, not two of the same one.
			period := 365.25 / perYear(sc.Unit, sc.EveryN)
			gap := daysBetween(prev.Date, last.Date)
			if a*100 >= amount*raisedPercent && b*100 >= amount*raisedPercent && gap*2 >= period && gap <= 2*period {
				r := row(sc, reasonRaised)
				r.Proposed, r.Paid, r.Last = b, []int64{a, b}, last.Date
				basis.Rows = append(basis.Rows, r)
			}
		}
	}
	sort.SliceStable(basis.Rows, func(i, j int) bool {
		ri, rj := basis.Rows[i], basis.Rows[j]
		if rank[ri.Reason] != rank[rj.Reason] {
			return rank[ri.Reason] < rank[rj.Reason]
		}
		if ri.Yearly != rj.Yearly {
			return ri.Yearly > rj.Yearly
		}
		return ri.Name < rj.Name
	})
	if len(basis.Rows) > proposalRows {
		basis.Rows = basis.Rows[:proposalRows]
	}
	return basis, nil
}

const subscriptionSystem = "You explain subscription proposals to the owner of a personal-finance wallet: " +
	"schedules whose payments went up, that look like a double of another, or that the bank no longer " +
	"shows paid. CloudBank worked out every number: use only those, never invent one. Write 2 or 3 short " +
	"sentences of plain text, with no headings, no lists and no markdown: say what to look at first and " +
	"why. Give no investment advice. Write amounts as the reader's language writes them, with the " +
	"currency symbol."

func (b ProposalBasis) subscriptionPrompt(lang string) string {
	var w strings.Builder
	plain := Basis{Currency: b.Currency}.plain
	fmt.Fprintf(&w, "Subscription proposals (currency %s, symbol %s), each a schedule of the wallet.\n",
		b.Currency.Code, b.Currency.Symbol)
	for _, r := range b.Rows {
		switch r.Reason {
		case reasonRaised:
			more := int64(math.Round(float64(r.Yearly) * float64(r.Proposed-r.Amount) / float64(r.Amount)))
			fmt.Fprintf(&w, "- %s: saved at %s, the last 2 payments were %s and %s; %s a year more than saved\n",
				r.Name, plain(r.Amount), plain(r.Paid[0]), plain(r.Paid[1]), plain(more))
		case reasonDouble:
			fmt.Fprintf(&w, "- %s: looks like a double of %s, paying the same payee; %s a year\n", r.Name, r.Other, plain(r.Yearly))
		case reasonAlike:
			fmt.Fprintf(&w, "- %s: may be a double of %s, the same amount just as often; %s a year\n", r.Name, r.Other, plain(r.Yearly))
		default:
			fmt.Fprintf(&w, "- %s: no payment found in the bank since %s; %s a year\n", r.Name, r.Last, plain(r.Yearly))
		}
	}
	name := languages[lang]
	if name == "" {
		name = "English"
	}
	fmt.Fprintf(&w, "\nWrite the text in %s.", name)
	return w.String()
}

// subscriptionNotes is a subscription proposal's notification, two lines in
// each language; %s is the wallet.
var subscriptionNotes = map[string][2]string{
	"en":    {"Subscriptions to look at", "%s: in Schedules."},
	"it":    {"Abbonamenti da guardare", "%s: li trovi in Programmate."},
	"es":    {"Suscripciones que revisar", "%s: las encontrarás en Programados."},
	"fr":    {"Abonnements à vérifier", "%s : à voir dans Échéancier."},
	"de":    {"Abos zum Ansehen", "%s: unter Wiederkehrend."},
	"pt-BR": {"Assinaturas para conferir", "%s: estão em Agendamentos."},
}
