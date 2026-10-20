package goal

import "testing"

func TestShareAndPace(t *testing.T) {
	date := "2027-04-30"
	g := Goal{TargetAmount: 120000, Saved: 30000, TargetDate: &date}
	moves := []Contribution{{Date: "2026-08-10", Amount: 10001}, {Date: "2026-09-10", Amount: 10000}, {Date: "2026-10-10", Amount: 10000}, {Date: "2026-11-01", Amount: 50000}}
	need, pace := ShareAndPace(g, moves, "2026-11-01", 2)
	if need != 18000 || pace != 10000 {
		t.Fatalf("need %d pace %d", need, pace)
	}
	past := "2026-10-01"
	g.TargetDate = &past
	if need, _ := ShareAndPace(g, nil, "2026-11-01", 2); need != 90000 {
		t.Fatalf("past date need = %d", need)
	}
}
