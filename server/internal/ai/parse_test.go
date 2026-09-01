package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func TestParseEntry(t *testing.T) {
	svc, q, uid, wid := newFixture(t)
	ctx := context.Background()
	food, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})
	groceries, _ := q.InsertCategory(ctx, db.InsertCategoryParams{
		WalletID: wid, Name: "Groceries", ParentID: nullID(food.ID),
	})
	bar, _ := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: wid, Name: "Bar Centrale"})

	key := "k"
	if _, err := svc.UpdateSettings(ctx, uid, SettingsInput{
		Enabled: true, BaseURL: "https://api.example/v1", Model: "m", APIKey: &key,
	}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	// A well-formed reply (wrapped in a code fence, to test tolerance).
	svc.hc = &mockDoer{reply: "```json\n{\"amount\": 12.4, \"direction\": \"expense\", " +
		"\"date\": \"2026-06-14\", \"payee\": \"Bar Centrale\", \"category\": \"Food:Groceries\", " +
		"\"memo\": \"coffee\"}\n```"}
	got, err := svc.ParseEntry(ctx, uid, wid, "12.40 coffee at Bar Centrale yesterday", "2026-06-15")
	if err != nil {
		t.Fatalf("ParseEntry: %v", err)
	}
	if got == nil || got.Amount != "12.4" || got.Direction != "expense" || got.Date != "2026-06-14" || got.Memo != "coffee" {
		t.Fatalf("parsed = %+v", got)
	}
	if got.CategoryID == nil || *got.CategoryID != groceries.ID || got.CategoryName != "Food:Groceries" {
		t.Fatalf("category = %+v", got)
	}
	if got.PayeeID == nil || *got.PayeeID != bar.ID || got.PayeeName != "Bar Centrale" {
		t.Fatalf("payee = %+v", got)
	}

	// An unmatched payee/category are reported but never invented into an id.
	svc.hc = &mockDoer{reply: `{"amount":9,"direction":"income","date":"nope","payee":"Unknown Shop","category":"Nonexistent","memo":""}`}
	got2, err := svc.ParseEntry(ctx, uid, wid, "9 from unknown", "2026-06-15")
	if err != nil {
		t.Fatalf("ParseEntry(2): %v", err)
	}
	if got2.Direction != "income" || got2.Amount != "9" {
		t.Fatalf("parsed2 = %+v", got2)
	}
	if got2.Date != "2026-06-15" { // bad date falls back to today
		t.Fatalf("date fallback = %q, want today", got2.Date)
	}
	if got2.CategoryID != nil {
		t.Fatalf("unmatched category must stay nil, got %+v", got2.CategoryID)
	}
	if got2.PayeeID != nil || got2.PayeeName != "Unknown Shop" {
		t.Fatalf("unmatched payee: id=%v name=%q", got2.PayeeID, got2.PayeeName)
	}

	// A reply with no JSON object is an error.
	svc.hc = &mockDoer{reply: "I could not understand that."}
	if _, err := svc.ParseEntry(ctx, uid, wid, "gibberish", "2026-06-15"); err == nil {
		t.Fatal("expected an error for a non-JSON reply")
	}

	// Disabled → ErrNotConfigured; blank text → nil, nil.
	if _, err := svc.ParseEntry(ctx, uid, wid, "   ", "2026-06-15"); err != nil {
		t.Fatalf("blank text err = %v, want nil", err)
	}
	blank := ""
	_, _ = svc.UpdateSettings(ctx, uid, SettingsInput{Enabled: false, BaseURL: "u", Model: "m", APIKey: &blank})
	if _, err := svc.ParseEntry(ctx, uid, wid, "x", "2026-06-15"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("disabled err = %v, want ErrNotConfigured", err)
	}
}
