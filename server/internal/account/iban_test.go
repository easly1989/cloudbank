package account

import (
	"errors"
	"testing"
)

func TestValidIBAN(t *testing.T) {
	for iban, want := range map[string]bool{
		"IT60X0542811101000000123456": true,  // the Italian sample IBAN
		"DE89370400440532013000":      true,  // the German one
		"GB82WEST12345698765432":      true,  // and the British one
		"IT60X0542811101000000123457": false, // last digit off: the check fails
		"IT60":                        false,
		"it60x0542811101000000123456": false, // electronic form is upper case
	} {
		if got := ValidIBAN(iban); got != want {
			t.Errorf("ValidIBAN(%q) = %v, want %v", iban, got, want)
		}
	}
}

func TestNormalizeCodes(t *testing.T) {
	in := Input{Type: "checking", Number: " it60 x054 2811 1010 0000 0123 456 ", BIC: " bpmoit22xxx "}
	if err := normalizeCodes(&in); err != nil {
		t.Fatal(err)
	}
	if in.Number != "IT60X0542811101000000123456" || in.BIC != "BPMOIT22XXX" {
		t.Fatalf("got %q / %q, want the electronic forms", in.Number, in.BIC)
	}

	// A number that does not start like an IBAN stays as written (HomeBank,
	// outside SEPA), and a card keeps whatever it has.
	for _, in := range []Input{
		{Type: "bank", Number: "000123-45"},
		{Type: "creditcard", Number: "IT00 not an iban"},
	} {
		want := in.Number
		if err := normalizeCodes(&in); err != nil || in.Number != want {
			t.Errorf("%s %q: got %q, %v", in.Type, want, in.Number, err)
		}
	}

	if err := normalizeCodes(&Input{Type: "savings", Number: "IT60X0542811101000000123457"}); !errors.Is(err, ErrInvalidIBAN) {
		t.Errorf("a wrong check digit: got %v, want ErrInvalidIBAN", err)
	}
	if err := normalizeCodes(&Input{Type: "bank", BIC: "BPMO"}); !errors.Is(err, ErrInvalidBIC) {
		t.Errorf("a short BIC: got %v, want ErrInvalidBIC", err)
	}
}
