package banksync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// ebStoredAccount is an Enable Banking account captured from the POST /sessions
// response and persisted on the connection (GET /sessions/{id} returns only uid
// strings, so the account details are not re-fetchable from the session alone).
type ebStoredAccount struct {
	UID      string `json:"uid"`
	Name     string `json:"name"`
	Currency string `json:"currency"`
	IBAN     string `json:"iban,omitempty"`
}

func parseStoredAccounts(js string) []ebStoredAccount {
	if strings.TrimSpace(js) == "" {
		return nil
	}
	var out []ebStoredAccount
	_ = json.Unmarshal([]byte(js), &out)
	return out
}

// EBankingConfigView is the safe view of a wallet's Enable Banking config — it
// never includes the private key.
type EBankingConfigView struct {
	Configured  bool   `json:"configured"`
	AppID       string `json:"appId,omitempty"`
	Environment string `json:"environment,omitempty"`
}

// EBankingBank is a selectable ASPSP (bank).
type EBankingBank struct {
	Name    string `json:"name"`
	Country string `json:"country"`
	Logo    string `json:"logo,omitempty"`
}

// EBankingConfig returns the wallet's Enable Banking config (never the key).
func (s *Service) EBankingConfig(ctx context.Context, walletID int64) (EBankingConfigView, error) {
	cfg, err := s.rq.GetEBankingConfig(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return EBankingConfigView{Configured: false}, nil
	}
	if err != nil {
		return EBankingConfigView{}, err
	}
	return EBankingConfigView{Configured: true, AppID: cfg.AppID, Environment: cfg.Environment}, nil
}

// SetEBankingConfig stores the wallet's Enable Banking application credentials.
// The private key is validated (must parse) but otherwise kept opaque.
func (s *Service) SetEBankingConfig(ctx context.Context, walletID int64, appID, privateKey, environment string) error {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		return ErrInvalid
	}
	// An empty private key on an already-configured wallet keeps the stored key,
	// so the environment or app id can be changed without re-pasting the key.
	key := privateKey
	if strings.TrimSpace(key) == "" {
		existing, err := s.rq.GetEBankingConfig(ctx, walletID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrInvalid
		}
		if err != nil {
			return err
		}
		key = secrets.Open(existing.PrivateKey) // decrypt the stored key to reuse it
	}
	if _, err := parseRSAPrivateKey(key); err != nil {
		return ErrInvalid
	}
	env := strings.ToLower(strings.TrimSpace(environment))
	if env != "production" {
		env = "sandbox"
	}
	return s.q.UpsertEBankingConfig(ctx, db.UpsertEBankingConfigParams{
		WalletID: walletID, AppID: appID, PrivateKey: secrets.Seal(key), Environment: env,
	})
}

// DeleteEBankingConfig removes the wallet's Enable Banking credentials.
func (s *Service) DeleteEBankingConfig(ctx context.Context, walletID int64) error {
	_, err := s.q.DeleteEBankingConfig(ctx, walletID)
	return err
}

// ebClientForConn builds a client from the wallet's stored credentials.
func (s *Service) ebClientForConn(ctx context.Context, walletID int64) (*enableBankingClient, error) {
	cfg, err := s.rq.GetEBankingConfig(ctx, walletID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrEBNotConfigured
	}
	if err != nil {
		return nil, err
	}
	return newEnableBankingClient(s.hc, cfg.AppID, secrets.Open(cfg.PrivateKey))
}

// EBankingBanks lists the ASPSPs available to the wallet's application, optionally
// filtered by country (ISO code).
func (s *Service) EBankingBanks(ctx context.Context, walletID int64, country string) ([]EBankingBank, error) {
	cl, err := s.ebClientForConn(ctx, walletID)
	if err != nil {
		return nil, err
	}
	aspsps, err := cl.listASPSPs(ctx, country)
	if err != nil {
		return nil, err
	}
	out := make([]EBankingBank, 0, len(aspsps))
	for _, a := range aspsps {
		out = append(out, EBankingBank(a))
	}
	return out, nil
}

