package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func makeTemplate(t *testing.T, c *testClient, wid, acc int64) int64 {
	t.Helper()
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	tpl := decodeTemplate(t, c.do(http.MethodPost, base+"/templates", map[string]any{
		"name": "Rent", "accountId": acc, "amount": -120000, "paymentMode": 4,
	}, true))
	return int64(tpl["id"].(float64))
}

func TestScheduleCrudAndPost(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	tpl := makeTemplate(t, c, wid, acc)
	sched := base + "/schedules"

	resp := c.do(http.MethodPost, sched, map[string]any{
		"templateId": tpl, "unit": "month", "everyN": 1, "nextDue": "2026-01-15", "autoPost": true,
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d, want 201", resp.StatusCode)
	}
	sc := decodeTxn(t, resp)
	id := int64(sc["id"].(float64))

	// List shows it with the template summary.
	lr := c.do(http.MethodGet, sched, nil, false)
	defer lr.Body.Close()
	var list []map[string]any
	_ = json.NewDecoder(lr.Body).Decode(&list)
	if len(list) != 1 || list[0]["templateName"] != "Rent" {
		t.Fatalf("list = %+v", list)
	}

	// Post now → one transaction in the account, schedule advances.
	if r := c.do(http.MethodPost, sched+"/"+strconv.FormatInt(id, 10)+"/post", nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("post now = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if total := accountTotal(t, c, wid, acc); total != 1 {
		t.Fatalf("account total after post = %d, want 1", total)
	}
	after := decodeTxn(t, c.do(http.MethodGet, sched+"/"+strconv.FormatInt(id, 10), nil, false))
	if after["nextDue"] != "2026-02-15" {
		t.Fatalf("nextDue = %v, want 2026-02-15", after["nextDue"])
	}

	// Skip → no new transaction, advances again.
	if r := c.do(http.MethodPost, sched+"/"+strconv.FormatInt(id, 10)+"/skip", nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("skip = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if total := accountTotal(t, c, wid, acc); total != 1 {
		t.Fatalf("skip should not post; total = %d", total)
	}

	// Invalid unit → 400.
	if r := c.do(http.MethodPost, sched, map[string]any{"templateId": tpl, "unit": "fortnight", "everyN": 1, "nextDue": "2026-01-15"}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad unit = %d, want 400", r.StatusCode)
	}

	// Delete.
	if r := c.do(http.MethodDelete, sched+"/"+strconv.FormatInt(id, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", r.StatusCode)
	} else {
		r.Body.Close()
	}
}

func TestScheduleCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	wid, acc := makeAccount(t, admin)
	tpl := makeTemplate(t, admin, wid, acc)
	sched := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/schedules"
	sc := decodeTxn(t, admin.do(http.MethodPost, sched, map[string]any{
		"templateId": tpl, "unit": "month", "everyN": 1, "nextDue": "2026-01-15",
	}, true))
	id := strconv.FormatInt(int64(sc["id"].(float64)), 10)

	admin.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	if r := bob.do(http.MethodPost, sched+"/"+id+"/post", nil, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob post = %d, want 404", r.StatusCode)
	}
}

// The calendar lists a month's occurrences; posting one can change its amount;
// another wallet's calendar is out of reach (#546).
func TestScheduleCalendar(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	tpl := makeTemplate(t, c, wid, acc)
	sc := decodeTxn(t, c.do(http.MethodPost, base+"/schedules", map[string]any{
		"templateId": tpl, "unit": "month", "everyN": 1, "nextDue": "2026-09-01",
	}, true))
	id := strconv.FormatInt(int64(sc["id"].(float64)), 10)

	calendar := func(query string) (int, []map[string]any) {
		t.Helper()
		r := c.do(http.MethodGet, base+"/schedules/calendar?"+query, nil, false)
		defer r.Body.Close()
		var out struct {
			Occurrences []map[string]any `json:"occurrences"`
		}
		_ = json.NewDecoder(r.Body).Decode(&out)
		return r.StatusCode, out.Occurrences
	}
	code, occ := calendar("from=2026-09-01&to=2026-10-31&today=2026-09-10")
	if code != http.StatusOK || len(occ) != 2 || occ[0]["state"] != "overdue" || occ[0]["next"] != true || occ[1]["state"] != "due" {
		t.Fatalf("calendar = %d %+v", code, occ)
	}

	r := c.do(http.MethodPost, base+"/schedules/"+id+"/post", map[string]any{"amount": -125000, "status": 2}, true)
	r.Body.Close()
	if r.StatusCode != http.StatusNoContent {
		t.Fatalf("post with a new amount = %d", r.StatusCode)
	}
	_, occ = calendar("from=2026-09-01&to=2026-09-30&today=2026-09-10")
	if len(occ) != 1 || occ[0]["state"] != "registered" || occ[0]["amount"] != float64(-125000) || occ[0]["status"] != float64(2) {
		t.Fatalf("after posting = %+v", occ)
	}
	r = c.do(http.MethodPost, base+"/schedules/"+id+"/post", map[string]any{"status": 9}, true)
	r.Body.Close()
	if r.StatusCode != http.StatusBadRequest {
		t.Errorf("post with a bad status = %d, want 400", r.StatusCode)
	}

	if code, _ := calendar("from=2026-09-01&to=2027-09-01"); code != http.StatusBadRequest {
		t.Errorf("a year's range = %d, want 400", code)
	}
	if code, _ := calendar("from=2026-09-01&to=2026-09-30&today=x"); code != http.StatusBadRequest {
		t.Errorf("bad today = %d, want 400", code)
	}
}
