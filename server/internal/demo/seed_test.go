package demo

import (
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/importer"
)

func cents(t *testing.T, s string) int64 {
	t.Helper()
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	whole, frac, ok := strings.Cut(s, ".")
	if !ok || len(frac) != 2 {
		t.Fatalf("amount %q is not written with two decimals", s)
	}
	var n int64
	for _, r := range whole + frac {
		n = n*10 + int64(r-'0')
	}
	if neg {
		n = -n
	}
	return n
}

// Opened on any day of a year and a half, the seed stays whole: every date is
// in the year ending that day, splits add up, and no two equal amounts on one
// account fall close enough to be flagged as duplicates.
func TestSeedHoldsOnEveryDay(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for day := 0; day < 540; day++ {
		today := start.AddDate(0, 0, day)
		for _, italian := range []bool{false, true} {
			x := seedFile(today, italian)
			first, last := julian(today.AddDate(-1, 0, 0)), julian(today)
			type key struct {
				account int
				amount  int64
			}
			seen := map[key][]int{}
			for _, o := range x.Operations {
				if o.Date < first || o.Date > last {
					t.Fatalf("%s: a transaction on day %d falls outside the year", today.Format("2006-01-02"), o.Date)
				}
				amt := cents(t, o.Amount)
				if o.Scat != "" {
					var sum int64
					for _, part := range strings.Split(o.Samt, "||") {
						sum += cents(t, part)
					}
					if sum != amt {
						t.Fatalf("%s: a split's parts add to %d, not %d", today.Format("2006-01-02"), sum, amt)
					}
				}
				k := key{o.Account, amt}
				for _, other := range seen[k] {
					if gap := o.Date - other; gap >= -lookAlikeDays && gap <= lookAlikeDays {
						t.Fatalf("%s: account %d has %s twice within %d days",
							today.Format("2006-01-02"), o.Account, o.Amount, gap)
					}
				}
				seen[k] = append(seen[k], o.Date)
			}
			if len(x.Operations) < 300 {
				t.Fatalf("%s: only %d transactions", today.Format("2006-01-02"), len(x.Operations))
			}
			checkTransfers(t, today, x)
		}
	}
}

// Each transfer is two legs of the same size, one out and one in.
func checkTransfers(t *testing.T, today time.Time, x *importer.XHB) {
	t.Helper()
	legs := map[int][]importer.XOpe{}
	for _, o := range x.Operations {
		if o.Kxfer > 0 {
			legs[o.Kxfer] = append(legs[o.Kxfer], o)
		}
	}
	for k, pair := range legs {
		if len(pair) != 2 || cents(t, pair[0].Amount) != -cents(t, pair[1].Amount) {
			t.Fatalf("%s: transfer %d is not two matching legs: %+v", today.Format("2006-01-02"), k, pair)
		}
	}
}
