package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCSVShape(t *testing.T) {
	for in, want := range map[string]string{
		"03/10/2026":          "03/10/2026",
		"2026-10-03":          "2026-10-03",
		"-42,30":              "-42,30",
		"1.234,56 €":          "1.234,56 €",
		"(12.00)":             "(12.00)",
		"":                    "(empty)",
		"EUR":                 "text, 1 word",
		"CARD PAYMENT MILANO": "text, 3 words",
		"Rossi 12":            "text, 2 words",
	} {
		if got := csvShape(in); got != want {
			t.Errorf("csvShape(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseCSVReply(t *testing.T) {
	got := parseCSVReply("Sure:\n```json\n{\"date\":0,\"amount\":4,\"debit\":5,\"payee\":3,\"memo\":3,"+
		"\"category\":9,\"info\":1.5,\"dateFormat\":\"dmy\",\"decimalChar\":\",\",\"invertAmount\":true}\n```", 7)
	m := got.Mapping
	if len(m) != 3 || m["date"] != 0 || m["amount"] != 4 || m["payee"] != 3 {
		t.Fatalf("mapping = %v: memo on the payee's column, a column out of range, a fraction and debit beside amount are out", m)
	}
	if got.DateFormat != "dmy" || got.DecimalChar != "," || !got.InvertAmount {
		t.Fatalf("got %+v", got)
	}
	if got := parseCSVReply("no idea", 3); len(got.Mapping) != 0 || got.DecimalChar != "" {
		t.Fatalf("prose = %+v", got)
	}
	if got := parseCSVReply(`{"debit":1,"credit":2,"dateFormat":"ymd","decimalChar":";"}`, 3); got.Mapping["credit"] != 2 || got.DateFormat != "" || got.DecimalChar != "." {
		t.Fatalf("debit/credit = %+v", got)
	}
}

func TestProposeCSVMapping(t *testing.T) {
	svc, _, uid, wid := newFixture(t)
	ctx := context.Background()
	columns := []string{"Booking date", "Description", "Counterparty", "Amount"}
	rows := [][]string{
		{"03/10/2026", "CARD PAYMENT MILANO", "Supermarket", "-42,30"},
		{"04/10/2026", "TRANSFER IT60X0542811101000000123456", "Rossi", "1500,00"},
	}
	if _, err := svc.ProposeCSVMapping(ctx, uid, wid, columns, rows, false); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("off: %v", err)
	}
	key := "k"
	if _, err := svc.UpdateSettings(ctx, uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key, Features: &Features{Import: true},
	}); err != nil {
		t.Fatal(err)
	}
	mock := &mockDoer{reply: `{"date":0,"memo":1,"payee":2,"amount":3,"dateFormat":"dmy","decimalChar":","}`}
	svc.hc = mock
	got, err := svc.ProposeCSVMapping(ctx, uid, wid, columns, rows, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.Mapping["amount"] != 3 || got.Mapping["payee"] != 2 || got.DateFormat != "dmy" || got.DecimalChar != "," {
		t.Fatalf("got %+v", got)
	}
	// The names, the dates and the amounts went; the words never did.
	sent := string(mock.lastBody)
	for _, want := range []string{"0. Booking date: 03/10/2026 | 04/10/2026", "1. Description: text, 3 words | text, 2 words", "3. Amount: -42,30 | 1500,00"} {
		if !strings.Contains(sent, want) {
			t.Fatalf("sent %s, want %q", sent, want)
		}
	}
	for _, never := range []string{"MILANO", "Supermarket", "Rossi", "IT60X"} {
		if strings.Contains(sent, never) {
			t.Fatalf("sent %q: %s", never, sent)
		}
	}
}
