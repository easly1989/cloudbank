package currency

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors.
var (
	ErrNotFound     = errors.New("currency: not found")
	ErrUnknownCode  = errors.New("currency: unknown ISO code")
	ErrDuplicate    = errors.New("currency: already added to this wallet")
	ErrBaseCurrency = errors.New("currency: operation not allowed on the base currency")
)

// Currency is the public representation of a wallet currency.
type Currency struct {
	ID            int64
	WalletID      int64
	IsoCode       string
	Name          string
	Symbol        string
	SymbolPrefix  bool
	DecimalChar   string
	GroupChar     string
	FracDigits    int
	IsBase        bool
	Rate          float64
	RateUpdatedAt string
}

// Rate is one historical exchange-rate record.
type Rate struct {
	Date   string
	Rate   float64
	Source string
}

func toCurrency(c db.Currency) Currency {
	out := Currency{
		ID: c.ID, WalletID: c.WalletID, IsoCode: c.IsoCode, Name: c.Name,
		Symbol: c.Symbol, SymbolPrefix: c.SymbolPrefix != 0,
		DecimalChar: c.DecimalChar, GroupChar: c.GroupChar,
		FracDigits: int(c.FracDigits), IsBase: c.IsBase != 0, Rate: c.Rate,
	}
	if c.RateUpdatedAt.Valid {
		out.RateUpdatedAt = c.RateUpdatedAt.String
	}
	return out
}

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// Service implements per-wallet currency management.
type Service struct {
	db *sql.DB
	q  *db.Queries
}

// NewService builds a Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// ListForWallet returns a wallet's currencies (base first).
func (s *Service) ListForWallet(ctx context.Context, walletID int64) ([]Currency, error) {
	rows, err := s.q.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Currency, 0, len(rows))
	for _, c := range rows {
		out = append(out, toCurrency(c))
	}
	return out, nil
}

// Get returns a currency by id.
func (s *Service) Get(ctx context.Context, id int64) (Currency, error) {
	c, err := s.q.GetCurrency(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Currency{}, ErrNotFound
	}
	if err != nil {
		return Currency{}, err
	}
	return toCurrency(c), nil
}

