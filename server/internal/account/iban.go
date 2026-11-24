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

// compact drops spaces and dashes and upper-cases, the IBAN's electronic form.
func compact(s string) string {
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
// HomeBank have other shapes. Both fields may be empty.
func normalizeCodes(in *Input) error {
	in.BIC = compact(in.BIC)
	if in.BIC != "" && !bicShape.MatchString(in.BIC) {
		return ErrInvalidBIC
	}
	if !IsBankType(in.Type) {
		return nil
	}
	if n := compact(in.Number); looksLikeIBAN.MatchString(n) {
		if !ValidIBAN(n) {
			return ErrInvalidIBAN
		}
		in.Number = n
	}
	return nil
}
