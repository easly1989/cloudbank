package importer

import (
	"strings"
	"testing"
)

func TestJulianToDate(t *testing.T) {
	cases := map[int]string{
		719163: "1970-01-01",
		738945: "2024-02-29", // leap day
		739617: "2026-01-01",
	}
	for j, want := range cases {
		if got := julianToDate(j); got != want {
			t.Fatalf("julianToDate(%d) = %s, want %s", j, got, want)
		}
	}
}

func TestParseAmount(t *testing.T) {
	cases := []struct {
		s    string
		frac int
		want int64
	}{
		{"120.40", 2, 12040},
		{"-50.0", 2, -5000},
		{"11", 2, 1100},
		{"1.005", 2, 101},   // half away from zero → up
		{"-1.005", 2, -101}, // away from zero (more negative)
		{"3.14159", 2, 314},
		{"100", 0, 100},
		{"", 2, 0},
	}
	for _, c := range cases {
		if got := parseAmount(c.s, c.frac); got != c.want {
			t.Fatalf("parseAmount(%q,%d) = %d, want %d", c.s, c.frac, got, c.want)
		}
	}
}

func TestParseXHB(t *testing.T) {
	data := `<homebank v="1.4" d="050700">
  <properties title="My Money" curr="1"/>
  <cur key="1" iso="EUR" name="Euro" symb="€" frac="2" rate="0"/>
  <account key="1" pos="1" type="1" curr="1" name="Checking" initial="100.0"/>
  <ope date="738885" amount="-50.0" account="1" paymode="3" st="1" wording="lunch" scat="1||2" samt="-30.0||-20.0"/>
</homebank>`
	x, err := ParseXHB(strings.NewReader(data))
	if err != nil {
		t.Fatalf("ParseXHB: %v", err)
	}
	if x.Properties.Title != "My Money" || x.Properties.Curr != 1 {
		t.Fatalf("properties = %+v", x.Properties)
	}
	if len(x.Currencies) != 1 || x.Currencies[0].ISO != "EUR" {
		t.Fatalf("currencies = %+v", x.Currencies)
	}
	if len(x.Operations) != 1 || x.Operations[0].Wording != "lunch" {
		t.Fatalf("operations = %+v", x.Operations)
	}
	if got := splitList(x.Operations[0].Scat); len(got) != 2 || got[1] != "2" {
		t.Fatalf("scat = %v", got)
	}
}
