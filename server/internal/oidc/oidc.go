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

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/easly1989/cloudbank/server/internal/auth"
)

// Service wraps a discovered OIDC provider and the OAuth2 client configuration.
type Service struct {
	verifier *gooidc.IDTokenVerifier
	oauth    oauth2.Config
	name     string
}

// AuthRequest is the per-login state the caller must round-trip through the
// browser (in a signed/sealed, short-lived cookie) between Start and Exchange.
type AuthRequest struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"` // PKCE code verifier
}

// New discovers the issuer and returns a configured Service. It performs a
// network call (OIDC discovery); an error means the provider is misconfigured or
// unreachable and the caller should treat OIDC as disabled.
func New(ctx context.Context, issuer, clientID, clientSecret, redirectURL, scopes, name string) (*Service, error) {
	provider, err := gooidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc: discover %q: %w", issuer, err)
	}
	sc := strings.Fields(scopes)
	if len(sc) == 0 {
		sc = []string{gooidc.ScopeOpenID, "profile", "email"}
	}
	return &Service{
		verifier: provider.Verifier(&gooidc.Config{ClientID: clientID}),
		oauth: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  redirectURL,
			Scopes:       sc,
		},
		name: name,
	}, nil
}

// Name is the provider label shown on the sign-in button.
func (s *Service) Name() string { return s.name }

// Start builds a fresh AuthRequest (state, nonce, PKCE verifier) and the provider
// authorization URL to redirect the browser to.
func (s *Service) Start() (AuthRequest, string) {
	req := AuthRequest{
		State:    oauth2.GenerateVerifier(),
		Nonce:    oauth2.GenerateVerifier(),
		Verifier: oauth2.GenerateVerifier(),
	}
	url := s.oauth.AuthCodeURL(req.State,
		gooidc.Nonce(req.Nonce),
		oauth2.S256ChallengeOption(req.Verifier),
	)
	return req, url
}

// Exchange completes the flow: swaps the authorization code for tokens, verifies
// the ID token (signature via JWKS, issuer, audience, expiry) and the nonce, and
// returns the verified claims.
func (s *Service) Exchange(ctx context.Context, req AuthRequest, code string) (auth.OIDCClaims, error) {
	tok, err := s.oauth.Exchange(ctx, code, oauth2.VerifierOption(req.Verifier))
	if err != nil {
		return auth.OIDCClaims{}, fmt.Errorf("oidc: token exchange: %w", err)
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok || rawID == "" {
		return auth.OIDCClaims{}, errors.New("oidc: no id_token in token response")
	}
	idToken, err := s.verifier.Verify(ctx, rawID)
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
	return auth.OIDCClaims{
		Issuer:        idToken.Issuer,
		Subject:       idToken.Subject,
		Email:         claims.Email,
		EmailVerified: claims.EmailVerified,
		Name:          claims.Name,
	}, nil
}
