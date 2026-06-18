// Package importer reads HomeBank .xhb files (a documented XML format) and
// populates a new wallet. Clean-room implementation: parsing is from the public
// file structure only; no HomeBank source is reused.
package importer

import (
	"encoding/xml"
	"io"
	"strconv"
	"strings"
	"time"
)

// XHB is a parsed HomeBank file.
type XHB struct {
	XMLName     xml.Name    `xml:"homebank"`
	Version     string      `xml:"v,attr"`
	Properties  XProperties `xml:"properties"`
	Currencies  []XCur      `xml:"cur"`
	Accounts    []XAccount  `xml:"account"`
	Payees      []XPayee    `xml:"pay"`
	Categories  []XCat      `xml:"cat"`
	Tags        []XTag      `xml:"tag"`
	Operations  []XOpe      `xml:"ope"`
	Favorites   []XFav      `xml:"fav"`
	Assignments []XAsg      `xml:"asg"`
}

// XProperties holds the file's wallet-level settings.
type XProperties struct {
	Title string `xml:"title,attr"`
	Curr  int    `xml:"curr,attr"` // base currency key
}

// XCur is a currency definition.
type XCur struct {
	Key   int     `xml:"key,attr"`
	ISO   string  `xml:"iso,attr"`
	Name  string  `xml:"name,attr"`
	Symb  string  `xml:"symb,attr"`
	Syprf int     `xml:"syprf,attr"`
	Dchar string  `xml:"dchar,attr"`
	Gchar string  `xml:"gchar,attr"`
	Frac  int     `xml:"frac,attr"`
	Rate  float64 `xml:"rate,attr"`
}

// XAccount is an account.
type XAccount struct {
	Key      int    `xml:"key,attr"`
	Pos      int    `xml:"pos,attr"`
	Type     int    `xml:"type,attr"`
	Curr     int    `xml:"curr,attr"`
	Flags    int    `xml:"flags,attr"`
	Name     string `xml:"name,attr"`
	Number   string `xml:"number,attr"`
	Bankname string `xml:"bankname,attr"`
	Initial  string `xml:"initial,attr"`
	Minimum  string `xml:"minimum,attr"`
	Notes    string `xml:"notes,attr"`
}

// XPayee is a payee.
type XPayee struct {
	Key  int    `xml:"key,attr"`
	Name string `xml:"name,attr"`
}

// XCat is a category, possibly with a budget (b0 = same; b1..b12 = monthly).
type XCat struct {
	Key    int    `xml:"key,attr"`
	Parent int    `xml:"parent,attr"`
	Flags  int    `xml:"flags,attr"`
	Name   string `xml:"name,attr"`
	B0     string `xml:"b0,attr"`
	B1     string `xml:"b1,attr"`
	B2     string `xml:"b2,attr"`
	B3     string `xml:"b3,attr"`
	B4     string `xml:"b4,attr"`
	B5     string `xml:"b5,attr"`
	B6     string `xml:"b6,attr"`
	B7     string `xml:"b7,attr"`
	B8     string `xml:"b8,attr"`
	B9     string `xml:"b9,attr"`
	B10    string `xml:"b10,attr"`
	B11    string `xml:"b11,attr"`
	B12    string `xml:"b12,attr"`
}

func (c XCat) months() [13]string {
	return [13]string{c.B0, c.B1, c.B2, c.B3, c.B4, c.B5, c.B6, c.B7, c.B8, c.B9, c.B10, c.B11, c.B12}
}

// XTag is a tag.
type XTag struct {
	Key  int    `xml:"key,attr"`
	Name string `xml:"name,attr"`
}

// XOpe is a transaction (operation).
type XOpe struct {
	Date       int    `xml:"date,attr"`
	Amount     string `xml:"amount,attr"`
	Account    int    `xml:"account,attr"`
	DstAccount int    `xml:"dst_account,attr"`
	Paymode    int    `xml:"paymode,attr"`
	St         int    `xml:"st,attr"`
	Flags      int    `xml:"flags,attr"`
	Payee      int    `xml:"payee,attr"`
	Category   int    `xml:"category,attr"`
	Wording    string `xml:"wording,attr"`
	Info       string `xml:"info,attr"`
	Tags       string `xml:"tags,attr"`
	Kxfer      int    `xml:"kxfer,attr"`
	Scat       string `xml:"scat,attr"`
	Samt       string `xml:"samt,attr"`
	Smem       string `xml:"smem,attr"`
}

// XAsg is an assignment rule.
type XAsg struct {
	Key      int    `xml:"key,attr"`
	Flags    int    `xml:"flags,attr"`
	Field    int    `xml:"field,attr"`
	Name     string `xml:"name,attr"`
	Payee    int    `xml:"payee,attr"`
	Category int    `xml:"category,attr"`
	Paymode  int    `xml:"paymode,attr"`
}

// XFav is an archive/template, optionally scheduled.
type XFav struct {
	Account  int    `xml:"account,attr"`
	Amount   string `xml:"amount,attr"`
	Paymode  int    `xml:"paymode,attr"`
	Flags    int    `xml:"flags,attr"`
	Payee    int    `xml:"payee,attr"`
	Category int    `xml:"category,attr"`
	Wording  string `xml:"wording,attr"`
	Nextdate int    `xml:"nextdate,attr"`
	Every    int    `xml:"every,attr"`
	Unit     int    `xml:"unit,attr"`
	Limit    int    `xml:"limit,attr"`
	Weekend  int    `xml:"weekend,attr"`
}

// ParseXHB decodes a HomeBank file.
func ParseXHB(r io.Reader) (*XHB, error) {
	var x XHB
	dec := xml.NewDecoder(r)
	if err := dec.Decode(&x); err != nil {
		return nil, err
	}
	return &x, nil
}

// homeBankEpoch is the HomeBank Julian day number for 1970-01-01 (days since
// 0001-01-01, with that day = 1).
const homeBankEpoch = 719163

// julianToDate converts a HomeBank Julian day number to a civil YYYY-MM-DD date.
func julianToDate(j int) string {
	return time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, j-homeBankEpoch).Format("2006-01-02")
}

// parseAmount parses a HomeBank decimal amount (always dot-separated, C locale)
// into signed minor units with `frac` fractional digits, rounding half away from
// zero — matching HomeBank's C round() for balance parity.
func parseAmount(s string, frac int) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	neg := false
	switch s[0] {
	case '-':
		neg, s = true, s[1:]
	case '+':
		s = s[1:]
	}
	intPart, fracPart := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, fracPart = s[:i], s[i+1:]
	}
	if intPart == "" {
		intPart = "0"
	}
	intVal, err := strconv.ParseInt(intPart, 10, 64)
	if err != nil {
		return 0
	}
	roundUp := false
	if len(fracPart) > frac {
		if fracPart[frac] >= '5' {
			roundUp = true
		}
		fracPart = fracPart[:frac]
	}
	for len(fracPart) < frac {
		fracPart += "0"
	}
	var fracVal int64
	if fracPart != "" {
		fracVal, _ = strconv.ParseInt(fracPart, 10, 64)
	}
	minor := intVal*pow10(frac) + fracVal
	if roundUp {
		minor++
	}
	if neg {
		minor = -minor
	}
	return minor
}

func pow10(n int) int64 {
	p := int64(1)
	for ; n > 0; n-- {
		p *= 10
	}
	return p
}

// splitList splits a HomeBank split field on the "||" separator.
func splitList(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, "||")
}
