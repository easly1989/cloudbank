package banksync

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Errors surfaced to the API layer, which maps them to status codes.
var (
	// ErrPluggyCredentials means the client id/secret were rejected, or the key
	// derived from them is no longer accepted.
	ErrPluggyCredentials = errors.New("banksync: pluggy credentials rejected")
	// ErrPluggyItemNotFound means the item id does not exist for this
	// application — typically a typo, or a connection removed in Meu Pluggy.
	ErrPluggyItemNotFound = errors.New("banksync: pluggy item not found")
	// ErrPluggyNotConfigured means the wallet has no Pluggy application yet.
	ErrPluggyNotConfigured = errors.New("banksync: pluggy is not configured")
)

// PluggyConfig is the wallet's Pluggy application, as returned to the client.
// The secret is never included — only whether one is stored.
type PluggyConfig struct {
	Configured   bool   `json:"configured"`
	ClientID     string `json:"clientId,omitempty"`
	ConfiguredAt string `json:"configuredAt,omitempty"`
}

// PluggyConfig returns the wallet's Pluggy application, if configured.
func (s *Service) PluggyConfig(ctx context.Context, walletID int64) (PluggyConfig, error) {
	cfg, err := s.q.GetPluggyConfig(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return PluggyConfig{}, ErrPluggyNotConfigured
	}
	if err != nil {
		return PluggyConfig{}, err
	}
	return PluggyConfig{
		Configured:   cfg.ClientID != "" && secrets.Open(cfg.ClientSecret) != "",
		ClientID:     cfg.ClientID,
		ConfiguredAt: cfg.UpdatedAt,
	}, nil
}

// SavePluggyConfig stores the wallet's Pluggy application credentials. The
// secret is sealed at rest and never returned to the client.
func (s *Service) SavePluggyConfig(ctx context.Context, walletID int64, clientID, clientSecret string) error {
	clientID = strings.TrimSpace(clientID)
	clientSecret = strings.TrimSpace(clientSecret)
	if clientID == "" || clientSecret == "" {
		return ErrPluggyCredentials
	}
	if err := s.allowed(providerPluggy); err != nil {
		return err
	}
	// Verify before storing, so a typo is reported now rather than at the first
	// scheduled sync in the middle of the night.
	if _, err := newPluggyClient(s.hc, s.pluggyBase).authenticate(ctx, clientID, clientSecret); err != nil {
		return err
	}
	return s.q.UpsertPluggyConfig(ctx, db.UpsertPluggyConfigParams{
		WalletID:     walletID,
		ClientID:     clientID,
		ClientSecret: secrets.Seal(clientSecret),
	})
}

// DeletePluggyConfig forgets the wallet's Pluggy application. Existing
// connections stay, but cannot sync until credentials are supplied again.
func (s *Service) DeletePluggyConfig(ctx context.Context, walletID int64) error {
	return s.q.DeletePluggyConfig(ctx, walletID)
}

// pluggyKeyFor authenticates with the wallet's stored application credentials.
//
// The key lives two hours, but is deliberately not cached across calls: a sync
// run is short, keys are cheap to mint, and a cache would have to be invalidated
// whenever the user changes credentials. Within one run the key is passed down
// rather than re-fetched.
func (s *Service) pluggyKeyFor(ctx context.Context, walletID int64) (pluggyAPIKey, error) {
	if err := s.allowed(providerPluggy); err != nil {
		return pluggyAPIKey{}, err
	}
	cfg, err := s.q.GetPluggyConfig(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return pluggyAPIKey{}, ErrPluggyNotConfigured
	}
	if err != nil {
		return pluggyAPIKey{}, err
	}
	secret := secrets.Open(cfg.ClientSecret)
	if cfg.ClientID == "" || secret == "" {
		return pluggyAPIKey{}, ErrPluggyNotConfigured
	}
	return newPluggyClient(s.hc, s.pluggyBase).authenticate(ctx, cfg.ClientID, secret)
}

