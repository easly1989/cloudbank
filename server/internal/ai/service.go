package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/netguard"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// ErrNotConfigured is returned when AI is disabled or missing a key/model/url.
var ErrNotConfigured = errors.New("ai: not enabled or not fully configured")

// ErrLocalURL means a user who is not an administrator named a provider on the
// server's own network (#543).
var ErrLocalURL = errors.New("ai: only an administrator can use a provider on the local network")

// ErrBadURL means the provider URL is not an http(s) URL, or its name does not
// resolve.
var ErrBadURL = errors.New("ai: the provider URL must be an http(s) address that resolves")

// DefaultMonthlyLimit is how many calls a user's AI makes in a month unless
// they say otherwise (#696).
const DefaultMonthlyLimit = 200

// Features are the AI's jobs, each switched on by itself under the master
// switch (#696).
type Features struct {
	Suggest bool `json:"suggest"`
	Entry   bool `json:"entry"`
	Mail    bool `json:"mail"`
	Reports bool `json:"reports"`
	// Budgets: budget proposals from what is really spent (#698).
	Budgets bool `json:"budgets"`
	// Subscriptions: schedules raised, doubled or no longer paid (#699).
	Subscriptions bool `json:"subscriptions"`
	// Savings: categories that grew lately, back to what they were (#699).
	Savings bool `json:"savings"`
	// Goals: goals behind their date, dates to move, dates to set (#699).
	Goals bool `json:"goals"`
}

// Schedule is which reports come by themselves besides the monthly one,
// which comes whenever reports are on (#697).
type Schedule struct {
	Weekly bool `json:"weekly"`
	Yearly bool `json:"yearly"`
}

// Settings is the public (safe) view of a user's AI configuration — never the key.
type Settings struct {
	Enabled  bool     `json:"enabled"`
	BaseURL  string   `json:"baseUrl"`
	Model    string   `json:"model"`
	HasKey   bool     `json:"hasKey"`
	Features Features `json:"features"`
	Schedule Schedule `json:"schedule"`
	// WalletsOff are the wallets taken out of the AI's reach; every other one
	// of the user's wallets is in.
	WalletsOff   []int64 `json:"walletsOff"`
	MonthlyLimit int64   `json:"monthlyLimit"`
	// Used is how many calls this calendar month has had (UTC).
	Used   int64 `json:"used"`
	Motion bool  `json:"motion"`
	// Local is a provider on the server's own network: nothing leaves it.
	Local bool `json:"local"`
}

// SettingsInput updates a user's AI configuration. APIKey nil means "keep the
// stored key"; a non-nil empty string clears it. The other pointers, nil, keep
// what is stored too.
type SettingsInput struct {
	Enabled      bool
	BaseURL      string
	Model        string
	APIKey       *string
	Features     *Features
	Schedule     *Schedule
	WalletsOff   []int64 // nil keeps the stored list; empty clears it
	MonthlyLimit *int64
	Motion       *bool
}

// Category is a suggested category (id + full "Parent:Sub" name).
type Category struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// SuggestInput describes the transaction to categorize. Only the payee and
// the amount are sent: never the memo (#696).
type SuggestInput struct {
	Payee  string
	Amount string // human-formatted amount, for context only
}

// Service manages AI settings and category suggestions.
type Service struct {
	db *sql.DB
	q  *db.Queries
	rq *db.Queries
	// hc is the HTTP transport for provider calls; nil uses the default client.
	// Tests inject a mock.
	hc httpDoer
	// now is the clock the monthly limit counts by; tests pin it.
	now func() time.Time
}

// NewService builds an AI Service. read/write are the store's connection pools.
func NewService(read, write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write), rq: db.New(read), now: time.Now}
}

func (s *Service) load(ctx context.Context, userID int64) (db.GetAISettingsRow, error) {
	row, err := s.rq.GetAISettings(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return db.GetAISettingsRow{MonthlyLimit: DefaultMonthlyLimit, Motion: 1, YearlyOn: 1}, nil
	}
	if err != nil {
		return db.GetAISettingsRow{}, err
	}
	row.ApiKey = secrets.Open(row.ApiKey) // decrypt for callers; UpdateSettings re-seals
	return row, nil
}

func ready(cfg db.GetAISettingsRow) bool {
	return cfg.Enabled != 0 && cfg.ApiKey != "" && cfg.BaseUrl != "" && cfg.Model != ""
}

