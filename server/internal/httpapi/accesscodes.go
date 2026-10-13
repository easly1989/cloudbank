package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/auth"
)

// Access recovery codes (#620): on a server that signs in through SSO only,
// each user keeps one-time codes that let them in while the identity provider
// is down, so nobody has to touch the container to get back in.

// accessCodeRoutes registers the signed-in user's own codes.
func (h *authHandlers) accessCodeRoutes(r chi.Router) {
	r.Get("/auth/me/access-codes", h.accessCodesStatus)
	r.Post("/auth/me/access-codes", h.newAccessCodes)
}

// accessCodesStatus says how many of the user's codes are still unused.
func (h *authHandlers) accessCodesStatus(w http.ResponseWriter, r *http.Request) {
	n, err := h.svc.AccessCodesRemaining(r.Context(), userFromContext(r.Context()).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the recovery codes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"remaining": n})
}

// newAccessCodes replaces the user's codes and returns the new ones, once.
// From a browser session only: an API token cannot mint a way in.
func (h *authHandlers) newAccessCodes(w http.ResponseWriter, r *http.Request) {
	if !h.requireSession(w, r) {
		return
	}
	codes, err := h.svc.NewAccessCodes(r.Context(), userFromContext(r.Context()).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not make the recovery codes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"codes": codes})
}

// recoveryLogin signs in with a username and one access recovery code.
func (h *authHandlers) recoveryLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Code     string `json:"code"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	u, token, left, err := h.svc.LoginWithAccessCode(r.Context(), clientIP(r),
		strings.TrimSpace(in.Username), strings.TrimSpace(in.Code), r.UserAgent())
	switch {
	case errors.Is(err, auth.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many attempts, try again later")
		return
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid username or recovery code")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not log in")
		return
	}
	h.setSessionCookie(w, token)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserResponse(u), "remaining": left})
}

// passwordLoginOff answers the password endpoints of a server that signs in
// through SSO only.
func passwordLoginOff(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusForbidden, "password_login_off", "this server signs in through SSO only")
}
