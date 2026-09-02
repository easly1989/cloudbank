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
		r.Post("/reauth", h.ebReauth)
		r.Post("/auto-sync", h.setAutoSync)
	})
	// Enable Banking (EU/PSD2), bring-your-own credentials.
	r.Get("/bank/enablebanking/config", h.ebGetConfig)
	r.Put("/bank/enablebanking/config", h.ebSetConfig)
	r.Delete("/bank/enablebanking/config", h.ebDeleteConfig)
	r.Get("/bank/enablebanking/aspsps", h.ebBanks)
	r.Post("/bank/enablebanking/auth", h.ebStartAuth)
	r.Post("/bank/enablebanking/callback", h.ebCallback)
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
	case errors.Is(err, banksync.ErrEBNotConfigured):
		writeError(w, http.StatusBadRequest, "not_configured", "enable banking is not configured for this wallet")
	case errors.Is(err, banksync.ErrEBConsentExpired):
		writeError(w, http.StatusConflict, "consent_expired", "the bank consent has expired — reconnect the bank")
	default:
		writeError(w, http.StatusBadGateway, "provider_error", "the bank provider request failed")
	}
}

func (h *bankSyncHandlers) ebGetConfig(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	cfg, err := h.svc.EBankingConfig(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load config")
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *bankSyncHandlers) ebSetConfig(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		AppID       string `json:"appId"`
		PrivateKey  string `json:"privateKey"`
		Environment string `json:"environment"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.svc.SetEBankingConfig(r.Context(), wl.ID, body.AppID, body.PrivateKey, body.Environment); err != nil {
		h.writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *bankSyncHandlers) ebDeleteConfig(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	if err := h.svc.DeleteEBankingConfig(r.Context(), wl.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete config")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *bankSyncHandlers) ebBanks(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	banks, err := h.svc.EBankingBanks(r.Context(), wl.ID, r.URL.Query().Get("country"))
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, banks)
}

func (h *bankSyncHandlers) ebStartAuth(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		AspspName    string `json:"aspspName"`
		AspspCountry string `json:"aspspCountry"`
		Name         string `json:"name"`
		RedirectURL  string `json:"redirectUrl"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	url, state, err := h.svc.EBankingStartAuth(r.Context(), wl.ID, body.AspspName, body.AspspCountry, body.Name, body.RedirectURL)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url, "state": state})
}

func (h *bankSyncHandlers) setAutoSync(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.connID(w, r)
	if !ok {
		return
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.svc.SetAutoSync(r.Context(), wl.ID, id, body.Enabled); err != nil {
		h.writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *bankSyncHandlers) ebReauth(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.connID(w, r)
	if !ok {
		return
	}
	var body struct {
		RedirectURL string `json:"redirectUrl"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	url, state, err := h.svc.EBankingStartReauth(r.Context(), wl.ID, id, body.RedirectURL)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url, "state": state})
}

func (h *bankSyncHandlers) ebCallback(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		State string `json:"state"`
		Code  string `json:"code"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	conn, err := h.svc.EBankingCompleteAuth(r.Context(), wl.ID, body.State, body.Code)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"connection": conn})
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
