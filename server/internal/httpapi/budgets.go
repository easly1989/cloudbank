package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/budget"
)

// budgetHandlers serves wallet-scoped budget endpoints (mounted inside the
// walletContext middleware).
type budgetHandlers struct {
	svc *budget.Service
}

func (h *budgetHandlers) walletRoutes(r chi.Router) {
	r.Get("/budgets", h.list)
	r.Get("/budgets/report", h.report)
	r.Put("/budgets/{categoryId}", h.set)
	r.Delete("/budgets/{categoryId}", h.clear)
}

func (h *budgetHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	out, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list budgets")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type budgetInput struct {
	Mode    string    `json:"mode"`
	Same    int64     `json:"same"`
	Monthly [12]int64 `json:"monthly"`
}

func (h *budgetHandlers) set(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	categoryID, err := strconv.ParseInt(chi.URLParam(r, "categoryId"), 10, 64)
	if err != nil || categoryID <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "category not found")
		return
	}
	var in budgetInput
	if !decodeJSON(w, r, &in) {
		return
	}
	err = h.svc.SetCategoryBudget(r.Context(), wl.ID, categoryID, budget.Input{Mode: in.Mode, Same: in.Same, Monthly: in.Monthly})
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, budget.ErrInvalidMode):
		writeError(w, http.StatusBadRequest, "invalid_mode", "mode must be 'same' or 'monthly'")
	case errors.Is(err, budget.ErrInvalidCategory):
		writeError(w, http.StatusNotFound, "not_found", "category not found")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not save budget")
	}
}

func (h *budgetHandlers) clear(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	categoryID, err := strconv.ParseInt(chi.URLParam(r, "categoryId"), 10, 64)
	if err != nil || categoryID <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "category not found")
		return
	}
	if err := h.svc.SetCategoryBudget(r.Context(), wl.ID, categoryID, budget.Input{Mode: budget.ModeSame, Same: 0}); err != nil {
		if errors.Is(err, budget.ErrInvalidCategory) {
			writeError(w, http.StatusNotFound, "not_found", "category not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not clear budget")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *budgetHandlers) report(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		now := time.Now().UTC()
		from = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
		to = time.Date(now.Year(), 12, 31, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	}
	rollup := r.URL.Query().Get("rollup") != "false"
	rep, err := h.svc.Report(r.Context(), wl.ID, from, to, rollup)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build budget report")
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
