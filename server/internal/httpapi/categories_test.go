package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func decodeCategory(t *testing.T, resp *http.Response) categoryResponse {
	t.Helper()
	defer resp.Body.Close()
	var c categoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		t.Fatalf("decode category: %v", err)
	}
	return c
}

func TestCategoryCrudMergeAndIsolation(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/categories"

	// Top-level + subcategory (inherits type).
	food := decodeCategory(t, c.do(http.MethodPost, base, map[string]any{"name": "Food", "isIncome": false}, true))
	resp := c.do(http.MethodPost, base, map[string]any{"name": "Groceries", "parentId": food.ID, "isIncome": true}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create sub = %d, want 201", resp.StatusCode)
	}
	sub := decodeCategory(t, resp)
	if sub.IsIncome {
		t.Fatal("subcategory should inherit expense type")
	}
	if sub.ParentID == nil || *sub.ParentID != food.ID {
		t.Fatalf("sub parent = %+v", sub.ParentID)
	}

	// Depth-3 is rejected.
	resp = c.do(http.MethodPost, base, map[string]any{"name": "X", "parentId": sub.ID}, true)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("depth-3 = %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// Usage of Food: 1 subcategory.
	uresp := c.do(http.MethodGet, base+"/"+strconv.FormatInt(food.ID, 10)+"/usage", nil, false)
	defer uresp.Body.Close()
	var usage struct {
		Subcategories int64 `json:"subcategories"`
		Payees        int64 `json:"payees"`
	}
	_ = json.NewDecoder(uresp.Body).Decode(&usage)
	if usage.Subcategories != 1 {
		t.Fatalf("usage = %+v, want 1 subcategory", usage)
	}

	// Merge Food into a new top-level "Expenses" (reparents the subcategory).
	exp := decodeCategory(t, c.do(http.MethodPost, base, map[string]any{"name": "Expenses"}, true))
	resp = c.do(http.MethodPost, base+"/"+strconv.FormatInt(food.ID, 10)+"/merge",
		map[string]any{"targetId": exp.ID}, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("merge = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()

	// Cross-user isolation: bob can't touch this wallet's categories.
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	if r := bob.do(http.MethodGet, base, nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob list categories = %d, want 404", r.StatusCode)
	}
}

func TestPayeeCrudAndMerge(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/payees"

	// Create a category to use as a payee default.
	cat := decodeCategory(t, c.do(http.MethodPost,
		"/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/categories",
		map[string]any{"name": "Shopping"}, true))

	resp := c.do(http.MethodPost, base, map[string]any{"name": "Acme", "defaultCategoryId": cat.ID}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create payee = %d, want 201", resp.StatusCode)
	}
	acme := decodeWalletPayee(t, resp)
	if acme.DefaultCategoryID == nil || *acme.DefaultCategoryID != cat.ID {
		t.Fatalf("payee default = %+v", acme)
	}

	// Duplicate name → 409.
	resp = c.do(http.MethodPost, base, map[string]any{"name": "Acme"}, true)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate payee = %d, want 409", resp.StatusCode)
	}
	resp.Body.Close()

	// Merge into another payee.
	other := decodeWalletPayee(t, c.do(http.MethodPost, base, map[string]any{"name": "Other"}, true))
	resp = c.do(http.MethodPost, base+"/"+strconv.FormatInt(acme.ID, 10)+"/merge",
		map[string]any{"targetId": other.ID}, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("merge payee = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()

	list := decodeWalletPayees(t, c.do(http.MethodGet, base, nil, false))
	if len(list) != 1 || list[0].ID != other.ID {
		t.Fatalf("payees after merge = %+v", list)
	}
}

func decodeWalletPayee(t *testing.T, resp *http.Response) payeeResponse {
	t.Helper()
	defer resp.Body.Close()
	var p payeeResponse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode payee: %v", err)
	}
	return p
}

func decodeWalletPayees(t *testing.T, resp *http.Response) []payeeResponse {
	t.Helper()
	defer resp.Body.Close()
	var p []payeeResponse
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode payees: %v", err)
	}
	return p
}
