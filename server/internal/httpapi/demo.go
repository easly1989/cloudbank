package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/demo"
)

// demoHandlers serves what only the demo build has: the one-click start, a
// setup status that never asks for an administrator, and the limits.
type demoHandlers struct {
	svc    *demo.Service
	secure bool
}

func (h *demoHandlers) routes(r chi.Router) {
	r.Get("/setup/status", h.setupStatus)
	r.Post("/demo/session", h.start)
}

// start makes a demo account for the visitor and signs them in.
func (h *demoHandlers) start(w http.ResponseWriter, r *http.Request) {
	ip := demo.Visitor(r.RemoteAddr, r.Header.Get("X-Forwarded-For"), h.svc.Limits().ProxyHops)
	u, token, err := h.svc.Start(r.Context(), ip, r.Header.Get("Accept-Language"), r.UserAgent())
	switch {
	case errors.Is(err, demo.ErrTooMany):
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many demos started from here, try again later")
		return
	case errors.Is(err, demo.ErrFull):
		writeError(w, http.StatusServiceUnavailable, "demo_full", "the demo is full right now, try again later")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not start the demo")
		return
	}
	writeSessionCookie(w, token, h.secure)
	writeJSON(w, http.StatusCreated, toUserResponse(u))
}

// setupStatus: a demo never has a first administrator to set up.
func (h *demoHandlers) setupStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"needsSetup": false})
}

// writeLimit answers a write a demo cap stopped.
func writeLimit(w http.ResponseWriter, what string) {
	writeError(w, http.StatusConflict, "demo_limit", "the demo allows no more "+what)
}

// limitBody caps every request body, imports included.
func (h *demoHandlers) limitBody(next http.Handler) http.Handler {
	limit := h.svc.Limits().MaxBody
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if limit > 0 && r.Body != nil {
			if r.ContentLength > limit {
				writeError(w, http.StatusRequestEntityTooLarge, "too_large", "the demo does not take a file this large")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		next.ServeHTTP(w, r)
	})
}

// newWallet refuses a wallet past the demo's cap, before it is made. The
// database refuses it too; this is the answer the reader can understand.
func (h *demoHandlers) newWallet(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		full, err := h.svc.WalletsFull(r.Context(), userFromContext(r.Context()).ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not check the demo limits")
			return
		}
		if full {
			writeLimit(w, "wallets")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// fullWallet refuses anything new in a wallet that holds as many transactions
// as the demo allows. Reading, editing and deleting still work, so the reader
// can make room.
func (h *demoHandlers) fullWallet(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			wl, _ := walletFromContext(r.Context())
			full, err := h.svc.WalletFull(r.Context(), wl.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal", "could not check the demo limits")
				return
			}
			if full {
				writeLimit(w, "transactions in this wallet")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
