package money

import "testing"

func TestFormat(t *testing.T) {
	tests := []struct {
		name     string
		amount   int64
		frac     int
		dec, grp string
		symbol   string
		prefix   bool
		want     string
	}{
		{"usd", 123450, 2, ".", ",", "$", true, "$1,234.50"},
		{"eur suffix", 123450, 2, ",", ".", "€", false, "1.234,50 €"},
		{"negative usd", -99, 2, ".", ",", "$", true, "-$0.99"},
		{"jpy no frac", 1234, 0, ".", ",", "¥", true, "¥1,234"},
		{"no symbol", 1000, 2, ".", ",", "", true, "10.00"},
		{"three digits no group", 500, 2, ".", ",", "", false, "5.00"},
		{"millions grouped", 1234567890, 2, ".", ",", "$", true, "$12,345,678.90"},
		{"three frac digits", 1234, 3, ".", ",", "", false, "1.234"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := Format(tc.amount, tc.frac, tc.dec, tc.grp, tc.symbol, tc.prefix)
			if got != tc.want {
				t.Errorf("Format = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestParse(t *testing.T) {
	tests := []struct {
		name string
		in   string
		frac int
		dec  string
		want int64
	}{
		{"plain", "1234.50", 2, ".", 123450},
		{"grouped", "1,234.50", 2, ".", 123450},
		{"it locale", "1.234,50", 2, ",", 123450},
		{"with symbol", "$1,234.50", 2, ".", 123450},
		{"negative", "-99.00", 2, ".", -9900},
		{"parens negative", "(5.00)", 2, ".", -500},
		{"jpy", "1,234", 0, ".", 1234},
		{"round half up", "1.235", 2, ".", 124},
		{"round down", "1.234", 2, ".", 123},
		{"fewer decimals", "1.5", 2, ".", 150},
		{"integer only", "42", 2, ".", 4200},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Parse(tc.in, tc.frac, tc.dec)
			if err != nil {
				t.Fatalf("Parse(%q) error: %v", tc.in, err)
			}
			if got != tc.want {
				t.Errorf("Parse(%q) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

func TestParseRoundTrip(t *testing.T) {
	for _, amount := range []int64{0, 1, -1, 99, 100, -12345, 1234567890} {
		s := Format(amount, 2, ".", ",", "", false)
		got, err := Parse(s, 2, ".")
		if err != nil || got != amount {
			t.Errorf("round trip %d -> %q -> %d (err %v)", amount, s, got, err)
		}
	}
}

func TestParseInvalid(t *testing.T) {
	for _, in := range []string{"", "   ", "abc", "$"} {
		if _, err := Parse(in, 2, "."); err == nil {
			t.Errorf("Parse(%q) expected error", in)
		}
	}
}
