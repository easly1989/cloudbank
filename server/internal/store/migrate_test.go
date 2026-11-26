package store

import (
	"path/filepath"
	"testing"
)

// 0073 gives every mailbox one source named after its folder, with its cursor
// and AI settings, and hands it the mailbox's patterns and mails (#794).
func TestMailSourcesBackfill(t *testing.T) {
	db, err := openPool(filepath.Join(t.TempDir(), "cloudbank.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrateUpTo(db, "0072_transaction_merge.sql"); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO wallets (id, title) VALUES (1, 'W')`,
		`INSERT INTO currencies (id, wallet_id, iso_code, name, symbol, frac_digits, is_base, rate) VALUES (1, 1, 'EUR', 'Euro', 'E', 2, 1, 1)`,
		`INSERT INTO accounts (id, wallet_id, name, type, currency_id) VALUES (1, 1, 'Conto', 'bank', 1)`,
		`INSERT INTO mailboxes (id, wallet_id, provider, address, folder, uid_validity, last_uid, ai_mode, ai_account_id, ai_field, ai_senders)
		 VALUES (1, 1, 'imap', 'a@example.com', 'Banca', 7, 42, 'patterns_ai', 1, 'payee', 'banca.example')`,
		`INSERT INTO mailboxes (id, wallet_id, provider, address) VALUES (2, 1, 'microsoft', 'b@example.com')`,
		`INSERT INTO mail_patterns (id, mailbox_id, sender, body, account_id) VALUES (1, 1, 'avvisi@banca.example', 'x', 1)`,
		`INSERT INTO mail_messages (id, mailbox_id, uid, message_id, received_at) VALUES (1, 1, 40, '<1@example>', '2026-10-15T12:00:00Z')`,
		`INSERT INTO mail_messages (id, mailbox_id, uid, message_id, received_at) VALUES (2, 2, 3, '<2@example>', '2026-10-15T12:00:00Z')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	type source struct {
		id, mailbox, position, validity, last int64
		name, folder, mode, field, senders    string
		account                               *int64
	}
	rows, err := db.Query(`SELECT id, mailbox_id, position, uid_validity, last_uid, name, folder, ai_mode, ai_field, ai_senders, ai_account_id
		FROM mail_sources ORDER BY mailbox_id`)
	if err != nil {
		t.Fatal(err)
	}
	var got []source
	for rows.Next() {
		var s source
		if err := rows.Scan(&s.id, &s.mailbox, &s.position, &s.validity, &s.last, &s.name, &s.folder, &s.mode, &s.field, &s.senders, &s.account); err != nil {
			t.Fatal(err)
		}
		got = append(got, s)
	}
	_ = rows.Close()
	if len(got) != 2 {
		t.Fatalf("%d sources, want one per mailbox", len(got))
	}
	a, b := got[0], got[1]
	if a.mailbox != 1 || a.name != "Banca" || a.folder != "Banca" || a.validity != 7 || a.last != 42 ||
		a.mode != "patterns_ai" || a.field != "payee" || a.senders != "banca.example" || a.account == nil || *a.account != 1 {
		t.Fatalf("source of mailbox 1 = %+v", a)
	}
	if b.mailbox != 2 || b.name != "INBOX" || b.folder != "INBOX" || b.mode != "patterns" || b.account != nil {
		t.Fatalf("source of mailbox 2 = %+v", b)
	}

	var patternSource int64
	if err := db.QueryRow(`SELECT source_id FROM mail_patterns WHERE id = 1`).Scan(&patternSource); err != nil || patternSource != a.id {
		t.Fatalf("pattern source = %d, %v", patternSource, err)
	}
	for id, want := range map[int64]source{1: a, 2: b} {
		var src int64
		var folder string
		if err := db.QueryRow(`SELECT source_id, folder FROM mail_messages WHERE id = ?`, id).Scan(&src, &folder); err != nil {
			t.Fatal(err)
		}
		if src != want.id || folder != want.folder {
			t.Fatalf("mail %d: source %d folder %q, want %d %q", id, src, folder, want.id, want.folder)
		}
	}

	// A removed source keeps its mails, without it, and takes its patterns.
	if _, err := db.Exec(`DELETE FROM mail_sources WHERE id = ?`, a.id); err != nil {
		t.Fatal(err)
	}
	var mails, patterns int
	_ = db.QueryRow(`SELECT COUNT(*) FROM mail_messages WHERE mailbox_id = 1 AND source_id IS NULL`).Scan(&mails)
	_ = db.QueryRow(`SELECT COUNT(*) FROM mail_patterns`).Scan(&patterns)
	if mails != 1 || patterns != 0 {
		t.Fatalf("after removing the source: %d mails without it, %d patterns", mails, patterns)
	}
}
