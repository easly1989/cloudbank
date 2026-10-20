package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// A budget proposal (#698) through its life: it comes when the switch is
// turned on, Later hides it, it comes back, Ignore puts it away until the
// numbers change, and Applied closes a row and then the whole of it. It is
// its asker's alone, and a stranger to the wallet gets 404.
func TestAIBudgetProposals(t *testing.T) {
	c := newTestAPI(t)
	model := newFakeModel(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	rent := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Rent"}, true))
	bills := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Utilities"}, true))
	gym := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Gym"}, true))
	c.do(http.MethodPut, base+"/budgets/"+strconv.FormatInt(bills.ID, 10), map[string]any{"year": 0, "mode": "same", "same": -9000}, true).Body.Close()
	n := time.Now().UTC()
	if n.Day() == 1 && n.Hour() < 7 {
		// Proposals come from 07:00 on the 1st: read where it is later already.
		c.do(http.MethodPut, "/api/v1/notifications/settings", map[string]any{"timezone": "Pacific/Kiritimati"}, true).Body.Close()
	}
	month := time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, time.UTC)
	spend := func(cat int64, amount int64) {
		for i := 1; i <= 6; i++ {
			c.do(http.MethodPost, base+"/transactions", map[string]any{
				"accountId": acc, "date": month.AddDate(0, -i, 3).Format("2006-01-02"), "amount": amount, "categoryId": cat,
			}, true).Body.Close()
		}
	}
	spend(rent.ID, -75000)
	spend(bills.ID, -5980)

	type row struct {
		CategoryID int64  `json:"categoryId"`
		Reason     string `json:"reason"`
		Budget     int64  `json:"budget"`
		Proposed   int64  `json:"proposed"`
	}
	type proposal struct {
		ID    int64  `json:"id"`
		Body  string `json:"body"`
		Basis struct {
			Rows []row `json:"rows"`
		} `json:"basis"`
	}
	list := func(cl *testClient) (int, []proposal) {
		t.Helper()
		r := cl.do(http.MethodGet, base+"/insights/proposals", nil, false)
		defer r.Body.Close()
		var out struct {
			Proposals []proposal `json:"proposals"`
		}
		_ = json.NewDecoder(r.Body).Decode(&out)
		return r.StatusCode, out.Proposals
	}
	waitFor := func(want int) []proposal {
		t.Helper()
		for range 100 {
			if _, ps := list(c); len(ps) == want {
				return ps
			}
			time.Sleep(50 * time.Millisecond)
		}
		_, ps := list(c)
		t.Fatalf("proposals = %+v, want %d", ps, want)
		return nil
	}
	budgetsOn := func(on bool) {
		t.Helper()
		r := c.do(http.MethodPut, "/api/v1/ai/settings", map[string]any{
			"enabled": true, "baseUrl": model.srv.URL, "model": "m", "apiKey": "k",
			"features": map[string]bool{"budgets": on},
		}, true)
		r.Body.Close()
		if r.StatusCode != http.StatusOK {
			t.Fatalf("settings = %d", r.StatusCode)
		}
	}
	act := func(cl *testClient, id int64, body map[string]any) int {
		t.Helper()
		r := cl.do(http.MethodPost, base+"/insights/proposals/"+strconv.FormatInt(id, 10)+"/actions", body, true)
		r.Body.Close()
		return r.StatusCode
	}
	q := db.New(c.st.Write())

	// Open: turned on, it comes at once; the rent has no budget, the utilities'
	// budget is never reached. The amounts are CloudBank's.
	budgetsOn(true)
	ps := waitFor(1)
	rows := ps[0].Basis.Rows
	if len(rows) != 2 || rows[0] != (row{rent.ID, "none", 0, 75000}) || rows[1] != (row{bills.ID, "under", 9000, 6000}) {
		t.Fatalf("rows = %+v", rows)
	}
	if ps[0].Body == "" || model.calls() != 1 {
		t.Fatalf("body %q, %d calls", ps[0].Body, model.calls())
	}
	id := ps[0].ID

	// Another member sees none of it, nor can touch it; a stranger gets 404.
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "eve", "password": "evessecret"}, true).Body.Close()
	bobUser, _ := q.GetUserByUsername(t.Context(), "bob")
	if err := q.AddWalletMember(t.Context(), db.AddWalletMemberParams{WalletID: wid, UserID: bobUser.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	bob, eve := c.fork(), c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	eve.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "eve", "password": "evessecret"}, true).Body.Close()
	if code, got := list(bob); code != http.StatusOK || len(got) != 0 {
		t.Fatalf("bob's list = %d %+v", code, got)
	}
	if code := act(bob, id, map[string]any{"action": "ignore"}); code != http.StatusNotFound {
		t.Fatalf("bob's ignore = %d, want 404", code)
	}
	if code, _ := list(eve); code != http.StatusNotFound {
		t.Fatalf("eve's list = %d, want 404", code)
	}
	if code := act(c, id, map[string]any{"action": "applied", "categoryId": gym.ID}); code != http.StatusBadRequest {
		t.Fatalf("a category not in it = %d, want 400", code)
	}

	// Later: gone for a week, then back.
	if code := act(c, id, map[string]any{"action": "later"}); code != http.StatusNoContent {
		t.Fatalf("later = %d", code)
	}
	waitFor(0)
	if _, err := c.st.Write().Exec(`UPDATE ai_proposals SET later_until = '2000-01-01T00:00:00Z' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	waitFor(1)

	// Ignored: put away. Seen again next month, it does not come back while
	// the numbers are the same; a new category brings it back.
	if code := act(c, id, map[string]any{"action": "ignore"}); code != http.StatusNoContent {
		t.Fatalf("ignore = %d", code)
	}
	waitFor(0)
	nextMonth := func() {
		t.Helper()
		// As if the ignored one was last month's, and the month starts again.
		if _, err := c.st.Write().Exec(`UPDATE ai_proposals SET period = '2000-01'`); err != nil {
			t.Fatal(err)
		}
		if _, err := c.st.Write().Exec(`DELETE FROM ai_report_runs`); err != nil {
			t.Fatal(err)
		}
		budgetsOn(false)
		budgetsOn(true)
	}
	nextMonth()
	time.Sleep(300 * time.Millisecond)
	if _, got := list(c); len(got) != 0 || model.calls() != 1 {
		t.Fatalf("unchanged numbers came back: %+v, %d calls", got, model.calls())
	}
	spend(gym.ID, -4000)
	nextMonth()
	ps = waitFor(1)
	if len(ps[0].Basis.Rows) != 3 || ps[0].ID == id {
		t.Fatalf("back with a new category = %+v", ps)
	}
	id = ps[0].ID

	// Applied: each row saved from the budget form goes; with the last, the
	// proposal is done.
	for i, r := range ps[0].Basis.Rows {
		if code := act(c, id, map[string]any{"action": "applied", "categoryId": r.CategoryID}); code != http.StatusNoContent {
			t.Fatalf("applied %d = %d", r.CategoryID, code)
		}
		if i < 2 {
			if got := waitFor(1); len(got[0].Basis.Rows) != 2-i {
				t.Fatalf("after %d applied = %+v", i+1, got[0].Basis.Rows)
			}
		}
	}
	waitFor(0)

	// The thumb is the owner's; another member's is a 404.
	path := base + "/insights/proposals/" + strconv.FormatInt(id, 10) + "/feedback"
	if r := bob.do(http.MethodPut, path, map[string]any{"feedback": 1}, true); r.StatusCode != http.StatusNotFound {
		t.Errorf("bob's thumb = %d, want 404", r.StatusCode)
	}
	if r := c.do(http.MethodPut, path, map[string]any{"feedback": 1}, true); r.StatusCode != http.StatusNoContent {
		t.Errorf("thumb = %d", r.StatusCode)
	}
}

// A subscription proposal (#699) through the API: it comes when its switch is
// turned on, its row is the schedule, and Applied by the schedule closes it.
func TestAISubscriptionProposals(t *testing.T) {
	c := newTestAPI(t)
	model := newFakeModel(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	gym := makePayee(t, c, wid, "Gym")
	tpl := decodeTemplate(t, c.do(http.MethodPost, base+"/templates", map[string]any{
		"name": "Gym membership", "accountId": acc, "amount": -3900, "payeeId": gym,
	}, true))
	sc := decodeTxn(t, c.do(http.MethodPost, base+"/schedules", map[string]any{
		"templateId": tpl["id"], "unit": "month", "everyN": 1, "nextDue": time.Now().UTC().Format("2006-01-02"), "autoPost": false,
	}, true))
	scheduleID := int64(sc["id"].(float64))
	if n := time.Now().UTC(); n.Day() == 1 && n.Hour() < 7 {
		c.do(http.MethodPut, "/api/v1/notifications/settings", map[string]any{"timezone": "Pacific/Kiritimati"}, true).Body.Close()
	}
	// Paid five and four months ago, not since.
	for _, m := range []int{-5, -4} {
		c.do(http.MethodPost, base+"/transactions", map[string]any{
			"accountId": acc, "date": time.Now().UTC().AddDate(0, m, 0).Format("2006-01-02"), "amount": -3900, "payeeId": gym,
		}, true).Body.Close()
	}

	type proposal struct {
		ID    int64  `json:"id"`
		Kind  string `json:"kind"`
		Basis struct {
			Rows []struct {
				ScheduleID int64  `json:"scheduleId"`
				Reason     string `json:"reason"`
				Amount     int64  `json:"amount"`
				Yearly     int64  `json:"yearly"`
			} `json:"rows"`
		} `json:"basis"`
	}
	waitFor := func(want int) []proposal {
		t.Helper()
		var out struct {
			Proposals []proposal `json:"proposals"`
		}
		for range 100 {
			r := c.do(http.MethodGet, base+"/insights/proposals", nil, false)
			_ = json.NewDecoder(r.Body).Decode(&out)
			r.Body.Close()
			if len(out.Proposals) == want {
				return out.Proposals
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatalf("proposals = %+v, want %d", out.Proposals, want)
		return nil
	}
	r := c.do(http.MethodPut, "/api/v1/ai/settings", map[string]any{
		"enabled": true, "baseUrl": model.srv.URL, "model": "m", "apiKey": "k",
		"features": map[string]bool{"subscriptions": true},
	}, true)
	var st struct {
		Features map[string]bool `json:"features"`
	}
	_ = json.NewDecoder(r.Body).Decode(&st)
	r.Body.Close()
	if !st.Features["subscriptions"] || st.Features["budgets"] {
		t.Fatalf("features = %+v", st.Features)
	}
	ps := waitFor(1)
	rows := ps[0].Basis.Rows
	if ps[0].Kind != "subscriptions" || len(rows) != 1 || rows[0].ScheduleID != scheduleID ||
		rows[0].Reason != "unused" || rows[0].Amount != 3900 || rows[0].Yearly != 46800 {
		t.Fatalf("proposal = %+v", ps[0])
	}
	act := func(body map[string]any) int {
		r := c.do(http.MethodPost, base+"/insights/proposals/"+strconv.FormatInt(ps[0].ID, 10)+"/actions", body, true)
		r.Body.Close()
		return r.StatusCode
	}
	if code := act(map[string]any{"action": "applied", "scheduleId": scheduleID + 1}); code != http.StatusBadRequest {
		t.Fatalf("a schedule not in it = %d, want 400", code)
	}
	if code := act(map[string]any{"action": "applied", "scheduleId": scheduleID}); code != http.StatusNoContent {
		t.Fatalf("applied = %d", code)
	}
	waitFor(0)
}
