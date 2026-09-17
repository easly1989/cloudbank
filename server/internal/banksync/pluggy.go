package banksync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Pluggy (https://pluggy.ai) is a Latin American open-finance aggregator, and
// CloudBank's third bank-sync provider after SimpleFIN and Enable Banking. Like
// both of those it is bring-your-own-credentials: the user registers their own
// Pluggy application and supplies its client id and secret, so CloudBank never
// holds a shared key and never sees a bank login.
//
// Unlike Enable Banking there is no consent redirect to host. Banks are linked
// outside CloudBank, in Pluggy's own consumer app (Meu Pluggy), which yields an
// "item" id per connected institution; the user pastes that id and CloudBank
// reads the item's accounts and transactions server-side. That makes this the
// smallest of the three providers.

// pluggyAccountCredit is the account type Pluggy reports for a credit card.
// It is the one distinction that matters here, because it inverts the sign of
// every amount — see pluggyTransaction.signedAmount.
const pluggyAccountCredit = "CREDIT"

const (
	pluggyBaseURL = "https://api.pluggy.ai"

	// An API key is valid for two hours. Refresh early so a long sync cannot
	// have one expire underneath it mid-run.
	pluggyKeyTTL    = 2 * time.Hour
	pluggyKeyMargin = 10 * time.Minute
)

type pluggyClient struct {
	hc   httpDoer
	base string
}

func newPluggyClient(hc httpDoer, base string) *pluggyClient {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	if base == "" {
		base = pluggyBaseURL
	}
	return &pluggyClient{hc: hc, base: strings.TrimSuffix(base, "/")}
}

// pluggyAPIKey is a fetched key with the moment it stops being usable.
type pluggyAPIKey struct {
	Key       string
	ExpiresAt time.Time
}

// authenticate exchanges the application credentials for a short-lived API key.
func (c *pluggyClient) authenticate(ctx context.Context, clientID, clientSecret string) (pluggyAPIKey, error) {
	body, err := json.Marshal(map[string]string{
		"clientId":     clientID,
		"clientSecret": clientSecret,
	})
	if err != nil {
		return pluggyAPIKey{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/auth", bytes.NewReader(body))
	if err != nil {
		return pluggyAPIKey{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return pluggyAPIKey{}, fmt.Errorf("banksync: pluggy auth: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return pluggyAPIKey{}, ErrPluggyCredentials
	}
	if resp.StatusCode != http.StatusOK {
		return pluggyAPIKey{}, fmt.Errorf("banksync: pluggy auth: unexpected status %d", resp.StatusCode)
	}
	var out struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return pluggyAPIKey{}, fmt.Errorf("banksync: pluggy auth: %w", err)
	}
	if out.APIKey == "" {
		return pluggyAPIKey{}, ErrPluggyCredentials
	}
	return pluggyAPIKey{Key: out.APIKey, ExpiresAt: time.Now().Add(pluggyKeyTTL - pluggyKeyMargin)}, nil
}

// pluggyAccount is one account inside an item.
type pluggyAccount struct {
	ID            string      `json:"id"`
	Type          string      `json:"type"` // BANK or CREDIT
	Subtype       string      `json:"subtype"`
	Name          string      `json:"name"`
	MarketingName string      `json:"marketingName"`
	Number        string      `json:"number"`
	Balance       json.Number `json:"balance"`
	CurrencyCode  string      `json:"currencyCode"`
}

// displayName prefers the bank's marketing name, which is what the user sees in
// their banking app, and falls back to the plain name and then the number.
func (a pluggyAccount) displayName() string {
	for _, v := range []string{a.MarketingName, a.Name, a.Number} {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return a.ID
}

// accounts lists the accounts of one item.
func (c *pluggyClient) accounts(ctx context.Context, apiKey, itemID string) ([]pluggyAccount, error) {
	q := url.Values{"itemId": {itemID}}
	var out struct {
		Results []pluggyAccount `json:"results"`
	}
	if err := c.getJSON(ctx, apiKey, "/accounts?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Results, nil
}

// pluggyTransaction is one movement. Note the sign rules in pluggyAmount: they
// differ between bank accounts and credit cards.
type pluggyTransaction struct {
	ID             string      `json:"id"`
	Description    string      `json:"description"`
	DescriptionRaw string      `json:"descriptionRaw"`
	Amount         json.Number `json:"amount"`
	Date           string      `json:"date"`
	Type           string      `json:"type"`   // CREDIT or DEBIT
	Status         string      `json:"status"` // POSTED or PENDING
	CurrencyCode   string      `json:"currencyCode"`
}

// signedAmount returns the amount as a decimal string signed the way a ledger
// expects — negative for money leaving the user — which takes some care,
// because Pluggy's conventions differ by account type:
//
//   - On a **bank account** the direction is carried by `type`: DEBIT is an
//     outflow, CREDIT an inflow. The amount's own sign is not relied upon.
//   - On a **credit card** the sign is inverted relative to a ledger: Pluggy
//     documents a positive amount as a new charge (you owe more, i.e. an
//     expense) and a negative one as a payment or refund.
//
// Getting this wrong does not fail loudly — it silently books every card
// expense as income — so the account type is always passed in explicitly rather
// than guessed.
//
// The value stays a string throughout: amounts are parsed into int64 minor
// units by the caller, and a float must never touch one.
func (t pluggyTransaction) signedAmount(accountType string) string {
	s := strings.TrimSpace(t.Amount.String())
	if s == "" {
		return ""
	}
	negative := strings.HasPrefix(s, "-")
	magnitude := strings.TrimPrefix(strings.TrimPrefix(s, "-"), "+")

	var outflow bool
	switch {
	case strings.EqualFold(accountType, pluggyAccountCredit):
		outflow = !negative
	case strings.EqualFold(t.Type, "DEBIT"):
		outflow = true
	case strings.EqualFold(t.Type, "CREDIT"):
		outflow = false
	default:
		// No usable type: fall back to the literal sign rather than invent one.
		outflow = negative
	}
	if outflow {
		return "-" + magnitude
	}
	return magnitude
}

// cleared reports whether the movement has settled. A PENDING one can still
// change or disappear, so it is imported without a status rather than claiming
// to be reconciled.
func (t pluggyTransaction) cleared() bool {
	return strings.EqualFold(strings.TrimSpace(t.Status), "POSTED")
}

// transactions lists an account's movements from `from` (a civil date) onwards,
// following the cursor until the provider stops handing one back.
//
// v1 GET /transactions is deprecated until 2026-12-31, so this uses v2. Mind the
// parameter names: v2 renamed from/to to dateFrom/dateTo, and its `next` is a
// ready-made query string to append to the path rather than a bare cursor.
func (c *pluggyClient) transactions(ctx context.Context, apiKey, accountID, from string) ([]pluggyTransaction, error) {
	q := url.Values{"accountId": {accountID}}
	if from != "" {
		q.Set("dateFrom", from)
	}
	path := "/v2/transactions?" + q.Encode()

	var all []pluggyTransaction
	// Bounded so a provider that keeps returning a cursor cannot spin forever.
	for page := 0; page < 200; page++ {
		var out struct {
			Results []pluggyTransaction `json:"results"`
			Next    string              `json:"next"`
		}
		if err := c.getJSON(ctx, apiKey, path, &out); err != nil {
			return nil, err
		}
		all = append(all, out.Results...)
		next := strings.TrimSpace(out.Next)
		if next == "" {
			return all, nil
		}
		path = "/v2/transactions" + ensureLeadingQuery(next)
	}
	return all, nil
}

// ensureLeadingQuery normalizes the `next` fragment, which the API documents as
// a ready-to-append query string but does not promise to prefix with '?'.
func ensureLeadingQuery(next string) string {
	switch {
	case strings.HasPrefix(next, "?"), strings.HasPrefix(next, "&"):
		return "?" + strings.TrimLeft(next, "?&")
	default:
		return "?" + next
	}
}

func (c *pluggyClient) getJSON(ctx context.Context, apiKey, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-KEY", apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("banksync: pluggy: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	switch {
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return ErrPluggyCredentials
	case resp.StatusCode == http.StatusNotFound:
		return ErrPluggyItemNotFound
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("banksync: pluggy: unexpected status %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(dst); err != nil {
		return fmt.Errorf("banksync: pluggy: %w", err)
	}
	return nil
}
