package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/auth"
)

const sessionCookie = "cb_session"
const sessionMaxAge = 7 * 24 * 60 * 60 // seconds, matches auth.sessionTTL

type ctxKey int

const userCtxKey ctxKey = iota

// authHandlers groups the auth/setup/admin HTTP handlers and middleware.
type authHandlers struct {
	svc    *auth.Service
	secure bool
}

// userResponse is the JSON shape returned for an account. It never contains the
// password hash.
type userResponse struct {
	ID          int64           `json:"id"`
	Username    string          `json:"username"`
	Email       string          `json:"email"`
	IsAdmin     bool            `json:"isAdmin"`
	Locale      string          `json:"locale"`
	Theme       string          `json:"theme"`
	Preferences json.RawMessage `json:"preferences"`
	Disabled    bool            `json:"disabled"`
	CreatedAt   string          `json:"createdAt"`
}

func toUserResponse(u auth.User) userResponse {
	prefs := json.RawMessage(u.Preferences)
	if len(prefs) == 0 {
		prefs = json.RawMessage("{}")
	}
	return userResponse{
		ID: u.ID, Username: u.Username, Email: u.Email, IsAdmin: u.IsAdmin,
		Locale: u.Locale, Theme: u.Theme, Preferences: prefs, Disabled: u.Disabled, CreatedAt: u.CreatedAt,
	}
}

// publicRoutes registers the unauthenticated auth/setup endpoints.
func (h *authHandlers) publicRoutes(r chi.Router) {
	r.Get("/setup/status", h.setupStatus)
	r.Post("/setup", h.setup)
	r.Post("/auth/login", h.login)
}

// protectedRoutes registers endpoints that require an authenticated session;
// it must be mounted inside a group that applies h.requireAuth.
func (h *authHandlers) protectedRoutes(r chi.Router) {
	r.Post("/auth/logout", h.logout)
	r.Get("/auth/me", h.me)
	r.Patch("/auth/me", h.updateMe)

	r.Group(func(r chi.Router) {
		r.Use(h.requireAdmin)
		r.Get("/admin/users", h.listUsers)
		r.Post("/admin/users", h.createUser)
		r.Post("/admin/users/{id}/disable", h.disableUser)
		r.Post("/admin/users/{id}/password", h.resetPassword)
	})
}

func (h *authHandlers) setupStatus(w http.ResponseWriter, r *http.Request) {
	need, err := h.svc.NeedsSetup(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read setup status")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"needsSetup": need})
}

type credentials struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *authHandlers) setup(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !decodeJSON(w, r, &in) {
		return
	}
	if msg := validateCredentials(in.Username, in.Password); msg != "" {
		writeError(w, http.StatusBadRequest, "invalid", msg)
		return
	}
	u, token, err := h.svc.Setup(r.Context(), strings.TrimSpace(in.Username), in.Email, in.Password, r.UserAgent())
	if errors.Is(err, auth.ErrSetupNotAllowed) {
		writeError(w, http.StatusConflict, "setup_done", "setup has already been completed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not complete setup")
		return
	}
	h.setSessionCookie(w, token)
	writeJSON(w, http.StatusCreated, toUserResponse(u))
}

func (h *authHandlers) login(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !decodeJSON(w, r, &in) {
		return
	}
	u, token, err := h.svc.Login(r.Context(), clientIP(r), strings.TrimSpace(in.Username), in.Password, r.UserAgent())
	switch {
	case errors.Is(err, auth.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many attempts, try again later")
		return
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid username or password")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not log in")
		return
	}
	h.setSessionCookie(w, token)
	writeJSON(w, http.StatusOK, toUserResponse(u))
}

func (h *authHandlers) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = h.svc.Logout(r.Context(), c.Value)
	}
	h.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *authHandlers) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, toUserResponse(userFromContext(r.Context())))
}

