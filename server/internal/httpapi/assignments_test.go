package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func decodeRule(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("decode rule: %v", err)
	}
	return m
}

func TestAssignmentRulesCrudAndApply(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	rules := base + "/assignments"
	cat := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Food"}, true))

	// Bad regex → 400 at save time.
	if r := c.do(http.MethodPost, rules, map[string]any{
		"matchField": "memo", "matchType": "regex", "pattern": "a(",
	}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad regex = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// Create a contains rule that sets a category.
	r1 := decodeRule(t, c.do(http.MethodPost, rules, map[string]any{
		"matchField": "memo", "matchType": "contains", "pattern": "coffee",
		"setCategoryId": cat.ID, "applyOnManual": true, "applyOnImport": true,
	}, true))
	id1 := int64(r1["id"].(float64))
	r2 := decodeRule(t, c.do(http.MethodPost, rules, map[string]any{
		"matchField": "memo", "matchType": "contains", "pattern": "tea", "applyOnManual": true,
	}, true))
	id2 := int64(r2["id"].(float64))

	// A transaction the rule should match.
	tx := decodeTxn(t, c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": "2026-01-15", "amount": -500, "memo": "morning coffee",
	}, true))
	txID := int64(tx["id"].(float64))

	// Tester preview.
	tresp := c.do(http.MethodPost, rules+"/test", map[string]any{"matchField": "memo", "matchType": "contains", "pattern": "coffee"}, true)
	defer tresp.Body.Close()
	var matches []map[string]any
	_ = json.NewDecoder(tresp.Body).Decode(&matches)
	if len(matches) != 1 {
		t.Fatalf("tester matches = %d, want 1", len(matches))
	}

	// Suggest for new entry text.
	sresp := c.do(http.MethodPost, rules+"/suggest", map[string]any{"memo": "coffee to go"}, true)
	sug := decodeRule(t, sresp)
	if sug["matched"] != true || int64(sug["categoryId"].(float64)) != cat.ID {
		t.Fatalf("suggest = %+v", sug)
	}

	// Bulk apply to existing → categorizes the coffee transaction.
	aresp := c.do(http.MethodPost, rules+"/apply", map[string]any{"onlyFillEmpty": true}, true)
	ap := decodeRule(t, aresp)
	if int64(ap["changed"].(float64)) != 1 {
		t.Fatalf("apply changed = %v, want 1", ap["changed"])
	}
	got := decodeTxn(t, c.do(http.MethodGet, base+"/transactions/"+strconv.FormatInt(txID, 10), nil, false))
	if got["categoryId"] == nil || int64(got["categoryId"].(float64)) != cat.ID {
		t.Fatalf("transaction category not applied: %v", got["categoryId"])
	}

	// Reorder + delete.
	if r := c.do(http.MethodPost, rules+"/reorder", map[string]any{"ids": []int64{id2, id1}}, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("reorder = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if r := c.do(http.MethodDelete, rules+"/"+strconv.FormatInt(id1, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
}

func TestAssignmentCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid, _ := makeAccount(t, admin)
	rules := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/assignments"
	r := decodeRule(t, admin.do(http.MethodPost, rules, map[string]any{
		"matchField": "memo", "matchType": "contains", "pattern": "x",
	}, true))
	id := strconv.FormatInt(int64(r["id"].(float64)), 10)

	admin.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	if resp := bob.do(http.MethodDelete, rules+"/"+id, nil, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("bob delete = %d, want 404", resp.StatusCode)
	}
}
