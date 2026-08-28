package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/auth"
)

// apiTokenResponse is a token's metadata — never the token itself.
type apiTokenResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Scope      string `json:"scope"`
	Prefix     string `json:"prefix"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
	ExpiresAt  string `json:"expiresAt,omitempty"`
}

func toAPITokenResponse(t auth.APIToken) apiTokenResponse {
	return apiTokenResponse{
		ID: t.ID, Name: t.Name, Scope: t.Scope, Prefix: t.Prefix,
		CreatedAt: t.CreatedAt, LastUsedAt: t.LastUsedAt, ExpiresAt: t.ExpiresAt,
	}
}

// tokenRoutes registers the personal-API-token management endpoints. They run
// inside requireAuth but must be reached with a browser session — never with a
// token — so a leaked token cannot mint or revoke further tokens.
func (h *authHandlers) tokenRoutes(r chi.Router) {
	r.Get("/auth/tokens", h.listTokens)
	r.Post("/auth/tokens", h.createToken)
	r.Delete("/auth/tokens/{id}", h.revokeToken)
}

// requireSession blocks token-authenticated callers from managing tokens.
func (h *authHandlers) requireSession(w http.ResponseWriter, r *http.Request) bool {
	if authViaToken(r.Context()) {
		writeError(w, http.StatusForbidden, "forbidden", "manage API tokens from a browser session, not an API token")
		return false
	}
	return true
}

func (h *authHandlers) listTokens(w http.ResponseWriter, r *http.Request) {
	if !h.requireSession(w, r) {
		return
	}
	u := userFromContext(r.Context())
	toks, err := h.svc.ListAPITokens(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list tokens")
		return
	}
	out := make([]apiTokenResponse, 0, len(toks))
	for _, t := range toks {
		out = append(out, toAPITokenResponse(t))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *authHandlers) createToken(w http.ResponseWriter, r *http.Request) {
	if !h.requireSession(w, r) {
		return
	}
	u := userFromContext(r.Context())
	var body struct {
		Name          string `json:"name"`
		Scope         string `json:"scope"`
		ExpiresInDays int    `json:"expiresInDays"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid", "name is required")
		return
	}
	scope := body.Scope
	if scope == "" {
		scope = auth.ScopeRead
	}
	expiresAt := ""
	if body.ExpiresInDays > 0 {
		expiresAt = time.Now().UTC().AddDate(0, 0, body.ExpiresInDays).Format(time.RFC3339)
	}
	tok, plaintext, err := h.svc.CreateAPIToken(r.Context(), u.ID, name, scope, expiresAt)
	if errors.Is(err, auth.ErrInvalidScope) {
		writeError(w, http.StatusBadRequest, "invalid", "scope must be read or write")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not create token")
		return
	}
	// The plaintext token is returned exactly once and never recoverable.
	writeJSON(w, http.StatusCreated, map[string]any{"token": plaintext, "info": toAPITokenResponse(tok)})
}

func (h *authHandlers) revokeToken(w http.ResponseWriter, r *http.Request) {
	if !h.requireSession(w, r) {
		return
	}
	u := userFromContext(r.Context())
	id := chi.URLParam(r, "id")
	err := h.svc.RevokeAPIToken(r.Context(), u.ID, id)
	if errors.Is(err, auth.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "token not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not revoke token")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
