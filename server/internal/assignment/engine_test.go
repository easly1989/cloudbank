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
		tags          []string
		want          bool
	}{
		{"contains memo ci", FieldMemo, TypeContains, "coffee", false, "Morning COFFEE run", "", nil, true},
		{"contains memo cs miss", FieldMemo, TypeContains, "coffee", true, "Morning COFFEE run", "", nil, false},
		{"exact payee ci", FieldPayee, TypeExact, "esso", false, "", "ESSO", nil, true},
		{"exact payee miss", FieldPayee, TypeExact, "esso", false, "", "ESSO Station", nil, false},
		{"regex memo", FieldMemo, TypeRegex, `inv\d+`, false, "INV4321 paid", "", nil, true},
		{"both matches payee", FieldBoth, TypeContains, "shell", false, "fuel", "Shell", nil, true},
		{"both matches memo", FieldBoth, TypeContains, "fuel", false, "fuel", "Shell", nil, true},
		{"both no match", FieldBoth, TypeContains, "rent", false, "fuel", "Shell", nil, false},
		{"tag exact", FieldTag, TypeExact, "car", false, "fuel", "Shell", []string{"home", "Car"}, true},
		{"tag contains", FieldTag, TypeContains, "office", false, "", "", []string{"home-office"}, true},
		{"tag does not read the memo", FieldTag, TypeContains, "car", false, "car wash", "", nil, false},
		{"memo does not read the tags", FieldMemo, TypeContains, "car", false, "", "", []string{"car"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := Rule{Field: c.field, Type: c.typ, Pattern: c.pattern, CaseSensitive: c.caseSensitive}
			mustCompile(t, &r)
			if got := r.Matches(Subject{Memo: c.memo, Payee: c.payee, Tags: c.tags}); got != c.want {
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
	res, ok := FirstMatch(rules, Subject{Memo: "uber eats dinner"})
	if !ok || res.RuleID != 1 || res.CategoryID == nil || *res.CategoryID != 10 {
		t.Fatalf("FirstMatch = %+v, %v", res, ok)
	}
	if _, ok := FirstMatch(rules, Subject{Memo: "groceries"}); ok {
		t.Fatalf("expected no match")
	}
}

func TestAccountConditionAndSetInfo(t *testing.T) {
	rules := []Rule{{
		ID: 1, Field: FieldMemo, Type: TypeContains, Pattern: "cheque",
		MatchAccountID: iptr(7), SetInfo: sptr("0001"),
	}}
	mustCompile(t, &rules[0])
	// Right account → matches and sets the info field.
	res, ok := FirstMatch(rules, Subject{Memo: "cheque to landlord", AccountID: 7})
	if !ok || res.Info == nil || *res.Info != "0001" {
		t.Fatalf("account 7 = %+v, %v", res, ok)
	}
	// Different account → the account-conditioned rule does not apply.
	if _, ok := FirstMatch(rules, Subject{Memo: "cheque to landlord", AccountID: 9}); ok {
		t.Fatalf("account 9 should not match an account-7 rule")
	}
}

func sptr(s string) *string { return &s }

func TestFirstMatchCarriesTags(t *testing.T) {
	rules := []Rule{{ID: 1, Field: FieldPayee, Type: TypeContains, Pattern: "petrol", SetTags: []string{"car"}}}
	mustCompile(t, &rules[0])
	res, ok := FirstMatch(rules, Subject{Payee: "Petrol station"})
	if !ok || len(res.Tags) != 1 || res.Tags[0] != "car" {
		t.Fatalf("FirstMatch = %+v, %v", res, ok)
	}
}

func TestAddTagsNeverRemoves(t *testing.T) {
	got := AddTags([]string{"home", "car"}, []string{"car", "work", "work"})
	want := []string{"home", "car", "work"}
	if len(got) != len(want) {
		t.Fatalf("AddTags = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("AddTags = %v, want %v", got, want)
		}
	}
}