// EBankingStartAuth begins a bank authorization and returns the URL to redirect
// the user to, plus the state that ties the eventual callback back to this wallet.
func (s *Service) EBankingStartAuth(ctx context.Context, walletID int64, aspspName, aspspCountry, name, redirectURL string) (string, string, error) {
	aspspName = strings.TrimSpace(aspspName)
	aspspCountry = strings.TrimSpace(aspspCountry)
	if aspspName == "" || aspspCountry == "" {
		return "", "", ErrInvalid
	}
	return s.ebStartAuth(ctx, walletID, aspspName, aspspCountry, strings.TrimSpace(name), redirectURL, 0)
}

// EBankingStartReauth re-authorizes an existing connection's bank. When the
// callback completes it refreshes that connection's session in place — keeping
// its account links — instead of creating a new connection. Used to renew a
// consent that is expiring or has expired.
func (s *Service) EBankingStartReauth(ctx context.Context, walletID, connID int64, redirectURL string) (string, string, error) {
	c, err := s.conn(ctx, walletID, connID)
	if err != nil {
		return "", "", err
	}
	if c.Provider != providerEnableBanking {
		return "", "", ErrInvalid
	}
	return s.ebStartAuth(ctx, walletID, c.AspspName, c.AspspCountry, c.Name, redirectURL, connID)
}

// ebStartAuth begins an authorization and records a pending row. connectionID > 0
// marks it as a re-authorization of that connection.
func (s *Service) ebStartAuth(ctx context.Context, walletID int64, aspspName, aspspCountry, name, redirectURL string, connectionID int64) (string, string, error) {
	redirectURL = strings.TrimSpace(redirectURL)
	if aspspName == "" || aspspCountry == "" || redirectURL == "" {
		return "", "", ErrInvalid
	}
	cl, err := s.ebClientForConn(ctx, walletID)
	if err != nil {
		return "", "", err
	}
	// Opportunistically drop abandoned authorizations (started, never completed).
	_ = s.q.DeleteStaleEBankingAuth(ctx, walletID)
	state, err := randToken()
	if err != nil {
		return "", "", err
	}
	validUntil := time.Now().AddDate(0, 0, consentValidityDays)
	resp, err := cl.startAuth(ctx, aspspName, aspspCountry, redirectURL, state, validUntil)
	if err != nil {
		return "", "", err
	}
	if resp.URL == "" {
		return "", "", fmt.Errorf("banksync: enable banking returned no authorization url")
	}
	if err := s.q.InsertEBankingAuth(ctx, db.InsertEBankingAuthParams{
		State: state, WalletID: walletID, AspspName: aspspName, AspspCountry: aspspCountry,
		Name: name, RedirectUrl: redirectURL, ConnectionID: connectionID,
	}); err != nil {
		return "", "", err
	}
	return resp.URL, state, nil
}

// EBankingCompleteAuth exchanges the redirect code for a session and stores it as
// a connection, consuming the pending authorization.
func (s *Service) EBankingCompleteAuth(ctx context.Context, walletID int64, state, code string) (Connection, error) {
	if strings.TrimSpace(state) == "" || strings.TrimSpace(code) == "" {
		return Connection{}, ErrInvalid
	}
	pend, err := s.rq.GetEBankingAuth(ctx, state)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && pend.WalletID != walletID) {
		return Connection{}, ErrNotFound
	}
	if err != nil {
		return Connection{}, err
	}
	cl, err := s.ebClientForConn(ctx, walletID)
	if err != nil {
		return Connection{}, err
	}
	sess, err := cl.createSession(ctx, code)
	if err != nil {
		return Connection{}, err
	}
	if sess.SessionID == "" {
		return Connection{}, fmt.Errorf("banksync: enable banking returned no session")
	}
	name := strings.TrimSpace(pend.Name)
	if name == "" {
		name = pend.AspspName
	}
	// Capture the account list now: the POST /sessions response has full account
	// objects, but GET /sessions/{id} later returns only uid strings.
	accs := make([]ebStoredAccount, 0, len(sess.Accounts))
	for _, a := range sess.Accounts {
		accs = append(accs, ebStoredAccount{UID: a.UID, Name: a.label(), Currency: a.Currency, IBAN: a.AccountID.IBAN})
	}
	accountsJSON, _ := json.Marshal(accs)

	// A re-authorization refreshes the existing connection's session in place,
	// keeping its account links; a fresh authorization inserts a new connection.
	if pend.ConnectionID > 0 {
		row, err := s.q.RefreshEBankingConnectionSession(ctx, db.RefreshEBankingConnectionSessionParams{
			AccessUrl: secrets.Seal(sess.SessionID), ValidUntil: sess.Access.ValidUntil,
			AccountsJson: string(accountsJSON), ID: pend.ConnectionID, WalletID: walletID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Connection{}, ErrNotFound
		}
		if err != nil {
			return Connection{}, err
		}
		_ = s.q.DeleteEBankingAuth(ctx, state)
		return toConnection(row), nil
	}

	row, err := s.q.InsertEBankingConnection(ctx, db.InsertEBankingConnectionParams{
		WalletID: walletID, AccessUrl: secrets.Seal(sess.SessionID), Name: name,
		AspspName: pend.AspspName, AspspCountry: pend.AspspCountry,
		ValidUntil: sess.Access.ValidUntil, AccountsJson: string(accountsJSON),
	})
	if err != nil {
		return Connection{}, err
	}
	_ = s.q.DeleteEBankingAuth(ctx, state)
	return toConnection(row), nil
}

