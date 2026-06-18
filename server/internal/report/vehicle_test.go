package report

import (
	"context"
	"math"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func TestParseFuelMemo(t *testing.T) {
	cases := []struct {
		memo            string
		meter, vol, prc float64
		hasV            bool
	}{
		{"d=10000 v=40 p=1.5", 10000, 40, 1.5, true},
		{"fill up d=10500 v=35,5", 10500, 35.5, 0, true}, // it-IT decimal comma
		{"d=10800", 10800, 0, 0, false},                  // partial: no volume
		{"v=20 d=12000", 12000, 20, 0, true},             // any order
		{"random note", 0, 0, 0, false},                  // no tokens
	}
	for _, c := range cases {
		f := parseFuelMemo(c.memo)
		if f.meter != c.meter || f.volume != c.vol || f.price != c.prc || f.hasVolume != c.hasV {
			t.Fatalf("parse(%q) = %+v", c.memo, f)
		}
	}
}

func approx(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func TestVehicleConsumptionBetweenFullFills(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	carCat, _ := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.wid, Name: "Car"})
	car := carCat.ID

	// A full fill, a full fill (segment 1), a partial fill, then a full fill
	// (segment 2 spans the partial). Costs in EUR.
	seq := []struct {
		date, memo string
		amount     int64
	}{
		{"2026-01-01", "d=10000 v=40 p=1.50", -6000}, // baseline
		{"2026-01-10", "d=10500 v=35 p=1.50", -5250}, // 500 km, 35 L → 7.0
		{"2026-01-18", "d=10800", -3000},             // partial, no volume
		{"2026-01-25", "d=11000 v=45 p=1.50", -6750}, // 500 km (since last full), 45 L → 9.0
	}
	for _, s := range seq {
		_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: s.date, Amount: s.amount, CategoryID: &car, Memo: s.memo})
	}

	rep, err := f.s.Vehicle(ctx, f.wid, car, "2026-01-01", "2026-12-31")
	if err != nil {
		t.Fatalf("Vehicle: %v", err)
	}
	if len(rep.Entries) != 4 {
		t.Fatalf("entries = %d, want 4", len(rep.Entries))
	}
	// Per-entry consumption: only at full fills that closed a segment.
	if !approx(rep.Entries[1].Consumption, 7.0) {
		t.Fatalf("entry 1 consumption = %v, want 7.0", rep.Entries[1].Consumption)
	}
	if rep.Entries[2].Consumption != 0 || !rep.Entries[2].Partial {
		t.Fatalf("entry 2 (partial) = %+v", rep.Entries[2])
	}
	if !approx(rep.Entries[3].Consumption, 9.0) {
		t.Fatalf("entry 3 consumption = %v, want 9.0", rep.Entries[3].Consumption)
	}
	if !approx(rep.TotalDistance, 1000) {
		t.Fatalf("total distance = %v, want 1000", rep.TotalDistance)
	}
	if !approx(rep.TotalVolume, 120) {
		t.Fatalf("total volume = %v, want 120", rep.TotalVolume)
	}
	// Average between full fills = (35+45)/(500+500) * 100 = 8.0.
	if !approx(rep.AvgConsumption, 8.0) {
		t.Fatalf("avg consumption = %v, want 8.0", rep.AvgConsumption)
	}
	if rep.TotalCost != 21000 {
		t.Fatalf("total cost = %d, want 21000", rep.TotalCost)
	}
	// Entry distance reflects the odometer leg.
	if !approx(rep.Entries[2].Distance, 300) {
		t.Fatalf("partial leg distance = %v, want 300", rep.Entries[2].Distance)
	}
}
