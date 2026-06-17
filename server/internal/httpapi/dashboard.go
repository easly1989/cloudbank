package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/dashboard"
)

// dashboardHandlers serves the wallet-scoped dashboard (mounted inside the
// walletContext middleware).
type dashboardHandlers struct {
	svc *dashboard.Service
}

func (h *dashboardHandlers) walletRoutes(r chi.Router) {
	r.Get("/dashboard", h.get)
}

func (h *dashboardHandlers) get(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		from, to = currentMonth(time.Now().UTC())
	}
	data, err := h.svc.Build(r.Context(), wl.ID, from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build dashboard")
		return
	}
	writeJSON(w, http.StatusOK, data)
}

// currentMonth returns the first and last civil dates of t's month.
func currentMonth(t time.Time) (from, to string) {
	first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1)
	return first.Format("2006-01-02"), last.Format("2006-01-02")
}