// AddCurrency adds an ISO currency to a wallet from the catalog. When makeBase
// is set (or it is the wallet's first currency), it becomes the base currency.
func (s *Service) AddCurrency(ctx context.Context, walletID int64, isoCode string, makeBase bool) (Currency, error) {
	entry, ok := Lookup(isoCode)
	if !ok {
		return Currency{}, ErrUnknownCode
	}

	n, err := s.q.CountWalletCurrencies(ctx, walletID)
	if err != nil {
		return Currency{}, err
	}
	base := makeBase || n == 0

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Currency{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if base {
		if err := qtx.ClearWalletBase(ctx, walletID); err != nil {
			return Currency{}, err
		}
	}
	c, err := qtx.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: walletID, IsoCode: entry.Code, Name: entry.Name, Symbol: entry.Symbol,
		SymbolPrefix: b2i(entry.SymbolPrefix), DecimalChar: ".", GroupChar: ",",
		FracDigits: int64(entry.FracDigits), IsBase: b2i(base), Rate: 1,
	})
	if err != nil {
		if isUnique(err) {
			return Currency{}, ErrDuplicate
		}
		return Currency{}, err
	}
	if base {
		if err := qtx.UpdateWalletBaseCurrency(ctx, db.UpdateWalletBaseCurrencyParams{
			BaseCurrencyID: sql.NullInt64{Int64: c.ID, Valid: true}, ID: walletID,
		}); err != nil {
			return Currency{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Currency{}, err
	}
	return toCurrency(c), nil
}

// SetBase makes a currency the wallet's base (its rate becomes 1).
func (s *Service) SetBase(ctx context.Context, walletID, currencyID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if err := qtx.ClearWalletBase(ctx, walletID); err != nil {
		return err
	}
	if err := qtx.SetCurrencyBase(ctx, currencyID); err != nil {
		return err
	}
	if err := qtx.UpdateWalletBaseCurrency(ctx, db.UpdateWalletBaseCurrencyParams{
		BaseCurrencyID: sql.NullInt64{Int64: currencyID, Valid: true}, ID: walletID,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// UpdateRate sets a manual exchange rate (value of one unit in the base
// currency) and records it in the history. The base currency cannot be changed.
func (s *Service) UpdateRate(ctx context.Context, currencyID int64, rate float64) error {
	c, err := s.Get(ctx, currencyID)
	if err != nil {
		return err
	}
	if c.IsBase {
		return ErrBaseCurrency
	}
	return s.setRate(ctx, currencyID, rate, time.Now().UTC().Format("2006-01-02"), "manual")
}

// setRate writes a currency's current rate and appends a history record.
func (s *Service) setRate(ctx context.Context, currencyID int64, rate float64, date, source string) error {
	if err := s.q.UpdateCurrencyRate(ctx, db.UpdateCurrencyRateParams{Rate: rate, ID: currencyID}); err != nil {
		return err
	}
	return s.q.UpsertExchangeRate(ctx, db.UpsertExchangeRateParams{
		CurrencyID: currencyID,
		Date:       date,
		Rate:       rate,
		Source:     source,
	})
}

// RefreshResult summarises an online rate refresh for one wallet.
type RefreshResult struct {
	Date        string   `json:"date"`        // provider quotation date, when available
	Updated     []string `json:"updated"`     // ISO codes refreshed from the provider
	Unsupported []string `json:"unsupported"` // wallet currencies the provider does not cover
	// ProviderError is set (and Updated empty) when the provider was unreachable
	// or does not support the base currency; existing manual rates are kept.
	ProviderError string `json:"providerError,omitempty"`
}

// RefreshRates updates a wallet's non-base currencies from the provider,
// recording history with source "frankfurter". Currencies the provider does not
// cover are left untouched (manual) and listed in Unsupported. Provider failure
// degrades gracefully: manual rates are kept and ProviderError is set.
func (s *Service) RefreshRates(ctx context.Context, walletID int64, provider RateProvider) (RefreshResult, error) {
	res := RefreshResult{Updated: []string{}, Unsupported: []string{}}
	if provider == nil {
		res.ProviderError = "no rate provider configured"
		return res, nil
	}
	currencies, err := s.ListForWallet(ctx, walletID)
	if err != nil {
		return res, err
	}
	var base *Currency
	others := make([]Currency, 0, len(currencies))
	for i := range currencies {
		if currencies[i].IsBase {
			base = &currencies[i]
		} else {
			others = append(others, currencies[i])
		}
	}
	if base == nil || len(others) == 0 {
		return res, nil
	}

	rates, date, err := provider.Latest(ctx, base.IsoCode)
	if err != nil {
		res.ProviderError = err.Error()
		return res, nil
	}
	res.Date = date
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}

	for _, c := range others {
		perBase, ok := rates[c.IsoCode]
		if !ok || perBase == 0 {
			res.Unsupported = append(res.Unsupported, c.IsoCode)
			continue
		}
		// Provider gives units-of-c per one base; we store base per one unit of c.
		rate := 1.0 / perBase
		if err := s.setRate(ctx, c.ID, rate, date, "frankfurter"); err != nil {
			return res, err
		}
		res.Updated = append(res.Updated, c.IsoCode)
	}
	return res, nil
}

// RefreshAll refreshes every wallet's rates, sharing one provider request per
// distinct base currency. It is used by the daily background job; per-wallet
// errors are logged, not fatal.
func (s *Service) RefreshAll(ctx context.Context, provider RateProvider, log func(walletID int64, res RefreshResult, err error)) error {
	ids, err := s.q.ListAllWalletIDs(ctx)
	if err != nil {
		return err
	}
	memo := newMemoProvider(provider)
	for _, id := range ids {
		res, err := s.RefreshRates(ctx, id, memo)
		if log != nil {
			log(id, res, err)
		}
	}
	return nil
}

// UpdateFormat changes a currency's display metadata.
func (s *Service) UpdateFormat(ctx context.Context, currencyID int64, symbol string, prefix bool, decimalChar, groupChar string, fracDigits int) error {
	return s.q.UpdateCurrencyFormat(ctx, db.UpdateCurrencyFormatParams{
		Symbol: symbol, SymbolPrefix: b2i(prefix), DecimalChar: decimalChar,
		GroupChar: groupChar, FracDigits: int64(fracDigits), ID: currencyID,
	})
}

// Delete removes a currency. The base currency cannot be deleted.
func (s *Service) Delete(ctx context.Context, currencyID int64) error {
	c, err := s.Get(ctx, currencyID)
	if err != nil {
		return err
	}
	if c.IsBase {
		return ErrBaseCurrency
	}
	return s.q.DeleteCurrency(ctx, currencyID)
}

// RateHistory returns a currency's exchange-rate history (newest first).
func (s *Service) RateHistory(ctx context.Context, currencyID int64) ([]Rate, error) {
	rows, err := s.q.ListExchangeRates(ctx, currencyID)
	if err != nil {
		return nil, err
	}
	out := make([]Rate, 0, len(rows))
	for _, r := range rows {
		out = append(out, Rate{Date: r.Date, Rate: r.Rate, Source: r.Source})
	}
	return out, nil
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}
