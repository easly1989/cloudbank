// Package config loads CloudBank's runtime configuration from the environment.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds the server's runtime configuration. All values come from
// environment variables so the container is zero-config by default.
type Config struct {
	// Addr is the TCP address the HTTP server listens on (e.g. ":8080").
	Addr string
	// DataDir is the directory holding the SQLite database and backups.
	DataDir string
	// LogLevel is one of "debug", "info", "warn", "error".
	LogLevel string
	// SecureCookies controls the Secure flag on session cookies. Set false
	// for plain-HTTP LAN installs that do not terminate TLS.
	SecureCookies bool
	// RateProviderURL overrides the online exchange-rate API root (default
	// frankfurter.app). Useful for a self-hosted mirror or for testing.
	RateProviderURL string
	// VAPIDSubject is the Web Push contact (a mailto: or https: URL) sent in the
	// VAPID JWT. Defaults to a placeholder; set it to a real contact in
	// production so push services can reach the operator.
	VAPIDSubject string
	// SecretKey, when set, encrypts reversible secrets at rest (bank credentials,
	// AI API keys, 2FA secrets, the VAPID key). Empty leaves them stored in
	// plaintext (the default). It must stay stable — losing it makes previously
	// encrypted secrets unrecoverable.
	SecretKey string
	// BankSyncInterval is how often the background job wakes to check for bank
	// connections that are due to sync. Each connection's own interval (default
	// daily, configurable per connection) decides when it is actually re-synced,
	// so this only bounds how promptly a due connection is picked up. Zero disables
	// background bank sync entirely (manual "Sync now" still works).
	BankSyncInterval time.Duration

	// OIDC/SSO login. When Issuer, ClientID, ClientSecret and RedirectURL are all
	// set (see OIDCEnabled), a "Sign in with <OIDCName>" button is offered on the
	// login page alongside the local username/password form.
	OIDCIssuer       string
	OIDCClientID     string
	OIDCClientSecret string
	// OIDCRedirectURL is the absolute callback URL registered with the provider,
	// e.g. https://cloudbank.example.com/api/v1/auth/oidc/callback.
	OIDCRedirectURL string
	// OIDCScopes is the space-separated scope list (must include "openid").
	OIDCScopes string
	// OIDCName is the provider label shown on the sign-in button.
	OIDCName string
	// OIDCAutoProvision, when true, creates a local (non-admin) account on first
	// SSO login for an unknown identity; otherwise the account must pre-exist
	// (matched by verified email) or login is refused.
	OIDCAutoProvision bool

	// Demo tunes the public demo build (the `demo` build tag). A normal build
	// reads it and never uses it.
	Demo Demo
}

// Demo holds the public demo's limits.
type Demo struct {
	// Idle is how long a demo account lives without use before it is deleted.
	Idle time.Duration
	// MaxUsers caps the demo accounts alive at once.
	MaxUsers int
	// SessionsPerHour caps the demo accounts one address may start in an hour.
	SessionsPerHour int
	// ProxyHops says which X-Forwarded-For entry is the visitor: 0 ignores the
	// header (the TCP peer is the visitor), 1 takes the last entry (the one the
	// nearest proxy appended), and so on. Entries further left are the client's
	// own word and never trusted.
	ProxyHops int
	// MaxTransactions caps the transactions in one demo wallet.
	MaxTransactions int
	// MaxWallets caps the wallets one demo account may hold.
	MaxWallets int
	// MaxBody caps any request body, uploads and imports included, in bytes.
	MaxBody int64
}

// OIDCEnabled reports whether OIDC/SSO login is fully configured.
func (c Config) OIDCEnabled() bool {
	return c.OIDCIssuer != "" && c.OIDCClientID != "" && c.OIDCClientSecret != "" && c.OIDCRedirectURL != ""
}

// Load reads the configuration from the environment, applying defaults.
func Load() Config {
	return Config{
		Addr:             getenv("CB_ADDR", ":8080"),
		DataDir:          getenv("CB_DATA_DIR", "/data"),
		LogLevel:         getenv("CB_LOG_LEVEL", "info"),
		SecureCookies:    getBoolEnv("CB_SECURE_COOKIES", true),
		RateProviderURL:  getenv("CB_RATE_URL", ""),
		VAPIDSubject:     getenv("CB_VAPID_SUBJECT", "mailto:cloudbank@localhost"),
		SecretKey:        getenv("CB_SECRET_KEY", ""),
		BankSyncInterval: getDurationEnv("CB_BANK_SYNC_INTERVAL", time.Hour),

		OIDCIssuer:        getenv("CB_OIDC_ISSUER", ""),
		OIDCClientID:      getenv("CB_OIDC_CLIENT_ID", ""),
		OIDCClientSecret:  getenv("CB_OIDC_CLIENT_SECRET", ""),
		OIDCRedirectURL:   getenv("CB_OIDC_REDIRECT_URL", ""),
		OIDCScopes:        getenv("CB_OIDC_SCOPES", "openid profile email"),
		OIDCName:          getenv("CB_OIDC_NAME", "SSO"),
		OIDCAutoProvision: getBoolEnv("CB_OIDC_AUTO_PROVISION", false),

		Demo: Demo{
			Idle:            getDurationEnv("CB_DEMO_IDLE", 2*time.Hour),
			MaxUsers:        getIntEnv("CB_DEMO_MAX_USERS", 200),
			SessionsPerHour: getIntEnv("CB_DEMO_SESSIONS_PER_HOUR", 10),
			ProxyHops:       getIntEnv("CB_DEMO_PROXY_HOPS", 0),
			MaxTransactions: getIntEnv("CB_DEMO_MAX_TRANSACTIONS", 5000),
			MaxWallets:      getIntEnv("CB_DEMO_MAX_WALLETS", 3),
			MaxBody:         int64(getIntEnv("CB_DEMO_MAX_BODY", 1<<20)),
		},
	}
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

// getDurationEnv parses a Go duration (e.g. "12h", "30m"). "0", "off", "false" or
// "disabled" mean zero (feature disabled); an invalid value falls back.
func getDurationEnv(key string, fallback time.Duration) time.Duration {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback
	}
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "off", "false", "disabled":
		return 0
	}
	d, err := time.ParseDuration(strings.TrimSpace(v))
	if err != nil || d < 0 {
		return fallback
	}
	return d
}

// getIntEnv parses a non-negative integer; anything else falls back.
func getIntEnv(key string, fallback int) int {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 0 {
		return fallback
	}
	return n
}

func getBoolEnv(key string, fallback bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return b
}