// updateMe persists the current user's language, theme and UI preferences.
func (h *authHandlers) updateMe(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	var in struct {
		Locale      string          `json:"locale"`
		Theme       string          `json:"theme"`
		Preferences json.RawMessage `json:"preferences"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	locale := in.Locale
	if locale == "" {
		locale = user.Locale
	}
	theme := in.Theme
	if theme == "" {
		theme = user.Theme
	}
	prefs := string(in.Preferences)
	if prefs == "" {
		prefs = user.Preferences
	}
	updated, err := h.svc.UpdateSettings(r.Context(), user.ID, locale, theme, prefs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not update preferences")
		return
	}
	writeJSON(w, http.StatusOK, toUserResponse(updated))
}

func (h *authHandlers) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.svc.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list users")
		return
	}
	out := make([]userResponse, 0, len(users))
	for _, u := range users {
		out = append(out, toUserResponse(u))
	}
	writeJSON(w, http.StatusOK, out)
}

type createUserRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	IsAdmin  bool   `json:"isAdmin"`
}

func (h *authHandlers) createUser(w http.ResponseWriter, r *http.Request) {
	var in createUserRequest
	if !decodeJSON(w, r, &in) {
		return
	}
	if msg := validateCredentials(in.Username, in.Password); msg != "" {
		writeError(w, http.StatusBadRequest, "invalid", msg)
		return
	}
	u, err := h.svc.CreateUser(r.Context(), strings.TrimSpace(in.Username), in.Email, in.Password, in.IsAdmin)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "username_taken", "that username is already taken")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not create user")
		return
	}
	writeJSON(w, http.StatusCreated, toUserResponse(u))
}

func (h *authHandlers) disableUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if id == userFromContext(r.Context()).ID {
		writeError(w, http.StatusBadRequest, "self", "you cannot disable your own account")
		return
	}
	var in struct {
		Disabled bool `json:"disabled"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := h.svc.SetDisabled(r.Context(), id, in.Disabled); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not update user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *authHandlers) resetPassword(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.Password) < 8 {
		writeError(w, http.StatusBadRequest, "invalid", "password must be at least 8 characters")
		return
	}
	if err := h.svc.ResetPassword(r.Context(), id, in.Password); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not reset password")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// requireAuth validates the session cookie and stashes the user in the context.
func (h *authHandlers) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		u, err := h.svc.Authenticate(r.Context(), c.Value)
		if err != nil {
			h.clearSessionCookie(w)
			writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userCtxKey, u)))
	})
}

// requireAdmin must run after requireAuth; it rejects non-admin users.
func (h *authHandlers) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !userFromContext(r.Context()).IsAdmin {
			writeError(w, http.StatusForbidden, "forbidden", "administrator access required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *authHandlers) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   sessionMaxAge,
	})
}

func (h *authHandlers) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func userFromContext(ctx context.Context) auth.User {
	u, _ := ctx.Value(userCtxKey).(auth.User)
	return u
}

// csrf rejects state-changing requests that lack the X-Requested-With header.
// Combined with SameSite=Lax session cookies, requiring a custom header that
// browsers will not attach to cross-site form posts or navigations defeats CSRF
// without per-request tokens. The SPA's fetch client always sends it.
func csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if r.Header.Get("X-Requested-With") == "" {
				writeError(w, http.StatusForbidden, "csrf", "missing X-Requested-With header")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// --- helpers ---

func validateCredentials(username, password string) string {
	if strings.TrimSpace(username) == "" {
		return "username is required"
	}
	if len(password) < 8 {
		return "password must be at least 8 characters"
	}
	return ""
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "request body is not valid JSON")
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid", "invalid user id")
		return 0, false
	}
	return id, true
}

func clientIP(r *http.Request) string {
	// chi's RealIP middleware sets RemoteAddr from X-Forwarded-For/X-Real-IP.
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i != -1 {
		host = host[:i]
	}
	return host
}

func isUniqueViolation(err error) bool {
	// modernc.org/sqlite surfaces constraint violations in the error text.
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}