// ConnectPluggy registers a Pluggy item as a connection. The item is created by
// the user in Meu Pluggy; CloudBank only reads it, so the id is validated by
// listing its accounts before anything is stored.
func (s *Service) ConnectPluggy(ctx context.Context, walletID int64, itemID, name string) (Connection, []RemoteAccount, error) {
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return Connection{}, nil, ErrPluggyItemNotFound
	}
	key, err := s.pluggyKeyFor(ctx, walletID)
	if err != nil {
		return Connection{}, nil, err
	}
	accounts, err := newPluggyClient(s.hc, s.pluggyBase).accounts(ctx, key.Key, itemID)
	if err != nil {
		return Connection{}, nil, err
	}
	if len(accounts) == 0 {
		return Connection{}, nil, ErrPluggyItemNotFound
	}
	if strings.TrimSpace(name) == "" {
		name = accounts[0].displayName()
	}
	row, err := s.q.InsertBankConnection(ctx, db.InsertBankConnectionParams{
		WalletID: walletID, Provider: providerPluggy,
		AccessUrl: secrets.Seal(itemID), Name: strings.TrimSpace(name),
	})
	if err != nil {
		return Connection{}, nil, err
	}
	out := make([]RemoteAccount, 0, len(accounts))
	for _, a := range accounts {
		out = append(out, RemoteAccount{
			ExternalID: a.ID, Name: a.displayName(),
			Currency: a.CurrencyCode, Balance: a.Balance.String(),
		})
	}
	return toConnection(row), out, nil
}

func (s *Service) pluggyRemoteAccounts(ctx context.Context, c db.BankConnection) ([]RemoteAccount, error) {
	key, err := s.pluggyKeyFor(ctx, c.WalletID)
	if err != nil {
		return nil, err
	}
	accounts, err := newPluggyClient(s.hc, s.pluggyBase).accounts(ctx, key.Key, secrets.Open(c.AccessUrl))
	if err != nil {
		return nil, err
	}
	linked := map[string]int64{}
	if links, err := s.rq.ListBankLinks(ctx, c.ID); err == nil {
		for _, l := range links {
			linked[l.ExternalID] = l.AccountID
		}
	}
	out := make([]RemoteAccount, 0, len(accounts))
	for _, a := range accounts {
		ra := RemoteAccount{
			ExternalID: a.ID,
			Name:       a.displayName(),
			Currency:   a.CurrencyCode,
			Balance:    a.Balance.String(),
		}
		if id, ok := linked[a.ID]; ok {
			ra.LinkedAccountID = &id
		}
		out = append(out, ra)
	}
	return out, nil
}

// pluggyFetchRows reads each linked account's movements since `start`. One
// account failing does not abandon the others: the failure is reported per
// account, exactly as the Enable Banking path does.
func (s *Service) pluggyFetchRows(
	ctx context.Context, c db.BankConnection, linkByExt map[string]int64, start time.Time,
) (map[string][]importio.Row, []accountFetchError, error) {
	key, err := s.pluggyKeyFor(ctx, c.WalletID)
	if err != nil {
		return nil, nil, err
	}
	client := newPluggyClient(s.hc, s.pluggyBase)
	itemID := secrets.Open(c.AccessUrl)

	accounts, err := client.accounts(ctx, key.Key, itemID)
	if err != nil {
		return nil, nil, err
	}

	from := ""
	if !start.IsZero() {
		from = start.Format("2006-01-02")
	}

	byAccount := map[string][]importio.Row{}
	var failures []accountFetchError
	for _, a := range accounts {
		if _, linked := linkByExt[a.ID]; !linked {
			continue
		}
		txns, err := client.transactions(ctx, key.Key, a.ID, from)
		if err != nil {
			failures = append(failures, accountFetchError{ExternalID: a.ID, Name: a.displayName(), Err: err})
			continue
		}
		byAccount[a.ID] = pluggyRows(txns, a.Type)
	}
	return byAccount, failures, nil
}

// pluggyRows maps provider transactions to import rows. accountType decides the
// sign convention — see pluggyTransaction.signedAmount.
func pluggyRows(txns []pluggyTransaction, accountType string) []importio.Row {
	rows := make([]importio.Row, 0, len(txns))
	for i, t := range txns {
		date := strings.TrimSpace(t.Date)
		if len(date) < 10 {
			continue // no usable date
		}
		amt, err := money.Parse(t.signedAmount(accountType), 6, ".")
		if err != nil {
			continue
		}
		memo := strings.TrimSpace(t.Description)
		if memo == "" {
			memo = strings.TrimSpace(t.DescriptionRaw)
		}
		status := 0
		if t.cleared() {
			status = 1
		}
		rows = append(rows, importio.Row{
			Line:   i + 1,
			Date:   date[:10],
			Amount: amt,
			Memo:   memo,
			Status: status,
			// Namespaced like the other providers, so ids from two providers can
			// never collide in the duplicate check.
			FITID: "pluggy:" + t.ID,
		})
	}
	return rows
}
