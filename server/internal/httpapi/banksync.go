package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/banksync"
)

// bankSyncHandlers serves the wallet-scoped bank-sync endpoints.
type bankSyncHandlers struct {
	svc *banksync.Service
}

func (h *bankSyncHandlers) walletRoutes(r chi.Router) {
	r.Get("/bank/connections", h.list)
	r.Post("/bank/connections", h.connect)
	r.Route("/bank/connections/{connId}", func(r chi.Router) {
		r.Delete("/", h.remove)
		r.Get("/accounts", h.accounts)
		r.Post("/links", h.link)
		r.Delete("/links/{externalId}", h.unlink)
		r.Post("/sync", h.sync)
	})
}

func (h *bankSyncHandlers) connID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "connId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid", "invalid connection id")
		return 0, false
	}
	return id, true
}

func (h *bankSyncHandlers) writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, banksync.ErrTokenClaimed):
		writeError(w, http.StatusBadRequest, "token_invalid", "the setup token is invalid or already used")
	case errors.Is(err, banksync.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "not found")
	case errors.Is(err, banksync.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid", "invalid input")
	default:
		writeError(w, http.StatusBadGateway, "provider_error", "the bank provider request failed")
	}
}

func (h *bankSyncHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	conns, err := h.svc.ListConnections(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list connections")
		return
	}
	writeJSON(w, http.StatusOK, conns)
}

func (h *bankSyncHandlers) connect(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		SetupToken string `json:"setupToken"`
		Name       string `json:"name"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	conn, accounts, err := h.svc.Connect(r.Context(), wl.ID, body.SetupToken, body.Name)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"connection": conn, "accounts": accounts})
}

func (h *bankSyncHandlers) remove(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.connID(w, r)
	if !ok {
		return
	}
	if err := h.svc.RemoveConnection(r.Context(), wl.ID, id); err != nil {
		h.writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *bankSyncHandlers) accounts(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.connID(w, r)
	if !ok {
		return
	}
	accounts, err := h.svc.RemoteAccounts(r.Context(), wl.ID, id)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

func (h *bankSyncHandlers) link(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.connID(w, r)
	if !ok {
		return
	}
	var body struct {
		ExternalID string `json:"externalId"`
		AccountID  int64  `json:"accountId"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.svc.Link(r.Context(), wl.ID, id, body.ExternalID, body.AccountID); err != nil {
		h.writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *bankSyncHandlers) unlink(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.connID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Unlink(r.Context(), wl.ID, id, chi.URLParam(r, "externalId")); err != nil {
		h.writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *bankSyncHandlers) sync(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.connID(w, r)
	if !ok {
		return
	}
	res, err := h.svc.Sync(r.Context(), wl.ID, id)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}
