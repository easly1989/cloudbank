package banksync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
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
	// Card is true for a non-IBAN account (e.g. a card identified by a CPAN); it
	// drives the default payment mode for imported rows (credit card vs direct
	// debit).
	Card bool `json:"card,omitempty"`
	// Balance / BalanceCurrency / BalanceAt cache the last balance fetched from the
	// provider so the accounts page can render without a live call on every open.
	// The provider caps unattended access per day (PSD2), so balances are refreshed
	// at most once per balanceCacheTTL. BalanceAt is RFC3339 (empty = never fetched).
	Balance         string `json:"balance,omitempty"`
	BalanceCurrency string `json:"balanceCurrency,omitempty"`
	BalanceAt       string `json:"balanceAt,omitempty"`
}

// balanceCacheTTL bounds how often account balances are re-fetched from the
// provider for the accounts page — the PSD2 daily call budget is small, so
// balances are cached between opens rather than fetched on every one.
const balanceCacheTTL = 12 * time.Hour

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
		accs = append(accs, ebStoredAccount{
			UID: a.UID, Name: a.label(), Currency: a.Currency,
			IBAN: a.identifier(), Card: a.AccountID.IBAN == "",
		})
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
// + cached balances), annotated with any existing link. Balances are refreshed
// from the provider at most once per balanceCacheTTL and cached on the connection,
// so repeatedly opening the accounts page does not exhaust the PSD2 daily budget.
func (s *Service) ebRemoteAccounts(ctx context.Context, c db.BankConnection) ([]RemoteAccount, error) {
	linked := map[string]int64{}
	if links, err := s.rq.ListBankLinks(ctx, c.ID); err == nil {
		for _, l := range links {
			linked[l.ExternalID] = l.AccountID
		}
	}
	stored := parseStoredAccounts(c.AccountsJson)

	// Refresh only the stale (or never-fetched) balances, building the client lazily
	// so an all-cached open makes no provider call at all.
	var cl *enableBankingClient
	dirty := false
	for i := range stored {
		if balanceFresh(stored[i].BalanceAt) {
			continue
		}
		if cl == nil {
			client, err := s.ebClientForConn(ctx, c.WalletID)
			if err != nil {
				return nil, err
			}
			cl = client
		}
		bal, cur := cl.balance(ctx, stored[i].UID)
		stored[i].Balance = bal
		stored[i].BalanceCurrency = cur
		stored[i].BalanceAt = time.Now().UTC().Format(time.RFC3339)
		dirty = true
	}
	if dirty {
		if js, err := json.Marshal(stored); err == nil {
			if err := s.q.UpdateEBankingAccounts(ctx, db.UpdateEBankingAccountsParams{
				AccountsJson: string(js), ID: c.ID,
			}); err != nil {
				slog.Warn("bank sync: could not cache balances", "connection", c.ID, "error", err)
			}
		}
	}

	out := make([]RemoteAccount, 0, len(stored))
	for _, a := range stored {
		cur := a.BalanceCurrency
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
		ra := RemoteAccount{ExternalID: a.UID, Name: name, Currency: cur, Balance: a.Balance}
		if id, ok := linked[a.UID]; ok {
			ra.LinkedAccountID = &id
		}
		out = append(out, ra)
	}
	return out, nil
}

// balanceFresh reports whether a cached balance timestamp (RFC3339) is recent
// enough to reuse without re-fetching from the provider.
func balanceFresh(at string) bool {
	if at == "" {
		return false
	}
	t, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return false
	}
	return time.Since(t) < balanceCacheTTL
}

