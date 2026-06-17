package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func decodeTemplate(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("decode template: %v", err)
	}
	return m
}

func TestTemplateCrudAndFromTransaction(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	tpls := base + "/templates"

	// Create a template.
	resp := c.do(http.MethodPost, tpls, map[string]any{
		"name": "Rent", "accountId": acc, "amount": -120000, "paymentMode": 4,
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d, want 201", resp.StatusCode)
	}
	tpl := decodeTemplate(t, resp)
	id := int64(tpl["id"].(float64))

	// List.
	lr := c.do(http.MethodGet, tpls, nil, false)
	defer lr.Body.Close()
	var list []map[string]any
	_ = json.NewDecoder(lr.Body).Decode(&list)
	if len(list) != 1 {
		t.Fatalf("list = %d, want 1", len(list))
	}

	// Blank name → 400.
	if r := c.do(http.MethodPost, tpls, map[string]any{"name": "   "}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("blank name = %d, want 400", r.StatusCode)
	}

	// Create-from-transaction.
	tx := decodeTxn(t, c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": "2026-01-15", "amount": -2500, "memo": "coffee",
	}, true))
	txID := int64(tx["id"].(float64))
	fr := c.do(http.MethodPost, tpls+"/from-transaction/"+strconv.FormatInt(txID, 10), map[string]any{"name": "Coffee"}, true)
	if fr.StatusCode != http.StatusCreated {
		t.Fatalf("from-transaction = %d, want 201", fr.StatusCode)
	}
	fromTpl := decodeTemplate(t, fr)
	if fromTpl["name"] != "Coffee" || int64(fromTpl["amount"].(float64)) != -2500 {
		t.Fatalf("from-transaction template = %+v", fromTpl)
	}

	// Delete the first template.
	if r := c.do(http.MethodDelete, tpls+"/"+strconv.FormatInt(id, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
}

func TestTemplateCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid, acc := makeAccount(t, admin)
	tpls := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/templates"
	tpl := decodeTemplate(t, admin.do(http.MethodPost, tpls, map[string]any{"name": "Rent", "accountId": acc, "amount": -100}, true))
	id := strconv.FormatInt(int64(tpl["id"].(float64)), 10)

	admin.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	if r := bob.do(http.MethodGet, tpls+"/"+id, nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob get = %d, want 404", r.StatusCode)
	}
}
