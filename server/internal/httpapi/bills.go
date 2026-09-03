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
	// `from` bounds which recently-paid occurrences are shown for context;
	// upcoming bills always show their real next-due date. Default: the start of
	// the current month.
	from := r.URL.Query().Get("from")
	if from == "" {
		from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	}
	data, err := h.svc.Bills(r.Context(), wl.ID, from, today)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load bills")
		return
	}
	writeJSON(w, http.StatusOK, data)
}
