package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// makeAccountWithBalance sets up admin + wallet (EUR) + an account with an
// initial balance.
func makeAccountWithBalance(t *testing.T, c *testClient, initial int64) (int64, int64) {
	t.Helper()
	wid := createWalletWithBase(t, c, "EUR")
	acc := decodeAccount(t, c.do(http.MethodPost,
		"/api/v1/wallets/"+strconv.FormatInt(wid, 10)+"/accounts",
		map[string]any{"name": "Main", "type": "checking", "initialBalance": initial}, true))
	return wid, acc.ID
}

func TestReportStatisticsAndDrilldown(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	food := decodeCategory(t, c.do(http.MethodPost, base+"/categories", map[string]any{"name": "Food"}, true))

	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-01-10", "amount": -1000, "categoryId": food.ID}, true).Body.Close()
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-02-10", "amount": -2000, "categoryId": food.ID}, true).Body.Close()

	// JSON statistics by category.
	resp := c.do(http.MethodGet, base+"/reports/statistics?groupBy=category", nil, false)
	defer resp.Body.Close()
	var res struct {
		Groups []struct {
			Key    string
			Label  string
			Amount int64
		}
		Total int64
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(res.Groups) != 1 || res.Groups[0].Amount != -3000 || res.Total != -3000 {
		t.Fatalf("stats = %+v", res)
	}

	// CSV export.
	csvResp := c.do(http.MethodGet, base+"/reports/statistics?groupBy=category&format=csv", nil, false)
	defer csvResp.Body.Close()
	if ct := csvResp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("csv content-type = %q", ct)
	}
	buf := make([]byte, 4096)
	n, _ := csvResp.Body.Read(buf)
	if !strings.Contains(string(buf[:n]), "Food,-30.00") {
		t.Fatalf("csv body = %q", string(buf[:n]))
	}

	// Drill-down into the category.
	dd := c.do(http.MethodGet, base+"/reports/statistics/drilldown?groupBy=category&groupKey="+strconv.FormatInt(food.ID, 10), nil, false)
	defer dd.Body.Close()
	var rows []map[string]any
	_ = json.NewDecoder(dd.Body).Decode(&rows)
	if len(rows) != 2 {
		t.Fatalf("drilldown rows = %d, want 2", len(rows))
	}

	// The register's other filters are read too (#487). The drill-down lists the
	// newest first: February's row is cleared, so "no status" leaves January's.
	c.do(http.MethodPatch, base+"/transactions/"+strconv.FormatInt(int64(rows[0]["id"].(float64)), 10)+"/status",
		map[string]any{"status": 1}, true).Body.Close()
	for _, tc := range []struct {
		query string
		want  int64
	}{
		{"noFlags=1", -1000},
		{"noFlags=true&transfers=none", -1000},
		{"uncategorised=1", 0},
		{"transfers=only", 0},
	} {
		r := c.do(http.MethodGet, base+"/reports/statistics?groupBy=month&"+tc.query, nil, false)
		var got struct{ Total int64 }
		_ = json.NewDecoder(r.Body).Decode(&got)
		r.Body.Close()
		if got.Total != tc.want {
			t.Errorf("%s: total %d, want %d", tc.query, got.Total, tc.want)
		}
	}

	// Invalid groupBy → 400.
	if r := c.do(http.MethodGet, base+"/reports/statistics?groupBy=nope", nil, false); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad group = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}
}

func TestReportTrendAndBalance(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccountWithBalance(t, c, 100000)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)

	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-01-10", "amount": -3000}, true).Body.Close()
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-02-10", "amount": 5000}, true).Body.Close()

	// Trend by month.
	tr := c.do(http.MethodGet, base+"/reports/trend?bucket=month&from=2026-01-01&to=2026-02-28", nil, false)
	defer tr.Body.Close()
	var trend struct {
		Buckets []string
		Series  []struct{ Values []int64 }
	}
	_ = json.NewDecoder(tr.Body).Decode(&trend)
	if len(trend.Buckets) != 2 || len(trend.Series) != 1 || trend.Series[0].Values[0] != -3000 {
		t.Fatalf("trend = %+v", trend)
	}

	// Balance over time.
	br := c.do(http.MethodGet, base+"/reports/balance?bucket=month&from=2026-01-01&to=2026-02-28&accountIds="+strconv.FormatInt(acc, 10), nil, false)
	defer br.Body.Close()
	var bal struct {
		Series []struct {
			Values         []int64
			MinimumBalance int64 `json:"minimumBalance"`
		}
	}
	_ = json.NewDecoder(br.Body).Decode(&bal)
	if len(bal.Series) != 1 || bal.Series[0].Values[0] != 97000 || bal.Series[0].Values[1] != 102000 {
		t.Fatalf("balance = %+v", bal)
	}

	// Bad bucket → 400.
	if r := c.do(http.MethodGet, base+"/reports/trend?bucket=decade", nil, false); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad bucket = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}
}

