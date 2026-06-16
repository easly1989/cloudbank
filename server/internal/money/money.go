// Package money formats and parses monetary amounts. Amounts are always int64
// minor units (e.g. cents); floats never touch a value. Formatting metadata
// (fractional digits, decimal/group separators, symbol) comes from the currency.
package money

import (
	"errors"
	"strconv"
	"strings"
)

// ErrInvalid is returned when a string cannot be parsed as an amount.
var ErrInvalid = errors.New("money: invalid amount")

func pow10(n int) int64 {
	r := int64(1)
	for i := 0; i < n; i++ {
		r *= 10
	}
	return r
}

// Format renders amount (minor units) using the given metadata. Negative values
// are prefixed with '-'. A prefix symbol hugs the number ("$1,234.50"); a suffix
// symbol is separated by a space ("1.234,50 €").
func Format(amount int64, fracDigits int, decimalChar, groupChar, symbol string, symbolPrefix bool) string {
	if fracDigits < 0 {
		fracDigits = 0
	}
	neg := amount < 0
	abs := amount
	if neg {
		abs = -abs
	}
	scale := pow10(fracDigits)
	intPart := abs / scale
	fracPart := abs % scale

	num := group(strconv.FormatInt(intPart, 10), groupChar)
	if fracDigits > 0 {
		dc := decimalChar
		if dc == "" {
			dc = "."
		}
		fs := strconv.FormatInt(fracPart, 10)
		for len(fs) < fracDigits {
			fs = "0" + fs
		}
		num = num + dc + fs
	}

	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	if symbol != "" && symbolPrefix {
		b.WriteString(symbol)
	}
	b.WriteString(num)
	if symbol != "" && !symbolPrefix {
		b.WriteByte(' ')
		b.WriteString(symbol)
	}
	return b.String()
}

// group inserts groupChar every three digits from the right. An empty groupChar
// disables grouping.
func group(digits, groupChar string) string {
	if groupChar == "" || len(digits) <= 3 {
		return digits
	}
	var b strings.Builder
	pre := len(digits) % 3
	if pre > 0 {
		b.WriteString(digits[:pre])
	}
	for i := pre; i < len(digits); i += 3 {
		if b.Len() > 0 {
			b.WriteString(groupChar)
		}
		b.WriteString(digits[i : i+3])
	}
	return b.String()
}

// Parse reads a user-entered amount into minor units. It is lenient: group
// separators, currency symbols and spaces are ignored; the decimalChar splits
// the fractional part. Extra fractional digits are rounded half away from zero.
func Parse(s string, fracDigits int, decimalChar string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, ErrInvalid
	}
	if fracDigits < 0 {
		fracDigits = 0
	}
	neg := strings.Contains(s, "-") ||
		(strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")"))

	dc := byte('.')
	if decimalChar != "" {
		dc = decimalChar[0]
	}

	var intDigits, fracDigitsBuf []byte
	seenDec := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			if seenDec {
				fracDigitsBuf = append(fracDigitsBuf, c)
			} else {
				intDigits = append(intDigits, c)
			}
		case c == dc && !seenDec:
			seenDec = true
		}
	}
	if len(intDigits) == 0 && len(fracDigitsBuf) == 0 {
		return 0, ErrInvalid
	}

	var intVal int64
	for _, c := range intDigits {
		intVal = intVal*10 + int64(c-'0')
	}

	roundUp := false
	if len(fracDigitsBuf) > fracDigits {
		if fracDigitsBuf[fracDigits] >= '5' {
			roundUp = true
		}
		fracDigitsBuf = fracDigitsBuf[:fracDigits]
	}
	var fracVal int64
	for i := 0; i < fracDigits; i++ {
		fracVal *= 10
		if i < len(fracDigitsBuf) {
			fracVal += int64(fracDigitsBuf[i] - '0')
		}
	}

	total := intVal*pow10(fracDigits) + fracVal
	if roundUp {
		total++
	}
	if neg {
		total = -total
	}
	return total, nil
}
