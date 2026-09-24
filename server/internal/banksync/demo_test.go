package banksync

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"
	"time"
)

func TestDemoBankSyncsWithoutReachingAnything(t *testing.T) {
	svc, _, _, wid, acc := newFixture(t)
	svc.hc = nil // any real request would now leave the machine
	svc.OnlyDemoBank()
	ctx := context.Background()

	conn, remotes, err := svc.ConnectDemo(ctx, wid, "")
	if err != nil {
		t.Fatalf("ConnectDemo: %v", err)
	}
	if conn.Provider != providerDemo || conn.Name != "Demo Bank" || len(remotes) != 2 {
		t.Fatalf("connect result: %+v / %+v", conn, remotes)
	}
	if err := svc.Link(ctx, wid, conn.ID, "demo-checking", acc); err != nil {
		t.Fatalf("Link: %v", err)
	}
	first, err := svc.Sync(ctx, wid, conn.ID)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if first.Accounts != 1 || first.Imported == 0 {
		t.Fatalf("first sync imported nothing: %+v", first)
	}
	again, err := svc.Sync(ctx, wid, conn.ID)
	if err != nil {
		t.Fatalf("second Sync: %v", err)
	}
	if again.Imported != 0 {
		t.Fatalf("a second sync over the same days imported %d, want 0", again.Imported)
	}
}

func TestDemoOnlyRefusesRealProviders(t *testing.T) {
	svc, _, _, wid, _ := newFixture(t)
	svc.OnlyDemoBank()
	ctx := context.Background()

	token := base64.StdEncoding.EncodeToString([]byte("https://example.test/claim/x"))
	if _, _, err := svc.Connect(ctx, wid, token, "Real"); !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("SimpleFIN connect: err = %v, want ErrProviderDisabled", err)
	}
	if _, err := svc.EBankingBanks(ctx, wid, "IT"); !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("Enable Banking: err = %v, want ErrProviderDisabled", err)
	}
	if err := svc.SavePluggyConfig(ctx, wid, "id", "secret"); !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("Pluggy: err = %v, want ErrProviderDisabled", err)
	}
	if svc.hc.(*mockDoer).fetches != 0 {
		t.Fatal("a refused provider still made a request")
	}
}

func TestDemoFetchRowsIsStableAndRecent(t *testing.T) {
	today := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	long := demoFetchRows(today.AddDate(0, 0, -90), today)
	short := demoFetchRows(today.AddDate(0, 0, -demoLookbackDays), today)
	for ext, rows := range long {
		if len(rows) != len(short[ext]) {
			t.Fatalf("%s: a 90-day window gave %d rows, want the %d of the last %d days",
				ext, len(rows), len(short[ext]), demoLookbackDays)
		}
		for i, r := range rows {
			if r.FITID != short[ext][i].FITID || r.Amount != short[ext][i].Amount {
				t.Fatalf("%s row %d differs between two fetches of the same day", ext, i)
			}
			if r.Amount >= 0 {
				t.Fatalf("%s row %d: amount %d, want a payment", ext, i, r.Amount)
			}
		}
	}
	if len(long) == 0 {
		t.Fatal("the pretend bank returned nothing")
	}
}
