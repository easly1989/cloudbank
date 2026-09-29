package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

// Every save that names an account, category, payee or vehicle by id refuses
// one of another wallet with 400 invalid_reference, and still takes its own
// (#543).
func TestSavesRefuseAnotherWalletsRecords(t *testing.T) {
	c := newTestAPI(t)
	walletA, accA := makeAccount(t, c)
	walletB, accB := makeAccount(t, c)
	a := "/api/v1/wallets/" + strconv.FormatInt(walletA, 10)
	b := "/api/v1/wallets/" + strconv.FormatInt(walletB, 10)

	created := func(path string, body map[string]any) int64 {
		t.Helper()
		resp := c.do(http.MethodPost, path, body, true)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("POST %s = %d, want 201", path, resp.StatusCode)
		}
		var out struct {
			ID int64 `json:"id"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out.ID
	}
	catA := created(a+"/categories", map[string]any{"name": "Food"})
	catB := created(b+"/categories", map[string]any{"name": "Secret"})
	payA := created(a+"/payees", map[string]any{"name": "Shop"})
	payB := created(b+"/payees", map[string]any{"name": "Secret"})
	vehB := created(b+"/vehicles", map[string]any{"name": "Van"})
	ruleA := created(a+"/assignments", map[string]any{"matchField": "memo", "matchType": "contains", "pattern": "x"})
	goalA := created(a+"/goals", map[string]any{"name": "Trip", "targetAmount": 1000})

	refused := func(method, path string, body map[string]any) {
		t.Helper()
		resp := c.do(method, path, body, true)
		defer resp.Body.Close()
		var e struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&e)
		if resp.StatusCode != http.StatusBadRequest || e.Error.Code != "invalid_reference" {
			t.Errorf("%s %s = %d %q, want 400 invalid_reference", method, path, resp.StatusCode, e.Error.Code)
		}
	}
	txn := func(extra map[string]any) map[string]any {
		body := map[string]any{"accountId": accA, "date": "2026-01-01", "amount": -100}
		for k, v := range extra {
			body[k] = v
		}
		return body
	}

	t.Run("transactions", func(t *testing.T) {
		refused(http.MethodPost, a+"/transactions", txn(map[string]any{"categoryId": catB}))
		refused(http.MethodPost, a+"/transactions", txn(map[string]any{"payeeId": payB}))
		refused(http.MethodPost, a+"/transactions", txn(map[string]any{"vehicleId": vehB}))
		refused(http.MethodPost, a+"/transactions", txn(map[string]any{"splits": []map[string]any{
			{"categoryId": catA, "amount": -60}, {"categoryId": catB, "amount": -40},
		}}))
		own := created(a+"/transactions", txn(map[string]any{"categoryId": catA, "payeeId": payA}))
		refused(http.MethodPatch, a+"/transactions/"+strconv.FormatInt(own, 10), txn(map[string]any{"categoryId": catB}))
	})
	t.Run("templates", func(t *testing.T) {
		refused(http.MethodPost, a+"/templates", map[string]any{"name": "T", "accountId": accA, "categoryId": catB})
		refused(http.MethodPost, a+"/templates", map[string]any{"name": "T", "accountId": accA, "payeeId": payB})
		refused(http.MethodPost, a+"/templates", map[string]any{"name": "T", "accountId": accA, "amount": -100,
			"splits": []map[string]any{{"categoryId": catB, "amount": -100}}})
	})
	t.Run("rules", func(t *testing.T) {
		rule := map[string]any{"matchField": "memo", "matchType": "contains", "pattern": "x"}
		with := func(k string, v int64) map[string]any {
			m := map[string]any{k: v}
			for key, val := range rule {
				m[key] = val
			}
			return m
		}
		refused(http.MethodPost, a+"/assignments", with("matchAccountId", accB))
		refused(http.MethodPost, a+"/assignments", with("setPayeeId", payB))
		refused(http.MethodPost, a+"/assignments", with("setCategoryId", catB))
		refused(http.MethodPatch, a+"/assignments/"+strconv.FormatInt(ruleA, 10), with("setCategoryId", catB))
	})
	t.Run("payees", func(t *testing.T) {
		refused(http.MethodPost, a+"/payees", map[string]any{"name": "Other", "defaultCategoryId": catB})
		refused(http.MethodPatch, a+"/payees/"+strconv.FormatInt(payA, 10), map[string]any{"name": "Shop", "defaultCategoryId": catB})
	})
	t.Run("goals", func(t *testing.T) {
		refused(http.MethodPost, a+"/goals", map[string]any{"name": "G", "targetAmount": 1000, "accountId": accB})
		refused(http.MethodPatch, a+"/goals/"+strconv.FormatInt(goalA, 10), map[string]any{"name": "G", "targetAmount": 1000, "accountId": accB})
	})
}
