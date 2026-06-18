package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

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

	// Invalid groupBy → 400.
	if r := c.do(http.MethodGet, base+"/reports/statistics?groupBy=nope", nil, false); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad group = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}
}
