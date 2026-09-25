package banksync

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"time"

	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// providerDemo is the pretend bank of the public demo build: it walks the whole
// connect, link and sync flow without reaching anything.
const providerDemo = "demo"

// ErrProviderDisabled means the provider cannot be used on this server: the
// demo build reaches no real bank.
var ErrProviderDisabled = errors.New("banksync: this bank provider is not available here")

// demoLookbackDays bounds what the pretend bank returns: a few days of card
// payments, not a second copy of the seeded year.
const demoLookbackDays = 10

// The pretend bank's two accounts.
var demoAccounts = []RemoteAccount{
	{ExternalID: "demo-checking", Name: "Everyday account", Currency: "EUR", Balance: "2481.36"},
	{ExternalID: "demo-card", Name: "Credit card", Currency: "EUR", Balance: "-312.40"},
}

// demoMerchants are what the pretend bank's statement lines say.
var demoMerchants = []struct {
	memo      string
	min, span int64 // cents
}{
	{"Card payment: bakery", 250, 900},
	{"Card payment: supermarket", 1800, 6500},
	{"Card payment: café", 180, 600},
	{"Card payment: pharmacy", 600, 2400},
	{"Card payment: bookshop", 900, 2600},
	{"Card payment: petrol station", 3500, 3500},
}

// OnlyDemoBank limits the service to the pretend bank. The demo build calls
// it; a connection to any other provider is then refused, whatever the route.
func (s *Service) OnlyDemoBank() { s.demoOnly = true }

// allowed refuses a connection's provider when the service is demo-only.
func (s *Service) allowed(provider string) error {
	if s.demoOnly && provider != providerDemo {
		return ErrProviderDisabled
	}
	return nil
}

// ConnectDemo adds a connection to the pretend bank and returns it with its
// accounts, as Connect does for SimpleFIN.
func (s *Service) ConnectDemo(ctx context.Context, walletID int64, name string) (Connection, []RemoteAccount, error) {
	if name == "" {
		name = "Demo Bank"
	}
	row, err := s.q.InsertBankConnection(ctx, db.InsertBankConnectionParams{
		WalletID: walletID, Provider: providerDemo, Name: name,
	})
	if err != nil {
		return Connection{}, nil, err
	}
	accounts, err := s.remoteAccounts(ctx, row)
	if err != nil {
		return Connection{}, nil, err
	}
	return toConnection(row), accounts, nil
}

func (s *Service) demoRemoteAccounts(ctx context.Context, c db.BankConnection) ([]RemoteAccount, error) {
	linked := map[string]int64{}
	if links, err := s.rq.ListBankLinks(ctx, c.ID); err == nil {
		for _, l := range links {
			linked[l.ExternalID] = l.AccountID
		}
	}
	out := make([]RemoteAccount, 0, len(demoAccounts))
	for _, a := range demoAccounts {
		if id, ok := linked[a.ExternalID]; ok {
			a.LinkedAccountID = &id
		}
		out = append(out, a)
	}
	return out, nil
}

// demoFetchRows makes up the statement lines from start to today. The same day
// always yields the same lines, so a sync over days already fetched imports
// nothing new: the dedup key is stable.
func demoFetchRows(start, today time.Time) map[string][]importio.Row {
	floor := today.AddDate(0, 0, -demoLookbackDays)
	if start.Before(floor) {
		start = floor
	}
	out := map[string][]importio.Row{}
	day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	for line := 1; !day.After(today); day = day.AddDate(0, 0, 1) {
		date := day.Format("2006-01-02")
		for _, ext := range []string{"demo-checking", "demo-card"} {
			h := fnv.New64a()
			_, _ = h.Write([]byte(ext + date))
			n := h.Sum64()
			// About one line in two account-days.
			if n%2 == 0 {
				continue
			}
			m := demoMerchants[(n>>8)%uint64(len(demoMerchants))]
			cents := m.min + int64((n>>16)%uint64(m.span))
			status := 1 // cleared
			if day.Equal(today) {
				status = 0 // still pending
			}
			out[ext] = append(out[ext], importio.Row{
				Line:   line,
				Date:   date,
				Amount: -cents * 10000, // six fraction digits, as the other providers
				Memo:   m.memo,
				Status: status,
				FITID:  fmt.Sprintf("demo:%s:%s", ext, date),
			})
			line++
		}
	}
	return out
}
