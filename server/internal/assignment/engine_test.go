package assignment

import "testing"

func iptr(v int64) *int64 { return &v }

func mustCompile(t *testing.T, r *Rule) {
	t.Helper()
	if err := r.Compile(); err != nil {
		t.Fatalf("Compile(%+v): %v", r, err)
	}
}

func TestMatches(t *testing.T) {
	cases := []struct {
		name          string
		field, typ    string
		pattern       string
		caseSensitive bool
		memo, payee   string
		want          bool
	}{
		{"contains memo ci", FieldMemo, TypeContains, "coffee", false, "Morning COFFEE run", "", true},
		{"contains memo cs miss", FieldMemo, TypeContains, "coffee", true, "Morning COFFEE run", "", false},
		{"exact payee ci", FieldPayee, TypeExact, "esso", false, "", "ESSO", true},
		{"exact payee miss", FieldPayee, TypeExact, "esso", false, "", "ESSO Station", false},
		{"regex memo", FieldMemo, TypeRegex, `inv\d+`, false, "INV4321 paid", "", true},
		{"both matches payee", FieldBoth, TypeContains, "shell", false, "fuel", "Shell", true},
		{"both matches memo", FieldBoth, TypeContains, "fuel", false, "fuel", "Shell", true},
		{"both no match", FieldBoth, TypeContains, "rent", false, "fuel", "Shell", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := Rule{Field: c.field, Type: c.typ, Pattern: c.pattern, CaseSensitive: c.caseSensitive}
			mustCompile(t, &r)
			if got := r.Matches(c.memo, c.payee); got != c.want {
				t.Fatalf("Matches = %v, want %v", got, c.want)
			}
		})
	}
}

func TestCompileErrors(t *testing.T) {
	cases := []struct {
		name string
		rule Rule
		want error
	}{
		{"bad field", Rule{Field: "nope", Type: TypeContains, Pattern: "x"}, ErrInvalidField},
		{"bad type", Rule{Field: FieldMemo, Type: "nope", Pattern: "x"}, ErrInvalidType},
		{"empty pattern", Rule{Field: FieldMemo, Type: TypeContains, Pattern: "  "}, ErrEmptyPattern},
		{"bad regex", Rule{Field: FieldMemo, Type: TypeRegex, Pattern: "a("}, ErrInvalidRegex},
		{"good regex", Rule{Field: FieldMemo, Type: TypeRegex, Pattern: "a(b)?"}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := c.rule
			if err := r.Compile(); err != c.want {
				t.Fatalf("Compile = %v, want %v", err, c.want)
			}
		})
	}
}

func TestFirstMatchWins(t *testing.T) {
	rules := []Rule{
		{ID: 1, Field: FieldMemo, Type: TypeContains, Pattern: "uber", SetCategoryID: iptr(10)},
		{ID: 2, Field: FieldMemo, Type: TypeContains, Pattern: "eats", SetCategoryID: iptr(20)},
	}
	for i := range rules {
		mustCompile(t, &rules[i])
	}
	// "uber eats" matches both; the first rule wins.
	res, ok := FirstMatch(rules, "uber eats dinner", "")
	if !ok || res.RuleID != 1 || res.CategoryID == nil || *res.CategoryID != 10 {
		t.Fatalf("FirstMatch = %+v, %v", res, ok)
	}
	if _, ok := FirstMatch(rules, "groceries", ""); ok {
		t.Fatalf("expected no match")
	}
}