// ebRemoteAccounts lists an Enable Banking connection's accounts (session accounts
// + best-effort balances), annotated with any existing link.
func (s *Service) ebRemoteAccounts(ctx context.Context, c db.BankConnection) ([]RemoteAccount, error) {
	cl, err := s.ebClientForConn(ctx, c.WalletID)
	if err != nil {
		return nil, err
	}
	linked := map[string]int64{}
	if links, err := s.rq.ListBankLinks(ctx, c.ID); err == nil {
		for _, l := range links {
			linked[l.ExternalID] = l.AccountID
		}
	}
	stored := parseStoredAccounts(c.AccountsJson)
	out := make([]RemoteAccount, 0, len(stored))
	for _, a := range stored {
		bal, cur := cl.balance(ctx, a.UID)
		if cur == "" {
			cur = a.Currency
		}
		name := a.Name
		if name == "" {
			name = a.IBAN
		}
		if name == "" {
			name = a.UID
		}
		ra := RemoteAccount{ExternalID: a.UID, Name: name, Currency: cur, Balance: bal}
		if id, ok := linked[a.UID]; ok {
			ra.LinkedAccountID = &id
		}
		out = append(out, ra)
	}
	return out, nil
}

// ebFetchRows fetches import rows for each linked account of an Enable Banking
// connection, keyed by the provider account uid.
func (s *Service) ebFetchRows(ctx context.Context, c db.BankConnection, linkByExt map[string]int64, start time.Time) (map[string][]importio.Row, error) {
	cl, err := s.ebClientForConn(ctx, c.WalletID)
	if err != nil {
		return nil, err
	}
	out := make(map[string][]importio.Row)
	for _, a := range parseStoredAccounts(c.AccountsJson) {
		if _, linked := linkByExt[a.UID]; !linked {
			continue
		}
		txns, err := cl.transactions(ctx, a.UID, start)
		if err != nil {
			return nil, err
		}
		out[a.UID] = ebRowsFromTxns(txns)
	}
	return out, nil
}

// ebRowsFromTxns maps Enable Banking transactions to import rows. The dedup key is
// the provider entry reference (or a hash fallback).
func ebRowsFromTxns(txns []ebTxn) []importio.Row {
	rows := make([]importio.Row, 0, len(txns))
	for i, tx := range txns {
		d := tx.date()
		if d == "" {
			continue
		}
		amt, err := money.Parse(tx.signedAmount(), 6, ".")
		if err != nil {
			continue
		}
		status := 1 // booked
		if strings.EqualFold(tx.Status, "PDNG") {
			status = 0
		}
		rows = append(rows, importio.Row{
			Line:   i + 1,
			Date:   d,
			Amount: amt,
			Memo:   tx.memo(),
			Status: status,
			FITID:  "enablebanking:" + tx.dedupID(),
		})
	}
	return rows
}
