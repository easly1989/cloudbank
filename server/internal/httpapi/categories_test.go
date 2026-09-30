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

// A PATCH moves a category only when it says where (#552): parentId left out
// keeps it in place, null makes it top-level, an id puts it there.
func TestCategoryUpdateMovesOnlyWhenAsked(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/categories"
	food := decodeCategory(t, c.do(http.MethodPost, base, map[string]any{"name": "Food"}, true))
	pay := decodeCategory(t, c.do(http.MethodPost, base, map[string]any{"name": "Pay", "isIncome": true}, true))
	groc := decodeCategory(t, c.do(http.MethodPost, base, map[string]any{"name": "Groceries", "parentId": food.ID}, true))
	at := base + "/" + strconv.FormatInt(groc.ID, 10)

	got := decodeCategory(t, c.do(http.MethodPatch, at, map[string]any{"name": "Grocery"}, true))
	if got.ParentID == nil || *got.ParentID != food.ID || got.Name != "Grocery" {
		t.Fatalf("rename without parentId = %+v, want still under Food", got)
	}
	got = decodeCategory(t, c.do(http.MethodPatch, at, map[string]any{"name": "Grocery", "parentId": pay.ID}, true))
	if got.ParentID == nil || *got.ParentID != pay.ID || !got.IsIncome {
		t.Fatalf("move under Pay = %+v, want under Pay, income", got)
	}
	got = decodeCategory(t, c.do(http.MethodPatch, at, map[string]any{"name": "Grocery", "parentId": nil}, true))
	if got.ParentID != nil {
		t.Fatalf("parentId null = %+v, want top-level", got)
	}
	// Food has no subcategory left, so it can go under Pay; Pay cannot then go
	// under anything, since Food now sits under it.
	resp := c.do(http.MethodPatch, base+"/"+strconv.FormatInt(food.ID, 10), map[string]any{"name": "Food", "parentId": pay.ID}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("move Food under Pay = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
	resp = c.do(http.MethodPatch, base+"/"+strconv.FormatInt(pay.ID, 10), map[string]any{"name": "Pay", "parentId": groc.ID}, true)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("move Pay (with Food) = %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestCategoryActivity(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	food := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Food"}, true))
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2025-12-10", "amount": -500, "categoryId": food.ID}, true).Body.Close()
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-01-10", "amount": -1000, "categoryId": food.ID}, true).Body.Close()
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-02-10", "amount": -2000, "categoryId": food.ID}, true).Body.Close()

	resp := c.do(http.MethodGet, base+"/categories/activity?from=2026-01-01&to=2026-12-31", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("activity = %d, want 200", resp.StatusCode)
	}
	defer resp.Body.Close()
	var res struct {
		Categories []struct {
			CategoryID int64
			Count      int64
			Amount     int64
			LastDate   string
		}
		Currency struct{ Code string }
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(res.Categories) != 1 || res.Categories[0].CategoryID != food.ID || res.Categories[0].Count != 2 ||
		res.Categories[0].Amount != -3000 || res.Categories[0].LastDate != "2026-02-10" || res.Currency.Code != "EUR" {
		t.Fatalf("activity = %+v", res)
	}

	for _, q := range []string{"", "?from=2026-01-01", "?from=2026-13-01&to=2026-12-31", "?from=2026-12-31&to=2026-01-01"} {
		r := c.do(http.MethodGet, base+"/categories/activity"+q, nil, false)
		if r.StatusCode != http.StatusBadRequest {
			t.Fatalf("activity%s = %d, want 400", q, r.StatusCode)
		}
		r.Body.Close()
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
