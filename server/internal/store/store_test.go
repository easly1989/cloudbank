package store

import (
	"sync"
	"testing"
)

// newTestStore opens a Store backed by a temporary directory, cleaned up when
// the test ends.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestOpenRunsMigrations(t *testing.T) {
	s := newTestStore(t)

	// The schema created by migration 0001 must be present.
	for _, table := range []string{"users", "sessions", "wallets", "wallet_members"} {
		var name string
		err := s.Read().QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found: %v", table, err)
		}
	}
}

func TestMigrationsIdempotentAcrossReopen(t *testing.T) {
	dir := t.TempDir()
	s1, err := Open(dir)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	if err := s1.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	// Re-opening the same directory must not fail re-running migrations.
	s2, err := Open(dir)
	if err != nil {
		t.Fatalf("second open: %v", err)
	}
	defer s2.Close()
	if err := s2.Ping(); err != nil {
		t.Errorf("ping after reopen: %v", err)
	}
}

func TestForeignKeysEnforced(t *testing.T) {
	s := newTestStore(t)
	// Inserting a session for a non-existent user must violate the FK.
	_, err := s.Write().Exec(
		`INSERT INTO sessions (id, user_id, expires_at) VALUES ('abc', 999, '2099-01-01T00:00:00Z')`,
	)
	if err == nil {
		t.Fatal("expected foreign key violation, got nil")
	}
}

// TestConcurrentWritersNoBusy hammers the single write pool from many
// goroutines; the single-connection discipline must serialize them without
// SQLITE_BUSY errors.
func TestConcurrentWritersNoBusy(t *testing.T) {
	s := newTestStore(t)

	if _, err := s.Write().Exec(
		`INSERT INTO users (username, password_hash) VALUES ('seed', 'x')`,
	); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	const workers = 16
	const perWorker = 25
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				if _, err := s.Write().Exec(
					`UPDATE users SET email = email || 'x' WHERE username = 'seed'`,
				); err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent write failed: %v", err)
	}
}
