package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// A pretend OpenAI-compatible provider: it answers every question with a
// two-paragraph report and keeps what it was told.
type fakeModel struct {
	mu   sync.Mutex
	told []string
	srv  *httptest.Server
}

func newFakeModel(t *testing.T) *fakeModel {
	m := &fakeModel{}
	m.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		m.mu.Lock()
		m.told = append(m.told, string(b))
		m.mu.Unlock()
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"You kept money.\n\nGroceries went down."}}]}`))
	}))
	t.Cleanup(m.srv.Close)
	return m
}

// codeOf is the code of an error response.
func codeOf(out map[string]any) any {
	e, _ := out["error"].(map[string]any)
	return e["code"]
}

func (m *fakeModel) last() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.told) == 0 {
		return ""
	}
	return m.told[len(m.told)-1]
}

func (m *fakeModel) calls() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.told)
}

// "Generate now" writes last month's report from the server's numbers; the
// report is the asking user's alone; the month's limit asks before going on.
func TestAIReports(t *testing.T) {
	c := newTestAPI(t)
	model := newFakeModel(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	n := time.Now().UTC()
	last := time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0)
	period := last.Format("2006-01")
	for _, tx := range []map[string]any{
		{"accountId": acc, "date": last.AddDate(0, 0, 2).Format("2006-01-02"), "amount": 250000, "memo": "salary"},
		{"accountId": acc, "date": last.AddDate(0, 0, 9).Format("2006-01-02"), "amount": -64050, "memo": "a private note"},
	} {
		c.do(http.MethodPost, base+"/transactions", tx, true).Body.Close()
	}

	generate := func(cl *testClient, body map[string]any) (int, map[string]any) {
		t.Helper()
		r := cl.do(http.MethodPost, base+"/insights/reports", body, true)
		defer r.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(r.Body).Decode(&out)
		return r.StatusCode, out
	}
	// The AI off: no report, nothing sent.
	if code, out := generate(c, map[string]any{"period": period}); code != http.StatusBadRequest || codeOf(out) != "ai_disabled" {
		t.Fatalf("AI off = %d %v", code, out)
	}
	settings := func(extra map[string]any) {
		t.Helper()
		body := map[string]any{
			"enabled": true, "baseUrl": model.srv.URL, "model": "m", "apiKey": "k",
			"features": map[string]bool{"suggest": false, "entry": false, "mail": false, "reports": true},
		}
		for k, v := range extra {
			body[k] = v
		}
		r := c.do(http.MethodPut, "/api/v1/ai/settings", body, true)
		r.Body.Close()
		if r.StatusCode != http.StatusOK {
			t.Fatalf("settings = %d", r.StatusCode)
		}
	}
	settings(nil)

	code, rep := generate(c, map[string]any{"period": period})
	if code != http.StatusCreated || rep["body"] != "You kept money.\n\nGroceries went down." {
		t.Fatalf("generate = %d %v", code, rep)
	}
	figures := rep["basis"].(map[string]any)["figures"].(map[string]any)
	if figures["income"] != float64(250000) || figures["expense"] != float64(64050) || figures["net"] != float64(185950) {
		t.Fatalf("figures = %v", figures)
	}
	told := model.last()
	if strings.Contains(told, "private note") || !strings.Contains(told, "2500.00") || !strings.Contains(told, "in English") {
		t.Fatalf("the model was told %s", told)
	}

	// Bad months: this one, and one over a year ago.
	for _, p := range []string{n.Format("2006-01"), n.AddDate(-2, 0, 0).Format("2006-01"), "soon"} {
		if code, out := generate(c, map[string]any{"period": p}); code != http.StatusBadRequest || codeOf(out) != "bad_period" {
			t.Errorf("period %s = %d %v", p, code, out)
		}
	}

	// Another member of the wallet sees none of it; a stranger gets 404.
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "eve", "password": "evessecret"}, true).Body.Close()
	q := db.New(c.st.Write())
	bobUser, _ := q.GetUserByUsername(t.Context(), "bob")
	if err := q.AddWalletMember(t.Context(), db.AddWalletMemberParams{WalletID: wid, UserID: bobUser.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	bob, eve := c.fork(), c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	eve.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "eve", "password": "evessecret"}, true).Body.Close()
	list := func(cl *testClient) (int, []any) {
		t.Helper()
		r := cl.do(http.MethodGet, base+"/insights/reports", nil, false)
		defer r.Body.Close()
		var out struct {
			Reports []any `json:"reports"`
		}
		_ = json.NewDecoder(r.Body).Decode(&out)
		return r.StatusCode, out.Reports
	}
	if code, reps := list(c); code != http.StatusOK || len(reps) != 1 {
		t.Fatalf("owner's list = %d %d", code, len(reps))
	}
	if code, reps := list(bob); code != http.StatusOK || len(reps) != 0 {
		t.Fatalf("bob's list = %d %v, want none of the owner's", code, reps)
	}
	if code, _ := list(eve); code != http.StatusNotFound {
		t.Fatalf("eve's list = %d, want 404", code)
	}
	id := strconv.FormatInt(int64(rep["id"].(float64)), 10)
	if r := bob.do(http.MethodPut, base+"/insights/reports/"+id+"/feedback", map[string]any{"feedback": 1}, true); r.StatusCode != http.StatusNotFound {
		t.Errorf("bob's thumb on the owner's report = %d, want 404", r.StatusCode)
	}
	if r := c.do(http.MethodPut, base+"/insights/reports/"+id+"/feedback", map[string]any{"feedback": -1}, true); r.StatusCode != http.StatusNoContent {
		t.Errorf("thumb = %d", r.StatusCode)
	}
	if _, reps := list(c); reps[0].(map[string]any)["feedback"] != float64(-1) {
		t.Errorf("feedback not kept: %v", reps[0])
	}

	// At the limit "Generate now" asks first; with a yes it goes.
	settings(map[string]any{"monthlyLimit": 1})
	before := model.calls()
	if code, out := generate(c, map[string]any{"period": period}); code != http.StatusConflict || codeOf(out) != "ai_limit" || model.calls() != before {
		t.Fatalf("over the limit = %d %v", code, out)
	}
	if code, _ := generate(c, map[string]any{"period": period, "confirm": true}); code != http.StatusCreated {
		t.Fatalf("confirmed = %d", code)
	}

	// The log shows both calls; the text is there word for word.
	r := c.do(http.MethodGet, "/api/v1/ai/sends", nil, false)
	var sends struct {
		Sends []map[string]any `json:"sends"`
	}
	_ = json.NewDecoder(r.Body).Decode(&sends)
	r.Body.Close()
	if len(sends.Sends) != 2 || sends.Sends[0]["feature"] != "reports" || sends.Sends[0]["sent"] != nil {
		t.Fatalf("sends = %v", sends.Sends)
	}
	sid := strconv.FormatInt(int64(sends.Sends[0]["id"].(float64)), 10)
	r = c.do(http.MethodGet, "/api/v1/ai/sends/"+sid, nil, false)
	var one map[string]any
	_ = json.NewDecoder(r.Body).Decode(&one)
	r.Body.Close()
	if !strings.Contains(one["sent"].(string), "Write the report in English") {
		t.Fatalf("send = %v", one)
	}
	if r := bob.do(http.MethodGet, "/api/v1/ai/sends/"+sid, nil, false); r.StatusCode != http.StatusNotFound {
		t.Errorf("bob read the owner's log: %d", r.StatusCode)
	}

	// The wallet taken out of the AI's reach: no report.
	settings(map[string]any{"walletsOff": []int64{wid}, "monthlyLimit": 100})
	if code, out := generate(c, map[string]any{"period": period}); code != http.StatusBadRequest || codeOf(out) != "ai_disabled" {
		t.Fatalf("wallet off = %d %v", code, out)
	}
}
