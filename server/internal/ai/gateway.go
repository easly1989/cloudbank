package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The AI's jobs, as the log and the switches name them (#696).
const (
	FeatureSuggest       = "suggest"
	FeatureEntry         = "entry"
	FeatureMail          = "mail"
	FeatureReports       = "reports"
	FeatureBudgets       = "budgets"
	FeatureSubscriptions = "subscriptions"
	FeatureSavings       = "savings"
	FeatureGoals         = "goals"
	FeatureUnusual       = "unusual"
	FeatureRules         = "rules"
	FeaturePayees        = "payees"
	FeatureImport        = "import"
	FeatureAsk           = "ask"
)

// ErrFeatureOff means the job, or the wallet it is for, is switched off. It
// is a kind of ErrNotConfigured, so callers that already stop quietly on that
// stop on this too.
var ErrFeatureOff = fmt.Errorf("%w: the feature or the wallet is switched off", ErrNotConfigured)

// ErrLimit means this month's requests are used up. An automatic job stops;
// one the user asked for asks them first, and calls again with Confirm.
var ErrLimit = errors.New("ai: this month's request limit is reached")

// sendsKept is how long the log of what was sent is kept.
const sendsKept = 90 * 24 * time.Hour

// Call is one question for the model.
type Call struct {
	UserID int64
	// WalletID is the wallet the question is about; 0 for none.
	WalletID int64
	Feature  string
	// Confirm is the user's yes to a call past this month's limit.
	Confirm bool
	System  string
	User    string
	// MaxTokens bounds the reply; 0 is a short one.
	MaxTokens int
}

// Answer is the model's reply and the model that gave it.
type Answer struct {
	Text  string
	Model string
}

func featureOn(cfg db.GetAISettingsRow, feature string) bool {
	switch feature {
	case FeatureSuggest:
		return cfg.SuggestOn != 0
	case FeatureEntry:
		return cfg.EntryOn != 0
	case FeatureMail:
		return cfg.MailOn != 0
	case FeatureReports:
		return cfg.ReportsOn != 0
	case FeatureBudgets:
		return cfg.BudgetsOn != 0
	case FeatureSubscriptions:
		return cfg.SubscriptionsOn != 0
	case FeatureSavings:
		return cfg.SavingsOn != 0
	case FeatureGoals:
		return cfg.GoalsOn != 0
	case FeatureUnusual:
		return cfg.UnusualOn != 0
	case FeatureRules:
		return cfg.RulesOn != 0
	case FeaturePayees:
		return cfg.PayeesOn != 0
	case FeatureImport:
		return cfg.ImportOn != 0
	case FeatureAsk:
		return cfg.AskOn != 0
	}
	return false
}

// Ask is the one way to the model (#696): nothing calls the provider except
// through it. It checks the master switch, the job's switch, the wallet and
// the monthly limit; hides card numbers and IBANs in what goes out; writes
// what goes out to the log, which is also what the limit counts; and only then
// asks. A call that fails at the provider still counts: it was sent.
func (s *Service) Ask(ctx context.Context, c Call) (Answer, error) {
	cfg, err := s.allowed(ctx, c.UserID, c.WalletID, c.Feature)
	if err != nil {
		return Answer{}, err
	}
	used, err := s.rq.CountAISendsSince(ctx, db.CountAISendsSinceParams{UserID: c.UserID, CreatedAt: s.monthStart()})
	if err != nil {
		return Answer{}, err
	}
	if used >= cfg.MonthlyLimit && !c.Confirm {
		return Answer{}, ErrLimit
	}

	user := hideNumbers(c.User)
	wallet := sql.NullInt64{Int64: c.WalletID, Valid: c.WalletID != 0}
	cutoff := s.now().UTC().Add(-sendsKept).Format("2006-01-02T15:04:05.000Z")
	if err := s.q.PurgeAISends(ctx, db.PurgeAISendsParams{UserID: c.UserID, CreatedAt: cutoff}); err != nil {
		return Answer{}, err
	}
	if _, err := s.q.InsertAISend(ctx, db.InsertAISendParams{
		UserID: c.UserID, WalletID: wallet, Feature: c.Feature, Model: cfg.Model,
		Sent: c.System + "\n\n" + user,
	}); err != nil {
		return Answer{}, err
	}

	// Only an administrator's own provider may be on the local network (#543).
	admin := false
	if u, err := s.rq.GetUserByID(ctx, c.UserID); err == nil {
		admin = u.IsAdmin != 0
	}
	tokens := c.MaxTokens
	if tokens == 0 {
		tokens = 300
	}
	text, err := newClient(cfg.BaseUrl, cfg.ApiKey, cfg.Model, s.hc, admin).chat(ctx, c.System, user, tokens)
	if err != nil {
		return Answer{}, err
	}
	return Answer{Text: text, Model: cfg.Model}, nil
}

// allowed loads the user's settings when the AI, the job and the wallet (0 for
// none) are all switched on; ErrNotConfigured or ErrFeatureOff otherwise.
func (s *Service) allowed(ctx context.Context, userID, walletID int64, feature string) (db.GetAISettingsRow, error) {
	cfg, err := s.load(ctx, userID)
	if err != nil {
		return cfg, err
	}
	if !ready(cfg) {
		return cfg, ErrNotConfigured
	}
	if !featureOn(cfg, feature) {
		return cfg, ErrFeatureOff
	}
	if walletID != 0 {
		off, err := s.rq.AIWalletOff(ctx, db.AIWalletOffParams{UserID: userID, WalletID: walletID})
		if err != nil {
			return cfg, err
		}
		if off > 0 {
			return cfg, ErrFeatureOff
		}
	}
	return cfg, nil
}

// Send is one entry of the log of what was sent.
type Send struct {
	ID         int64  `json:"id"`
	WalletID   *int64 `json:"walletId"`
	WalletName string `json:"walletName"`
	Feature    string `json:"feature"`
	Model      string `json:"model"`
	CreatedAt  string `json:"createdAt"`
	// Sent is the text itself, word for word; only on one entry asked for by id.
	Sent string `json:"sent,omitempty"`
}

// Sends lists the user's latest calls, newest first.
func (s *Service) Sends(ctx context.Context, userID int64, limit int64) ([]Send, error) {
	rows, err := s.rq.ListAISends(ctx, db.ListAISendsParams{UserID: userID, Limit: limit})
	if err != nil {
		return nil, err
	}
	out := make([]Send, 0, len(rows))
	for _, r := range rows {
		out = append(out, Send{
			ID: r.ID, WalletID: nullID(r.WalletID), WalletName: r.WalletName,
			Feature: r.Feature, Model: r.Model, CreatedAt: r.CreatedAt,
		})
	}
	return out, nil
}

// ErrNotFound is a log entry or a report that is not the user's.
var ErrNotFound = errors.New("ai: not found")

// SendOf returns one of the user's calls with what was sent.
func (s *Service) SendOf(ctx context.Context, userID, id int64) (Send, error) {
	r, err := s.rq.GetAISend(ctx, db.GetAISendParams{UserID: userID, ID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return Send{}, ErrNotFound
	}
	if err != nil {
		return Send{}, err
	}
	return Send{
		ID: r.ID, WalletID: nullID(r.WalletID), WalletName: r.WalletName,
		Feature: r.Feature, Model: r.Model, CreatedAt: r.CreatedAt, Sent: r.Sent,
	}, nil
}

func nullID(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	return &n.Int64
}
