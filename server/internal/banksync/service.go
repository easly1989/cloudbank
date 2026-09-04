package banksync

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors.
var (
	ErrNotFound = errors.New("banksync: not found")
	ErrInvalid  = errors.New("banksync: invalid input")
)

// firstSyncLookbackDays bounds the first sync; later syncs start a few days
// before the last sync so late-posting transactions are caught (dedup covers
// the overlap).
const (
	firstSyncLookbackDays = 90
	resyncOverlapDays     = 3
	// consentValidityDays is how long an Enable Banking consent is requested for
	// (independent of the transaction-history sync window above).
	consentValidityDays = 90
)

// Provider identifiers stored in bank_connections.provider.
const (
	providerSimpleFIN     = "simplefin"
	providerEnableBanking = "enablebanking"
)

// Connection is the public view of a bank connection — never the access URL.
type Connection struct {
	ID           int64  `json:"id"`
	Provider     string `json:"provider"`
	Name         string `json:"name"`
	CreatedAt    string `json:"createdAt"`
	LastSyncedAt string `json:"lastSyncedAt,omitempty"`
	Aspsp        string `json:"aspsp,omitempty"`
	Country      string `json:"country,omitempty"`
	ValidUntil   string `json:"validUntil,omitempty"`
	AutoSync     bool   `json:"autoSync"`
}

// RemoteAccount is a provider account, with the linked CloudBank account if any.
type RemoteAccount struct {
	ExternalID      string `json:"externalId"`
	Name            string `json:"name"`
	Currency        string `json:"currency"`
	Balance         string `json:"balance"`
	LinkedAccountID *int64 `json:"linkedAccountId,omitempty"`
}

// SyncResult reports what a sync did.
type SyncResult struct {
	Imported   int `json:"imported"`
	Reconciled int `json:"reconciled"`
	Accounts   int `json:"accounts"`
	// Failed counts linked accounts whose transactions could not be fetched this
	// run; Warnings carries a human message for each. A per-account failure no
	// longer fails the whole sync — the other accounts still import.
	Failed   int      `json:"failed"`
	Warnings []string `json:"warnings,omitempty"`
}

// accountFetchError is a non-fatal, per-account failure during a sync: one
// account's transactions could not be fetched, but the others still can.
type accountFetchError struct {
	ExternalID string
	Name       string
	Err        error
}

// Service manages bank connections and imports their transactions through the
// shared import pipeline (so duplicate flagging and import rules are reused).
type Service struct {
	q   *db.Queries
	rq  *db.Queries
	imp *importio.Service
	hc  httpDoer // provider HTTP transport; nil = default. Injectable for tests.
	// syncStagger is the pause between connections in a background batch, to avoid
	// hammering providers. Tests set it to 0.
	syncStagger time.Duration
}

// NewService builds a Service. imp is the import pipeline used to commit rows.
func NewService(read, write *sql.DB, imp *importio.Service) *Service {
	return &Service{q: db.New(write), rq: db.New(read), imp: imp, syncStagger: 2 * time.Second}
}

func toConnection(c db.BankConnection) Connection {
	out := Connection{
		ID: c.ID, Provider: c.Provider, Name: c.Name, CreatedAt: c.CreatedAt,
		Aspsp: c.AspspName, Country: c.AspspCountry, ValidUntil: c.ValidUntil,
		AutoSync: c.AutoSync != 0,
	}
	if c.LastSyncedAt.Valid {
		out.LastSyncedAt = c.LastSyncedAt.String
	}
	return out
}

// conn loads a connection and checks it belongs to the wallet.
func (s *Service) conn(ctx context.Context, walletID, id int64) (db.BankConnection, error) {
	c, err := s.rq.GetBankConnection(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && c.WalletID != walletID) {
		return db.BankConnection{}, ErrNotFound
	}
	return c, err
}

