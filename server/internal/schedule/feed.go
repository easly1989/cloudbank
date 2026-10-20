package schedule

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The calendar feed (#694): the dates of a wallet's schedules as an iCalendar
// file, for a phone's calendar app to subscribe to at a private address. Each
// event carries the schedule's name and amount, never an account's balance.

// ErrFeedNotFound is returned for an address that does not exist, was
// regenerated or turned off, or whose user left the wallet.
var ErrFeedNotFound = errors.New("schedule: calendar feed not found")

// Feed is a user's private calendar address for a wallet: its id and token
// make the path /ical/{id}/{token}.ics.
type Feed struct {
	ID    int64  `json:"id"`
	Token string `json:"token"`
}

// FeedOf returns the user's address for the wallet, or nil when there is none.
func (s *Service) FeedOf(ctx context.Context, userID, walletID int64) (*Feed, error) {
	f, err := s.rq.GetCalendarFeed(ctx, db.GetCalendarFeedParams{UserID: userID, WalletID: walletID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &Feed{ID: f.ID, Token: secrets.Open(f.Token)}, nil
}

// NewFeed makes the user's address for the wallet, or gives it a new token,
// after which the old address answers 404.
func (s *Service) NewFeed(ctx context.Context, userID, walletID int64) (Feed, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return Feed{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	id, err := s.q.UpsertCalendarFeed(ctx, db.UpsertCalendarFeedParams{
		UserID: userID, WalletID: walletID, Token: secrets.Seal(token),
	})
	if err != nil {
		return Feed{}, err
	}
	return Feed{ID: id, Token: token}, nil
}

// DeleteFeed turns the user's address for the wallet off.
func (s *Service) DeleteFeed(ctx context.Context, userID, walletID int64) error {
	return s.q.DeleteCalendarFeed(ctx, db.DeleteCalendarFeedParams{UserID: userID, WalletID: walletID})
}

// FeedICS is the calendar at an address, checked against its token in
// constant time.
func (s *Service) FeedICS(ctx context.Context, id int64, token string, now time.Time) ([]byte, error) {
	f, err := s.rq.ResolveCalendarFeed(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrFeedNotFound
	}
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(secrets.Open(f.Token)), []byte(token)) != 1 {
		return nil, ErrFeedNotFound
	}
	return s.ICS(ctx, f.WalletID, f.WalletTitle, now)
}

// ICS is a wallet's schedules from three months back to twelve ahead, one
// all-day event per occurrence, registered or not.
func (s *Service) ICS(ctx context.Context, walletID int64, walletTitle string, now time.Time) ([]byte, error) {
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	occ, err := s.occurrences(ctx, walletID, day.AddDate(0, -3, 0), day.AddDate(0, 12, 0), day)
	if err != nil {
		return nil, err
	}
	accounts, err := s.rq.ListAccountsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	format := map[int64]func(int64) string{}
	for _, a := range accounts {
		format[a.ID] = func(v int64) string {
			return money.Format(v, int(a.CurrencyFracDigits), a.CurrencyDecimalChar, a.CurrencyGroupChar,
				a.CurrencySymbol, a.CurrencySymbolPrefix != 0)
		}
	}
	stamp := now.UTC().Format("20060102T150405Z")
	var b strings.Builder
	line := func(s string) { b.WriteString(fold(s)) }
	line("BEGIN:VCALENDAR")
	line("VERSION:2.0")
	line("PRODID:-//CloudBank//Schedules//EN")
	line("CALSCALE:GREGORIAN")
	line("METHOD:PUBLISH")
	line("X-WR-CALNAME:" + escapeText("CloudBank · "+walletTitle))
	line("REFRESH-INTERVAL;VALUE=DURATION:PT6H")
	line("X-PUBLISHED-TTL:PT6H")
	for _, o := range occ {
		d, err := ParseDate(o.Date)
		if err != nil {
			continue
		}
		uid := fmt.Sprintf("t%d-%s@cloudbank", o.TemplateID, o.Date)
		switch {
		case o.TransactionID != nil:
			uid = fmt.Sprintf("tx%d@cloudbank", *o.TransactionID)
		case o.ScheduleID != nil:
			uid = fmt.Sprintf("s%d-%s@cloudbank", *o.ScheduleID, o.Date)
		}
		summary := o.Name
		if f, ok := format[o.AccountID]; ok {
			summary += " · " + f(o.Amount)
		}
		line("BEGIN:VEVENT")
		line("UID:" + uid)
		line("DTSTAMP:" + stamp)
		line("DTSTART;VALUE=DATE:" + d.Format("20060102"))
		line("DTEND;VALUE=DATE:" + d.AddDate(0, 0, 1).Format("20060102"))
		line("SUMMARY:" + escapeText(summary))
		line("TRANSP:TRANSPARENT")
		line("END:VEVENT")
	}
	line("END:VCALENDAR")
	return []byte(b.String()), nil
}

// escapeText escapes an iCalendar TEXT value (RFC 5545 §3.3.11).
func escapeText(s string) string {
	return strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`, "\r", `\n`).Replace(s)
}

// fold ends a content line with CRLF, folded so no line is longer than 75
// octets and no UTF-8 character is split (RFC 5545 §3.1).
func fold(s string) string {
	var b strings.Builder
	limit := 75
	for len(s) > limit {
		cut := limit
		for cut > 0 && !utf8.RuneStart(s[cut]) {
			cut--
		}
		b.WriteString(s[:cut])
		b.WriteString("\r\n ")
		s = s[cut:]
		limit = 74 // the leading space takes one
	}
	b.WriteString(s)
	b.WriteString("\r\n")
	return b.String()
}
