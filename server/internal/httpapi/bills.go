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
	today := time.Now().UTC().Format("2006-01-02")
	data, err := h.svc.Bills(r.Context(), wl.ID, today)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load bills")
		return
	}
	writeJSON(w, http.StatusOK, data)
}
