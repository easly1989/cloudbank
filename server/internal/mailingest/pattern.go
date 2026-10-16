package mailingest

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/money"
)

// Pattern says how to read one kind of bank mail (#657): which mails it is
// for, an RE2 expression with named groups that finds the pieces in the mail's
// text, and the fixed values that complete the transaction. The editor builds
// the expression from the pieces the user highlights; Advanced shows it.
type Pattern struct {
	ID        int64  `json:"id"`
	MailboxID int64  `json:"mailboxId"`
	Position  int    `json:"position"`
	Name      string `json:"name"`
	// Sender is the From address the pattern is for, compared without case.
	Sender string `json:"sender"`
	// SubjectMode narrows the mails further: "" (any subject), "contains"
	// (Subject appears in it, without case) or "regex" (Subject matches it).
	SubjectMode string `json:"subjectMode"`
	Subject     string `json:"subject"`
	// Body is matched against the mail's text: its subject, a newline, then
	// its body. Its named groups are the pieces (see the Group constants).
	Body string `json:"body"`
	// AccountID receives the transactions; Cards sends a card's ones elsewhere.
	AccountID int64         `json:"accountId"`
	Cards     []CardAccount `json:"cards"`
	// Direction is "out" (money spent), "in" (money received) or "capture":
	// the direction group decides, money in when it holds one of InWords.
	Direction   string `json:"direction"`
	InWords     string `json:"inWords"`
	PaymentMode int    `json:"paymentMode"`
	ApplyRules  bool   `json:"applyRules"`
	// DateFormat reads the date group, e.g. "DD.MM" or "DD/MM/YYYY"; a date
	// without a year takes the mail's. Without a date group the date is the
	// mail's own, as a calendar day where it was written.
	DateFormat string `json:"dateFormat"`
	// RequireAuth applies the pattern only to mails the receiving server
	// vouched for (DMARC or DKIM of the sender's domain), so a forged sender
	// cannot write into the register.
	RequireAuth bool `json:"requireAuth"`
	// Editor is the editor's own state (the sample and the highlights), kept
	// for it to reopen; the server does not read it.
	Editor string `json:"editor"`
}

// CardAccount sends the mails about one card to its own account.
type CardAccount struct {
	// Digits are the card digits the mail shows, usually the last four.
	Digits    string `json:"digits"`
	AccountID int64  `json:"accountId"`
}

// The named groups a pattern's expression may use.
const (
	GroupAmount    = "amount"
	GroupMemo      = "memo"
	GroupPayee     = "payee"
	GroupInfo      = "info"
	GroupTag       = "tag"
	GroupCategory  = "category"
	GroupDate      = "date"
	GroupCard      = "card"
	GroupDirection = "direction"
)

var knownGroups = map[string]bool{
	GroupAmount: true, GroupMemo: true, GroupPayee: true, GroupInfo: true, GroupTag: true,
	GroupCategory: true, GroupDate: true, GroupCard: true, GroupDirection: true,
}

// Directions.
const (
	DirectionOut     = "out"
	DirectionIn      = "in"
	DirectionCapture = "capture"
)

// mailInput is a mail as a pattern reads it.
type mailInput struct {
	From, Subject, Body string
	// Date is the mail's Date header in its own offset; Received stands in
	// when the header is missing.
	Date          time.Time
	Authenticated bool
}

// text is what a pattern's expression is matched against.
func (m mailInput) text() string { return m.Subject + "\n" + m.Body }

// compiled is a validated pattern, ready to match.
type compiled struct {
	p       Pattern
	body    *regexp.Regexp
	subject *regexp.Regexp
	inWords []string
	date    *dateLayout
}

// ExpressionError is an expression RE2 cannot read: the body's, or with
// Subject the subject's. Reason is RE2's own words, which the editor shows
// under a heading in the reader's language.
type ExpressionError struct {
	Subject bool
	Reason  string
}

