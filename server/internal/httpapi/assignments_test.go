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

	// Tester preview: a dry run, for the rule being edited.
	tres := decodeRule(t, c.do(http.MethodPost, rules+"/test", map[string]any{
		"id": id1, "matchField": "memo", "matchType": "contains", "pattern": "coffee",
	}, true))
	if tres["count"].(float64) != 1 || tres["taken"].(float64) != 0 || tres["withoutCategory"].(float64) != 1 {
		t.Fatalf("tester = %+v", tres)
	}
	if latest := tres["latest"].([]any); len(latest) != 1 {
		t.Fatalf("tester latest = %v", latest)
	}

	// The list counts what each rule decides.
	lresp := c.do(http.MethodGet, rules, nil, false)
	var listed []map[string]any
	_ = json.NewDecoder(lresp.Body).Decode(&listed)
	lresp.Body.Close()
	if len(listed) != 2 || listed[0]["matches"].(float64) != 1 || listed[1]["matches"].(float64) != 0 {
		t.Fatalf("list = %+v", listed)
	}
	if tags, ok := listed[0]["setTags"].([]any); !ok || len(tags) != 0 {
		t.Fatalf("setTags = %v, want []", listed[0]["setTags"])
	}

	// A rule adds its tags; they come back on the rule and in the suggestion.
	upd := decodeRule(t, c.do(http.MethodPatch, rules+"/"+strconv.FormatInt(id1, 10), map[string]any{
		"matchField": "memo", "matchType": "contains", "pattern": "coffee",
		"setCategoryId": cat.ID, "setTags": []string{"treats"}, "applyOnManual": true, "applyOnImport": true,
	}, true))
	if tags := upd["setTags"].([]any); len(tags) != 1 || tags[0] != "treats" {
		t.Fatalf("updated setTags = %v", upd["setTags"])
	}

	// Suggest for new entry text.
	sresp := c.do(http.MethodPost, rules+"/suggest", map[string]any{"memo": "coffee to go"}, true)
	sug := decodeRule(t, sresp)
	if sug["matched"] != true || int64(sug["categoryId"].(float64)) != cat.ID {
		t.Fatalf("suggest = %+v", sug)
	}
	if tags := sug["tags"].([]any); len(tags) != 1 || tags[0] != "treats" {
		t.Fatalf("suggest tags = %v", sug["tags"])
	}

	// Applying the tea rule alone leaves the coffee transaction alone.
	if ap := decodeRule(t, c.do(http.MethodPost, rules+"/apply", map[string]any{"onlyFillEmpty": true, "assignmentId": id2}, true)); ap["changed"].(float64) != 0 {
		t.Fatalf("apply tea changed = %v, want 0", ap["changed"])
	}

	// Bulk apply to existing → categorizes and tags the coffee transaction.
	aresp := c.do(http.MethodPost, rules+"/apply", map[string]any{"onlyFillEmpty": true}, true)
	ap := decodeRule(t, aresp)
	if int64(ap["changed"].(float64)) != 1 {
		t.Fatalf("apply changed = %v, want 1", ap["changed"])
	}
	got := decodeTxn(t, c.do(http.MethodGet, base+"/transactions/"+strconv.FormatInt(txID, 10), nil, false))
	if got["categoryId"] == nil || int64(got["categoryId"].(float64)) != cat.ID {
		t.Fatalf("transaction category not applied: %v", got["categoryId"])
	}
	if tags, _ := got["tags"].([]any); len(tags) != 1 || tags[0] != "treats" {
		t.Fatalf("transaction tags = %v, want [treats]", got["tags"])
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
