package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/bills"
)

// billsHandlers serves the wallet-scoped Bills view (mounted inside the
// walletContext middleware).
type billsHandlers struct {
	svc *bills.Service
}

func (h *billsHandlers) walletRoutes(r chi.Router) {
	r.Get("/bills", h.get)
}

func (h *billsHandlers) get(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	// `from` bounds which recently-paid occurrences to show for context; `to` is
	// the horizon for upcoming bills. Defaults: the current month's start through
	// the end of next month.
	from := r.URL.Query().Get("from")
	if from == "" {
		from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	}
	to := r.URL.Query().Get("to")
	if to == "" {
		to = time.Date(now.Year(), now.Month()+2, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1).Format("2006-01-02")
	}
	data, err := h.svc.Bills(r.Context(), wl.ID, from, to, today)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load bills")
		return
	}
	writeJSON(w, http.StatusOK, data)
}
