package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/transfer"
)

// transferHandlers serves wallet-scoped internal-transfer endpoints (mounted
// inside the walletContext middleware, so the wallet is always in context).
type transferHandlers struct {
	svc *transfer.Service
}

func (h *transferHandlers) walletRoutes(r chi.Router) {
	r.Post("/transfers", h.create)
	r.Route("/transfers/{transferId}", func(r chi.Router) {
		r.Get("/", h.get)
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
	})
}

type transferInput struct {
	FromAccountID int64  `json:"fromAccountId"`
	ToAccountID   int64  `json:"toAccountId"`
	Date          string `json:"date"`
	FromAmount    int64  `json:"fromAmount"`
	ToAmount      int64  `json:"toAmount"`
	Memo          string `json:"memo"`
	Status        int    `json:"status"`
}

func (in transferInput) toServiceInput() transfer.Input {
	return transfer.Input{
		FromAccountID: in.FromAccountID, ToAccountID: in.ToAccountID, Date: in.Date,
		FromAmount: in.FromAmount, ToAmount: in.ToAmount, Memo: in.Memo, Status: in.Status,
	}
}

func (h *transferHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in transferInput
	if !decodeJSON(w, r, &in) {
		return
	}
	t, err := h.svc.Create(r.Context(), wl.ID, in.toServiceInput())
	if !writeTransferError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (h *transferHandlers) get(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := transferIDFromPath(w, r)
	if !ok {
		return
	}
	t, err := h.svc.Get(r.Context(), wl.ID, id)
	if !writeTransferError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *transferHandlers) update(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := transferIDFromPath(w, r)
	if !ok {
		return
	}
	var in transferInput
	if !decodeJSON(w, r, &in) {
		return
	}
	t, err := h.svc.Update(r.Context(), wl.ID, id, in.toServiceInput())
	if !writeTransferError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *transferHandlers) delete(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := transferIDFromPath(w, r)
	if !ok {
		return
	}
	err := h.svc.Delete(r.Context(), wl.ID, id)
	if errors.Is(err, transfer.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "transfer not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete transfer")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func transferIDFromPath(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "transferId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "transfer not found")
		return 0, false
	}
	return id, true
}

func writeTransferError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, transfer.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "transfer not found")
	case errors.Is(err, transfer.ErrSameAccount):
		writeError(w, http.StatusBadRequest, "same_account", "source and destination accounts must differ")
	case errors.Is(err, transfer.ErrInvalidAccount):
		writeError(w, http.StatusBadRequest, "invalid_account", "account does not belong to this wallet")
	case errors.Is(err, transfer.ErrInvalidAmount):
		writeError(w, http.StatusBadRequest, "invalid_amount", "amounts must be greater than zero")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not save transfer")
	}
	return false
}
