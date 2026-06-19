package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/integrity"
)

// integrityHandlers serves the wallet anomaly-check endpoints (mounted inside
// the walletContext middleware).
type integrityHandlers struct {
	svc *integrity.Service
}

func (h *integrityHandlers) walletRoutes(r chi.Router) {
	r.Get("/integrity", h.check)
	r.Post("/integrity/fix", h.fix)
}

func (h *integrityHandlers) check(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	issues, err := h.svc.Check(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not run the integrity check")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"issues": issues})
}

func (h *integrityHandlers) fix(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in struct {
		Type string `json:"type"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	fixed, err := h.svc.Fix(r.Context(), wl.ID, in.Type)
	if err != nil {
		writeError(w, http.StatusBadRequest, "not_fixable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"fixed": fixed})
}
