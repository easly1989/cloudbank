// Package bills presents the wallet's scheduled outflows as "bills": a
// read-only, what's-due view derived entirely from the existing scheduled
// transactions — no new entity. For a date horizon it enumerates each
// schedule's upcoming occurrences and classifies them as overdue, due, or
// (recently) paid, plus a base-currency "left to pay" total.
//
// Paid is derived from schedule state, not fuzzy transaction matching: a
// schedule advances its next-due date and records last_posted every time its
// transaction is posted (manually via "mark paid", or by auto-post), so an
// occurrence before next_due has already been paid and one at/after it has not.
// This is precise and has no false positives; the trade-off is that a payment
// entered by hand outside the schedule is not detected.
package bills

import (
	"context"
	"database/sql"
	"math"
	"sort"

	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// occurrenceCap bounds how many upcoming occurrences a single schedule
// contributes to one window, so a daily schedule over a long horizon cannot
// flood the list.
const occurrenceCap = 60

// State is a bill occurrence's payment state.
type State string

const (
	// StateOverdue is an unpaid occurrence whose due date is before today.
	StateOverdue State = "overdue"
	// StateDue is an unpaid occurrence due today or later, within the horizon.
	StateDue State = "due"
	// StatePaid is an occurrence already posted (its schedule advanced past it).
	StatePaid State = "paid"
)

// CurrencyInfo describes a currency for formatting an amount on the client.
type CurrencyInfo struct {
	Code         string `json:"code"`
	Symbol       string `json:"symbol"`
	SymbolPrefix bool   `json:"symbolPrefix"`
	DecimalChar  string `json:"decimalChar"`
	GroupChar    string `json:"groupChar"`
	FracDigits   int    `json:"fracDigits"`
}

// Bill is one occurrence of a scheduled outflow with its classification. Amount
// is in the account's own currency (signed, negative for an outflow);
// BaseAmount is the same value converted to the wallet's base currency.
type Bill struct {
	ScheduleID  int64        `json:"scheduleId"`
	TemplateID  int64        `json:"templateId"`
	Name        string       `json:"name"`
	AccountID   *int64       `json:"accountId,omitempty"`
	AccountName string       `json:"accountName,omitempty"`
	DueDate     string       `json:"dueDate"`
	Amount      int64        `json:"amount"`
	BaseAmount  int64        `json:"baseAmount"`
	Currency    CurrencyInfo `json:"currency"`
	State       State        `json:"state"`
	IsTransfer  bool         `json:"isTransfer"`
	AutoPost    bool         `json:"autoPost"`
}

// Summary is the Bills view payload: the classified occurrences plus a
// base-currency total still to pay and per-state counts.
type Summary struct {
	From         string        `json:"from"`
	To           string        `json:"to"`
	BaseCurrency *CurrencyInfo `json:"baseCurrency,omitempty"`
	Bills        []Bill        `json:"bills"`
	// TotalDue is the base-currency amount still to pay: the summed magnitude of
	// every unpaid (overdue + due) outflow, as a positive number.
	TotalDue int64 `json:"totalDue"`
	Overdue  int   `json:"overdue"`
	Due      int   `json:"due"`
	Paid     int   `json:"paid"`
}

// Service builds the Bills view from the read pool.
type Service struct {
	rq *db.Queries
}

// NewService builds a Service backed by the read connection pool.
func NewService(read *sql.DB) *Service { return &Service{rq: db.New(read)} }

func currencyInfo(c db.Currency) CurrencyInfo {
	return CurrencyInfo{
		Code: c.IsoCode, Symbol: c.Symbol, SymbolPrefix: c.SymbolPrefix != 0,
		DecimalChar: c.DecimalChar, GroupChar: c.GroupChar, FracDigits: int(c.FracDigits),
	}
}

// convertToBase converts a minor-unit amount in cur to base-currency minor
// units (decimal value × rate, adjusted for differing fractional digits).
// Display-only aggregation, so float rounding is fine.
func convertToBase(amount int64, cur, base db.Currency) int64 {
	if cur.ID == base.ID || cur.ID == 0 {
		return amount
	}
	scaled := float64(amount) * cur.Rate * math.Pow10(int(base.FracDigits)-int(cur.FracDigits))
	return int64(math.Round(scaled))
}

// Bills classifies the wallet's scheduled outflows into overdue/due/paid
// occurrences. Unpaid occurrences with a due date on or before `to` are
// included (an overdue bill counts however far back it fell due); a recently
// posted occurrence is shown as paid when its post date falls within [from, to]
// for context. `today` splits due from overdue.
func (s *Service) Bills(ctx context.Context, walletID int64, from, to, today string) (Summary, error) {
	out := Summary{From: from, To: to, Bills: []Bill{}}

	currencies, err := s.rq.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return Summary{}, err
	}
	curByID := make(map[int64]db.Currency, len(currencies))
	var base *db.Currency
	for i := range currencies {
		curByID[currencies[i].ID] = currencies[i]
		if currencies[i].IsBase != 0 {
			base = &currencies[i]
		}
	}
	if base != nil {
		bi := currencyInfo(*base)
		out.BaseCurrency = &bi
	}

	rows, err := s.rq.ListScheduleBills(ctx, walletID)
	if err != nil {
		return Summary{}, err
	}

	for _, r := range rows {
		// Bills are outflows: expenses and transfers out (negative amount).
		// Income schedules belong to the cashflow view, not here.
		if r.TemplateAmount >= 0 {
			continue
		}

		cur, hasCur := curByID[r.CurrencyID.Int64]
		info := CurrencyInfo{}
		if hasCur {
			info = currencyInfo(cur)
		} else if base != nil {
			info = currencyInfo(*base)
		}
		toBase := func(amount int64) int64 {
			if base == nil || !hasCur {
				return amount
			}
			return convertToBase(amount, cur, *base)
		}

		var accID *int64
		if r.AccountID.Valid {
			v := r.AccountID.Int64
			accID = &v
		}
		mk := func(dueDate string, state State) Bill {
			return Bill{
				ScheduleID: r.ID, TemplateID: r.TemplateID, Name: r.TemplateName,
				AccountID: accID, AccountName: r.AccountName.String, DueDate: dueDate,
				Amount: r.TemplateAmount, BaseAmount: toBase(r.TemplateAmount), Currency: info,
				State: state, IsTransfer: r.TemplateIsTransfer != 0, AutoPost: r.AutoPost != 0,
			}
		}

		// Recently paid: the last posted occurrence, shown for context when it
		// falls inside the window. last_posted is a real recorded value.
		if r.LastPosted.Valid && r.LastPosted.String >= from && r.LastPosted.String <= to {
			out.Bills = append(out.Bills, mk(r.LastPosted.String, StatePaid))
			out.Paid++
		}

		// Upcoming unpaid occurrences: walk forward from next_due up to `to`,
		// honouring a finite remaining count and the per-schedule cap.
		next, err := schedule.ParseDate(r.NextDue)
		if err != nil {
			continue // skip a schedule with an unparseable next-due rather than fail the view
		}
		limit := occurrenceCap
		if r.Remaining.Valid && int(r.Remaining.Int64) >= 0 && int(r.Remaining.Int64) < limit {
			limit = int(r.Remaining.Int64)
		}
		for i := 0; i < limit; i++ {
			d := schedule.FormatDate(next)
			if d > to {
				break
			}
			state := StateDue
			if d < today {
				state = StateOverdue
			}
			out.Bills = append(out.Bills, mk(d, state))
			if state == StateOverdue {
				out.Overdue++
			} else {
				out.Due++
			}
			// Positive outflow magnitude added to the running "left to pay".
			out.TotalDue += -toBase(r.TemplateAmount)
			next = schedule.AddInterval(next, r.Unit, int(r.EveryN))
		}
	}

	sortBills(out.Bills)
	return out, nil
}

// sortBills orders overdue first (oldest due first), then due (soonest first),
// then paid (most recent first); ties break by schedule id for stability.
func sortBills(bills []Bill) {
	rank := map[State]int{StateOverdue: 0, StateDue: 1, StatePaid: 2}
	sort.SliceStable(bills, func(i, j int) bool {
		a, b := bills[i], bills[j]
		if rank[a.State] != rank[b.State] {
			return rank[a.State] < rank[b.State]
		}
		if a.DueDate != b.DueDate {
			if a.State == StatePaid {
				return a.DueDate > b.DueDate // paid: newest first
			}
			return a.DueDate < b.DueDate // unpaid: soonest first
		}
		return a.ScheduleID < b.ScheduleID
	})
}
