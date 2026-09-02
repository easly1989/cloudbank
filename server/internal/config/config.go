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
	// BankSyncInterval is how stale an auto-sync bank connection may get before the
	// background job re-syncs it. Zero disables background bank sync (manual "Sync
	// now" still works).
	BankSyncInterval time.Duration
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
		BankSyncInterval: getDurationEnv("CB_BANK_SYNC_INTERVAL", 12*time.Hour),
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