// monthStart is the first instant of the current calendar month (UTC), in the
// form the store writes timestamps in, so the two compare as strings.
func (s *Service) monthStart() string {
	n := s.now().UTC()
	return time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, time.UTC).Format("2006-01-02T15:04:05.000Z")
}

// Settings returns the user's configuration without the key.
func (s *Service) Settings(ctx context.Context, userID int64) (Settings, error) {
	row, err := s.load(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	off, err := s.rq.ListAIWalletsOff(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	used, err := s.rq.CountAISendsSince(ctx, db.CountAISendsSinceParams{UserID: userID, CreatedAt: s.monthStart()})
	if err != nil {
		return Settings{}, err
	}
	local := false
	if row.BaseUrl != "" {
		local = errors.Is(netguard.CheckURL(ctx, row.BaseUrl, false), netguard.ErrNotPublic)
	}
	return Settings{
		Enabled: row.Enabled != 0, BaseURL: row.BaseUrl, Model: row.Model, HasKey: row.ApiKey != "",
		Features: Features{
			Suggest: row.SuggestOn != 0, Entry: row.EntryOn != 0, Mail: row.MailOn != 0, Reports: row.ReportsOn != 0,
			Budgets: row.BudgetsOn != 0, Subscriptions: row.SubscriptionsOn != 0, Savings: row.SavingsOn != 0,
			Goals: row.GoalsOn != 0,
		},
		Schedule:   Schedule{Weekly: row.WeeklyOn != 0, Yearly: row.YearlyOn != 0},
		WalletsOff: off, MonthlyLimit: row.MonthlyLimit, Used: used, Motion: row.Motion != 0, Local: local,
	}, nil
}

func flag(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// UpdateSettings persists the user's configuration, preserving the stored key
// when the input key is nil. A provider on the local network is refused unless
// admin: the requests are the server's own.
func (s *Service) UpdateSettings(ctx context.Context, userID int64, admin bool, in SettingsInput) (Settings, error) {
	if err := checkBaseURL(ctx, strings.TrimSpace(in.BaseURL), admin); err != nil {
		return Settings{}, err
	}
	row, err := s.load(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	key := row.ApiKey
	if in.APIKey != nil {
		key = strings.TrimSpace(*in.APIKey)
	}
	p := db.UpsertAISettingsParams{
		UserID: userID, Enabled: flag(in.Enabled), BaseUrl: strings.TrimSpace(in.BaseURL),
		Model: strings.TrimSpace(in.Model), ApiKey: secrets.Seal(key),
		SuggestOn: row.SuggestOn, EntryOn: row.EntryOn, MailOn: row.MailOn, ReportsOn: row.ReportsOn, BudgetsOn: row.BudgetsOn,
		SubscriptionsOn: row.SubscriptionsOn, SavingsOn: row.SavingsOn, GoalsOn: row.GoalsOn,
		MonthlyLimit: row.MonthlyLimit, Motion: row.Motion, WeeklyOn: row.WeeklyOn, YearlyOn: row.YearlyOn,
	}
	if sc := in.Schedule; sc != nil {
		p.WeeklyOn, p.YearlyOn = flag(sc.Weekly), flag(sc.Yearly)
	}
	if f := in.Features; f != nil {
		p.SuggestOn, p.EntryOn, p.MailOn, p.ReportsOn = flag(f.Suggest), flag(f.Entry), flag(f.Mail), flag(f.Reports)
		p.BudgetsOn, p.SubscriptionsOn, p.SavingsOn = flag(f.Budgets), flag(f.Subscriptions), flag(f.Savings)
		p.GoalsOn = flag(f.Goals)
	}
	if in.MonthlyLimit != nil {
		if *in.MonthlyLimit < 1 || *in.MonthlyLimit > 100000 {
			return Settings{}, fmt.Errorf("%w: the monthly limit is between 1 and 100000", ErrInvalid)
		}
		p.MonthlyLimit = *in.MonthlyLimit
	}
	if in.Motion != nil {
		p.Motion = flag(*in.Motion)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Settings{}, err
	}
	defer func() { _ = tx.Rollback() }()
	q := s.q.WithTx(tx)
	if err := q.UpsertAISettings(ctx, p); err != nil {
		return Settings{}, err
	}
	if in.WalletsOff != nil {
		// Only the user's own wallets can be taken out; anything else is ignored.
		mine, err := q.ListWalletsForUser(ctx, userID)
		if err != nil {
			return Settings{}, err
		}
		member := map[int64]bool{}
		for _, w := range mine {
			member[w.ID] = true
		}
		if err := q.ClearAIWalletsOff(ctx, userID); err != nil {
			return Settings{}, err
		}
		for _, id := range in.WalletsOff {
			if !member[id] {
				continue
			}
			if err := q.AddAIWalletOff(ctx, db.AddAIWalletOffParams{UserID: userID, WalletID: id}); err != nil {
				return Settings{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return Settings{}, err
	}
	return s.Settings(ctx, userID)
}

// ErrInvalid is a setting out of range.
var ErrInvalid = errors.New("ai: invalid setting")

// checkBaseURL vets a provider URL on save: empty is fine (AI stays off),
// anything else must be http(s), and on the public internet unless admin.
func checkBaseURL(ctx context.Context, raw string, admin bool) error {
	if raw == "" {
		return nil
	}
	if admin {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return ErrBadURL
		}
		return nil
	}
	switch err := netguard.CheckURL(ctx, raw, false); {
	case err == nil:
		return nil
	case errors.Is(err, netguard.ErrNotPublic):
		return ErrLocalURL
	default:
		return ErrBadURL
	}
}

// SuggestCategory asks the configured model to pick the best matching category
// for the transaction from the wallet's categories. It returns nil (no error)
// when the model declines or names nothing valid. confirm is the user's yes to
// a call past this month's limit.
func (s *Service) SuggestCategory(ctx context.Context, userID, walletID int64, confirm bool, in SuggestInput) (*Category, error) {
	cats, err := s.rq.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	names, byName := categoryIndex(cats)
	if len(names) == 0 {
		return nil, nil
	}

	system := "You are a personal-finance assistant. Given a transaction, choose the single " +
		"best-matching category from the list. Reply with ONLY the exact category name from the " +
		"list, copied verbatim, or the single word none. Do not explain."
	reply, err := s.Ask(ctx, Call{
		UserID: userID, WalletID: walletID, Feature: FeatureSuggest, Confirm: confirm,
		System: system, User: buildPrompt(in, names),
	})
	if err != nil {
		return nil, err
	}
	if id, name, ok := matchCategory(reply.Text, byName); ok {
		return &Category{ID: id, Name: name}, nil
	}
	return nil, nil
}

// categoryIndex returns the full "Parent:Sub" names and a lookup from a
// normalized name to (id, displayName).
func categoryIndex(cats []db.Category) ([]string, map[string]Category) {
	nameByID := make(map[int64]string, len(cats))
	for _, c := range cats {
		nameByID[c.ID] = c.Name
	}
	names := make([]string, 0, len(cats))
	byName := make(map[string]Category, len(cats)*2)
	for _, c := range cats {
		full := c.Name
		if c.ParentID.Valid {
			if p, ok := nameByID[c.ParentID.Int64]; ok {
				full = p + ":" + c.Name
			}
		}
		names = append(names, full)
		cat := Category{ID: c.ID, Name: full}
		byName[normalize(full)] = cat
		byName[normalize(c.Name)] = cat // also accept the bare leaf name
	}
	return names, byName
}

func buildPrompt(in SuggestInput, names []string) string {
	var b strings.Builder
	b.WriteString("Transaction:\n")
	if in.Payee != "" {
		fmt.Fprintf(&b, "- Payee: %s\n", in.Payee)
	}
	if in.Amount != "" {
		fmt.Fprintf(&b, "- Amount: %s\n", in.Amount)
	}
	b.WriteString("\nCategories:\n")
	for _, n := range names {
		fmt.Fprintf(&b, "- %s\n", n)
	}
	return b.String()
}

func normalize(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// matchCategory resolves the model's reply to a category, tolerating surrounding
// quotes/punctuation and case. "none" (or an unlisted name) yields ok=false.
func matchCategory(reply string, byName map[string]Category) (int64, string, bool) {
	r := strings.Trim(strings.TrimSpace(reply), "\"'`.,:;")
	if r == "" || normalize(r) == "none" {
		return 0, "", false
	}
	if c, ok := byName[normalize(r)]; ok {
		return c.ID, c.Name, true
	}
	return 0, "", false
}
