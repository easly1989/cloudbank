package httpapi

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/auth"
)

// Passkeys (#798). Not mounted on a server that signs in through SSO only, nor
// in the demo build.

// passkeyBodyMax bounds a browser's WebAuthn answer.
const passkeyBodyMax = 64 << 10

type passkeyResponse struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
}

func toPasskeyResponse(p auth.Passkey) passkeyResponse {
	return passkeyResponse{ID: p.ID, Name: p.Name, CreatedAt: p.CreatedAt, LastUsedAt: p.LastUsedAt}
}

// passkeyPublicRoutes registers the sign-in with a passkey.
func (h *authHandlers) passkeyPublicRoutes(r chi.Router) {
	r.Post("/auth/passkeys/login/begin", h.passkeyLoginBegin)
	r.Post("/auth/passkeys/login/finish", h.passkeyLoginFinish)
}

// passkeyRoutes registers the signed-in user's own passkeys.
func (h *authHandlers) passkeyRoutes(r chi.Router) {
	r.Get("/auth/me/passkeys", h.listPasskeys)
	r.Post("/auth/me/passkeys/begin", h.addPasskeyBegin)
	r.Post("/auth/me/passkeys/finish", h.addPasskeyFinish)
	r.Patch("/auth/me/passkeys/{passkeyId}", h.renamePasskey)
	r.Delete("/auth/me/passkeys/{passkeyId}", h.deletePasskey)
}

// relyingParty reads where the ceremony runs from the Origin header, which the
// browser sets on these POSTs: a passkey belongs to the host the user is on.
func relyingParty(w http.ResponseWriter, r *http.Request) (auth.RelyingParty, bool) {
	origin := r.Header.Get("Origin")
	u, err := url.Parse(origin)
	bad := len(origin) > 300 || err != nil || (u.Scheme != "https" && u.Scheme != "http") ||
		u.Hostname() == "" || net.ParseIP(u.Hostname()) != nil || u.Path != "" || u.RawQuery != ""
	if !bad && u.Port() != "" {
		_, perr := strconv.ParseUint(u.Port(), 10, 16)
		bad = perr != nil
	}
	if bad {
		writeError(w, http.StatusBadRequest, "passkey_origin", "passkeys need the address CloudBank is reached at by name, not by IP")
		return auth.RelyingParty{}, false
	}
	return auth.RelyingParty{ID: u.Hostname(), Origin: u.Scheme + "://" + u.Host}, true
}

func (h *authHandlers) passkeyLoginBegin(w http.ResponseWriter, r *http.Request) {
	rp, ok := relyingParty(w, r)
	if !ok {
		return
	}
	opts, key, err := h.svc.BeginPasskeyLogin(clientIP(r), rp)
	if errors.Is(err, auth.ErrRateLimited) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many attempts, try again later")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not start the passkey sign-in")
		return
	}
	// Each request carries its own challenge's key, so two tabs, or a renewed
	// wait and a click, never answer each other's challenge. The challenge
	// stays on the server.
	writeJSON(w, http.StatusOK, map[string]any{"ceremony": key, "options": opts})
}

func (h *authHandlers) passkeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Ceremony   string          `json:"ceremony"`
		Credential json.RawMessage `json:"credential"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, passkeyBodyMax)
	if !decodeJSON(w, r, &in) {
		return
	}
	u, token, err := h.svc.FinishPasskeyLogin(r.Context(), in.Ceremony, in.Credential, r.UserAgent())
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "this passkey does not sign in to CloudBank")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not sign in")
		return
	}
	h.setSessionCookie(w, token)
	writeJSON(w, http.StatusOK, toUserResponse(u))
}

func (h *authHandlers) listPasskeys(w http.ResponseWriter, r *http.Request) {
	if !passkeySession(w, r) {
		return
	}
	list, err := h.svc.ListPasskeys(r.Context(), userFromContext(r.Context()).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list the passkeys")
		return
	}
	out := make([]passkeyResponse, 0, len(list))
	for _, p := range list {
		out = append(out, toPasskeyResponse(p))
	}
	writeJSON(w, http.StatusOK, out)
}

// writePasskeyAddError maps the errors of adding a passkey.
func writePasskeyAddError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrReauthRequired):
		writeError(w, http.StatusForbidden, "reauth_required", "sign in again to add a passkey")
	case errors.Is(err, auth.ErrPasskeyLimit):
		writeError(w, http.StatusConflict, "passkey_limit", "remove a passkey to add another")
	case errors.Is(err, auth.ErrPasskeyRejected):
		writeError(w, http.StatusBadRequest, "passkey_rejected", "the passkey was not accepted; try again")
	case errors.Is(err, auth.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not add the passkey")
	}
}

// passkeySession refuses API tokens: passkeys are managed from a browser.
func passkeySession(w http.ResponseWriter, r *http.Request) bool {
	if authViaToken(r.Context()) {
		writeError(w, http.StatusForbidden, "forbidden", "manage passkeys from a browser session, not an API token")
		return false
	}
	return true
}

func sessionToken(r *http.Request) string {
	if c, err := r.Cookie(sessionCookie); err == nil {
		return c.Value
	}
	return ""
}

func (h *authHandlers) addPasskeyBegin(w http.ResponseWriter, r *http.Request) {
	if !passkeySession(w, r) {
		return
	}
	rp, ok := relyingParty(w, r)
	if !ok {
		return
	}
	opts, err := h.svc.BeginPasskeyAdd(r.Context(), userFromContext(r.Context()).ID, sessionToken(r), rp)
	if err != nil {
		writePasskeyAddError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, opts)
}

func (h *authHandlers) addPasskeyFinish(w http.ResponseWriter, r *http.Request) {
	if !passkeySession(w, r) {
		return
	}
	var in struct {
		Name       string          `json:"name"`
		Credential json.RawMessage `json:"credential"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, passkeyBodyMax)
	if !decodeJSON(w, r, &in) {
		return
	}
	p, err := h.svc.FinishPasskeyAdd(r.Context(), userFromContext(r.Context()).ID, sessionToken(r), in.Name, in.Credential)
	if err != nil {
		writePasskeyAddError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toPasskeyResponse(p))
}

func passkeyID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "passkeyId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid", "invalid passkey id")
		return 0, false
	}
	return id, true
}

func (h *authHandlers) renamePasskey(w http.ResponseWriter, r *http.Request) {
	if !passkeySession(w, r) {
		return
	}
	id, ok := passkeyID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	h.passkeyChanged(w, h.svc.RenamePasskey(r.Context(), userFromContext(r.Context()).ID, id, in.Name))
}

func (h *authHandlers) deletePasskey(w http.ResponseWriter, r *http.Request) {
	if !passkeySession(w, r) {
		return
	}
	id, ok := passkeyID(w, r)
	if !ok {
		return
	}
	h.passkeyChanged(w, h.svc.DeletePasskey(r.Context(), userFromContext(r.Context()).ID, id))
}

func (h *authHandlers) passkeyChanged(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "no such passkey")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not change the passkey")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// deleteUserPasskeys lets an admin take every passkey from a user who lost
// their device.
func (h *authHandlers) deleteUserPasskeys(w http.ResponseWriter, r *http.Request) {
	if !passkeySession(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if _, err := h.svc.DeleteUserPasskeys(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not remove the passkeys")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
