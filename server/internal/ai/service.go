package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// ErrNotConfigured is returned when AI is disabled or missing a key/model/url.
var ErrNotConfigured = errors.New("ai: not enabled or not fully configured")

// Settings is the public (safe) view of a user's AI configuration — never the key.
type Settings struct {
	Enabled bool   `json:"enabled"`
	BaseURL string `json:"baseUrl"`
	Model   string `json:"model"`
	HasKey  bool   `json:"hasKey"`
}

// SettingsInput updates a user's AI configuration. APIKey nil means "keep the
// stored key"; a non-nil empty string clears it.
type SettingsInput struct {
	Enabled bool
	BaseURL string
	Model   string
	APIKey  *string
}

// Category is a suggested category (id + full "Parent:Sub" name).
type Category struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// SuggestInput describes the transaction to categorize.
type SuggestInput struct {
	Payee  string
	Memo   string
	Amount string // human-formatted amount, for context only
}

// Service manages AI settings and category suggestions.
type Service struct {
	q  *db.Queries
	rq *db.Queries
	// hc is the HTTP transport for provider calls; nil uses the default client.
	// Tests inject a mock.
	hc httpDoer
}

// NewService builds an AI Service. read/write are the store's connection pools.
func NewService(read, write *sql.DB) *Service {
	return &Service{q: db.New(write), rq: db.New(read)}
}

func (s *Service) load(ctx context.Context, userID int64) (db.GetAISettingsRow, error) {
	row, err := s.rq.GetAISettings(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return db.GetAISettingsRow{}, nil
	}
	if err != nil {
		return db.GetAISettingsRow{}, err
	}
	row.ApiKey = secrets.Open(row.ApiKey) // decrypt for callers; UpdateSettings re-seals
	return row, nil
}

// Settings returns the user's configuration without the key.
func (s *Service) Settings(ctx context.Context, userID int64) (Settings, error) {
	row, err := s.load(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	return Settings{
		Enabled: row.Enabled != 0, BaseURL: row.BaseUrl, Model: row.Model, HasKey: row.ApiKey != "",
	}, nil
}

// UpdateSettings persists the user's configuration, preserving the stored key
// when the input key is nil.
func (s *Service) UpdateSettings(ctx context.Context, userID int64, in SettingsInput) (Settings, error) {
	row, err := s.load(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	key := row.ApiKey
	if in.APIKey != nil {
		key = strings.TrimSpace(*in.APIKey)
	}
	var enabled int64
	if in.Enabled {
		enabled = 1
	}
	if err := s.q.UpsertAISettings(ctx, db.UpsertAISettingsParams{
		UserID: userID, Enabled: enabled, BaseUrl: strings.TrimSpace(in.BaseURL),
		Model: strings.TrimSpace(in.Model), ApiKey: secrets.Seal(key),
	}); err != nil {
		return Settings{}, err
	}
	return s.Settings(ctx, userID)
}

// SuggestCategory asks the configured model to pick the best matching category
// for the transaction from the wallet's categories. It returns nil (no error)
// when the model declines or names nothing valid.
func (s *Service) SuggestCategory(ctx context.Context, userID, walletID int64, in SuggestInput) (*Category, error) {
	cfg, err := s.load(ctx, userID)
	if err != nil {
		return nil, err
	}
	if cfg.Enabled == 0 || cfg.ApiKey == "" || cfg.BaseUrl == "" || cfg.Model == "" {
		return nil, ErrNotConfigured
	}

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
	user := buildPrompt(in, names)

	reply, err := newClient(cfg.BaseUrl, cfg.ApiKey, cfg.Model, s.hc).chat(ctx, system, user)
	if err != nil {
		return nil, err
	}
	if id, name, ok := matchCategory(reply, byName); ok {
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
	if in.Memo != "" {
		fmt.Fprintf(&b, "- Memo: %s\n", in.Memo)
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
