package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func makePayee(t *testing.T, c *testClient, wid int64, name string) int64 {
	t.Helper()
	p := decodeTemplate(t, c.do(http.MethodPost, "/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/payees", map[string]any{"name": name}, true))
	return int64(p["id"].(float64))
}

// makeTemplate makes an expense template with a payee, which a schedule needs (#723).
func makeTemplate(t *testing.T, c *testClient, wid, acc int64) int64 {
	t.Helper()
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	tpl := decodeTemplate(t, c.do(http.MethodPost, base+"/templates", map[string]any{
		"name": "Rent", "accountId": acc, "amount": -120000, "paymentMode": 4, "payeeId": makePayee(t, c, wid, "Landlord"),
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

// A schedule without a payee is refused; one that has a payee gives it to the
// transactions it registered without one; another user's is out of reach (#723).
func TestSchedulePayee(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	bare := decodeTemplate(t, c.do(http.MethodPost, base+"/templates", map[string]any{
		"name": "Gym", "accountId": acc, "amount": -4500,
	}, true))
	r := c.do(http.MethodPost, base+"/schedules", map[string]any{
		"templateId": bare["id"], "unit": "month", "everyN": 1, "nextDue": "2026-09-01",
	}, true)
	var e struct {
		Error struct{ Code string } `json:"error"`
	}
	_ = json.NewDecoder(r.Body).Decode(&e)
	r.Body.Close()
	if r.StatusCode != http.StatusBadRequest || e.Error.Code != "payee_required" {
		t.Fatalf("create without payee = %d %q, want 400 payee_required", r.StatusCode, e.Error.Code)
	}

	tpl := makeTemplate(t, c, wid, acc)
	sc := decodeTxn(t, c.do(http.MethodPost, base+"/schedules", map[string]any{
		"templateId": tpl, "unit": "month", "everyN": 1, "nextDue": "2026-09-01",
	}, true))
	id := strconv.FormatInt(int64(sc["id"].(float64)), 10)
	if sc["payeeName"] != "Landlord" || sc["withoutPayee"] != float64(0) {
		t.Fatalf("created = %+v", sc)
	}
	for _, d := range []string{"2026-07-01", "2026-08-01"} {
		c.do(http.MethodPost, base+"/transactions", map[string]any{
			"accountId": acc, "date": d, "amount": -120000, "templateId": tpl,
		}, true).Body.Close()
	}
	if got := decodeTxn(t, c.do(http.MethodGet, base+"/schedules/"+id, nil, false)); got["withoutPayee"] != float64(2) {
		t.Fatalf("withoutPayee = %v, want 2", got["withoutPayee"])
	}

	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	if r := bob.do(http.MethodPost, base+"/schedules/"+id+"/apply-payee", nil, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob apply = %d, want 404", r.StatusCode)
	}

	applied := decodeTxn(t, c.do(http.MethodPost, base+"/schedules/"+id+"/apply-payee", nil, true))
	if applied["updated"] != float64(2) {
		t.Fatalf("apply = %+v, want updated 2", applied)
	}
	if got := decodeTxn(t, c.do(http.MethodGet, base+"/schedules/"+id, nil, false)); got["withoutPayee"] != float64(0) {
		t.Fatalf("withoutPayee after = %v, want 0", got["withoutPayee"])
	}
}

// The recurring payments found are listed for a member only; ignoring one
// keeps it out (#693).
func TestScheduleProposals(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	bus := makePayee(t, c, wid, "Bus company")
	for _, d := range []string{"2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02"} {
		c.do(http.MethodPost, base+"/transactions", map[string]any{
			"accountId": acc, "date": d, "amount": -3500, "payeeId": bus,
		}, true).Body.Close()
	}
	list := func() []map[string]any {
		t.Helper()
		r := c.do(http.MethodGet, base+"/schedules/proposals?today=2026-10-19", nil, false)
		defer r.Body.Close()
		var out []map[string]any
		_ = json.NewDecoder(r.Body).Decode(&out)
		if r.StatusCode != http.StatusOK {
			t.Fatalf("proposals = %d", r.StatusCode)
		}
		return out
	}
	got := list()
	if len(got) != 1 || got[0]["payeeName"] != "Bus company" || got[0]["cadence"] != "monthly" || got[0]["yearly"] != float64(-42000) {
		t.Fatalf("proposals = %+v", got)
	}

	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	if r := bob.do(http.MethodGet, base+"/schedules/proposals", nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob proposals = %d, want 404", r.StatusCode)
	}
	if r := bob.do(http.MethodPost, base+"/schedules/proposals/ignore", map[string]any{"payeeId": bus, "cadence": "monthly"}, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob ignore = %d, want 404", r.StatusCode)
	}

	if r := c.do(http.MethodPost, base+"/schedules/proposals/ignore", map[string]any{"payeeId": bus, "cadence": "daily"}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad cadence = %d, want 400", r.StatusCode)
	}
	if r := c.do(http.MethodPost, base+"/schedules/proposals/ignore", map[string]any{"payeeId": bus, "cadence": "monthly"}, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("ignore = %d, want 204", r.StatusCode)
	}
	if got := list(); len(got) != 0 {
		t.Fatalf("after ignoring = %+v", got)
	}
}

// The calendar feed (#694): the address is the reader's, its file carries the
// schedules and never a balance, and a regenerated or turned-off address
// answers 404 to anyone.
func TestScheduleCalendarFeed(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": time.Now().Format("2006-01-02"), "amount": 123456,
	}, true).Body.Close()
	next := time.Now().AddDate(0, 1, 0).Format("2006-01-02")
	c.do(http.MethodPost, base+"/schedules", map[string]any{
		"templateId": makeTemplate(t, c, wid, acc), "unit": "month", "everyN": 1, "nextDue": next,
	}, true).Body.Close()

	feed := func(r *http.Response) map[string]any {
		t.Helper()
		defer r.Body.Close()
		var out struct {
			Feed map[string]any `json:"feed"`
		}
		_ = json.NewDecoder(r.Body).Decode(&out)
		return out.Feed
	}
	if f := feed(c.do(http.MethodGet, base+"/schedules/calendar-feed", nil, false)); f != nil {
		t.Fatalf("feed before any = %+v", f)
	}
	f := feed(c.do(http.MethodPost, base+"/schedules/calendar-feed", nil, true))
	path := fmt.Sprintf("/ical/%d/%s.ics", int64(f["id"].(float64)), f["token"])
	if again := feed(c.do(http.MethodGet, base+"/schedules/calendar-feed", nil, false)); again["token"] != f["token"] {
		t.Fatalf("feed shown again = %+v, want %+v", again, f)
	}

	anon := c.fork() // a calendar app: no session
	get := func(p string) (int, string) {
		t.Helper()
		r := anon.do(http.MethodGet, p, nil, false)
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		if r.StatusCode == http.StatusOK && !strings.HasPrefix(r.Header.Get("Content-Type"), "text/calendar") {
			t.Errorf("Content-Type = %q", r.Header.Get("Content-Type"))
		}
		return r.StatusCode, string(b)
	}
	code, body := get(path)
	if code != http.StatusOK || !strings.Contains(body, "BEGIN:VEVENT") || !strings.Contains(body, "DTSTART;VALUE=DATE:"+strings.ReplaceAll(next, "-", "")) {
		t.Fatalf("feed = %d %q", code, body)
	}
	if strings.Contains(body, "234,56") || strings.Contains(body, "234.56") {
		t.Errorf("the feed shows a balance: %q", body)
	}
	if code, _ := get(fmt.Sprintf("/ical/%d/%s.ics", int64(f["id"].(float64)), "guess")); code != http.StatusNotFound {
		t.Errorf("wrong token = %d, want 404", code)
	}

	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	for _, m := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		if r := bob.do(m, base+"/schedules/calendar-feed", nil, true); r.StatusCode != http.StatusNotFound {
			t.Errorf("bob %s = %d, want 404", m, r.StatusCode)
		}
	}
	if r := bob.do(http.MethodGet, base+"/schedules/calendar.ics", nil, false); r.StatusCode != http.StatusNotFound {
		t.Errorf("bob download = %d, want 404", r.StatusCode)
	}
	r := c.do(http.MethodGet, base+"/schedules/calendar.ics", nil, false)
	if r.StatusCode != http.StatusOK || !strings.HasPrefix(r.Header.Get("Content-Disposition"), "attachment") {
		t.Errorf("download = %d %q", r.StatusCode, r.Header.Get("Content-Disposition"))
	}
	r.Body.Close()

	c.do(http.MethodPost, base+"/schedules/calendar-feed", nil, true).Body.Close() // regenerate
	if code, _ := get(path); code != http.StatusNotFound {
		t.Errorf("old address after regenerate = %d, want 404", code)
	}
	if r := c.do(http.MethodDelete, base+"/schedules/calendar-feed", nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("turn off = %d, want 204", r.StatusCode)
	}
	if f := feed(c.do(http.MethodGet, base+"/schedules/calendar-feed", nil, false)); f != nil {
		t.Errorf("feed after turning off = %+v", f)
	}
}

func TestLogPathHidesFeedToken(t *testing.T) {
	if got := logPath("/ical/7/secret-token.ics"); strings.Contains(got, "secret") {
		t.Errorf("logPath = %q, keeps the token", got)
	}
	if got := logPath("/api/v1/ping"); got != "/api/v1/ping" {
		t.Errorf("logPath = %q, want the path unchanged", got)
	}
}
