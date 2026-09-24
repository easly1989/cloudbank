// Package demo is the server side of the public demo build (the `demo` build
// tag): throwaway accounts started with one click, each with a year of
// made-up money; their deletion after a spell without use and every night;
// and the limits that keep one visitor from filling the disk.
//
// The package is compiled into every binary, but only the demo build's main
// constructs it, so a normal server has no way to turn into a demo.
package demo

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/banksync"
	"github.com/easly1989/cloudbank/server/internal/config"
	"github.com/easly1989/cloudbank/server/internal/goal"
	"github.com/easly1989/cloudbank/server/internal/importer"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Errors the HTTP layer turns into answers the visitor can act on.
var (
	// ErrFull means as many demo accounts are alive as the server allows.
	ErrFull = errors.New("demo: every demo seat is taken")
	// ErrTooMany means this address has started its share of demos this hour.
	ErrTooMany = errors.New("demo: too many demos started from this address")
	// ErrRealDatabase stops the demo build from opening a database that holds
	// accounts it did not make: it deletes users by the hour.
	ErrRealDatabase = errors.New("demo: this database has accounts the demo did not create; " +
		"the demo build only runs on an empty, disposable data directory")
)

// markerName is the file a demo leaves in its data directory, so it can tell
// its own database from someone's real one on the next start.
const markerName = "cloudbank-demo"

// PurgeHourUTC is when every demo account is deleted, every night.
const PurgeHourUTC = 3

// sweepEvery is how often accounts past their idle time are looked for.
const sweepEvery = 5 * time.Minute

// limitMessage is what the database says when a demo cap stops a write.
const limitMessage = "demo limit"

// IsLimit reports whether err is a demo cap stopping a write.
func IsLimit(err error) bool {
	return err != nil && strings.Contains(err.Error(), limitMessage)
}

// Service starts and ends demo accounts.
type Service struct {
	cfg   config.Demo
	q     *db.Queries
	auth  *auth.Service
	imp   *importer.Service
	goals *goal.Service
	bank  *banksync.Service
	now   func() time.Time

	// mu keeps a sweep from deleting an account while it is being filled.
	mu     sync.Mutex
	starts *window
}

// New builds the Service. write is the single write connection.
func New(cfg config.Demo, write *sql.DB, a *auth.Service, imp *importer.Service,
	goals *goal.Service, bank *banksync.Service) *Service {
	return &Service{
		cfg: cfg, q: db.New(write), auth: a, imp: imp, goals: goals, bank: bank,
		now: time.Now, starts: newWindow(time.Hour),
	}
}

// Prepare readies the database for the demo, before the server takes a
// request: it refuses a database with accounts the demo did not create, marks
// the data directory as the demo's, and installs the caps as triggers, so no
// path that writes a transaction or a wallet can go past them.
func Prepare(ctx context.Context, write *sql.DB, dataDir string, cfg config.Demo) error {
	marker := filepath.Join(dataDir, markerName)
	if _, err := os.Stat(marker); errors.Is(err, fs.ErrNotExist) {
		n, err := db.New(write).CountUsers(ctx)
		if err != nil {
			return err
		}
		if n > 0 {
			return ErrRealDatabase
		}
		note := "This data directory belongs to a CloudBank demo. Everything in it is deleted\n" +
			"after two hours without use and every night. Do not point a real CloudBank at it.\n"
		if err := os.WriteFile(marker, []byte(note), 0o600); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}

	stmts := []string{
		"DROP TRIGGER IF EXISTS demo_cap_transactions",
		"DROP TRIGGER IF EXISTS demo_cap_wallets",
	}
	if cfg.MaxTransactions > 0 {
		stmts = append(stmts, fmt.Sprintf(`CREATE TRIGGER demo_cap_transactions BEFORE INSERT ON transactions
WHEN (SELECT COUNT(*) FROM transactions WHERE wallet_id = NEW.wallet_id) >= %d
BEGIN SELECT RAISE(ABORT, '%s: transactions'); END`, cfg.MaxTransactions, limitMessage))
	}
	if cfg.MaxWallets > 0 {
		stmts = append(stmts, fmt.Sprintf(`CREATE TRIGGER demo_cap_wallets BEFORE INSERT ON wallet_members
WHEN (SELECT COUNT(*) FROM wallet_members WHERE user_id = NEW.user_id) >= %d
BEGIN SELECT RAISE(ABORT, '%s: wallets'); END`, cfg.MaxWallets, limitMessage))
	}
	for _, s := range stmts {
		if _, err := write.ExecContext(ctx, s); err != nil {
			return err
		}
	}
	return nil
}

