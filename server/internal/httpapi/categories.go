package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/category"
	"github.com/easly1989/cloudbank/server/internal/report"
)

type categoryHandlers struct {
	svc *category.Service
	// rep, when set, serves the categories' activity (#552).
	rep *report.Service
}

type categoryResponse struct {
	ID       int64  `json:"id"`
	ParentID *int64 `json:"parentId,omitempty"`
	Name     string `json:"name"`
	IsIncome bool   `json:"isIncome"`
	NoBudget bool   `json:"noBudget"`
	NoReport bool   `json:"noReport"`
}

func toCategoryResponse(c category.Category) categoryResponse {
	return categoryResponse{ID: c.ID, ParentID: c.ParentID, Name: c.Name, IsIncome: c.IsIncome, NoBudget: c.NoBudget, NoReport: c.NoReport}
}

func (h *categoryHandlers) walletRoutes(r chi.Router) {
	r.Get("/categories", h.list)
	r.Post("/categories", h.create)
	if h.rep != nil {
		r.Get("/categories/activity", h.activity)
	}
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
	NoReport bool   `json:"noReport"`
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
	c, err := h.svc.Create(r.Context(), wl.ID, in.Name, in.ParentID, in.IsIncome, in.NoBudget, in.NoReport)
	if !writeCategoryError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toCategoryResponse(c))
}

// optionalParent tells a parentId left out (the category stays where it is)
// from one sent as null (it becomes top-level) or as an id (it moves there).
type optionalParent struct {
	set bool
	id  *int64
}

func (o *optionalParent) UnmarshalJSON(b []byte) error {
	o.set = true
	if string(b) == "null" {
		return nil
	}
	var id int64
	if err := json.Unmarshal(b, &id); err != nil {
		return err
	}
	o.id = &id
	return nil
}

type categoryUpdateInput struct {
	Name     string         `json:"name"`
	ParentID optionalParent `json:"parentId"`
	IsIncome bool           `json:"isIncome"`
	NoBudget bool           `json:"noBudget"`
	NoReport bool           `json:"noReport"`
}

func (h *categoryHandlers) update(w http.ResponseWriter, r *http.Request) {
	c, ok := h.categoryFromPath(w, r)
	if !ok {
		return
	}
	var in categoryUpdateInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid", "name is required")
		return
	}
	var move *category.Move
	if in.ParentID.set {
		move = &category.Move{ParentID: in.ParentID.id}
	}
	updated, err := h.svc.Update(r.Context(), c.ID, in.Name, in.IsIncome, in.NoBudget, in.NoReport, move)
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

// activity is what each category held between from and to: its lines, their
// sum in the base currency and the date of its latest line (#552).
func (h *categoryHandlers) activity(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if !isCivilDate(from) || !isCivilDate(to) || from > to {
		writeError(w, http.StatusBadRequest, "invalid_range", "from and to must be dates (YYYY-MM-DD), from no later than to")
		return
	}
	out, err := h.rep.CategoryActivity(r.Context(), wl.ID, from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not compute category activity")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// isCivilDate reports whether s is a date written YYYY-MM-DD.
func isCivilDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil && len(s) == 10
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
	var dup *category.DuplicateError
	if errors.As(err, &dup) {
		writeError(w, http.StatusConflict, "duplicate", fmt.Sprintf("a category named “%s” already exists here", dup.Existing))
		return false
	}
	return mapError(w, err, "could not save category",
		errCase{category.ErrNotFound, http.StatusNotFound, "not_found", "category not found"},
		errCase{category.ErrDuplicate, http.StatusConflict, "duplicate", "a category with that name already exists here"},
		errCase{category.ErrTooDeep, http.StatusBadRequest, "too_deep", "subcategories cannot have children"},
		errCase{category.ErrHasChildren, http.StatusConflict, "has_children", "this category has subcategories; choose a reassignment target"},
		errCase{category.ErrSelfReference, http.StatusBadRequest, "self", "cannot merge a category into itself"},
		errCase{category.ErrBadTarget, http.StatusBadRequest, "bad_target", "invalid target category"},
	)
}
