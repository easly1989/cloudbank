package httpapi

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/goal"
)

// goalHandlers serve wallet-scoped savings-goal endpoints (mounted inside the
// walletContext middleware).
type goalHandlers struct {
	svc *goal.Service
}

func (h *goalHandlers) walletRoutes(r chi.Router) {
	r.Get("/goals", h.list)
	r.Post("/goals", h.create)
	r.Patch("/goals/{goalId}", h.update)
	r.Delete("/goals/{goalId}", h.delete)
	r.Get("/goals/{goalId}/contributions", h.listContributions)
	r.Post("/goals/{goalId}/contributions", h.addContribution)
	r.Delete("/goals/{goalId}/contributions/{contribId}", h.deleteContribution)
}

type goalInput struct {
	Name         string  `json:"name"`
	TargetAmount int64   `json:"targetAmount"`
	TargetDate   *string `json:"targetDate"`
	AccountID    *int64  `json:"accountId"`
	Note         string  `json:"note"`
}

type contributionInput struct {
	Date   string `json:"date"`
	Amount int64  `json:"amount"`
	Note   string `json:"note"`
}

func writeGoalError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "could not save goal",
		errCase{goal.ErrNotFound, http.StatusNotFound, "not_found", "goal not found"},
		errCase{goal.ErrInvalid, http.StatusBadRequest, "invalid", "goal name and a positive target are required"},
		errCase{goal.ErrBadContribution, http.StatusBadRequest, "invalid", "a contribution needs a date and a non-zero amount"},
	)
}

func idParam(w http.ResponseWriter, r *http.Request, key, notFoundMsg string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, key), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", notFoundMsg)
		return 0, false
	}
	return id, true
}

func (h *goalHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	out, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list goals")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *goalHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in goalInput
	if !decodeJSON(w, r, &in) {
		return
	}
	g, err := h.svc.Create(r.Context(), wl.ID, goal.Input{
		Name: in.Name, TargetAmount: in.TargetAmount, TargetDate: in.TargetDate,
		AccountID: in.AccountID, Note: in.Note,
	})
	if !writeGoalError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (h *goalHandlers) update(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := idParam(w, r, "goalId", "goal not found")
	if !ok {
		return
	}
	var in goalInput
	if !decodeJSON(w, r, &in) {
		return
	}
	g, err := h.svc.Update(r.Context(), wl.ID, id, goal.Input{
		Name: in.Name, TargetAmount: in.TargetAmount, TargetDate: in.TargetDate,
		AccountID: in.AccountID, Note: in.Note,
	})
	if !writeGoalError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (h *goalHandlers) delete(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := idParam(w, r, "goalId", "goal not found")
	if !ok {
		return
	}
	if !writeGoalError(w, h.svc.Delete(r.Context(), wl.ID, id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *goalHandlers) listContributions(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := idParam(w, r, "goalId", "goal not found")
	if !ok {
		return
	}
	out, err := h.svc.Contributions(r.Context(), wl.ID, id)
	if !writeGoalError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *goalHandlers) addContribution(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := idParam(w, r, "goalId", "goal not found")
	if !ok {
		return
	}
	var in contributionInput
	if !decodeJSON(w, r, &in) {
		return
	}
	c, err := h.svc.AddContribution(r.Context(), wl.ID, id, in.Date, in.Amount, in.Note)
	if !writeGoalError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *goalHandlers) deleteContribution(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := idParam(w, r, "goalId", "goal not found")
	if !ok {
		return
	}
	cid, ok := idParam(w, r, "contribId", "contribution not found")
	if !ok {
		return
	}
	if !writeGoalError(w, h.svc.DeleteContribution(r.Context(), wl.ID, id, cid)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
