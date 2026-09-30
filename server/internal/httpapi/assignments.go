package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/walletref"
)

// assignmentHandlers serves wallet-scoped assignment-rule endpoints (mounted
// inside the walletContext middleware).
type assignmentHandlers struct {
	svc *assignment.Service
}

func (h *assignmentHandlers) walletRoutes(r chi.Router) {
	r.Get("/assignments", h.list)
	r.Post("/assignments", h.create)
	r.Post("/assignments/reorder", h.reorder)
	r.Post("/assignments/test", h.test)
	r.Post("/assignments/apply", h.apply)
	r.Post("/assignments/suggest", h.suggest)
	r.Route("/assignments/{assignmentId}", func(r chi.Router) {
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
	})
}

type assignmentInput struct {
	MatchField     string   `json:"matchField"`
	MatchType      string   `json:"matchType"`
	Pattern        string   `json:"pattern"`
	CaseSensitive  bool     `json:"caseSensitive"`
	MatchAccountID *int64   `json:"matchAccountId"`
	SetPayeeID     *int64   `json:"setPayeeId"`
	SetCategoryID  *int64   `json:"setCategoryId"`
	SetPaymentMode *int     `json:"setPaymentMode"`
	SetInfo        *string  `json:"setInfo"`
	SetTags        []string `json:"setTags"`
	ApplyOnManual  bool     `json:"applyOnManual"`
	ApplyOnImport  bool     `json:"applyOnImport"`
}

func (in assignmentInput) toServiceInput() assignment.Input {
	return assignment.Input{
		MatchField: in.MatchField, MatchType: in.MatchType, Pattern: in.Pattern,
		CaseSensitive: in.CaseSensitive, MatchAccountID: in.MatchAccountID,
		SetPayeeID: in.SetPayeeID, SetCategoryID: in.SetCategoryID,
		SetPaymentMode: in.SetPaymentMode, SetInfo: in.SetInfo, SetTags: in.SetTags,
		ApplyOnManual: in.ApplyOnManual, ApplyOnImport: in.ApplyOnImport,
	}
}

func (h *assignmentHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	out, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list rules")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *assignmentHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in assignmentInput
	if !decodeJSON(w, r, &in) {
		return
	}
	def, err := h.svc.Create(r.Context(), wl.ID, in.toServiceInput())
	if !writeAssignmentError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, def)
}

func (h *assignmentHandlers) update(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.ownedID(w, r)
	if !ok {
		return
	}
	var in assignmentInput
	if !decodeJSON(w, r, &in) {
		return
	}
	def, err := h.svc.Update(r.Context(), wl.ID, id, in.toServiceInput())
	if !writeAssignmentError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, def)
}

func (h *assignmentHandlers) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := h.ownedID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete rule")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *assignmentHandlers) reorder(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.svc.Reorder(r.Context(), wl.ID, body.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not reorder rules")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// test is the rule tester's dry run: what the rule in the body would match,
// changing nothing. id is the rule being edited, if any; the rules above it
// are the ones that can take a match first.
func (h *assignmentHandlers) test(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in struct {
		assignmentInput
		ID int64 `json:"id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	res, err := h.svc.Test(r.Context(), wl.ID, in.ID, in.toServiceInput(), 5)
	if !writeAssignmentError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *assignmentHandlers) apply(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		AccountID     *int64 `json:"accountId"`
		AssignmentID  *int64 `json:"assignmentId"`
		OnlyFillEmpty bool   `json:"onlyFillEmpty"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	// Only the wallet's own rules are loaded, so another wallet's rule id
	// simply matches nothing.
	n, err := h.svc.ApplyToExisting(r.Context(), wl.ID, body.AccountID, body.AssignmentID, body.OnlyFillEmpty)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not apply rules")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"changed": n})
}

func (h *assignmentHandlers) suggest(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		Memo      string   `json:"memo"`
		Payee     string   `json:"payee"`
		Tags      []string `json:"tags"`
		AccountID int64    `json:"accountId"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	res, ok, err := h.svc.Suggest(r.Context(), wl.ID, assignment.Subject{
		Memo: body.Memo, Payee: body.Payee, Tags: body.Tags, AccountID: body.AccountID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not evaluate rules")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"matched": ok, "payeeId": res.PayeeID, "categoryId": res.CategoryID,
		"paymentMode": res.PaymentMode, "info": res.Info, "tags": nonNilTags(res.Tags),
	})
}

// ownedID parses {assignmentId} and verifies it belongs to the wallet (else 404).
func (h *assignmentHandlers) ownedID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "assignmentId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "rule not found")
		return 0, false
	}
	walletID, err := h.svc.WalletOf(r.Context(), id)
	if errors.Is(err, assignment.ErrNotFound) || (err == nil && walletID != wl.ID) {
		writeError(w, http.StatusNotFound, "not_found", "rule not found")
		return 0, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load rule")
		return 0, false
	}
	return id, true
}

func writeAssignmentError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "could not save rule",
		errCase{assignment.ErrNotFound, http.StatusNotFound, "not_found", "rule not found"},
		errCase{walletref.ErrForeign, http.StatusBadRequest, "invalid_reference", "a referenced record does not belong to this wallet"},
		errCase{assignment.ErrInvalidField, http.StatusBadRequest, "invalid_field", "invalid match field"},
		errCase{assignment.ErrInvalidType, http.StatusBadRequest, "invalid_type", "invalid match type"},
		errCase{assignment.ErrEmptyPattern, http.StatusBadRequest, "empty_pattern", "pattern is required"},
		errCase{assignment.ErrInvalidRegex, http.StatusBadRequest, "invalid_regex", "invalid regular expression"},
	)
}

func nonNilTags(t []string) []string {
	if t == nil {
		return []string{}
	}
	return t
}
