package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/oidc"
	"github.com/easly1989/cloudbank/server/internal/secrets"
)

// oidcStateCookie carries the per-login state/nonce/PKCE-verifier (sealed) between
// the start redirect and the callback. Scoped to the OIDC paths and short-lived.
const oidcStateCookie = "cb_oidc"
const oidcStatePath = "/api/v1/auth/oidc"

// oidcHandlers serves the OIDC/SSO login endpoints. svc is nil when OIDC is not
// configured; the start/callback endpoints then report that SSO is disabled while
// /auth/config still answers so the login page can hide the button.
type oidcHandlers struct {
	svc           *oidc.Service
	auth          *auth.Service
	secure        bool
	autoProvision bool
}

func (h *oidcHandlers) routes(r chi.Router) {
	r.Get("/auth/config", h.config)
	r.Get("/auth/oidc/start", h.start)
	r.Get("/auth/oidc/callback", h.callback)
}

// config tells the (pre-auth) login page whether to show the SSO button.
func (h *oidcHandlers) config(w http.ResponseWriter, _ *http.Request) {
	oidcInfo := map[string]any{"enabled": false, "name": ""}
	if h.svc != nil {
		oidcInfo["enabled"] = true
		oidcInfo["name"] = h.svc.Name()
	}
	writeJSON(w, http.StatusOK, map[string]any{"oidc": oidcInfo})
}

func (h *oidcHandlers) start(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		writeError(w, http.StatusNotFound, "not_found", "SSO is not enabled")
		return
	}
	req, authURL := h.svc.Start()
	blob, err := json.Marshal(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not start SSO")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookie,
		Value:    base64.RawURLEncoding.EncodeToString([]byte(secrets.Seal(string(blob)))),
		Path:     oidcStatePath,
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600, // 10 minutes to complete the login
	})
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (h *oidcHandlers) callback(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		writeError(w, http.StatusNotFound, "not_found", "SSO is not enabled")
		return
	}
	// Consume the state cookie regardless of outcome.
	h.clearState(w)

	if e := r.URL.Query().Get("error"); e != "" {
		h.fail(w, r, "provider")
		return
	}
	req, ok := h.readState(r)
	if !ok || r.URL.Query().Get("state") == "" || r.URL.Query().Get("state") != req.State {
		h.fail(w, r, "state")
		return
	}
	claims, err := h.svc.Exchange(r.Context(), req, r.URL.Query().Get("code"))
	if err != nil {
		slog.Warn("oidc: token exchange/verify failed", "error", err)
		h.fail(w, r, "exchange")
		return
	}
	u, err := h.auth.UpsertOIDCUser(r.Context(), claims, h.autoProvision)
	if err != nil {
		slog.Warn("oidc: identity mapping refused", "error", err)
		h.fail(w, r, "account")
		return
	}
	token, err := h.auth.IssueSession(r.Context(), u.ID, r.UserAgent())
	if err != nil {
		h.fail(w, r, "session")
		return
	}
	writeSessionCookie(w, token, h.secure)
	http.Redirect(w, r, "/", http.StatusFound)
}

func (h *oidcHandlers) readState(r *http.Request) (oidc.AuthRequest, bool) {
	c, err := r.Cookie(oidcStateCookie)
	if err != nil {
		return oidc.AuthRequest{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil {
		return oidc.AuthRequest{}, false
	}
	var req oidc.AuthRequest
	if err := json.Unmarshal([]byte(secrets.Open(string(raw))), &req); err != nil {
		return oidc.AuthRequest{}, false
	}
	return req, true
}

func (h *oidcHandlers) clearState(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: oidcStateCookie, Value: "", Path: oidcStatePath, HttpOnly: true,
		Secure: h.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

// fail redirects back to the login page with an error code the SPA can surface.
func (h *oidcHandlers) fail(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/login?sso_error="+url.QueryEscape(code), http.StatusFound)
}
