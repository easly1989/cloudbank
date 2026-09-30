package schedule

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// maxCalendarDays bounds a calendar request: a month view with the days of
// the weeks around it needs 42, and a daily schedule projects one occurrence a
// day.
const maxCalendarDays = 100

// ErrInvalidRange means a calendar's from/to are not civil dates, are the
// wrong way round, or span more than maxCalendarDays.
var ErrInvalidRange = errors.New("schedule: invalid calendar range")

// Occurrence states.
const (
	StateRegistered = "registered" // a transaction exists
	StateDue        = "due"        // not registered, today or later
	StateOverdue    = "overdue"    // not registered, before today
)

// Occurrence is one date on which a schedule comes due: either a transaction
// it has already registered (in advance, on the day, or late), or one it has
// still to register, projected from its cadence.
type Occurrence struct {
	// ScheduleID is nil for a transaction whose schedule has since ended.
	ScheduleID *int64 `json:"scheduleId"`
	TemplateID int64  `json:"templateId"`
	Name       string `json:"name"`
	Date       string `json:"date"`
	Amount     int64  `json:"amount"`
	AccountID  int64  `json:"accountId"`
	IsTransfer bool   `json:"isTransfer"`
	IsSplit    bool   `json:"isSplit"`
	AutoPost   bool   `json:"autoPost"`
	State      string `json:"state"`
	// TransactionID and Status are set for a registered occurrence.
	TransactionID *int64 `json:"transactionId,omitempty"`
	Status        *int   `json:"status,omitempty"`
	// Next marks a schedule's first unregistered occurrence: the one that
	// posting now or skipping acts on.
	Next bool `json:"next"`
}

// Calendar is every occurrence of a wallet's schedules between two dates.
type Calendar struct {
	From        string       `json:"from"`
	To          string       `json:"to"`
	Today       string       `json:"today"`
	Occurrences []Occurrence `json:"occurrences"`
}

// Calendar lists the occurrences of a wallet's schedules from `from` to `to`
// (inclusive): the transactions they registered in that span, and the ones
// they have still to register, projected from each schedule's next due date
// with its weekend rule and occurrence limit.
func (s *Service) Calendar(ctx context.Context, walletID int64, from, to string, today time.Time) (Calendar, error) {
	f, err1 := ParseDate(from)
	t, err2 := ParseDate(to)
	if err1 != nil || err2 != nil || t.Before(f) || t.Sub(f) > maxCalendarDays*24*time.Hour {
		return Calendar{}, ErrInvalidRange
	}
	day := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	cal := Calendar{From: from, To: to, Today: FormatDate(day), Occurrences: []Occurrence{}}

	schedules, err := s.rq.ListSchedulesForCalendar(ctx, walletID)
	if err != nil {
		return Calendar{}, err
	}
	byTemplate := map[int64]db.ListSchedulesForCalendarRow{}
	for _, sc := range schedules {
		if _, ok := byTemplate[sc.TemplateID]; !ok {
			byTemplate[sc.TemplateID] = sc
		}
	}

	posted, err := s.rq.ListScheduledTransactionsInRange(ctx, db.ListScheduledTransactionsInRangeParams{
		WalletID: walletID, FromDate: from, ToDate: to,
	})
	if err != nil {
		return Calendar{}, err
	}
	for _, p := range posted {
		id, status := p.ID, int(p.Status)
		o := Occurrence{
			TemplateID: p.TemplateID.Int64, Name: p.TemplateName, Date: p.Date, Amount: p.Amount,
			AccountID: p.AccountID, IsTransfer: p.TemplateIsTransfer != 0, State: StateRegistered,
			TransactionID: &id, Status: &status,
		}
		if sc, ok := byTemplate[p.TemplateID.Int64]; ok {
			sid := sc.ID
			o.ScheduleID, o.AutoPost, o.IsSplit = &sid, sc.AutoPost != 0, sc.TemplateIsSplit != 0
		}
		cal.Occurrences = append(cal.Occurrences, o)
	}

	for _, sc := range schedules {
		cal.Occurrences = append(cal.Occurrences, project(sc, f, t, day)...)
	}
	sort.SliceStable(cal.Occurrences, func(i, j int) bool {
		a, b := cal.Occurrences[i], cal.Occurrences[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		return a.Name < b.Name
	})
	return cal, nil
}

// project walks a schedule's cadence from its next due date and returns the
// occurrences that land between from and to. It stops at the occurrence limit
// and never takes more than catchUpCap steps.
func project(sc db.ListSchedulesForCalendarRow, from, to, today time.Time) []Occurrence {
	due, err := ParseDate(sc.NextDue)
	if err != nil || !sc.AccountID.Valid {
		return nil
	}
	var out []Occurrence
	sid := sc.ID
	for i := 0; i < catchUpCap && !due.After(to.AddDate(0, 0, 3)); i++ {
		if sc.Remaining.Valid && int64(i) >= sc.Remaining.Int64 {
			break
		}
		date, skip := AdjustWeekend(due, int(sc.WeekendMode))
		if !skip && !date.Before(from) && !date.After(to) {
			state := StateDue
			if date.Before(today) {
				state = StateOverdue
			}
			out = append(out, Occurrence{
				ScheduleID: &sid, TemplateID: sc.TemplateID, Name: sc.TemplateName,
				Date: FormatDate(date), Amount: sc.TemplateAmount, AccountID: sc.AccountID.Int64,
				IsTransfer: sc.TemplateIsTransfer != 0, IsSplit: sc.TemplateIsSplit != 0,
				AutoPost: sc.AutoPost != 0, State: state, Next: i == 0,
			})
		}
		due = AddInterval(due, sc.Unit, int(sc.EveryN))
	}
	return out
}
