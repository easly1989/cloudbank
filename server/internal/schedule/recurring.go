package schedule

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"sort"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Recurring payments found in the transactions (#693): the same payee paid,
// or paying, a similar amount at a regular cadence, with no schedule for it.

// Cadence is how often a recurring payment comes round.
type Cadence string

// The cadences a recurring payment is recognised at.
const (
	Weekly    Cadence = "weekly"
	Monthly   Cadence = "monthly"
	Quarterly Cadence = "quarterly"
	Yearly    Cadence = "yearly"
)

// ErrInvalidCadence is returned for a cadence that is not one of the four.
var ErrInvalidCadence = errors.New("schedule: invalid cadence")

// ErrPayee is returned for a payee that is not in the wallet.
var ErrPayee = errors.New("schedule: payee not found in this wallet")

// Paid is one transaction of a payee: its civil date, amount and account.
type Paid struct {
	Date      string
	Amount    int64
	AccountID int64
}

// Found is a recurring payment: its cadence, the usual amount, how many
// payments in a row show it, the first and last of them, the date the next is
// due, and what it adds up to in a year. All amounts in minor units.
type Found struct {
	Cadence   Cadence
	Amount    int64
	AccountID int64
	Count     int
	First     string
	Last      string
	NextDue   string
	Yearly    int64
}

// rule is what a cadence asks of the payments: the days between two of them,
// how many in a row, how far back to look, and how a schedule repeats it.
type rule struct {
	cadence Cadence
	lo, hi  int // days between two payments
	min     int // payments in a row
	period  int // nominal days, for "still active"
	back    int // months to look back
	unit    string
	everyN  int
	perYear float64 // occurrences in a year, as the web counts them
}

var rules = []rule{
	{Weekly, 5, 9, 4, 7, 13, UnitWeek, 1, 365.25 / 7},
	{Monthly, 25, 34, 3, 30, 13, UnitMonth, 1, 12},
	{Quarterly, 84, 98, 3, 91, 13, UnitMonth, 3, 4},
	{Yearly, 355, 375, 2, 365, 25, UnitYear, 1, 1},
}

// repeatOf is how a schedule repeats a cadence: the unit and every how many.
func repeatOf(c Cadence) (string, int, bool) {
	for _, r := range rules {
		if r.cadence == c {
			return r.unit, r.everyN, true
		}
	}
	return "", 0, false
}

// median of minor amounts; the two middle ones averaged for an even count.
func median(v []int64) int64 {
	s := append([]int64(nil), v...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// Detect tells whether one payee's payments, in one currency and one
// direction and in date order, recur as of today. Each cadence in turn looks
// at its own window back: the payments within 10% of their median amount,
// and the run of them, ending with the latest, spaced as the cadence says.
// The run must be long enough and its last payment recent enough.
func Detect(paid []Paid, today time.Time) (Found, bool) {
	for _, r := range rules {
		from := FormatDate(today.AddDate(0, -r.back, 0))
		var window []Paid
		var amounts []int64
		for _, p := range paid {
			if p.Date >= from {
				window = append(window, p)
				amounts = append(amounts, p.Amount)
			}
		}
		if len(window) < r.min {
			continue
		}
		mid := median(amounts)
		if mid == 0 {
			continue
		}
		var near []Paid
		for _, p := range window {
			if abs(p.Amount-mid)*10 <= abs(mid) {
				near = append(near, p)
			}
		}
		if len(near) < r.min {
			continue
		}
		start := len(near) - 1
		for start > 0 && within(near[start-1].Date, near[start].Date, r.lo, r.hi) {
			start--
		}
		run := near[start:]
		last, _ := ParseDate(run[len(run)-1].Date)
		if len(run) < r.min || int(today.Sub(last).Hours()/24)*2 > r.period*3 {
			continue
		}
		var runAmounts []int64
		for _, p := range run {
			runAmounts = append(runAmounts, p.Amount)
		}
		amount := median(runAmounts)
		return Found{
			Cadence: r.cadence, Amount: amount, AccountID: run[len(run)-1].AccountID, Count: len(run),
			First: run[0].Date, Last: run[len(run)-1].Date,
			NextDue: FormatDate(AddInterval(last, r.unit, r.everyN)), Yearly: int64(math.Round(float64(amount) * r.perYear)),
		}, true
	}
	return Found{}, false
}

// within reports whether two civil dates are lo to hi days apart.
func within(a, b string, lo, hi int) bool {
	ta, e1 := ParseDate(a)
	tb, e2 := ParseDate(b)
	if e1 != nil || e2 != nil {
		return false
	}
	d := int(tb.Sub(ta).Hours() / 24)
	return d >= lo && d <= hi
}

// Proposal is a recurring payment offered as a schedule.
type Proposal struct {
	PayeeID   int64  `json:"payeeId"`
	PayeeName string `json:"payeeName"`
	AccountID int64  `json:"accountId"`
	Amount    int64  `json:"amount"`
	Cadence   string `json:"cadence"`
	Unit      string `json:"unit"`
	EveryN    int    `json:"everyN"`
	Count     int    `json:"count"`
	First     string `json:"first"`
	Last      string `json:"last"`
	NextDue   string `json:"nextDue"`
	Yearly    int64  `json:"yearly"`
}

// Proposals finds the wallet's recurring payments as of today, leaving out
// the payees a schedule already pays and what the reader ignored. Each payee
// is looked at per currency and direction; the costliest come first.
func (s *Service) Proposals(ctx context.Context, walletID int64, today time.Time) ([]Proposal, error) {
	rows, err := s.rq.ListRecurringCandidates(ctx, db.ListRecurringCandidatesParams{
		WalletID: walletID, FromDate: FormatDate(today.AddDate(0, -25, 0)), ToDate: FormatDate(today),
	})
	if err != nil {
		return nil, err
	}
	ignored, err := s.rq.ListRecurringIgnored(ctx, walletID)
	if err != nil {
		return nil, err
	}
	skip := map[db.ListRecurringIgnoredRow]bool{}
	for _, ig := range ignored {
		skip[ig] = true
	}
	type key struct {
		payee, currency int64
		income          bool
	}
	groups := map[key][]Paid{}
	names := map[int64]string{}
	var order []key
	for _, r := range rows {
		k := key{r.PayeeID, r.CurrencyID, r.Amount > 0}
		if _, ok := groups[k]; !ok {
			order = append(order, k)
		}
		groups[k] = append(groups[k], Paid{Date: r.Date, Amount: r.Amount, AccountID: r.AccountID})
		names[r.PayeeID] = r.PayeeName
	}
	out := []Proposal{}
	for _, k := range order {
		f, ok := Detect(groups[k], today)
		if !ok || skip[db.ListRecurringIgnoredRow{PayeeID: k.payee, Cadence: string(f.Cadence)}] {
			continue
		}
		unit, everyN, _ := repeatOf(f.Cadence)
		out = append(out, Proposal{
			PayeeID: k.payee, PayeeName: names[k.payee], AccountID: f.AccountID, Amount: f.Amount,
			Cadence: string(f.Cadence), Unit: unit, EveryN: everyN, Count: f.Count,
			First: f.First, Last: f.Last, NextDue: f.NextDue, Yearly: f.Yearly,
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return abs(out[i].Yearly) > abs(out[j].Yearly) })
	return out, nil
}

// Ignore stops proposing a payee at a cadence in the wallet.
func (s *Service) Ignore(ctx context.Context, walletID, payeeID int64, cadence string) error {
	if _, _, ok := repeatOf(Cadence(cadence)); !ok {
		return ErrInvalidCadence
	}
	p, err := s.q.GetPayee(ctx, payeeID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && p.WalletID != walletID) {
		return ErrPayee
	}
	if err != nil {
		return err
	}
	return s.q.InsertRecurringIgnored(ctx, db.InsertRecurringIgnoredParams{WalletID: walletID, PayeeID: payeeID, Cadence: cadence})
}
