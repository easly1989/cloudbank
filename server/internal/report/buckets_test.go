package report

import (
	"reflect"
	"testing"
)

func TestBucketKey(t *testing.T) {
	cases := []struct {
		date, interval, want string
	}{
		{"2026-03-15", BucketDay, "2026-03-15"},
		{"2026-03-15", BucketMonth, "2026-03"},
		{"2026-03-15", BucketQuarter, "2026-Q1"},
		{"2026-04-01", BucketQuarter, "2026-Q2"},
		{"2026-12-31", BucketQuarter, "2026-Q4"},
		{"2026-03-15", BucketYear, "2026"},
		// 2026-03-14 is a Saturday → Monday of that week is 2026-03-09.
		{"2026-03-14", BucketWeek, "2026-03-09"},
		{"2026-03-09", BucketWeek, "2026-03-09"},
		// Week spanning a month/year edge: 2027-01-01 is a Friday → Monday 2026-12-28.
		{"2027-01-01", BucketWeek, "2026-12-28"},
	}
	for _, c := range cases {
		got, err := BucketKey(c.date, c.interval)
		if err != nil || got != c.want {
			t.Fatalf("BucketKey(%s,%s) = %q,%v; want %q", c.date, c.interval, got, err, c.want)
		}
	}
}

func TestGenerateBucketsAcrossYearEdges(t *testing.T) {
	// Monthly across a year boundary.
	got, err := GenerateBuckets("2026-11-15", "2027-02-03", BucketMonth)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"2026-11", "2026-12", "2027-01", "2027-02"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("months = %v, want %v", got, want)
	}

	// Quarterly across a year boundary.
	gotQ, _ := GenerateBuckets("2026-10-01", "2027-04-30", BucketQuarter)
	wantQ := []string{"2026-Q4", "2027-Q1", "2027-Q2"}
	if !reflect.DeepEqual(gotQ, wantQ) {
		t.Fatalf("quarters = %v, want %v", gotQ, wantQ)
	}

	// Yearly.
	gotY, _ := GenerateBuckets("2025-06-01", "2027-01-01", BucketYear)
	if !reflect.DeepEqual(gotY, []string{"2025", "2026", "2027"}) {
		t.Fatalf("years = %v", gotY)
	}

	// Weekly across the new-year edge (Mondays).
	gotW, _ := GenerateBuckets("2026-12-28", "2027-01-05", BucketWeek)
	if !reflect.DeepEqual(gotW, []string{"2026-12-28", "2027-01-04"}) {
		t.Fatalf("weeks = %v", gotW)
	}
}
