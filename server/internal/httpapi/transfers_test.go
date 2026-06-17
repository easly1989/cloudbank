package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

// makeTwoAccounts sets up admin + wallet (EUR base) + two accounts, returning
// the wallet id and both account ids.
func makeTwoAccounts(t *testing.T, c *testClient) (wid, accA, accB int64) {
	t.Helper()
	wid = createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/accounts"
	accA = decodeAccount(t, c.do(http.MethodPost, base, map[string]any{"name": "A", "type": "checking"}, true)).ID
	accB = decodeAccount(t, c.do(http.MethodPost, base, map[string]any{"name": "B", "type": "savings"}, true)).ID
	return wid, accA, accB
}

func accountTotal(t *testing.T, c *testClient, wid, acc int64) int64 {
	t.Helper()
	r := c.do(http.MethodGet,
		"/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/transactions?accountId="+strconv.FormatInt(acc, 10),
		nil, false)
	defer r.Body.Close()
	var list struct {
		Total int64 `json:"total"`
	}
	_ = json.NewDecoder(r.Body).Decode(&list)
	return list.Total
}

func TestTransferCrud(t *testing.T) {
	c := newTestAPI(t)
	wid, accA, accB := makeTwoAccounts(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	transfers := base + "/transfers"

	resp := c.do(http.MethodPost, transfers, map[string]any{
		"fromAccountId": accA, "toAccountId": accB, "date": "2026-01-15",
		"fromAmount": 5000, "memo": "savings",
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create transfer = %d, want 201", resp.StatusCode)
	}
	tr := decodeTxn(t, resp)
	id := int64(tr["id"].(float64))
	if int64(tr["fromAmount"].(float64)) != 5000 || int64(tr["toAmount"].(float64)) != 5000 {
		t.Fatalf("transfer amounts = %v/%v", tr["fromAmount"], tr["toAmount"])
	}

	// Each account got one leg.
	if accountTotal(t, c, wid, accA) != 1 || accountTotal(t, c, wid, accB) != 1 {
		t.Fatalf("legs not created in both accounts")
	}

	// The transaction leg is flagged as a transfer.
	txnFromID := int64(tr["txnFromId"].(float64))
	leg := decodeTxn(t, c.do(http.MethodGet, base+"/transactions/"+strconv.FormatInt(txnFromID, 10), nil, false))
	if leg["transferId"] == nil || int64(leg["transferId"].(float64)) != id {
		t.Fatalf("leg transferId = %v, want %d", leg["transferId"], id)
	}
	if leg["transferAccountId"] == nil || int64(leg["transferAccountId"].(float64)) != accB {
		t.Fatalf("leg transferAccountId = %v, want %d", leg["transferAccountId"], accB)
	}

	// Get + update.
	if r := c.do(http.MethodGet, transfers+"/"+strconv.FormatInt(id, 10), nil, false); r.StatusCode != http.StatusOK {
		t.Fatalf("get transfer = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
	uresp := c.do(http.MethodPatch, transfers+"/"+strconv.FormatInt(id, 10), map[string]any{
		"date": "2026-02-01", "fromAmount": 7000,
	}, true)
	if uresp.StatusCode != http.StatusOK {
		t.Fatalf("update transfer = %d", uresp.StatusCode)
	}
	if u := decodeTxn(t, uresp); int64(u["fromAmount"].(float64)) != 7000 {
		t.Fatalf("updated fromAmount = %v", u["fromAmount"])
	}

	// Delete removes both legs.
	if r := c.do(http.MethodDelete, transfers+"/"+strconv.FormatInt(id, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete transfer = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if accountTotal(t, c, wid, accA) != 0 || accountTotal(t, c, wid, accB) != 0 {
		t.Fatalf("legs not removed by transfer delete")
	}
}

func TestTransferSameAccountRejected(t *testing.T) {
	c := newTestAPI(t)
	wid, accA, _ := makeTwoAccounts(t, c)
	r := c.do(http.MethodPost, "/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/transfers", map[string]any{
		"fromAccountId": accA, "toAccountId": accA, "date": "2026-01-15", "fromAmount": 5000,
	}, true)
	defer r.Body.Close()
	if r.StatusCode != http.StatusBadRequest {
		t.Fatalf("same-account transfer = %d, want 400", r.StatusCode)
	}
}

// Deleting one transfer leg through the transactions endpoint removes both legs.
func TestTransferDeleteLegRemovesBoth(t *testing.T) {
	c := newTestAPI(t)
	wid, accA, accB := makeTwoAccounts(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	tr := decodeTxn(t, c.do(http.MethodPost, base+"/transfers", map[string]any{
		"fromAccountId": accA, "toAccountId": accB, "date": "2026-01-15", "fromAmount": 5000,
	}, true))
	txnToID := int64(tr["txnToId"].(float64))

	if r := c.do(http.MethodDelete, base+"/transactions/"+strconv.FormatInt(txnToID, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete leg = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if accountTotal(t, c, wid, accA) != 0 || accountTotal(t, c, wid, accB) != 0 {
		t.Fatalf("deleting one leg left the other behind")
	}
}

func TestTransferCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid, accA, accB := makeTwoAccounts(t, admin)
	transfers := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/transfers"
	tr := decodeTxn(t, admin.do(http.MethodPost, transfers, map[string]any{
		"fromAccountId": accA, "toAccountId": accB, "date": "2026-01-15", "fromAmount": 5000,
	}, true))
	id := strconv.FormatInt(int64(tr["id"].(float64)), 10)

	admin.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	if r := bob.do(http.MethodGet, transfers+"/"+id, nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob get = %d, want 404", r.StatusCode)
	}
	if r := bob.do(http.MethodDelete, transfers+"/"+id, nil, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob delete = %d, want 404", r.StatusCode)
	}
}