// Connect claims a SimpleFIN setup token, stores the connection, and returns it
// with its remote accounts so the caller can link them.
func (s *Service) Connect(ctx context.Context, walletID int64, setupToken, name string) (Connection, []RemoteAccount, error) {
	accessURL, err := newSimplefinClient(s.hc).claim(ctx, setupToken)
	if err != nil {
		return Connection{}, nil, err
	}
	row, err := s.q.InsertBankConnection(ctx, db.InsertBankConnectionParams{
		WalletID: walletID, Provider: providerSimpleFIN, AccessUrl: secrets.Seal(accessURL), Name: name,
	})
	if err != nil {
		return Connection{}, nil, err
	}
	accounts, err := s.remoteAccounts(ctx, row)
	if err != nil {
		// The connection is saved; the caller can retry listing accounts.
		return toConnection(row), nil, nil
	}
	return toConnection(row), accounts, nil
}

// ListConnections returns the wallet's connections (no secrets).
func (s *Service) ListConnections(ctx context.Context, walletID int64) ([]Connection, error) {
	rows, err := s.rq.ListBankConnectionsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Connection, 0, len(rows))
	for _, c := range rows {
		out = append(out, toConnection(c))
	}
	return out, nil
}

// RemoveConnection deletes a connection (its links cascade). For Enable Banking it
// also best-effort revokes the bank consent.
func (s *Service) RemoveConnection(ctx context.Context, walletID, id int64) error {
	if c, err := s.conn(ctx, walletID, id); err == nil && c.Provider == providerEnableBanking {
		if cl, cerr := s.ebClientForConn(ctx, walletID); cerr == nil {
			_ = cl.deleteSession(ctx, secrets.Open(c.AccessUrl))
		}
	}
	n, err := s.q.DeleteBankConnection(ctx, db.DeleteBankConnectionParams{ID: id, WalletID: walletID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// RemoteAccounts fetches the provider accounts for a connection, annotated with
// any existing link.
func (s *Service) RemoteAccounts(ctx context.Context, walletID, connID int64) ([]RemoteAccount, error) {
	c, err := s.conn(ctx, walletID, connID)
	if err != nil {
		return nil, err
	}
	return s.remoteAccounts(ctx, c)
}

func (s *Service) remoteAccounts(ctx context.Context, c db.BankConnection) ([]RemoteAccount, error) {
	if c.Provider == providerEnableBanking {
		return s.ebRemoteAccounts(ctx, c)
	}
	return s.simplefinRemoteAccounts(ctx, c)
}

func (s *Service) simplefinRemoteAccounts(ctx context.Context, c db.BankConnection) ([]RemoteAccount, error) {
	set, err := newSimplefinClient(s.hc).fetchAccounts(ctx, secrets.Open(c.AccessUrl), 0)
	if err != nil {
		return nil, err
	}
	linked := map[string]int64{}
	if links, err := s.rq.ListBankLinks(ctx, c.ID); err == nil {
		for _, l := range links {
			linked[l.ExternalID] = l.AccountID
		}
	}
	out := make([]RemoteAccount, 0, len(set.Accounts))
	for _, a := range set.Accounts {
		ra := RemoteAccount{ExternalID: a.ID, Name: a.Name, Currency: a.Currency, Balance: a.Balance}
		if id, ok := linked[a.ID]; ok {
			ra.LinkedAccountID = &id
		}
		out = append(out, ra)
	}
	return out, nil
}

// Link maps a provider account to a CloudBank account (both wallet-scoped).
func (s *Service) Link(ctx context.Context, walletID, connID int64, externalID string, accountID int64) error {
	if externalID == "" {
		return ErrInvalid
	}
	if _, err := s.conn(ctx, walletID, connID); err != nil {
		return err
	}
	acc, err := s.rq.GetAccount(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && acc.WalletID != walletID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	return s.q.UpsertBankLink(ctx, db.UpsertBankLinkParams{
		ConnectionID: connID, ExternalID: externalID, AccountID: accountID,
	})
}

// Unlink removes a link.
func (s *Service) Unlink(ctx context.Context, walletID, connID int64, externalID string) error {
	if _, err := s.conn(ctx, walletID, connID); err != nil {
		return err
	}
	return s.q.DeleteBankLink(ctx, db.DeleteBankLinkParams{ConnectionID: connID, ExternalID: externalID})
}

// Sync fetches transactions for each linked account and imports the new ones
// through the shared pipeline (dedup + rules). Re-syncing imports nothing new.
func (s *Service) Sync(ctx context.Context, walletID, connID int64) (SyncResult, error) {
	c, err := s.conn(ctx, walletID, connID)
	if err != nil {
		return SyncResult{}, err
	}
	links, err := s.rq.ListBankLinks(ctx, connID)
	if err != nil {
		return SyncResult{}, err
	}
	linkByExt := make(map[string]int64, len(links))
	for _, l := range links {
		linkByExt[l.ExternalID] = l.AccountID
	}

	start := time.Now().AddDate(0, 0, -firstSyncLookbackDays)
	if c.LastSyncedAt.Valid {
		if last, perr := time.Parse(time.RFC3339, c.LastSyncedAt.String); perr == nil {
			start = last.AddDate(0, 0, -resyncOverlapDays)
		}
	}

	var (
		byAccount map[string][]importio.Row
		failures  []accountFetchError
		err2      error
	)
	if c.Provider == providerEnableBanking {
		byAccount, failures, err2 = s.ebFetchRows(ctx, c, linkByExt, start)
	} else {
		byAccount, err2 = s.simplefinFetchRows(ctx, c, start)
	}
	if err2 != nil {
		return SyncResult{}, err2
	}

	var res SyncResult
	for ext, accountID := range linkByExt {
		rows, present := byAccount[ext]
		if !present {
			continue
		}
		res.Accounts++
		if len(rows) == 0 {
			continue
		}
		imported, reconciled, err := s.commitRows(ctx, walletID, accountID, rows)
		if err != nil {
			return SyncResult{}, err
		}
		res.Imported += imported
		res.Reconciled += reconciled
	}
	for _, f := range failures {
		slog.Warn("bank sync: account fetch failed",
			"connection", connID, "account", f.ExternalID, "error", f.Err)
		res.Failed++
		res.Warnings = append(res.Warnings, syncWarning(f))
	}
	if err := s.q.TouchBankConnection(ctx, connID); err != nil {
		return SyncResult{}, err
	}
	return res, nil
}

// syncWarning renders a per-account fetch failure as a human message, using the
// account's name when known and stripping the internal error prefix.
func syncWarning(f accountFetchError) string {
	name := f.Name
	if strings.TrimSpace(name) == "" {
		name = f.ExternalID
	}
	msg := strings.TrimPrefix(f.Err.Error(), "banksync: ")
	return fmt.Sprintf("%s: %s", name, msg)
}

// simplefinFetchRows fetches all accounts once and maps each to import rows,
// keyed by the provider account id.
func (s *Service) simplefinFetchRows(ctx context.Context, c db.BankConnection, start time.Time) (map[string][]importio.Row, error) {
	set, err := newSimplefinClient(s.hc).fetchAccounts(ctx, secrets.Open(c.AccessUrl), start.Unix())
	if err != nil {
		return nil, err
	}
	out := make(map[string][]importio.Row, len(set.Accounts))
	for _, a := range set.Accounts {
		out[a.ID] = rowsFromTxns(a.Transactions)
	}
	return out, nil
}

// BatchSyncResult reports what a background sync run did across connections.
type BatchSyncResult struct {
	Connections int `json:"connections"` // connections successfully synced
	Imported    int `json:"imported"`
	Skipped     int `json:"skipped"` // e.g. expired Enable Banking consents
	Errors      int `json:"errors"`
}

// SetAutoSync turns background auto-sync on or off for a connection.
func (s *Service) SetAutoSync(ctx context.Context, walletID, connID int64, enabled bool) error {
	var v int64
	if enabled {
		v = 1
	}
	n, err := s.q.SetBankConnectionAutoSync(ctx, db.SetBankConnectionAutoSyncParams{
		AutoSync: v, ID: connID, WalletID: walletID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// SyncDue syncs every auto-sync connection whose last sync is older than
// olderThan (or which never synced), across all wallets. Expired Enable Banking
// consents are skipped (the user reconnects them); other per-connection errors
// are counted but do not stop the batch. It pauses briefly between connections to
// avoid hammering providers, and stops early if ctx is cancelled.
func (s *Service) SyncDue(ctx context.Context, olderThan time.Duration) (BatchSyncResult, error) {
	cutoff := time.Now().Add(-olderThan).UTC().Format("2006-01-02T15:04:05.000Z")
	rows, err := s.rq.ListDueBankConnections(ctx, sql.NullString{String: cutoff, Valid: true})
	if err != nil {
		return BatchSyncResult{}, err
	}
	var res BatchSyncResult
	for i, row := range rows {
		if i > 0 && s.syncStagger > 0 {
			select {
			case <-time.After(s.syncStagger):
			case <-ctx.Done():
				return res, ctx.Err()
			}
		}
		out, err := s.Sync(ctx, row.WalletID, row.ID)
		switch {
		case errors.Is(err, ErrEBConsentExpired):
			res.Skipped++
		case err != nil:
			res.Errors++
		default:
			res.Connections++
			res.Imported += out.Imported
		}
	}
	return res, nil
}

// rowsFromTxns maps SimpleFIN transactions to import rows. Amounts are signed
// decimal strings (negative = debit), parsed at 6 fraction digits; the dedup key
// is the provider transaction id.
func rowsFromTxns(txns []sfTxn) []importio.Row {
	rows := make([]importio.Row, 0, len(txns))
	for i, tx := range txns {
		ts := tx.Posted
		if ts == 0 {
			ts = tx.TransactedAt
		}
		if ts == 0 {
			continue // no usable date
		}
		amt, err := money.Parse(tx.Amount, 6, ".")
		if err != nil {
			continue
		}
		status := 1 // cleared
		if tx.Pending {
			status = 0
		}
		rows = append(rows, importio.Row{
			Line:   i + 1,
			Date:   time.Unix(ts, 0).UTC().Format("2006-01-02"),
			Amount: amt,
			Memo:   tx.Description,
			Status: status,
			FITID:  "simplefin:" + tx.ID,
		})
	}
	return rows
}

// commitRows runs rows through the preview pipeline (dedup + rules) and commits
// the non-duplicates, returning (created, reconciled).
func (s *Service) commitRows(ctx context.Context, walletID, accountID int64, rows []importio.Row) (int, int, error) {
	prev, err := s.imp.PreviewParsed(ctx, walletID, accountID, rows, true, true)
	if err != nil {
		return 0, 0, err
	}
	commit := make([]importio.CommitRow, 0, len(prev.Rows))
	for _, r := range prev.Rows {
		if r.Duplicate || r.Error != "" {
			continue
		}
		cr := importio.CommitRow{
			Date: r.Date, Amount: r.Amount, PaymentMode: r.PaymentMode, Info: r.Info,
			Payee: r.Payee, Memo: r.Memo, Category: r.Category, Tags: r.Tags,
			Status: r.Status, ImportRef: r.ImportRef,
		}
		if r.Match == "update" && r.MatchID > 0 {
			cr.UpdateID = r.MatchID
		}
		commit = append(commit, cr)
	}
	if len(commit) == 0 {
		return 0, 0, nil
	}
	out, err := s.imp.Commit(ctx, walletID, accountID, commit)
	if err != nil {
		return 0, 0, err
	}
	return out.Created, out.Updated, nil
}
