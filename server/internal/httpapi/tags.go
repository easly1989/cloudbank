package httpapi

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/tag"
)

// tagHandlers serve wallet-scoped tag-management endpoints (mounted inside the
// walletContext middleware).
type tagHandlers struct {
	svc *tag.Service
}

func (h *tagHandlers) walletRoutes(r chi.Router) {
	r.Get("/tags", h.list)
	r.Get("/tags/manage", h.listUsage)
	r.Patch("/tags/{tagId}", h.rename)
	r.Post("/tags/{tagId}/merge", h.merge)
	r.Delete("/tags/{tagId}", h.delete)
}

func (h *tagHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	tags, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list tags")
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (h *tagHandlers) listUsage(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	tags, err := h.svc.ListWithCounts(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list tags")
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func tagIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "tagId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "tag not found")
		return 0, false
	}
	return id, true
}

func writeTagError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "could not update tag",
		errCase{tag.ErrNotFound, http.StatusNotFound, "not_found", "tag not found"},
		errCase{tag.ErrDuplicate, http.StatusConflict, "conflict", "a tag with that name already exists"},
		errCase{tag.ErrInvalid, http.StatusBadRequest, "invalid", "invalid tag name or merge target"},
	)
}

func (h *tagHandlers) rename(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := tagIDParam(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !writeTagError(w, h.svc.Rename(r.Context(), wl.ID, id, in.Name)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *tagHandlers) merge(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := tagIDParam(w, r)
	if !ok {
		return
	}
	var in struct {
		TargetID int64 `json:"targetId"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !writeTagError(w, h.svc.Merge(r.Context(), wl.ID, id, in.TargetID)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *tagHandlers) delete(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := tagIDParam(w, r)
	if !ok {
		return
	}
	if !writeTagError(w, h.svc.Delete(r.Context(), wl.ID, id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