// Limits returns the caps, for the HTTP layer to check before a write.
func (s *Service) Limits() config.Demo { return s.cfg }

// WalletFull reports whether a wallet holds as many transactions as allowed.
func (s *Service) WalletFull(ctx context.Context, walletID int64) (bool, error) {
	if s.cfg.MaxTransactions <= 0 {
		return false, nil
	}
	n, err := s.q.DemoCountWalletTransactions(ctx, walletID)
	return n >= int64(s.cfg.MaxTransactions), err
}

// WalletsFull reports whether a user holds as many wallets as allowed.
func (s *Service) WalletsFull(ctx context.Context, userID int64) (bool, error) {
	if s.cfg.MaxWallets <= 0 {
		return false, nil
	}
	n, err := s.q.DemoCountUserWallets(ctx, userID)
	return n >= int64(s.cfg.MaxWallets), err
}

// Start makes a demo account for a visitor from ip, fills it, and opens its
// session. acceptLanguage picks the language of the account and its data.
func (s *Service) Start(ctx context.Context, ip, acceptLanguage, userAgent string) (auth.User, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cfg.SessionsPerHour > 0 && !s.starts.allow(ip, s.cfg.SessionsPerHour, s.now()) {
		return auth.User{}, "", ErrTooMany
	}
	if s.cfg.MaxUsers > 0 {
		n, err := s.q.CountUsers(ctx)
		if err != nil {
			return auth.User{}, "", err
		}
		if n >= int64(s.cfg.MaxUsers) {
			return auth.User{}, "", ErrFull
		}
	}

	name, err := randomHex(5)
	if err != nil {
		return auth.User{}, "", err
	}
	password, err := randomHex(24) // never told to anyone: nobody logs in with it
	if err != nil {
		return auth.User{}, "", err
	}
	u, err := s.auth.CreateUser(ctx, "demo-"+name, "", password, false)
	if err != nil {
		return auth.User{}, "", err
	}
	s.starts.record(ip, s.now())

	id := u.ID
	fail := func(err error) (auth.User, string, error) {
		// Nothing half-made is left behind.
		_ = s.deleteUser(ctx, id)
		return auth.User{}, "", err
	}
	locale := Language(acceptLanguage)
	u, err = s.auth.UpdateSettings(ctx, id, locale, "auto", "{}")
	if err != nil {
		return fail(err)
	}
	if err := s.fill(ctx, id, locale == "it"); err != nil {
		return fail(err)
	}
	token, err := s.auth.IssueSession(ctx, id, userAgent)
	if err != nil {
		return fail(err)
	}
	return u, token, nil
}

// fill gives a new demo account its wallet: the seeded year, two savings goals,
// and a connection to the pretend bank linked to the checking account.
func (s *Service) fill(ctx context.Context, userID int64, italian bool) error {
	today := s.now().UTC()
	res, err := s.imp.ImportXHB(ctx, userID, seedFile(today, italian))
	if err != nil {
		return err
	}
	lang := 0
	if italian {
		lang = 1
	}
	w := func(key string) string { return words[key][lang] }

	accounts, err := s.q.ListAccountsForWallet(ctx, res.WalletID)
	if err != nil {
		return err
	}
	byName := map[string]int64{}
	for _, a := range accounts {
		byName[a.Name] = a.ID
	}

	day := func(monthsBack int) string {
		return today.AddDate(0, -monthsBack, 0).Format("2006-01-02")
	}
	savings := byName[w("savings")]
	tripDate := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 5, 0).Format("2006-01-02")
	goals := []struct {
		in    goal.Input
		added map[int]int64 // months back → cents
	}{
		{goal.Input{Name: w("goalTrip"), TargetAmount: 180000, TargetDate: &tripDate, Note: w("goalNote")},
			map[int]int64{3: 15000, 2: 15000, 1: 20000}},
		{goal.Input{Name: w("goalBuffer"), TargetAmount: 500000, AccountID: &savings, Note: w("goalNote")},
			map[int]int64{8: 120000, 4: 40000}},
	}
	for _, g := range goals {
		made, err := s.goals.Create(ctx, res.WalletID, g.in)
		if err != nil {
			return err
		}
		for back := 12; back >= 0; back-- {
			if cents, ok := g.added[back]; ok {
				if _, err := s.goals.AddContribution(ctx, res.WalletID, made.ID, day(back), cents, ""); err != nil {
					return err
				}
			}
		}
	}

	conn, _, err := s.bank.ConnectDemo(ctx, res.WalletID, w("bank"))
	if err != nil {
		return err
	}
	return s.bank.Link(ctx, res.WalletID, conn.ID, "demo-checking", byName[w("checking")])
}