func (e *ExpressionError) Error() string {
	what := "the expression"
	if e.Subject {
		what = "the subject expression"
	}
	return fmt.Sprintf("%v: %s is not valid: %s", ErrInvalid, what, e.Reason)
}

func (e *ExpressionError) Unwrap() error { return ErrInvalid }

// errPattern wraps what makes a pattern unusable, in words the editor shows.
func errPattern(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

// compile checks a pattern and prepares it. Go's RE2 runs in time linear in
// the text, so no expression can hang a check.
func compile(p Pattern) (*compiled, error) {
	p.Sender = strings.ToLower(strings.TrimSpace(p.Sender))
	if p.Sender == "" {
		return nil, errPattern("the sender is required")
	}
	if p.AccountID <= 0 {
		return nil, errPattern("the account is required")
	}
	c := &compiled{p: p}
	body, err := regexp.Compile(p.Body)
	if err != nil || strings.TrimSpace(p.Body) == "" {
		return nil, &ExpressionError{Reason: regexError(err)}
	}
	c.body = body
	groups := map[string]bool{}
	for _, name := range body.SubexpNames() {
		if name == "" {
			continue
		}
		if !knownGroups[name] {
			return nil, errPattern("unknown group %q", name)
		}
		groups[name] = true
	}
	if !groups[GroupAmount] {
		return nil, errPattern("the expression must find the amount")
	}
	switch p.SubjectMode {
	case "":
	case "contains":
		if strings.TrimSpace(p.Subject) == "" {
			return nil, errPattern("the subject to look for is empty")
		}
	case "regex":
		re, err := regexp.Compile(p.Subject)
		if err != nil || p.Subject == "" {
			return nil, &ExpressionError{Subject: true, Reason: regexError(err)}
		}
		c.subject = re
	default:
		return nil, errPattern("unknown subject mode %q", p.SubjectMode)
	}
	switch p.Direction {
	case DirectionOut, DirectionIn:
	case DirectionCapture:
		if !groups[GroupDirection] {
			return nil, errPattern("the expression must find the direction")
		}
		for _, w := range strings.Split(p.InWords, ",") {
			if w = strings.ToLower(strings.TrimSpace(w)); w != "" {
				c.inWords = append(c.inWords, w)
			}
		}
		if len(c.inWords) == 0 {
			return nil, errPattern("say which words mean money in")
		}
	default:
		return nil, errPattern("unknown direction %q", p.Direction)
	}
	if groups[GroupDate] {
		d, err := parseLayout(p.DateFormat)
		if err != nil {
			return nil, err
		}
		c.date = d
	}
	if p.PaymentMode < 0 || p.PaymentMode > 11 {
		return nil, errPattern("unknown payment type %d", p.PaymentMode)
	}
	for _, card := range p.Cards {
		if onlyDigits(card.Digits) == "" || card.AccountID <= 0 {
			return nil, errPattern("each card needs its digits and an account")
		}
	}
	return c, nil
}

func regexError(err error) string {
	if err == nil {
		return "it is empty"
	}
	return strings.TrimPrefix(err.Error(), "error parsing regexp: ")
}

// appliesTo says whether the mail is one this pattern is for, before reading
// it: the sender, then the subject.
func (c *compiled) appliesTo(m mailInput) bool {
	if strings.ToLower(strings.TrimSpace(m.From)) != c.p.Sender {
		return false
	}
	switch c.p.SubjectMode {
	case "contains":
		return strings.Contains(strings.ToLower(m.Subject), strings.ToLower(strings.TrimSpace(c.p.Subject)))
	case "regex":
		return c.subject.MatchString(m.Subject)
	}
	return true
}

// Extracted is the transaction a mail becomes.
type Extracted struct {
	AccountID   int64    `json:"accountId"`
	Date        string   `json:"date"`
	Amount      int64    `json:"amount"`
	Memo        string   `json:"memo"`
	Payee       string   `json:"payee"`
	Info        string   `json:"info"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	PaymentMode int      `json:"paymentMode"`
	ApplyRules  bool     `json:"-"`
}

// read finds the pieces in the mail. ok is false when the expression does not
// match; err says why a match could not become a transaction. fracOf gives an
// account's currency decimals.
func (c *compiled) read(m mailInput, fracOf func(accountID int64) (int, bool)) (Extracted, bool, error) {
	sub := c.body.FindStringSubmatch(m.text())
	if sub == nil {
		return Extracted{}, false, nil
	}
	get := func(name string) string {
		i := c.body.SubexpIndex(name)
		if i < 0 || i >= len(sub) {
			return ""
		}
		return strings.TrimSpace(sub[i])
	}
	out := Extracted{
		AccountID: c.p.AccountID, Memo: get(GroupMemo), Payee: get(GroupPayee), Info: get(GroupInfo),
		Category: get(GroupCategory), PaymentMode: c.p.PaymentMode, ApplyRules: c.p.ApplyRules,
		Tags: []string{},
	}
	if t := get(GroupTag); t != "" {
		out.Tags = []string{t}
	}
	if card := onlyDigits(get(GroupCard)); card != "" {
		for _, ca := range c.p.Cards {
			d := onlyDigits(ca.Digits)
			if strings.HasSuffix(card, d) || strings.HasSuffix(d, card) {
				out.AccountID = ca.AccountID
				break
			}
		}
	}
	frac, ok := fracOf(out.AccountID)
	if !ok {
		return out, true, errPattern("the account is not in this wallet")
	}
	amount, err := parseAmount(get(GroupAmount), frac)
	if err != nil {
		return out, true, errPattern("the amount %q is not a number", get(GroupAmount))
	}
	if c.out(get(GroupDirection)) {
		amount = -amount
	}
	out.Amount = amount
	if c.date != nil {
		d, err := c.date.read(get(GroupDate), m.Date)
		if err != nil {
			return out, true, err
		}
		out.Date = d
	} else {
		out.Date = m.Date.Format("2006-01-02")
	}
	return out, true, nil
}

// out says whether the money left the account.
func (c *compiled) out(direction string) bool {
	switch c.p.Direction {
	case DirectionIn:
		return false
	case DirectionCapture:
		d := strings.ToLower(direction)
		for _, w := range c.inWords {
			if strings.Contains(d, w) {
				return false
			}
		}
	}
	return true
}

// Outcomes of reading a mail, as the history shows them.
const (
	OutcomeUnrecognized = "unrecognized"
	OutcomeUnverified   = "unverified"
	OutcomeCreated      = "created"
	OutcomeDuplicate    = "duplicate"
	OutcomeFailed       = "failed"
)

// evaluation is what the patterns made of one mail.
type evaluation struct {
	outcome string // unrecognized, unverified, or "" for a match
	pattern *compiled
	tx      Extracted
	err     error
}

// evaluate runs the patterns in order; the first that reads the mail wins. A
// pattern that would have read it but wants an authenticated sender, and did
// not get one, leaves the mail "unverified" unless a later one reads it.
func evaluate(patterns []*compiled, m mailInput, fracOf func(int64) (int, bool)) evaluation {
	unverified := false
	for _, c := range patterns {
		if !c.appliesTo(m) {
			continue
		}
		tx, ok, err := c.read(m, fracOf)
		if !ok {
			continue
		}
		if c.p.RequireAuth && !m.Authenticated {
			unverified = true
			continue
		}
		return evaluation{pattern: c, tx: tx, err: err}
	}
	if unverified {
		return evaluation{outcome: OutcomeUnverified}
	}
	return evaluation{outcome: OutcomeUnrecognized}
}

// parseAmount reads an amount written the way banks write them, with a comma
// or a point for the decimals and either for the thousands ("6,43",
// "1.234,56", "6.43", "1,234.56"), always through internal/money. The sign is
// dropped: the pattern's direction gives it.
func parseAmount(s string, frac int) (int64, error) {
	v, err := money.Parse(s, frac, decimalOf(s, frac))
	if err != nil {
		return 0, err
	}
	if v < 0 {
		v = -v
	}
	return v, nil
}

// decimalOf guesses which separator marks the decimals: the last one, unless
// it repeats, or is followed by exactly three digits with no other separator
// before it in a currency of fewer than three decimals, which makes it a
// thousands separator.
func decimalOf(s string, frac int) string {
	comma, dot := strings.LastIndexByte(s, ','), strings.LastIndexByte(s, '.')
	last, sep, other := comma, ",", "."
	if dot > comma {
		last, sep, other = dot, ".", ","
	}
	if last < 0 {
		return "."
	}
	if strings.Count(s, sep) > 1 {
		return other
	}
	if i := strings.LastIndex(s, other); i >= 0 && i < last {
		return sep
	}
	digits := 0
	for _, r := range s[last+1:] {
		if r < '0' || r > '9' {
			break
		}
		digits++
	}
	if digits == 3 && frac < 3 {
		return other
	}
	return sep
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// dateLayout reads a date written in a mail, as a format of DD, MM, YYYY or
// YY and the separators between them ("DD.MM", "DD/MM/YYYY", "MM-DD-YY").
type dateLayout struct {
	re    *regexp.Regexp
	order []string // the fields, in the order they appear
}

var reDateToken = regexp.MustCompile(`YYYY|YY|MM|DD`)

func parseLayout(format string) (*dateLayout, error) {
	format = strings.ToUpper(strings.TrimSpace(format))
	if !strings.Contains(format, "DD") || !strings.Contains(format, "MM") {
		return nil, errPattern("the date format needs DD and MM, for example DD.MM or DD/MM/YYYY")
	}
	var b strings.Builder
	b.WriteString(`^`)
	l := &dateLayout{}
	rest := format
	for {
		loc := reDateToken.FindStringIndex(rest)
		if loc == nil {
			b.WriteString(regexp.QuoteMeta(rest))
			break
		}
		b.WriteString(regexp.QuoteMeta(rest[:loc[0]]))
		tok := rest[loc[0]:loc[1]]
		switch tok {
		case "YYYY":
			b.WriteString(`(\d{4})`)
		case "YY":
			b.WriteString(`(\d{2})`)
		default:
			b.WriteString(`(\d{1,2})`)
		}
		l.order = append(l.order, tok)
		rest = rest[loc[1]:]
	}
	b.WriteString(`$`)
	l.re = regexp.MustCompile(b.String())
	return l, nil
}

// read turns the text into a calendar day. Without a year it takes the year
// the mail arrived in, or the one before when that would put the day more
// than a week after the mail: a payment of 31 December told on 2 January.
func (l *dateLayout) read(s string, arrived time.Time) (string, error) {
	sub := l.re.FindStringSubmatch(strings.TrimSpace(s))
	if sub == nil {
		return "", errPattern("the date %q does not fit the format", s)
	}
	year, month, day := 0, 0, 0
	for i, tok := range l.order {
		n, _ := strconv.Atoi(sub[i+1])
		switch tok {
		case "YYYY":
			year = n
		case "YY":
			year = 2000 + n
		case "MM":
			month = n
		case "DD":
			day = n
		}
	}
	guessed := year == 0
	if guessed {
		year = arrived.Year()
	}
	t := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	if t.Month() != time.Month(month) || t.Day() != day {
		return "", errPattern("the date %q is not a real day", s)
	}
	if guessed {
		mailDay := time.Date(arrived.Year(), arrived.Month(), arrived.Day(), 0, 0, 0, 0, time.UTC)
		if t.After(mailDay.AddDate(0, 0, 7)) {
			t = t.AddDate(-1, 0, 0)
		}
	}
	return t.Format("2006-01-02"), nil
}
