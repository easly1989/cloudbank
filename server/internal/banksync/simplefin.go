// Package banksync connects external bank-data providers and imports their
// transactions. The first provider is SimpleFIN — a bring-your-own-subscription
// service: the user pays SimpleFIN Bridge and pastes a Setup Token; CloudBank
// claims it once for an Access URL and fetches accounts/transactions with it.
package banksync

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ErrTokenClaimed means the setup token was invalid or already used (HTTP 403).
var ErrTokenClaimed = errors.New("banksync: setup token invalid or already claimed")

// httpDoer is the subset of *http.Client used; injectable for tests.
type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type simplefinClient struct {
	hc httpDoer
}

func newSimplefinClient(hc httpDoer) *simplefinClient {
	if hc == nil {
		// Do not follow redirects: the claim POST and the /accounts GET both expect
		// a direct response, so a redirect (e.g. a stale/relocated host) should
		// surface as an error rather than silently downgrade the POST to a GET.
		hc = &http.Client{
			Timeout:       30 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
	}
	return &simplefinClient{hc: hc}
}

// claim exchanges a Setup Token (base64 of a claim URL) for an Access URL that
// embeds Basic-Auth credentials.
func (c *simplefinClient) claim(ctx context.Context, setupToken string) (string, error) {
	dec, err := base64.StdEncoding.DecodeString(strings.TrimSpace(setupToken))
	if err != nil {
		return "", ErrTokenClaimed
	}
	claimURL := strings.TrimSpace(string(dec))
	if !strings.HasPrefix(claimURL, "https://") && !strings.HasPrefix(claimURL, "http://") {
		return "", ErrTokenClaimed
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, claimURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusForbidden {
		return "", ErrTokenClaimed
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("banksync: claim failed (%d)", resp.StatusCode)
	}
	accessURL := strings.TrimSpace(string(body))
	if !strings.HasPrefix(accessURL, "http") {
		return "", fmt.Errorf("banksync: claim returned no access url")
	}
	return accessURL, nil
}

// sfAccountSet is the /accounts response.
type sfAccountSet struct {
	Errlist  []string    `json:"errlist"`
	Accounts []sfAccount `json:"accounts"`
}

type sfAccount struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Currency     string  `json:"currency"`
	Balance      string  `json:"balance"`
	Transactions []sfTxn `json:"transactions"`
}

type sfTxn struct {
	ID           string `json:"id"`
	Posted       int64  `json:"posted"`
	Amount       string `json:"amount"`
	Description  string `json:"description"`
	Pending      bool   `json:"pending"`
	TransactedAt int64  `json:"transacted_at"`
}

// fetchAccounts GETs /accounts from the access URL. startDate (unix seconds, 0 =
// omit) bounds transactions; pending transactions are included.
func (c *simplefinClient) fetchAccounts(ctx context.Context, accessURL string, startDate int64) (*sfAccountSet, error) {
	u, err := url.Parse(accessURL)
	if err != nil {
		return nil, fmt.Errorf("banksync: invalid access url")
	}
	creds := u.User
	u.User = nil
	u.Path = strings.TrimRight(u.Path, "/") + "/accounts"
	q := url.Values{}
	q.Set("pending", "1")
	if startDate > 0 {
		q.Set("start-date", strconv.FormatInt(startDate, 10))
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if creds != nil {
		pw, _ := creds.Password()
		req.SetBasicAuth(creds.Username(), pw)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("banksync: provider returned %d", resp.StatusCode)
	}
	var set sfAccountSet
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&set); err != nil {
		return nil, fmt.Errorf("banksync: could not read provider response: %w", err)
	}
	return &set, nil
}
