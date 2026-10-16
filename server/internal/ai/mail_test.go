package ai

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"testing"
)

func configure(t *testing.T, svc *Service, uid int64) {
	t.Helper()
	key := "k"
	if _, err := svc.UpdateSettings(context.Background(), uid, true, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key,
	}); err != nil {
		t.Fatal(err)
	}
}

// sentText is the user message of the last request the provider received.
func sentText(t *testing.T, m *mockDoer) string {
	t.Helper()
	var req struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(m.lastBody, &req); err != nil {
		t.Fatal(err)
	}
	return req.Messages[len(req.Messages)-1].Content
}

func TestReadBankMail(t *testing.T) {
	svc, _, uid, _ := newFixture(t)
	ctx := context.Background()
	if svc.Configured(ctx, uid) {
		t.Fatal("configured before any setting")
	}
	if _, err := svc.ReadBankMail(ctx, uid, "Pagamento", "x", "2026-10-15"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
	configure(t, svc, uid)
	if !svc.Configured(ctx, uid) {
		t.Fatal("not configured after the settings")
	}

	m := &mockDoer{reply: "```json\n{\"payment\":true,\"amount\":\"6,43\",\"direction\":\"out\"," +
		"\"date\":\"2026-10-15\",\"text\":\"Supermercato Demo\"}\n```"}
	svc.hc = m
	got, err := svc.ReadBankMail(ctx, uid, "Pagamento con carta", "Pagamento di 6,43 EUR presso Supermercato Demo", "2026-10-15")
	if err != nil {
		t.Fatal(err)
	}
	want := MailReading{Amount: "6,43", Direction: "out", Date: "2026-10-15", Text: "Supermercato Demo"}
	if got == nil || *got != want {
		t.Fatalf("reading = %+v", got)
	}
	if !strings.Contains(sentText(t, m), "Supermercato Demo") {
		t.Fatal("the mail was not sent")
	}

	// A bad date is left out; the mail's own date takes its place downstream.
	svc.hc = &mockDoer{reply: `{"payment":true,"amount":250,"direction":"in","date":"ieri","text":"Mario Demo"}`}
	got, err = svc.ReadBankMail(ctx, uid, "Bonifico", "Hai ricevuto 250,00 EUR", "2026-10-15")
	if err != nil || got == nil || got.Amount != "250" || got.Direction != "in" || got.Date != "" {
		t.Fatalf("reading = %+v, %v", got, err)
	}

	// Not a payment, or an answer that cannot be a transaction: nothing.
	for _, reply := range []string{
		`{"payment":false}`,
		`{"payment":true,"direction":"out","text":"no amount"}`,
		`{"payment":true,"amount":0,"direction":"out"}`,
		`{"payment":true,"amount":5,"direction":"sideways"}`,
		`{"payment":true,"amount":"cinque","direction":"out"}`,
		`I cannot help with that.`,
	} {
		svc.hc = &mockDoer{reply: reply}
		got, err := svc.ReadBankMail(ctx, uid, "s", "b", "2026-10-15")
		if err != nil || got != nil {
			t.Errorf("%s: reading = %+v, %v; want nothing", reply, got, err)
		}
	}

	// The provider failing is an error, not "not a payment".
	svc.hc = &mockDoer{status: 500}
	if _, err := svc.ReadBankMail(ctx, uid, "s", "b", "2026-10-15"); err == nil {
		t.Fatal("a failing provider must be an error")
	}
}

// Nothing that looks like a card number or an IBAN reaches the provider,
// however the bank writes it.
func TestReadBankMailHidesCardsAndIBANs(t *testing.T) {
	svc, _, uid, _ := newFixture(t)
	configure(t, svc, uid)
	m := &mockDoer{reply: `{"payment":false}`}
	svc.hc = m
	body := "Pagamento di 1.234,56 EUR il 15/10/2026 alle 17:56 con la carta 4532 0151 1283 0366.\n" +
		"Carta 4532-0151-1283-0366, altra carta 4532015112830366, mascherata 1234_*_*_5678 o **** **** **** 5678.\n" +
		"Addebito sul conto IT60 X054 2811 1010 0000 0123 456 (IBAN IT60X0542811101000000123456).\n" +
		"Bonifico da DE89 3704 0044 0532 0130 00, rif. 12345678901."
	if _, err := svc.ReadBankMail(context.Background(), uid, "Carta 5500 0000 0000 0004", body, "2026-10-15"); err != nil {
		t.Fatal(err)
	}
	sent := sentText(t, m)
	for _, leak := range []string{"4532", "0366", "5678", "5500", "0004", "IT60", "0123", "DE89", "3704", "12345678901"} {
		if strings.Contains(sent, leak) {
			t.Errorf("%q reached the provider:\n%s", leak, sent)
		}
	}
	if regexp.MustCompile(`\d{4}\D{0,3}\d{4}\D{0,3}\d{4}`).MatchString(sent) {
		t.Errorf("a long number reached the provider:\n%s", sent)
	}
	// What the reading needs stays: the amount, the date, the time.
	for _, keep := range []string{"1.234,56 EUR", "15/10/2026", "17:56"} {
		if !strings.Contains(sent, keep) {
			t.Errorf("%q was hidden too:\n%s", keep, sent)
		}
	}
}
