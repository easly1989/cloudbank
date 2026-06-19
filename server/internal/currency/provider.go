package currency

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// RateProvider fetches reference exchange rates from an online source.
type RateProvider interface {
	// Latest returns, for one unit of base, how many units of each other
	// currency it buys (e.g. base=EUR → {"USD": 1.07, ...}), together with the
	// quotation date (YYYY-MM-DD). Currencies the provider does not cover are
	// simply absent from the map.
	Latest(ctx context.Context, base string) (rates map[string]float64, date string, err error)
}

// DefaultFrankfurterURL is the public, key-free frankfurter.app endpoint (ECB
// reference rates).
const DefaultFrankfurterURL = "https://api.frankfurter.app"

// Frankfurter is a RateProvider backed by frankfurter.app. It needs no API key.
type Frankfurter struct {
	// BaseURL overrides the API root (used in tests). Empty = DefaultFrankfurterURL.
	BaseURL string
	// Client overrides the HTTP client. Empty = a 10s-timeout client.
	Client *http.Client
}

type frankfurterResponse struct {
	Amount float64            `json:"amount"`
	Base   string             `json:"base"`
	Date   string             `json:"date"`
	Rates  map[string]float64 `json:"rates"`
}

// Latest fetches all rates frankfurter publishes for the given base currency.
func (f *Frankfurter) Latest(ctx context.Context, base string) (map[string]float64, string, error) {
	root := f.BaseURL
	if root == "" {
		root = DefaultFrankfurterURL
	}
	client := f.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	endpoint := strings.TrimRight(root, "/") + "/latest?from=" + url.QueryEscape(strings.ToUpper(base))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		// A non-200 (e.g. an unsupported base currency) means the provider can't
		// help; the caller degrades to manual rates.
		return nil, "", fmt.Errorf("rate provider returned status %d", resp.StatusCode)
	}
	var body frankfurterResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, "", err
	}
	return body.Rates, body.Date, nil
}

// memoProvider wraps a RateProvider and caches each base's result for the
// lifetime of one refresh run, so refreshing many wallets that share a base
// currency makes a single upstream request per base.
type memoProvider struct {
	inner RateProvider
	cache map[string]memoEntry
}

type memoEntry struct {
	rates map[string]float64
	date  string
	err   error
}

func newMemoProvider(inner RateProvider) *memoProvider {
	return &memoProvider{inner: inner, cache: map[string]memoEntry{}}
}

func (m *memoProvider) Latest(ctx context.Context, base string) (map[string]float64, string, error) {
	if e, ok := m.cache[base]; ok {
		return e.rates, e.date, e.err
	}
	rates, date, err := m.inner.Latest(ctx, base)
	m.cache[base] = memoEntry{rates: rates, date: date, err: err}
	return rates, date, err
}
