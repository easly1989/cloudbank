package goal

import "strconv"

// The Goals page's arithmetic (web/src/pages/goals/goalList.ts), for the
// notifications (#691) and the AI's proposals (#699) to say what the page says.

// MonthIndex is a civil date's month as one number: year × 12 + month − 1.
func MonthIndex(date string) int {
	y, _ := strconv.Atoi(date[:4])
	m, _ := strconv.Atoi(date[5:7])
	return y*12 + m - 1
}

func unitOf(frac int) int64 {
	unit := int64(1)
	for range frac {
		unit *= 10
	}
	return unit
}

// Pace is what went in a month over the last three full months before
// today's, rounded to the whole unit.
func Pace(moves []Contribution, today string, frac int) int64 {
	unit := unitOf(frac)
	now := MonthIndex(today)
	var sum int64
	for _, c := range moves {
		if m := MonthIndex(c.Date); m >= now-3 && m < now {
			sum += c.Amount
		}
	}
	if sum <= 0 {
		return 0
	}
	// Math.round of a positive number: half up.
	return (sum*2/3/unit + 1) / 2 * unit
}

// ShareAndPace is, for a dated goal not reached, the monthly share still
// needed, rounded up to the whole unit (all that is left once its date has
// gone by), and its Pace.
func ShareAndPace(g Goal, moves []Contribution, today string, frac int) (need, pace int64) {
	unit := unitOf(frac)
	pace = Pace(moves, today, frac)
	left := max(0, g.TargetAmount-g.Saved)
	if *g.TargetDate < today {
		return left, pace
	}
	months := int64(max(1, MonthIndex(*g.TargetDate)-MonthIndex(today)))
	return (left + months*unit - 1) / (months * unit) * unit, pace
}
