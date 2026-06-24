package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/dashboard"
	"github.com/easly1989/cloudbank/server/internal/schedule"
)

// dashboardHandlers serves the wallet-scoped dashboard (mounted inside the
// walletContext middleware).
type dashboardHandlers struct {
	svc *dashboard.Service
	// schedules, if set, fills the dashboard's upcoming list with the next
	// scheduled occurrences.
	schedules *schedule.Service
}

func (h *dashboardHandlers) walletRoutes(r chi.Router) {
	r.Get("/dashboard", h.get)
}

func (h *dashboardHandlers) get(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	now := time.Now().UTC()
	if from == "" || to == "" {
		from, to = currentMonth(now)
	}
	groupBy := r.URL.Query().Get("groupBy")
	if groupBy == "" {
		groupBy = dashboard.GroupByCategory
	}
	if groupBy != dashboard.GroupByCategory && groupBy != dashboard.GroupByPayee {
		writeError(w, http.StatusBadRequest, "invalid_group_by", "groupBy must be category or payee")
		return
	}
	// Income/expense trailing window in months (0 = all dates); default 12.
	ieMonths := 12
	if v := r.URL.Query().Get("ieMonths"); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil && n >= 0 {
			ieMonths = n
		}
	}
	data, err := h.svc.Build(r.Context(), wl.ID, from, to, groupBy, ieMonths)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build dashboard")
		return
	}
	if h.schedules != nil {
		within := now.AddDate(0, 0, 30).Format("2006-01-02")
		upcoming, err := h.schedules.Upcoming(r.Context(), wl.ID, within)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not load upcoming")
			return
		}
		data.Upcoming = make([]any, len(upcoming))
		for i := range upcoming {
			data.Upcoming[i] = upcoming[i]
		}
	}
	writeJSON(w, http.StatusOK, data)
}

// currentMonth returns the first and last civil dates of t's month.
func currentMonth(t time.Time) (from, to string) {
	first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1)
	return first.Format("2006-01-02"), last.Format("2006-01-02")
}
