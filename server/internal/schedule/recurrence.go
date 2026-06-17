package schedule

import "time"

// DateLayout is the civil-date format used throughout (no timezone).
const DateLayout = "2006-01-02"

// Recurrence units.
const (
	UnitDay   = "day"
	UnitWeek  = "week"
	UnitMonth = "month"
	UnitYear  = "year"
)

// Weekend adjustment modes.
const (
	WeekendNone   = 0 // post on the weekend, unchanged
	WeekendBefore = 1 // move to the previous Friday
	WeekendAfter  = 2 // move to the following Monday
	WeekendSkip   = 3 // skip an occurrence that lands on a weekend
)

// ParseDate parses a civil date (YYYY-MM-DD) as UTC midnight.
func ParseDate(s string) (time.Time, error) {
	return time.Parse(DateLayout, s)
}

// FormatDate renders a civil date.
func FormatDate(t time.Time) string { return t.Format(DateLayout) }

// AddInterval returns d advanced by n units. Month and year steps clamp to the
// end of the target month, so Jan 31 + 1 month is Feb 28 (or Feb 29 in a leap
// year) and Feb 29 + 1 year is Feb 28.
func AddInterval(d time.Time, unit string, n int) time.Time {
	switch unit {
	case UnitWeek:
		return d.AddDate(0, 0, 7*n)
	case UnitMonth:
		return addMonths(d, n)
	case UnitYear:
		return addMonths(d, 12*n)
	default: // UnitDay
		return d.AddDate(0, 0, n)
	}
}

func addMonths(d time.Time, months int) time.Time {
	y, m, day := d.Date()
	total := int(m) - 1 + months
	ny := y + floorDiv(total, 12)
	nm := time.Month(mod(total, 12) + 1)
	if last := daysInMonth(ny, nm); day > last {
		day = last
	}
	return time.Date(ny, nm, day, 0, 0, 0, 0, time.UTC)
}

func daysInMonth(y int, m time.Month) int {
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func floorDiv(a, b int) int {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

func mod(a, b int) int {
	m := a % b
	if m < 0 {
		m += b
	}
	return m
}

// AdjustWeekend applies a weekend mode to a due date. It returns the adjusted
// post date and whether the occurrence should be skipped entirely (only the
// "skip" mode can set this).
func AdjustWeekend(d time.Time, mode int) (time.Time, bool) {
	switch mode {
	case WeekendBefore:
		switch d.Weekday() {
		case time.Saturday:
			return d.AddDate(0, 0, -1), false
		case time.Sunday:
			return d.AddDate(0, 0, -2), false
		}
	case WeekendAfter:
		switch d.Weekday() {
		case time.Saturday:
			return d.AddDate(0, 0, 2), false
		case time.Sunday:
			return d.AddDate(0, 0, 1), false
		}
	case WeekendSkip:
		if wd := d.Weekday(); wd == time.Saturday || wd == time.Sunday {
			return d, true
		}
	}
	return d, false
}
