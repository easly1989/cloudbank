package schedule

import (
	"testing"
	"time"
)

func d(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := ParseDate(s)
	if err != nil {
		t.Fatalf("ParseDate(%q): %v", s, err)
	}
	return v
}

func TestAddInterval(t *testing.T) {
	cases := []struct {
		name string
		from string
		unit string
		n    int
		want string
	}{
		{"day", "2026-01-15", UnitDay, 10, "2026-01-25"},
		{"week", "2026-01-15", UnitWeek, 2, "2026-01-29"},
		{"month simple", "2026-01-15", UnitMonth, 1, "2026-02-15"},
		{"month-end Jan31+1", "2026-01-31", UnitMonth, 1, "2026-02-28"},
		{"month-end Jan31+1 leap", "2024-01-31", UnitMonth, 1, "2024-02-29"},
		{"month Mar31+1", "2026-03-31", UnitMonth, 1, "2026-04-30"},
		{"month wrap year", "2026-12-15", UnitMonth, 1, "2027-01-15"},
		{"every 3 months", "2026-01-31", UnitMonth, 3, "2026-04-30"},
		{"year", "2026-06-01", UnitYear, 1, "2027-06-01"},
		{"leap Feb29 +1y", "2024-02-29", UnitYear, 1, "2025-02-28"},
		{"leap Feb29 +4y", "2024-02-29", UnitYear, 4, "2028-02-29"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := FormatDate(AddInterval(d(t, c.from), c.unit, c.n))
			if got != c.want {
				t.Fatalf("AddInterval(%s, %s, %d) = %s, want %s", c.from, c.unit, c.n, got, c.want)
			}
		})
	}
}

func TestAdjustWeekend(t *testing.T) {
	// 2026-03-14 is a Saturday, 2026-03-15 a Sunday, 2026-03-16 a Monday.
	cases := []struct {
		name     string
		date     string
		mode     int
		want     string
		wantSkip bool
	}{
		{"none weekday", "2026-03-13", WeekendNone, "2026-03-13", false},
		{"none saturday", "2026-03-14", WeekendNone, "2026-03-14", false},
		{"before saturday", "2026-03-14", WeekendBefore, "2026-03-13", false},
		{"before sunday", "2026-03-15", WeekendBefore, "2026-03-13", false},
		{"after saturday", "2026-03-14", WeekendAfter, "2026-03-16", false},
		{"after sunday", "2026-03-15", WeekendAfter, "2026-03-16", false},
		{"after weekday noop", "2026-03-13", WeekendAfter, "2026-03-13", false},
		{"skip saturday", "2026-03-14", WeekendSkip, "2026-03-14", true},
		{"skip weekday", "2026-03-13", WeekendSkip, "2026-03-13", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, skip := AdjustWeekend(d(t, c.date), c.mode)
			if FormatDate(got) != c.want || skip != c.wantSkip {
				t.Fatalf("AdjustWeekend(%s, %d) = (%s, %v), want (%s, %v)",
					c.date, c.mode, FormatDate(got), skip, c.want, c.wantSkip)
			}
		})
	}
}
