package ai

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func TestRuleText(t *testing.T) {
	for _, c := range []struct {
		names []string
		want  string
	}{
		{[]string{"NETFLIX.COM 866-579"}, "NETFLIX.COM"},
		{[]string{"Amazon.it"}, "Amazon.it"},
		{[]string{"BAR 12"}, ""}, // too short
		{[]string{"AMZN MKTP IT*2K3", "AMZN MKTP IT*7H1", "Amazon.it"}, "AMZN MKTP IT"},
		{[]string{"ESSELUNGA SPA 0091", "esselunga via ro"}, "ESSELUNGA"},
		{[]string{"Ab 1", "Cd 2"}, ""},
	} {
		if got := ruleText(c.names); got != c.want {
			t.Errorf("ruleText(%q) = %q, want %q", c.names, got, c.want)
		}
	}
}

func TestParsePayeesReply(t *testing.T) {
	got := parsePayeesReply("1, 3 -> Amazon\n2 → \"Netflix\"\n9 -> Out of range\nnoise\n4 =>  \n", 4)
	if len(got) != 2 || got[0].name != "Amazon" || len(got[0].numbers) != 2 || got[1].name != "Netflix" || got[1].numbers[0] != 2 {
		t.Fatalf("got %+v", got)
	}
}

func TestProposePayeeCleanup(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	pay := func(name string) int64 {
		p, err := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: wid, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	// Sorted by name: 1 AMZN MKTP IT*2K3, 2 AMZN MKTP IT*7H1, 3 Amazon.it,
	// 4 NETFLIX.COM 866, 5 SUPERMARKET 0423, 6 Supermarket.
	a1, a2, a3 := pay("AMZN MKTP IT*2K3"), pay("AMZN MKTP IT*7H1"), pay("Amazon.it")
	nf, sa, sup := pay("NETFLIX.COM 866"), pay("SUPERMARKET 0423"), pay("Supermarket")

	if _, err := svc.ProposePayeeCleanup(ctx, uid, wid, false); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("off: %v", err)
	}
	key := "k"
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key, Features: &Features{Payees: true},
	}); err != nil {
		t.Fatal(err)
	}
	mock := &mockDoer{reply: "1, 2, 3 -> Amazon\n4 -> Netflix\n5 -> Supermarket\n6 -> Supermarket"}
	svc.hc = mock
	got, err := svc.ProposePayeeCleanup(ctx, uid, wid, false)
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]CleanupProposal{}
	for _, g := range got {
		by[g.Name] = g
	}
	if len(got) != 3 {
		t.Fatalf("got %+v; the clean Supermarket alone is no change", got)
	}
	amz := by["Amazon"]
	if len(amz.Payees) != 3 || amz.TargetID != nil || amz.Rule != "AMZN MKTP IT" {
		t.Fatalf("amazon = %+v", amz)
	}
	ids := map[int64]bool{}
	for _, p := range amz.Payees {
		ids[p.ID] = true
	}
	if !ids[a1] || !ids[a2] || !ids[a3] {
		t.Fatalf("amazon payees = %+v", amz.Payees)
	}
	if s := by["Supermarket"]; s.TargetID == nil || *s.TargetID != sup || len(s.Payees) != 1 || s.Payees[0].ID != sa {
		t.Fatalf("supermarket = %+v, want a merge into the existing one", s)
	}
	if n := by["Netflix"]; len(n.Payees) != 1 || n.Payees[0].ID != nf || n.Rule != "NETFLIX.COM" {
		t.Fatalf("netflix = %+v", n)
	}
	// Only the names went out.
	if sent := string(mock.lastBody); !strings.Contains(sent, "1. AMZN MKTP IT*2K3") || !strings.Contains(sent, "6. Supermarket") {
		t.Fatalf("sent = %s", sent)
	}
}