// farFuture outlives every session: as a cutoff, it makes every account idle.
const farFuture = "9999-12-31T23:59:59Z"

// deleteUser removes one account and its wallets. It runs under mu.
func (s *Service) deleteUser(ctx context.Context, userID int64) error {
	// Revoking the sessions makes the account idle; the sweep then takes it and
	// its wallets together.
	if err := s.q.DeleteUserSessions(ctx, userID); err != nil {
		return err
	}
	_, err := s.sweep(ctx, s.now())
	return err
}

// Purge deletes the demo accounts that have gone unused past their idle time,
// or every one of them when all is set, with their wallets.
func (s *Service) Purge(ctx context.Context, all bool) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.starts.prune(s.now())
	if all {
		return s.sweepCutoff(ctx, farFuture)
	}
	return s.sweep(ctx, s.now())
}

func (s *Service) sweep(ctx context.Context, now time.Time) (int64, error) {
	return s.sweepCutoff(ctx, now.UTC().Format(time.RFC3339))
}

func (s *Service) sweepCutoff(ctx context.Context, cutoff string) (int64, error) {
	if err := s.q.DemoDeleteWalletsOfIdleUsers(ctx, cutoff); err != nil {
		return 0, err
	}
	return s.q.DemoDeleteIdleUsers(ctx, cutoff)
}

// NextNightly is the next nightly purge after now.
func NextNightly(now time.Time) time.Time {
	now = now.UTC()
	t := time.Date(now.Year(), now.Month(), now.Day(), PurgeHourUTC, 0, 0, 0, time.UTC)
	if !t.After(now) {
		t = t.AddDate(0, 0, 1)
	}
	return t
}

// Run sweeps idle accounts every few minutes and every account each night at
// PurgeHourUTC, until ctx ends.
func (s *Service) Run(ctx context.Context, logger *slog.Logger) {
	purge := func(all bool) {
		n, err := s.Purge(ctx, all)
		switch {
		case err != nil && ctx.Err() == nil:
			logger.Error("demo: purge failed", "all", all, "error", err)
		case n > 0 || all:
			logger.Info("demo: accounts deleted", "count", n, "all", all)
		}
	}
	purge(false)
	sweep := time.NewTicker(sweepEvery)
	defer sweep.Stop()
	night := time.NewTimer(time.Until(NextNightly(s.now())))
	defer night.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-sweep.C:
			purge(false)
		case <-night.C:
			purge(true)
			night.Reset(time.Until(NextNightly(s.now())))
		}
	}
}

// Language picks the demo's language from an Accept-Language header: the
// first of Italian or English the browser names, English when it names neither.
func Language(acceptLanguage string) string {
	for _, part := range strings.Split(acceptLanguage, ",") {
		tag := strings.ToLower(strings.TrimSpace(strings.SplitN(part, ";", 2)[0]))
		switch {
		case tag == "it" || strings.HasPrefix(tag, "it-"):
			return "it"
		case tag == "en" || strings.HasPrefix(tag, "en-"):
			return "en"
		}
	}
	return "en"
}

// Visitor names the address a demo is started from. With hops at 0 it is the
// TCP peer. Behind proxies, it is the entry that many places from the right of
// X-Forwarded-For: each proxy appends the address it saw, so the entries the
// proxies wrote are on the right, and anything left of them is the client's
// own claim.
func Visitor(remoteAddr, forwardedFor string, hops int) string {
	peer := remoteAddr
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		peer = host
	}
	if hops <= 0 || strings.TrimSpace(forwardedFor) == "" {
		return peer
	}
	parts := strings.Split(forwardedFor, ",")
	if hops > len(parts) {
		return peer
	}
	if ip := strings.TrimSpace(parts[len(parts)-hops]); net.ParseIP(ip) != nil {
		return ip
	}
	return peer
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// window counts the demos each address started within the last period.
type window struct {
	period time.Duration
	mu     sync.Mutex
	seen   map[string][]time.Time
}

func newWindow(period time.Duration) *window {
	return &window{period: period, seen: map[string][]time.Time{}}
}

func (w *window) recent(key string, now time.Time) []time.Time {
	kept := w.seen[key][:0]
	for _, t := range w.seen[key] {
		if now.Sub(t) < w.period {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(w.seen, key)
		return nil
	}
	w.seen[key] = kept
	return kept
}

// prune forgets the addresses with nothing in the period.
func (w *window) prune(now time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for key := range w.seen {
		w.recent(key, now)
	}
}

func (w *window) allow(key string, limit int, now time.Time) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.recent(key, now)) < limit
}

func (w *window) record(key string, now time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.seen[key] = append(w.recent(key, now), now)
}