// The redesigned report tabs (#490–#492) read spending or income apart, money in
// and out apart, and the balances as of the caller's today.
func TestReportTypeFlowAndAsOf(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccountWithBalance(t, c, 100000)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-01-10", "amount": -3000}, true).Body.Close()
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-01-12", "amount": 5000}, true).Body.Close()
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-02-10", "amount": -1000}, true).Body.Close()

	for query, want := range map[string]int64{"type=expense": -4000, "type=income": 5000, "": 1000} {
		r := c.do(http.MethodGet, base+"/reports/statistics?groupBy=month&"+query, nil, false)
		var got struct{ Total int64 }
		_ = json.NewDecoder(r.Body).Decode(&got)
		r.Body.Close()
		if got.Total != want {
			t.Errorf("%q: total %d, want %d", query, got.Total, want)
		}
	}

	tr := c.do(http.MethodGet, base+"/reports/trend?bucket=month&breakdown=flow&from=2026-01-01&to=2026-02-28", nil, false)
	var trend struct {
		Series []struct {
			Key    string
			Values []int64
		}
	}
	_ = json.NewDecoder(tr.Body).Decode(&trend)
	tr.Body.Close()
	if len(trend.Series) != 2 || trend.Series[0].Key != "in" || trend.Series[0].Values[0] != 5000 || trend.Series[1].Values[0] != -3000 {
		t.Fatalf("flow = %+v", trend)
	}

	br := c.do(http.MethodGet, base+"/reports/balance?bucket=month&from=2026-01-01&to=2026-02-28&asOf=2026-01-31", nil, false)
	var bal struct {
		AsOf       string
		TodayTotal int64
		Total      []int64
	}
	_ = json.NewDecoder(br.Body).Decode(&bal)
	br.Body.Close()
	if bal.AsOf != "2026-01-31" || bal.TodayTotal != 102000 || len(bal.Total) != 2 || bal.Total[1] != 101000 {
		t.Fatalf("balance = %+v", bal)
	}
	if r := c.do(http.MethodGet, base+"/reports/balance?bucket=month&asOf=yesterday", nil, false); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad asOf = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}
}

func TestReportVehicle(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	var veh struct {
		ID int64 `json:"id"`
	}
	vr := c.do(http.MethodPost, base+"/vehicles", map[string]any{"name": "Car"}, true)
	if err := json.NewDecoder(vr.Body).Decode(&veh); err != nil {
		t.Fatalf("decode vehicle: %v", err)
	}
	vr.Body.Close()

	for _, e := range []struct {
		date, memo string
		amount     int
	}{
		{"2026-01-01", "d=10000 v=40", -6000},
		{"2026-01-10", "d=10500 v=35", -5250},
		{"2026-01-25", "d=11000 v=50", -7500},
	} {
		c.do(http.MethodPost, base+"/transactions", map[string]any{
			"accountId": acc, "date": e.date, "amount": e.amount, "vehicleId": veh.ID, "memo": e.memo,
		}, true).Body.Close()
	}

	resp := c.do(http.MethodGet, base+"/reports/vehicle?vehicleId="+strconv.FormatInt(veh.ID, 10), nil, false)
	defer resp.Body.Close()
	var rep struct {
		Entries        []struct{ Consumption float64 }
		TotalDistance  float64 `json:"totalDistance"`
		AvgConsumption float64 `json:"avgConsumption"`
		TotalCost      int64   `json:"totalCost"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rep); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// (35+50)/(500+500)*100 = 8.5.
	if rep.TotalDistance != 1000 || rep.AvgConsumption != 8.5 || rep.TotalCost != 18750 {
		t.Fatalf("vehicle report = %+v", rep)
	}

	// Missing vehicleId → 400.
	if r := c.do(http.MethodGet, base+"/reports/vehicle", nil, false); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing vehicleId = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}
}
