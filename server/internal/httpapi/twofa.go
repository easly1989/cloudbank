package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/auth"
)

// twoFactorRoutes registers the TOTP enrollment endpoints. Like token
// management, they require a browser session (never an API token).
func (h *authHandlers) twoFactorRoutes(r chi.Router) {
	r.Post("/auth/2fa/setup", h.setup2FA)
	r.Post("/auth/2fa/enable", h.enable2FA)
	r.Post("/auth/2fa/disable", h.disable2FA)
}

// setup2FA starts enrollment: it returns a fresh secret and provisioning URI.
// Nothing is persisted until enable2FA confirms a code.
func (h *authHandlers) setup2FA(w http.ResponseWriter, r *http.Request) {
	if !h.requireSession(w, r) {
		return
	}
	u := userFromContext(r.Context())
	secret, uri, err := h.svc.Begin2FASetup(r.Context(), u.ID)
	if errors.Is(err, auth.ErrTOTPEnabled) {
		writeError(w, http.StatusConflict, "already_enabled", "two-factor is already enabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not start 2FA setup")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"secret": secret, "otpauthUri": uri})
}

// enable2FA confirms enrollment with a code and returns the one-time recovery
// codes (shown once).
func (h *authHandlers) enable2FA(w http.ResponseWriter, r *http.Request) {
	if !h.requireSession(w, r) {
		return
	}
	u := userFromContext(r.Context())
	var body struct {
		Secret string `json:"secret"`
		Code   string `json:"code"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Secret == "" || body.Code == "" {
		writeError(w, http.StatusBadRequest, "invalid", "secret and code are required")
		return
	}
	codes, err := h.svc.Enable2FA(r.Context(), u.ID, body.Secret, body.Code)
	switch {
	case errors.Is(err, auth.ErrTOTPEnabled):
		writeError(w, http.StatusConflict, "already_enabled", "two-factor is already enabled")
		return
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusBadRequest, "invalid_code", "that code is not valid")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not enable 2FA")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes})
}

// disable2FA turns two-factor off after re-authenticating with the password.
func (h *authHandlers) disable2FA(w http.ResponseWriter, r *http.Request) {
	if !h.requireSession(w, r) {
		return
	}
	u := userFromContext(r.Context())
	var body struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	err := h.svc.Disable2FA(r.Context(), u.ID, body.Password)
	switch {
	case errors.Is(err, auth.ErrTOTPNotEnabled):
		writeError(w, http.StatusConflict, "not_enabled", "two-factor is not enabled")
		return
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusForbidden, "invalid_password", "incorrect password")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not disable 2FA")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
