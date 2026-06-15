// Package config loads CloudBank's runtime configuration from the environment.
package config

import (
	"os"
	"strconv"
	"strings"
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
}

// Load reads the configuration from the environment, applying defaults.
func Load() Config {
	return Config{
		Addr:          getenv("CB_ADDR", ":8080"),
		DataDir:       getenv("CB_DATA_DIR", "/data"),
		LogLevel:      getenv("CB_LOG_LEVEL", "info"),
		SecureCookies: getBoolEnv("CB_SECURE_COOKIES", true),
	}
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
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
