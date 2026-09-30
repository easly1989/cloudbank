// Package assignment is a pure rule engine that auto-fills a transaction's
// payee, category, payment mode, info and tags from its memo, payee or tags. Rules are tried
// in order (first match wins). The engine has no database dependency so the
// importers can reuse it directly.
package assignment

import (
	"errors"
	"regexp"
	"strings"
)

// Match fields.
const (
	FieldMemo  = "memo"
	FieldPayee = "payee"
	FieldBoth  = "both"
	FieldTag   = "tag" // any one of the transaction's tags
)

// Match types.
const (
	TypeExact    = "exact"
	TypeContains = "contains"
	TypeRegex    = "regex"
)

// Errors.
var (
	ErrInvalidField = errors.New("assignment: invalid match field")
	ErrInvalidType  = errors.New("assignment: invalid match type")
	ErrEmptyPattern = errors.New("assignment: pattern is required")
	ErrInvalidRegex = errors.New("assignment: invalid regular expression")
)

// Rule is one assignment rule: a matcher plus the values to set. Pointers are
// nil when the rule does not set that field.
type Rule struct {
	ID             int64
	Field          string
	Type           string
	Pattern        string
	CaseSensitive  bool
	MatchAccountID *int64 // nil = any account; else only transactions in that account
	SetPayeeID     *int64
	SetCategoryID  *int64
	SetPaymentMode *int
	SetInfo        *string  // nil = don't set the info / "number" field
	SetTags        []string // added to the transaction's tags, never replacing them

	re *regexp.Regexp // compiled when Type == regex
}

// Compile validates the rule's field/type/pattern and prepares it for matching
// (compiling the regular expression). Bad regular expressions are surfaced here
// so the caller can reject them at save time.
func (r *Rule) Compile() error {
	switch r.Field {
	case FieldMemo, FieldPayee, FieldBoth, FieldTag:
	default:
		return ErrInvalidField
	}
	if strings.TrimSpace(r.Pattern) == "" {
		return ErrEmptyPattern
	}
	switch r.Type {
	case TypeExact, TypeContains:
		return nil
	case TypeRegex:
		expr := r.Pattern
		if !r.CaseSensitive {
			expr = "(?i)" + expr
		}
		re, err := regexp.Compile(expr)
		if err != nil {
			return ErrInvalidRegex
		}
		r.re = re
		return nil
	default:
		return ErrInvalidType
	}
}

// Subject is what a rule reads of a transaction. AccountID 0 means no account
// yet, so a rule with an account condition does not match.
type Subject struct {
	Memo      string
	Payee     string
	Tags      []string
	AccountID int64
}

// Matches reports whether the rule matches the transaction's memo, payee or
// tags and (when the rule has an account condition) its account. The rule must
// have been Compiled first.
func (r *Rule) Matches(s Subject) bool {
	if r.MatchAccountID != nil && *r.MatchAccountID != s.AccountID {
		return false
	}
	switch r.Field {
	case FieldMemo:
		return r.matchText(s.Memo)
	case FieldPayee:
		return r.matchText(s.Payee)
	case FieldTag:
		for _, t := range s.Tags {
			if r.matchText(t) {
				return true
			}
		}
		return false
	default: // FieldBoth
		return r.matchText(s.Memo) || r.matchText(s.Payee)
	}
}

func (r *Rule) matchText(text string) bool {
	switch r.Type {
	case TypeRegex:
		return r.re != nil && r.re.MatchString(text)
	case TypeExact:
		if r.CaseSensitive {
			return text == r.Pattern
		}
		return strings.EqualFold(text, r.Pattern)
	default: // contains
		if r.CaseSensitive {
			return strings.Contains(text, r.Pattern)
		}
		return strings.Contains(strings.ToLower(text), strings.ToLower(r.Pattern))
	}
}

// Result is what a matching rule assigns.
type Result struct {
	RuleID      int64
	PayeeID     *int64
	CategoryID  *int64
	PaymentMode *int
	Info        *string
	Tags        []string // to add; empty when the rule adds none
}

// FirstMatch returns the assignments of the first rule (in slice order) that
// matches the transaction, and whether any rule matched. Rules must be
// Compiled.
func FirstMatch(rules []Rule, s Subject) (Result, bool) {
	for i := range rules {
		if rules[i].Matches(s) {
			return Result{
				RuleID: rules[i].ID, PayeeID: rules[i].SetPayeeID,
				CategoryID: rules[i].SetCategoryID, PaymentMode: rules[i].SetPaymentMode,
				Info: rules[i].SetInfo, Tags: rules[i].SetTags,
			}, true
		}
	}
	return Result{}, false
}

// AddTags returns tags with every name of add that is not already there
// appended, in add's order: a rule adds tags and never takes one away.
func AddTags(tags, add []string) []string {
	have := make(map[string]bool, len(tags))
	for _, t := range tags {
		have[t] = true
	}
	for _, t := range add {
		if !have[t] {
			have[t] = true
			tags = append(tags, t)
		}
	}
	return tags
}
