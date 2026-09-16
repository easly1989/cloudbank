package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/assetvaluation"
)

// assetValuationHandlers serve the wallet-scoped valuation endpoints for asset
// accounts (mounted inside the walletContext middleware).
type assetValuationHandlers struct {
	svc *assetvaluation.Service
}

func (h *assetValuationHandlers) walletRoutes(r chi.Router) {
	r.Get("/accounts/{accountId}/valuations", h.list)
	r.Post("/accounts/{accountId}/valuations", h.add)
	r.Patch("/accounts/{accountId}/valuations/{valuationId}", h.update)
	r.Delete("/accounts/{accountId}/valuations/{valuationId}", h.delete)
}

type valuationInput struct {
	Date  string `json:"date"`
	Value int64  `json:"value"`
	Note  string `json:"note"`
}

func writeValuationError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "could not save valuation",
		errCase{assetvaluation.ErrNotFound, http.StatusNotFound, "not_found", "account or valuation not found"},
		errCase{assetvaluation.ErrNotAsset, http.StatusBadRequest, "invalid", "valuations are only for asset accounts"},
		errCase{assetvaluation.ErrInvalid, http.StatusBadRequest, "invalid", "a date and a non-negative value are required"},
	)
}

func (h *assetValuationHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	aid, ok := idParam(w, r, "accountId", "account not found")
	if !ok {
		return
	}
	out, err := h.svc.List(r.Context(), wl.ID, aid)
	if !writeValuationError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *assetValuationHandlers) add(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	aid, ok := idParam(w, r, "accountId", "account not found")
	if !ok {
		return
	}
	var in valuationInput
	if !decodeJSON(w, r, &in) {
		return
	}
	v, err := h.svc.Add(r.Context(), wl.ID, aid, assetvaluation.Input{Date: in.Date, Value: in.Value, Note: in.Note})
	if !writeValuationError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (h *assetValuationHandlers) update(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	vid, ok := idParam(w, r, "valuationId", "valuation not found")
	if !ok {
		return
	}
	var in valuationInput
	if !decodeJSON(w, r, &in) {
		return
	}
	v, err := h.svc.Update(r.Context(), wl.ID, vid, assetvaluation.Input{Date: in.Date, Value: in.Value, Note: in.Note})
	if !writeValuationError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (h *assetValuationHandlers) delete(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	vid, ok := idParam(w, r, "valuationId", "valuation not found")
	if !ok {
		return
	}
	if !writeValuationError(w, h.svc.Delete(r.Context(), wl.ID, vid)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
