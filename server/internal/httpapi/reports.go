package httpapi

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/report"
)

// reportHandlers serves wallet-scoped report endpoints (mounted inside the
// walletContext middleware).
type reportHandlers struct {
	svc *report.Service
}

func (h *reportHandlers) walletRoutes(r chi.Router) {
	r.Get("/reports/statistics", h.statistics)
	r.Get("/reports/statistics/drilldown", h.drilldown)
	r.Get("/reports/trend", h.trend)
	r.Get("/reports/balance", h.balance)
	r.Get("/reports/vehicle", h.vehicle)
}

func (h *reportHandlers) vehicle(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	q := r.URL.Query()
	vehicleID, err := strconv.ParseInt(q.Get("vehicleId"), 10, 64)
	if err != nil || vehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid", "vehicleId is required")
		return
	}
	from, to := q.Get("from"), q.Get("to")
	if from == "" {
		from = "0000-01-01"
	}
	if to == "" {
		to = "9999-12-31"
	}
	res, err := h.svc.Vehicle(r.Context(), wl.ID, vehicleID, from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build vehicle report")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *reportHandlers) trend(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	q := r.URL.Query()
	bucket := q.Get("bucket")
	if !report.ValidBucket(bucket) {
		writeError(w, http.StatusBadRequest, "invalid_bucket", "invalid bucket")
		return
	}
	breakdown := q.Get("breakdown")
	if breakdown == "" {
		breakdown = report.BreakdownNone
	}
	if !report.ValidBreakdown(breakdown) {
		writeError(w, http.StatusBadRequest, "invalid_breakdown", "invalid breakdown")
		return
	}
	res, err := h.svc.Trend(r.Context(), wl.ID, parseReportFilter(r), bucket, breakdown)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build trend")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *reportHandlers) balance(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	q := r.URL.Query()
	bucket := q.Get("bucket")
	if !report.ValidBucket(bucket) {
		writeError(w, http.StatusBadRequest, "invalid_bucket", "invalid bucket")
		return
	}
	var accountIDs []int64
	if v := q.Get("accountIds"); v != "" {
		for _, p := range strings.Split(v, ",") {
			if n, err := strconv.ParseInt(p, 10, 64); err == nil {
				accountIDs = append(accountIDs, n)
			}
		}
	}
	res, err := h.svc.Balance(r.Context(), wl.ID, q.Get("from"), q.Get("to"), bucket, accountIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build balance report")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func parseReportFilter(r *http.Request) report.Filter {
	q := r.URL.Query()
	f := report.Filter{From: q.Get("from"), To: q.Get("to"), Text: q.Get("text")}
	if v := q.Get("status"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Status = &n
		}
	}
	if v := q.Get("payeeId"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.PayeeID = &n
		}
	}
	if v := q.Get("categoryId"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.CategoryID = &n
		}
	}
	if v := q.Get("amountMin"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.AmountMin = &n
		}
	}
	if v := q.Get("amountMax"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.AmountMax = &n
		}
	}
	if v := q.Get("tags"); v != "" {
		f.Tags = strings.Split(v, ",")
	}
	return f
}

func (h *reportHandlers) statistics(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	groupBy := r.URL.Query().Get("groupBy")
	if !report.ValidGroupBy(groupBy) {
		writeError(w, http.StatusBadRequest, "invalid_group", "invalid groupBy")
		return
	}
	res, err := h.svc.Statistics(r.Context(), wl.ID, parseReportFilter(r), groupBy)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build report")
		return
	}
	if r.URL.Query().Get("format") == "csv" {
		writeStatisticsCSV(w, groupBy, res)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func writeStatisticsCSV(w http.ResponseWriter, groupBy string, res report.Result) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"statistics-"+groupBy+".csv\"")
	cw := csv.NewWriter(w)
	frac := 2
	if res.Currency != nil {
		frac = res.Currency.FracDigits
	}
	_ = cw.Write([]string{"key", "label", "amount"})
	for _, g := range res.Groups {
		_ = cw.Write([]string{g.Key, g.Label, minorToDecimal(g.Amount, frac)})
	}
	_ = cw.Write([]string{"", "Total", minorToDecimal(res.Total, frac)})
	cw.Flush()
}

// minorToDecimal renders signed minor units as a plain decimal string (dot
// separator, no grouping) for CSV.
func minorToDecimal(amount int64, frac int) string {
	neg := amount < 0
	if neg {
		amount = -amount
	}
	s := strconv.FormatInt(amount, 10)
	if frac <= 0 {
		if neg {
			return "-" + s
		}
		return s
	}
	for len(s) <= frac {
		s = "0" + s
	}
	out := s[:len(s)-frac] + "." + s[len(s)-frac:]
	if neg {
		return "-" + out
	}
	return out
}

func (h *reportHandlers) drilldown(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	groupBy := r.URL.Query().Get("groupBy")
	if !report.ValidGroupBy(groupBy) {
		writeError(w, http.StatusBadRequest, "invalid_group", "invalid groupBy")
		return
	}
	key := r.URL.Query().Get("groupKey")
	rows, err := h.svc.Drilldown(r.Context(), wl.ID, parseReportFilter(r), groupBy, key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load transactions")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}
