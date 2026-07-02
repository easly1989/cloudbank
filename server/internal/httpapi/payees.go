package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/payee"
)

type payeeHandlers struct {
	svc *payee.Service
}

type payeeResponse struct {
	ID                 int64  `json:"id"`
	Name               string `json:"name"`
	DefaultCategoryID  *int64 `json:"defaultCategoryId,omitempty"`
	DefaultPaymentMode *int64 `json:"defaultPaymentMode,omitempty"`
}

func toPayeeResponse(p payee.Payee) payeeResponse {
	return payeeResponse{
		ID: p.ID, Name: p.Name,
		DefaultCategoryID: p.DefaultCategoryID, DefaultPaymentMode: p.DefaultPaymentMode,
	}
}

func (h *payeeHandlers) walletRoutes(r chi.Router) {
	r.Get("/payees", h.list)
	r.Post("/payees", h.create)
	r.Route("/payees/{payeeId}", func(r chi.Router) {
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
		r.Post("/merge", h.merge)
	})
}

func (h *payeeHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	payees, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list payees")
		return
	}
	out := make([]payeeResponse, 0, len(payees))
	for _, p := range payees {
		out = append(out, toPayeeResponse(p))
	}
	writeJSON(w, http.StatusOK, out)
}

type payeeInput struct {
	Name               string `json:"name"`
	DefaultCategoryID  *int64 `json:"defaultCategoryId"`
	DefaultPaymentMode *int64 `json:"defaultPaymentMode"`
}

func (h *payeeHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in payeeInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid", "name is required")
		return
	}
	p, err := h.svc.Create(r.Context(), wl.ID, in.Name, in.DefaultCategoryID, in.DefaultPaymentMode)
	if !writePayeeError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toPayeeResponse(p))
}

func (h *payeeHandlers) update(w http.ResponseWriter, r *http.Request) {
	p, ok := h.payeeFromPath(w, r)
	if !ok {
		return
	}
	var in payeeInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid", "name is required")
		return
	}
	updated, err := h.svc.Update(r.Context(), p.ID, in.Name, in.DefaultCategoryID, in.DefaultPaymentMode)
	if !writePayeeError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, toPayeeResponse(updated))
}

func (h *payeeHandlers) delete(w http.ResponseWriter, r *http.Request) {
	p, ok := h.payeeFromPath(w, r)
	if !ok {
		return
	}
	wl, _ := walletFromContext(r.Context())
	if err := h.svc.Delete(r.Context(), wl.ID, p.ID); !writePayeeError(w, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *payeeHandlers) merge(w http.ResponseWriter, r *http.Request) {
	p, ok := h.payeeFromPath(w, r)
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
	if err := h.svc.Merge(r.Context(), wl.ID, p.ID, in.TargetID); !writePayeeError(w, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *payeeHandlers) payeeFromPath(w http.ResponseWriter, r *http.Request) (payee.Payee, bool) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "payeeId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "payee not found")
		return payee.Payee{}, false
	}
	p, err := h.svc.Get(r.Context(), id)
	if errors.Is(err, payee.ErrNotFound) || (err == nil && p.WalletID != wl.ID) {
		writeError(w, http.StatusNotFound, "not_found", "payee not found")
		return payee.Payee{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load payee")
		return payee.Payee{}, false
	}
	return p, true
}

func writePayeeError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "could not save payee",
		errCase{payee.ErrNotFound, http.StatusNotFound, "not_found", "payee not found"},
		errCase{payee.ErrDuplicate, http.StatusConflict, "duplicate", "a payee with that name already exists"},
		errCase{payee.ErrSelfReference, http.StatusBadRequest, "self", "cannot merge a payee into itself"},
		errCase{payee.ErrBadTarget, http.StatusBadRequest, "bad_target", "invalid target payee"},
	)
}
