package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/oidc"
	"github.com/easly1989/cloudbank/server/internal/secrets"
)

// The provider's single sign-on set from Settings › Security (#796), admin only.
// The CB_OIDC_* variables win when any is set; a save reaches the provider
// first and takes effect at once, without a restart.

const (
	oidcCallbackPath   = "/api/v1/auth/oidc/callback"
	oidcDefaultScopes  = "openid profile email"
	oidcDefaultName    = "SSO"
	oidcDiscoverWait   = 10 * time.Second
	oidcReachableCheck = 5 * time.Second
)

func (h *oidcHandlers) settingsRoutes(r chi.Router) {
	r.Get("/admin/oidc", h.getSettings)
	r.Put("/admin/oidc", h.saveSettings)
	r.Delete("/admin/oidc", h.turnOff)
}

// oidcSettingsView is what the admin sees. The client secret is never in it:
// hasSecret only says whether one is there.
type oidcSettingsView struct {
	// Source is "env" (the CB_OIDC_* variables), "settings" or "none".
	Source        string `json:"source"`
	Enabled       bool   `json:"enabled"`
	Reachable     bool   `json:"reachable"`
	SecretKey     bool   `json:"secretKey"`
	SSOOnly       bool   `json:"ssoOnly"`
	LinkedUsers   int64  `json:"linkedUsers"`
	Issuer        string `json:"issuer"`
	ClientID      string `json:"clientId"`
	HasSecret     bool   `json:"hasSecret"`
	RedirectURL   string `json:"redirectUrl"`
	Scopes        string `json:"scopes"`
	Name          string `json:"name"`
	AutoProvision bool   `json:"autoProvision"`
	AdminEmail    string `json:"adminEmail"`
}

type oidcSettingsInput struct {
	Issuer        string `json:"issuer"`
	ClientID      string `json:"clientId"`
	ClientSecret  string `json:"clientSecret"`
	RedirectURL   string `json:"redirectUrl"`
	Scopes        string `json:"scopes"`
	Name          string `json:"name"`
	AutoProvision bool   `json:"autoProvision"`
	AdminEmail    string `json:"adminEmail"`
}

