package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/category"
)

type categoryHandlers struct {
	svc *category.Service
}

type categoryResponse struct {
	ID       int64  `json:"id"`
	ParentID *int64 `json:"parentId,omitempty"`
	Name     string `json:"name"`
	IsIncome bool   `json:"isIncome"`
	NoBudget bool   `json:"noBudget"`
}

func toCategoryResponse(c category.Category) categoryResponse {
	return categoryResponse{ID: c.ID, ParentID: c.ParentID, Name: c.Name, IsIncome: c.IsIncome, NoBudget: c.NoBudget}
}

func (h *categoryHandlers) walletRoutes(r chi.Router) {
	r.Get("/categories", h.list)
	r.Post("/categories", h.create)
	r.Route("/categories/{categoryId}", func(r chi.Router) {
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
		r.Get("/usage", h.usage)
		r.Post("/merge", h.merge)
	})
}

func (h *categoryHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	cats, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list categories")
		return
	}
	out := make([]categoryResponse, 0, len(cats))
	for _, c := range cats {
		out = append(out, toCategoryResponse(c))
	}
	writeJSON(w, http.StatusOK, out)
}

type categoryInput struct {
	Name     string `json:"name"`
	ParentID *int64 `json:"parentId"`
	IsIncome bool   `json:"isIncome"`
	NoBudget bool   `json:"noBudget"`
}

func (h *categoryHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in categoryInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid", "name is required")
		return
	}
	c, err := h.svc.Create(r.Context(), wl.ID, in.Name, in.ParentID, in.IsIncome, in.NoBudget)
	if !writeCategoryError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toCategoryResponse(c))
}

func (h *categoryHandlers) update(w http.ResponseWriter, r *http.Request) {
	c, ok := h.categoryFromPath(w, r)
	if !ok {
		return
	}
	var in categoryInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid", "name is required")
		return
	}
	updated, err := h.svc.Update(r.Context(), c.ID, in.Name, in.IsIncome, in.NoBudget)
	if !writeCategoryError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, toCategoryResponse(updated))
}

func (h *categoryHandlers) delete(w http.ResponseWriter, r *http.Request) {
	c, ok := h.categoryFromPath(w, r)
	if !ok {
		return
	}
	wl, _ := walletFromContext(r.Context())
	reassignTo := optionalIDParam(r, "reassignTo")
	if err := h.svc.Delete(r.Context(), wl.ID, c.ID, reassignTo); !writeCategoryError(w, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *categoryHandlers) usage(w http.ResponseWriter, r *http.Request) {
	c, ok := h.categoryFromPath(w, r)
	if !ok {
		return
	}
	u, err := h.svc.Usage(r.Context(), c.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not compute usage")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (h *categoryHandlers) merge(w http.ResponseWriter, r *http.Request) {
	c, ok := h.categoryFromPath(w, r)
	if !ok {
		return
	}
	wl, _ := walletFromContext(r.Context())
	var in struct {
		TargetID int64 `json:"targetId"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := h.svc.Merge(r.Context(), wl.ID, c.ID, in.TargetID); !writeCategoryError(w, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *categoryHandlers) categoryFromPath(w http.ResponseWriter, r *http.Request) (category.Category, bool) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "categoryId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "category not found")
		return category.Category{}, false
	}
	c, err := h.svc.Get(r.Context(), id)
	if errors.Is(err, category.ErrNotFound) || (err == nil && c.WalletID != wl.ID) {
		writeError(w, http.StatusNotFound, "not_found", "category not found")
		return category.Category{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load category")
		return category.Category{}, false
	}
	return c, true
}

// optionalIDParam reads a positive int64 query parameter, returning nil when
// absent or unparseable.
func optionalIDParam(r *http.Request, name string) *int64 {
	v := r.URL.Query().Get(name)
	if v == "" {
		return nil
	}
	id, err := strconv.ParseInt(v, 10, 64)
	if err != nil || id <= 0 {
		return nil
	}
	return &id
}

// writeCategoryError maps service errors to responses; returns true when no error.
func writeCategoryError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, category.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "category not found")
	case errors.Is(err, category.ErrDuplicate):
		writeError(w, http.StatusConflict, "duplicate", "a category with that name already exists here")
	case errors.Is(err, category.ErrTooDeep):
		writeError(w, http.StatusBadRequest, "too_deep", "subcategories cannot have children")
	case errors.Is(err, category.ErrHasChildren):
		writeError(w, http.StatusConflict, "has_children", "this category has subcategories; choose a reassignment target")
	case errors.Is(err, category.ErrSelfReference):
		writeError(w, http.StatusBadRequest, "self", "cannot merge a category into itself")
	case errors.Is(err, category.ErrBadTarget):
		writeError(w, http.StatusBadRequest, "bad_target", "invalid target category")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not save category")
	}
	return false
}
