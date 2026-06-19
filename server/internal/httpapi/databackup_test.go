package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"testing"
)

func TestPreferencesRoundTrip(t *testing.T) {
	c := newTestAPI(t)
	setupAdmin(c)

	resp := c.do(http.MethodPatch, "/api/v1/auth/me", map[string]any{
		"locale": "it", "theme": "dark",
		"preferences": map[string]any{"dateFormat": "dd/MM/yyyy", "startScreen": "accounts"},
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch me = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	resp = c.do(http.MethodGet, "/api/v1/auth/me", nil, false)
	defer resp.Body.Close()
	var me struct {
		Locale      string `json:"locale"`
		Theme       string `json:"theme"`
		Preferences struct {
			DateFormat  string `json:"dateFormat"`
			StartScreen string `json:"startScreen"`
		} `json:"preferences"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&me)
	if me.Locale != "it" || me.Theme != "dark" ||
		me.Preferences.DateFormat != "dd/MM/yyyy" || me.Preferences.StartScreen != "accounts" {
		t.Fatalf("me after patch = %+v", me)
	}
}

func TestIntegrityEndpoint(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)

	// A reconciled transaction dated in the future is an anomaly.
	c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": "2099-01-01", "amount": 1000, "status": 2,
	}, true).Body.Close()

	resp := c.do(http.MethodGet, base+"/integrity", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("integrity = %d, want 200", resp.StatusCode)
	}
	var out struct {
		Issues []struct {
			Type    string `json:"type"`
			Count   int    `json:"count"`
			Fixable bool   `json:"fixable"`
		} `json:"issues"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	var found bool
	for _, i := range out.Issues {
		if i.Type == "future_reconciled" && i.Count == 1 && i.Fixable {
			found = true
		}
	}
	if !found {
		t.Fatalf("future_reconciled not reported: %+v", out.Issues)
	}

	// Fix it.
	fresp := c.do(http.MethodPost, base+"/integrity/fix", map[string]any{"type": "future_reconciled"}, true)
	if fresp.StatusCode != http.StatusOK {
		t.Fatalf("fix = %d, want 200", fresp.StatusCode)
	}
	var fix struct {
		Fixed int `json:"fixed"`
	}
	_ = json.NewDecoder(fresp.Body).Decode(&fix)
	fresp.Body.Close()
	if fix.Fixed != 1 {
		t.Fatalf("fixed = %d, want 1", fix.Fixed)
	}
}

func TestWalletBackupRestore(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": "2026-01-15", "amount": -5000,
	}, true).Body.Close()

	// Download the backup as a JSON document.
	resp := c.do(http.MethodGet, base+"/backup", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("backup = %d, want 200", resp.StatusCode)
	}
	var doc map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		t.Fatalf("decode backup: %v", err)
	}
	resp.Body.Close()

	// Restore it into a new wallet.
	rresp := c.do(http.MethodPost, "/api/v1/backup/restore", doc, true)
	if rresp.StatusCode != http.StatusCreated {
		t.Fatalf("restore = %d, want 201", rresp.StatusCode)
	}
	var restored struct {
		WalletID int64 `json:"walletId"`
	}
	_ = json.NewDecoder(rresp.Body).Decode(&restored)
	rresp.Body.Close()
	if restored.WalletID == wid || restored.WalletID == 0 {
		t.Fatalf("restored wallet id = %d (must be new)", restored.WalletID)
	}

	// The restored wallet has the account and its transaction.
	nbase := "/api/v1/wallets/" + strconv.FormatInt(restored.WalletID, 10)
	aresp := c.do(http.MethodGet, nbase+"/accounts", nil, false)
	var accts []map[string]any
	_ = json.NewDecoder(aresp.Body).Decode(&accts)
	aresp.Body.Close()
	if len(accts) != 1 {
		t.Fatalf("restored accounts = %d, want 1", len(accts))
	}
}

func TestAdminHotBackup(t *testing.T) {
	c := newTestAPI(t)
	setupAdmin(c)

	resp := c.do(http.MethodGet, "/api/v1/admin/backup", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin backup = %d, want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	// A SQLite file starts with the "SQLite format 3\0" magic header.
	if len(body) < 16 || string(body[:15]) != "SQLite format 3" {
		t.Fatalf("backup body is not a SQLite file (len=%d)", len(body))
	}

	// A non-admin user cannot download it.
	c.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret", "isAdmin": false}, true).Body.Close()
	c.do(http.MethodPost, "/api/v1/auth/logout", nil, true).Body.Close()
	c.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	resp = c.do(http.MethodGet, "/api/v1/admin/backup", nil, false)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("bob admin backup = %d, want 403", resp.StatusCode)
	}
}