func (h *oidcHandlers) getSettings(w http.ResponseWriter, r *http.Request) {
	v, err := h.view(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the SSO settings")
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (h *oidcHandlers) view(ctx context.Context) (oidcSettingsView, error) {
	v := oidcSettingsView{
		Source: "none", SecretKey: secrets.Enabled(), SSOOnly: h.ssoOnly,
		Scopes: oidcDefaultScopes, Name: oidcDefaultName,
	}
	var s *oidc.Settings
	if h.env != nil {
		v.Source, s = "env", h.env
	} else {
		saved, ok, err := h.settings.Load(ctx)
		if err != nil {
			return v, err
		}
		if ok {
			v.Source, s = "settings", &saved
		}
	}
	if s != nil {
		v.Issuer, v.ClientID, v.HasSecret = s.Issuer, s.ClientID, s.ClientSecret != ""
		v.RedirectURL, v.Scopes, v.Name = s.RedirectURL, s.Scopes, s.Name
		v.AutoProvision, v.AdminEmail = s.AutoProvision, s.AdminEmail
		n, err := h.settings.Linked(ctx, s.Issuer)
		if err != nil {
			return v, err
		}
		v.LinkedUsers = n
	}
	if svc := h.live.Load().svc; svc != nil {
		v.Enabled = true
		// Discovery is kept once it worked, so this reaches the provider only
		// while it has not answered yet.
		dctx, cancel := context.WithTimeout(ctx, oidcReachableCheck)
		v.Reachable = svc.Discover(dctx) == nil
		cancel()
	}
	return v, nil
}

func (h *oidcHandlers) saveSettings(w http.ResponseWriter, r *http.Request) {
	if !oidcSession(w, r) {
		return
	}
	if h.env != nil {
		writeError(w, http.StatusConflict, "set_by_env", "the CB_OIDC_* variables set single sign-on on this server")
		return
	}
	if !secrets.Enabled() {
		writeError(w, http.StatusConflict, "secret_key_missing", "storing the client secret needs CB_SECRET_KEY on the server")
		return
	}
	var in oidcSettingsInput
	if !decodeJSON(w, r, &in) {
		return
	}
	s, msg := in.settings()
	if msg != "" {
		writeError(w, http.StatusBadRequest, "invalid", msg)
		return
	}

	h.saveMu.Lock()
	defer h.saveMu.Unlock()
	if s.ClientSecret == "" {
		saved, ok, err := h.settings.Load(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not read the SSO settings")
			return
		}
		// The saved secret goes only to the provider it was saved for: kept for
		// another issuer or client, it would be posted to that provider's token
		// endpoint.
		if !ok || saved.ClientSecret == "" || saved.Issuer != s.Issuer || saved.ClientID != s.ClientID {
			writeError(w, http.StatusBadRequest, "invalid", "the client secret is required")
			return
		}
		s.ClientSecret = saved.ClientSecret
	}
	// Nothing is saved unless the provider answers at this address.
	svc := oidc.New(s.Config)
	dctx, cancel := context.WithTimeout(r.Context(), oidcDiscoverWait)
	err := svc.Discover(dctx)
	cancel()
	if err != nil {
		// The detail can carry the reply of whatever answered at that address:
		// the log keeps its start, the answer none of it.
		detail := err.Error()
		if len(detail) > 200 {
			detail = detail[:200] + "…"
		}
		slog.Warn("oidc: provider not found while saving the settings", "issuer", s.Issuer, "error", detail)
		writeError(w, http.StatusBadGateway, "provider_unreachable", "the provider does not answer at this address")
		return
	}
	if err := h.settings.Save(r.Context(), s); err != nil {
		if errors.Is(err, oidc.ErrNoKey) {
			writeError(w, http.StatusConflict, "secret_key_missing", "storing the client secret needs CB_SECRET_KEY on the server")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not save the SSO settings")
		return
	}
	h.live.Store(&oidcLive{svc: svc, policy: h.policy(s)})
	slog.Info("oidc: provider set in Settings", "issuer", s.Issuer, "provider", s.Name, "auto_provision", s.AutoProvision)
	h.getSettings(w, r)
}

// turnOff forgets the saved provider. A server that signs in through SSO
// alone keeps it: without it nobody could sign in.
func (h *oidcHandlers) turnOff(w http.ResponseWriter, r *http.Request) {
	if !oidcSession(w, r) {
		return
	}
	if h.env != nil {
		writeError(w, http.StatusConflict, "set_by_env", "the CB_OIDC_* variables set single sign-on on this server")
		return
	}
	if h.ssoOnly {
		writeError(w, http.StatusConflict, "sso_only", "this server signs in through single sign-on only (CB_PASSWORD_LOGIN=false)")
		return
	}
	h.saveMu.Lock()
	defer h.saveMu.Unlock()
	if err := h.settings.Delete(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not turn single sign-on off")
		return
	}
	h.live.Store(&oidcLive{policy: h.policy(oidc.Settings{})})
	slog.Info("oidc: single sign-on turned off in Settings")
	w.WriteHeader(http.StatusNoContent)
}

// oidcSession refuses an API token: like access codes and API tokens, the
// way everyone signs in is changed from a browser session only.
func oidcSession(w http.ResponseWriter, r *http.Request) bool {
	if authViaToken(r.Context()) {
		writeError(w, http.StatusForbidden, "forbidden", "change single sign-on from a browser session, not an API token")
		return false
	}
	return true
}

// policy is how an SSO sign-in through s may create or claim an account.
func (h *oidcHandlers) policy(s oidc.Settings) auth.OIDCPolicy {
	return auth.OIDCPolicy{AutoProvision: s.AutoProvision, FirstAdmin: h.ssoOnly, AdminEmail: s.AdminEmail}
}

// settings checks the input and fills the defaults; msg says what is wrong.
func (in oidcSettingsInput) settings() (oidc.Settings, string) {
	s := oidc.Settings{
		Config: oidc.Config{
			Issuer:       strings.TrimSpace(in.Issuer),
			ClientID:     strings.TrimSpace(in.ClientID),
			ClientSecret: strings.TrimSpace(in.ClientSecret),
			RedirectURL:  strings.TrimSpace(in.RedirectURL),
			Scopes:       strings.Join(strings.Fields(in.Scopes), " "),
			Name:         strings.TrimSpace(in.Name),
		},
		AutoProvision: in.AutoProvision,
		AdminEmail:    strings.TrimSpace(in.AdminEmail),
	}
	if s.Scopes == "" {
		s.Scopes = oidcDefaultScopes
	}
	if s.Name == "" {
		s.Name = oidcDefaultName
	}
	switch {
	case !webURL(s.Issuer) || len(s.Issuer) > 2048:
		return s, "the issuer is an http or https address"
	case s.ClientID == "" || len(s.ClientID) > 255:
		return s, "the client ID is required, up to 255 characters"
	case len(s.ClientSecret) > 4096:
		return s, "the client secret is up to 4096 characters"
	case !webURL(s.RedirectURL) || len(s.RedirectURL) > 2048 || !strings.HasSuffix(s.RedirectURL, oidcCallbackPath):
		return s, "the redirect URL is an http or https address ending in " + oidcCallbackPath
	case !hasScope(s.Scopes, "openid") || len(s.Scopes) > 1024:
		return s, "the scopes include openid"
	case len([]rune(s.Name)) > 60:
		return s, "the button name is up to 60 characters"
	case s.AdminEmail != "" && (!strings.Contains(s.AdminEmail, "@") || len(s.AdminEmail) > 254):
		return s, "the administrator email is not an email address"
	}
	return s, ""
}

// webURL reports whether s is an absolute http(s) address with a host and
// nothing after its path.
func webURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" &&
		u.User == nil && u.RawQuery == "" && u.Fragment == "" && !u.ForceQuery
}

func hasScope(scopes, want string) bool {
	for _, s := range strings.Fields(scopes) {
		if s == want {
			return true
		}
	}
	return false
}
