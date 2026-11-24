package account

import (
	"errors"
	"regexp"
	"strings"
)

// Sentinel errors for a bank account's codes (#775).
var (
	ErrInvalidIBAN = errors.New("account: invalid IBAN")
	ErrInvalidBIC  = errors.New("account: invalid BIC")
)

// bankTypes keep an IBAN in the account number; the others (cards, cash,
// holdings, loans) keep whatever number their owner writes there.
var bankTypes = map[string]bool{"bank": true, "checking": true, "savings": true}

// IsBankType reports whether an account of type t carries an IBAN and a BIC.
func IsBankType(t string) bool { return bankTypes[t] }

var (
	looksLikeIBAN = regexp.MustCompile(`^[A-Z]{2}[0-9]{2}`)
	ibanShape     = regexp.MustCompile(`^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$`)
	bicShape      = regexp.MustCompile(`^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$`)
)

// Compact drops spaces and dashes and upper-cases: the IBAN's electronic form.
func Compact(s string) string {
	return strings.ToUpper(strings.NewReplacer(" ", "", "-", "", " ", "").Replace(strings.TrimSpace(s)))
}

// ValidIBAN reports whether s, in electronic form, is an IBAN whose ISO 13616
// check digits agree (mod 97 equals 1).
func ValidIBAN(s string) bool {
	if !ibanShape.MatchString(s) {
		return false
	}
	rearranged := s[4:] + s[:4]
	rem := 0
	for _, r := range rearranged {
		v := int(r - '0')
		if r >= 'A' && r <= 'Z' {
			v = int(r-'A') + 10
		}
		if v >= 10 {
			rem = (rem*100 + v) % 97
		} else {
			rem = (rem*10 + v) % 97
		}
	}
	return rem == 1
}

// normalizeCodes cleans a bank account's IBAN and BIC and checks them. An
// account number that does not start like an IBAN (two letters, two digits)
// is kept as written: accounts outside SEPA and numbers carried over from
// HomeBank have other shapes. A number the save does not change (prev) is not
// checked again, so an old one of an odd shape never blocks editing the rest
// of the account. Both fields may be empty; an account of another type keeps
// no BIC.
func normalizeCodes(in *Input, prev string) error {
	if !IsBankType(in.Type) {
		in.BIC = ""
		return nil
	}
	in.BIC = Compact(in.BIC)
	if in.BIC != "" && !bicShape.MatchString(in.BIC) {
		return ErrInvalidBIC
	}
	n := Compact(in.Number)
	if !looksLikeIBAN.MatchString(n) || n == Compact(prev) && !ValidIBAN(n) {
		return nil
	}
	if !ValidIBAN(n) {
		return ErrInvalidIBAN
	}
	in.Number = n
	return nil
}
