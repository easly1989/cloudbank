// Package oidc implements the OIDC/SSO Authorization Code flow with PKCE: it
// builds the provider redirect and verifies the returned ID token. Identity→user
// mapping and session issuance live in the auth service; this package only speaks
// to the identity provider.
package oidc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/easly1989/cloudbank/server/internal/auth"
)

// Config is what the provider's client registration and CloudBank agree on.
type Config struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	// Scopes is space-separated; empty means "openid profile email".
	Scopes string
	// Name is the provider label shown on the sign-in button.
	Name string
}

// Service talks to one identity provider. Discovery (the provider's metadata
// and keys) happens on first use and is retried on the next use when it
// fails, so a provider that is down while CloudBank starts only delays SSO
// until it is back: a server that signs in through SSO alone (#620) must
// still start, for its access recovery codes to work.
type Service struct {
	cfg    Config
	scopes []string

	mu       sync.Mutex
	provider *gooidc.Provider
	verifier *gooidc.IDTokenVerifier
	oauth    *oauth2.Config
}

// AuthRequest is the per-login state the caller must round-trip through the
// browser (in a signed/sealed, short-lived cookie) between Start and Exchange.
type AuthRequest struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"` // PKCE code verifier
}

// New returns a Service for the provider. It does not reach the provider:
// call Discover to find out at startup whether it answers.
func New(cfg Config) *Service {
	sc := strings.Fields(cfg.Scopes)
	if len(sc) == 0 {
		sc = []string{gooidc.ScopeOpenID, "profile", "email"}
	}
	return &Service{cfg: cfg, scopes: sc}
}

// Discover fetches the provider's metadata unless it already has it. An error
// means the provider is misconfigured or unreachable right now; the next
// Start or Exchange tries again.
func (s *Service) Discover(ctx context.Context) error {
	_, _, err := s.client(ctx)
	return err
}

func (s *Service) client(ctx context.Context) (*oauth2.Config, *gooidc.IDTokenVerifier, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.oauth != nil {
		return s.oauth, s.verifier, nil
	}
	provider, err := gooidc.NewProvider(ctx, s.cfg.Issuer)
	if err != nil {
		return nil, nil, fmt.Errorf("oidc: discover %q: %w", s.cfg.Issuer, err)
	}
	s.provider = provider
	s.verifier = provider.Verifier(&gooidc.Config{ClientID: s.cfg.ClientID})
	s.oauth = &oauth2.Config{
		ClientID:     s.cfg.ClientID,
		ClientSecret: s.cfg.ClientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  s.cfg.RedirectURL,
		Scopes:       s.scopes,
	}
	return s.oauth, s.verifier, nil
}

// Name is the provider label shown on the sign-in button.
func (s *Service) Name() string { return s.cfg.Name }

// Start builds a fresh AuthRequest (state, nonce, PKCE verifier) and the provider
// authorization URL to redirect the browser to. It fails when the provider
// cannot be discovered.
func (s *Service) Start(ctx context.Context) (AuthRequest, string, error) {
	oc, _, err := s.client(ctx)
	if err != nil {
		return AuthRequest{}, "", err
	}
	req := AuthRequest{
		State:    oauth2.GenerateVerifier(),
		Nonce:    oauth2.GenerateVerifier(),
		Verifier: oauth2.GenerateVerifier(),
	}
	url := oc.AuthCodeURL(req.State,
		gooidc.Nonce(req.Nonce),
		oauth2.S256ChallengeOption(req.Verifier),
	)
	return req, url, nil
}

// Exchange completes the flow: swaps the authorization code for tokens, verifies
// the ID token (signature via JWKS, issuer, audience, expiry) and the nonce, and
// returns the verified claims.
func (s *Service) Exchange(ctx context.Context, req AuthRequest, code string) (auth.OIDCClaims, error) {
	oc, verifier, err := s.client(ctx)
	if err != nil {
		return auth.OIDCClaims{}, err
	}
	tok, err := oc.Exchange(ctx, code, oauth2.VerifierOption(req.Verifier))
	if err != nil {
		return auth.OIDCClaims{}, fmt.Errorf("oidc: token exchange: %w", err)
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok || rawID == "" {
		return auth.OIDCClaims{}, errors.New("oidc: no id_token in token response")
	}
	idToken, err := verifier.Verify(ctx, rawID)
	if err != nil {
		return auth.OIDCClaims{}, fmt.Errorf("oidc: verify id_token: %w", err)
	}
	if idToken.Nonce != req.Nonce {
		return auth.OIDCClaims{}, errors.New("oidc: nonce mismatch")
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return auth.OIDCClaims{}, fmt.Errorf("oidc: parse claims: %w", err)
	}
	out := auth.OIDCClaims{
		Issuer:        idToken.Issuer,
		Subject:       idToken.Subject,
		Email:         claims.Email,
		EmailVerified: claims.EmailVerified,
		Name:          claims.Name,
	}
	if out.Email == "" {
		// Some providers keep the ID token minimal and give the email only at
		// the userinfo endpoint (Authelia since 4.39, by default).
		if err := s.fillFromUserInfo(ctx, tok, &out); err != nil {
			return auth.OIDCClaims{}, err
		}
	}
	return out, nil
}

// fillFromUserInfo reads the email from the provider's userinfo endpoint, for
// the same subject the verified ID token named.
func (s *Service) fillFromUserInfo(ctx context.Context, tok *oauth2.Token, c *auth.OIDCClaims) error {
	s.mu.Lock()
	provider := s.provider
	s.mu.Unlock()
	if provider.UserInfoEndpoint() == "" {
		return nil
	}
	info, err := provider.UserInfo(ctx, oauth2.StaticTokenSource(tok))
	if err != nil {
		return fmt.Errorf("oidc: userinfo: %w", err)
	}
	if info.Subject != c.Subject {
		return errors.New("oidc: userinfo is for another subject")
	}
	c.Email = info.Email
	c.EmailVerified = info.EmailVerified
	if c.Name == "" {
		var extra struct {
			Name string `json:"name"`
		}
		if err := info.Claims(&extra); err == nil {
			c.Name = extra.Name
		}
	}
	return nil
}
