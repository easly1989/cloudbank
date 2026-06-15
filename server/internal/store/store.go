// Package store owns the SQLite database: connection management, schema
// migrations, and (in later milestones) the sqlc-generated queries.
package store

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // pure-Go driver, registered as "sqlite"
)

// Store holds the database handles. SQLite allows only one writer at a time, so
// writes go through a dedicated pool capped at a single connection (which
// serializes them and avoids SQLITE_BUSY), while reads use a separate pool that
// can open many connections. Both point at the same WAL-mode database file.
type Store struct {
	read  *sql.DB
	write *sql.DB
	path  string
}

// Open opens (creating if needed) the database under dataDir, applies all
// pending migrations, and returns a ready Store.
func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	dbPath := filepath.Join(dataDir, "cloudbank.db")

	write, err := openPool(dbPath)
	if err != nil {
		return nil, fmt.Errorf("open write pool: %w", err)
	}
	// Single writer: serialize all writes through one connection.
	write.SetMaxOpenConns(1)

	read, err := openPool(dbPath)
	if err != nil {
		_ = write.Close()
		return nil, fmt.Errorf("open read pool: %w", err)
	}

	s := &Store{read: read, write: write, path: dbPath}
	// Migrations run on the single write connection.
	if err := migrate(s.write); err != nil {
		_ = s.Close()
		return nil, err
	}
	return s, nil
}

// openPool opens a connection pool with CloudBank's standard pragmas.
func openPool(dbPath string) (*sql.DB, error) {
	dsn := "file:" + dbPath + "?" + url.Values{
		"_pragma": {
			"journal_mode(WAL)",
			"foreign_keys(ON)",
			"busy_timeout(5000)",
			"synchronous(NORMAL)",
		},
	}.Encode()

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// Read returns the read connection pool.
func (s *Store) Read() *sql.DB { return s.read }

// Write returns the single-connection write pool.
func (s *Store) Write() *sql.DB { return s.write }

// Ping verifies the database is reachable; it satisfies the health check.
func (s *Store) Ping() error { return s.read.Ping() }

// Close closes both connection pools.
func (s *Store) Close() error {
	var firstErr error
	if err := s.read.Close(); err != nil {
		firstErr = err
	}
	if err := s.write.Close(); err != nil && firstErr == nil {
		firstErr = err
	}
	return firstErr
}
