package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/updates"
)

// updateHandlers expose the new-version check to admins (#582): they are the
// ones who can update the server, so nobody else is told.
type updateHandlers struct {
	svc *updates.Service
}

func (h *updateHandlers) routes(r chi.Router) {
	r.Get("/admin/updates", h.status)
	r.Put("/admin/updates", h.setEnabled)
	r.Post("/admin/updates/check", h.check)
}

func (h *updateHandlers) status(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.Status(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load the update check")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

type updateSettingsRequest struct {
	Enabled bool `json:"enabled"`
}

func (h *updateHandlers) setEnabled(w http.ResponseWriter, r *http.Request) {
	var in updateSettingsRequest
	if !decodeJSON(w, r, &in) {
		return
	}
	st, err := h.svc.SetEnabled(r.Context(), in.Enabled)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not save the update check")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *updateHandlers) check(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.Check(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not check for updates")
		return
	}
	writeJSON(w, http.StatusOK, st)
}