// ebFetchRows fetches import rows for each linked account of an Enable Banking
// connection, keyed by the provider account uid. A failure fetching one account's
// transactions (e.g. a card account the bank does not expose, or a transient
// provider error) is returned as a non-fatal accountFetchError so the remaining
// accounts still sync — only a client/setup failure aborts the whole run.
func (s *Service) ebFetchRows(ctx context.Context, c db.BankConnection, linkByExt map[string]int64, start time.Time) (map[string][]importio.Row, []accountFetchError, error) {
	cl, err := s.ebClientForConn(ctx, c.WalletID)
	if err != nil {
		return nil, nil, err
	}
	out := make(map[string][]importio.Row)
	var failures []accountFetchError
	debugPending := bankSyncDebugPending()
	for _, a := range parseStoredAccounts(c.AccountsJson) {
		if _, linked := linkByExt[a.UID]; !linked {
			continue
		}
		name := a.Name
		if strings.TrimSpace(name) == "" {
			name = a.IBAN
		}
		txns, err := cl.transactions(ctx, a.UID, start)
		if err != nil {
			failures = append(failures, accountFetchError{ExternalID: a.UID, Name: name, Err: err})
			continue
		}
		rows := ebRowsFromTxns(txns, a.Card)
		out[a.UID] = rows

		// Diagnostics for #351: break down what the default (unfiltered) call
		// returned. This costs no extra provider call. If pending == 0 the ASPSP
		// does not expose pending in the default call; if pendingDroppedNoDate > 0
		// pending arrive but are skipped for lack of a date.
		booked, pending, other, pendingDroppedNoDate := txnStatusStats(txns)
		slog.Info("bank sync: fetched account",
			"connection", c.ID, "account", name,
			"total", len(txns), "booked", booked, "pending", pending, "other", other,
			"pendingDroppedNoDate", pendingDroppedNoDate, "rows", len(rows))

		// Opt-in probe: fetch pending explicitly and log the provider's exact
		// response. Off by default because the extra call spends the small PSD2
		// daily budget; enable it for a single manual sync to diagnose.
		if debugPending {
			if pend, perr := cl.transactionsByStatus(ctx, a.UID, start, "PDNG"); perr != nil {
				slog.Warn("bank sync: PDNG probe failed",
					"connection", c.ID, "account", name, "error", perr)
			} else {
				slog.Info("bank sync: PDNG probe",
					"connection", c.ID, "account", name, "count", len(pend))
			}
		}
	}
	return out, failures, nil
}

// txnStatusStats breaks a fetched transaction set down by status, and counts how
// many pending rows would be dropped for lacking any usable date — the two facts
// that explain whether pending transactions reach the ledger (#351).
func txnStatusStats(txns []ebTxn) (booked, pending, other, pendingDroppedNoDate int) {
	for _, t := range txns {
		switch {
		case strings.EqualFold(t.Status, "BOOK"):
			booked++
		case strings.EqualFold(t.Status, "PDNG"):
			pending++
			if t.date() == "" {
				pendingDroppedNoDate++
			}
		default:
			other++
		}
	}
	return booked, pending, other, pendingDroppedNoDate
}

// bankSyncDebugPending reports whether the opt-in pending (PDNG) probe is enabled
// via CB_BANK_SYNC_DEBUG_PENDING. It is off by default so ordinary syncs make a
// single transactions call per account and stay within the PSD2 daily budget.
func bankSyncDebugPending() bool {
	v := strings.TrimSpace(os.Getenv("CB_BANK_SYNC_DEBUG_PENDING"))
	return v != "" && v != "0" && !strings.EqualFold(v, "false")
}

// Default payment modes for imported rows, by account type (HomeBank codes):
// a card account → credit card, an IBAN account → direct debit. Import rules
// still override these when they match.
const (
	paymodeCreditCard  = 1
	paymodeDirectDebit = 11
)

// ebRowsFromTxns maps Enable Banking transactions to import rows. The dedup key is
// the provider entry reference (or a hash fallback). card selects the default
// payment mode (credit card for a card account, else direct debit).
func ebRowsFromTxns(txns []ebTxn, card bool) []importio.Row {
	paymode := paymodeDirectDebit
	if card {
		paymode = paymodeCreditCard
	}
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
		// Booked at the bank → reconciled (final); pending → cleared (provisional).
		// A pending row later settles up to reconciled when its booked form arrives.
		status := 2 // booked → reconciled
		if strings.EqualFold(tx.Status, "PDNG") {
			status = 1 // pending → cleared
		}
		rows = append(rows, importio.Row{
			Line:        i + 1,
			Date:        d,
			Amount:      amt,
			Memo:        tx.memo(),
			PaymentMode: paymode,
			Status:      status,
			FITID:       "enablebanking:" + tx.dedupID(),
		})
	}
	return rows
}
