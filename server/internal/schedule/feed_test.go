package schedule

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/template"
)

// The calendar feed (#694): its events, its address's lifecycle, and the
// iCalendar format the calendar apps read.
func TestFeed(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u, err := f.q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x", Locale: "it", Theme: "auto"})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: f.wid, UserID: u.ID, Role: "owner"}); err != nil {
		t.Fatal(err)
	}
	rent, _ := f.s.Create(ctx, f.wid, Input{TemplateID: f.expenseTemplate(t, -75000), Unit: UnitMonth, EveryN: 1, NextDue: "2026-08-01"})
	if err := f.s.PostNow(ctx, rent.ID); err != nil { // August registered
		t.Fatal(err)
	}
	// A name the format has to escape, long enough to be folded.
	tpl, _ := f.tpl.Create(ctx, f.wid, template.Input{
		Name: "Gas; water, and the bins — a name long enough to be folded", AccountID: &f.accA, Amount: -4250, PayeeID: &f.payee,
	})
	_, _ = f.s.Create(ctx, f.wid, Input{TemplateID: tpl.ID, Unit: UnitYear, EveryN: 1, NextDue: "2027-02-10"})
	now := at(t, "2026-10-20")

	if got, _ := f.s.FeedOf(ctx, u.ID, f.wid); got != nil {
		t.Fatalf("FeedOf before any = %+v, want nil", got)
	}
	feed, err := f.s.NewFeed(ctx, u.ID, f.wid)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed.Token) < 40 {
		t.Errorf("token %q is too short to be unguessable", feed.Token)
	}
	if got, _ := f.s.FeedOf(ctx, u.ID, f.wid); got == nil || *got != feed {
		t.Errorf("FeedOf = %+v, want %+v", got, feed)
	}

	ics, err := f.s.FeedICS(ctx, feed.ID, feed.Token, now)
	if err != nil {
		t.Fatal(err)
	}
	body := string(ics)
	for _, want := range []string{
		"BEGIN:VCALENDAR\r\n", "VERSION:2.0\r\n", "X-WR-CALNAME:CloudBank · W\r\n",
		"UID:tx", // August, registered
		"DTSTART;VALUE=DATE:20260801\r\nDTEND;VALUE=DATE:20260802\r\nSUMMARY:Rent · -750\\,00 €\r\n",
		"DTSTART;VALUE=DATE:20261101\r\n",
		"DTSTART;VALUE=DATE:20271001\r\n", // twelve months ahead, inclusive
		"SUMMARY:Gas\\; water\\, and the bins",
		"END:VCALENDAR\r\n",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("feed lacks %q", want)
		}
	}
	for _, unwanted := range []string{"DTSTART;VALUE=DATE:20260701", "DTSTART;VALUE=DATE:20271101", "VALARM"} {
		if strings.Contains(body, unwanted) {
			t.Errorf("feed has %q", unwanted)
		}
	}
	for _, l := range strings.Split(strings.TrimSuffix(body, "\r\n"), "\r\n") {
		if len(l) > 75 {
			t.Errorf("line longer than 75 octets: %q", l)
		}
		if strings.Contains(l, "\n") {
			t.Errorf("bare LF in %q", l)
		}
	}
	if !strings.Contains(body, "\r\n ") {
		t.Error("the long summary was not folded")
	}

	if _, err := f.s.FeedICS(ctx, feed.ID, feed.Token[:len(feed.Token)-1]+"x", now); !errors.Is(err, ErrFeedNotFound) {
		t.Errorf("wrong token: err = %v, want ErrFeedNotFound", err)
	}
	again, _ := f.s.NewFeed(ctx, u.ID, f.wid)
	if again.ID != feed.ID || again.Token == feed.Token {
		t.Errorf("regenerated = %+v, want the same id and a new token", again)
	}
	if _, err := f.s.FeedICS(ctx, feed.ID, feed.Token, now); !errors.Is(err, ErrFeedNotFound) {
		t.Errorf("old token after regenerate: err = %v, want ErrFeedNotFound", err)
	}
	if err := f.q.SetUserDisabled(ctx, db.SetUserDisabledParams{Disabled: 1, ID: u.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.FeedICS(ctx, again.ID, again.Token, now); !errors.Is(err, ErrFeedNotFound) {
		t.Errorf("disabled user: err = %v, want ErrFeedNotFound", err)
	}
	_ = f.q.SetUserDisabled(ctx, db.SetUserDisabledParams{Disabled: 0, ID: u.ID})
	if err := f.s.DeleteFeed(ctx, u.ID, f.wid); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.FeedICS(ctx, again.ID, again.Token, now); !errors.Is(err, ErrFeedNotFound) {
		t.Errorf("turned off: err = %v, want ErrFeedNotFound", err)
	}
}

func TestFold(t *testing.T) {
	s := strings.Repeat("é", 60) // 120 octets
	got := fold(s)
	for _, l := range strings.Split(strings.TrimSuffix(got, "\r\n"), "\r\n") {
		if len(l) > 75 {
			t.Errorf("line of %d octets", len(l))
		}
	}
	if strings.ReplaceAll(strings.TrimSuffix(got, "\r\n"), "\r\n ", "") != s {
		t.Errorf("unfolding %q does not give the original back", got)
	}
}
