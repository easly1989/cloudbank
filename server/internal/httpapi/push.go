package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/push"
)

// pushHandlers serves Web Push subscription management (inside requireAuth).
type pushHandlers struct {
	svc *push.Service
}

func (h *pushHandlers) routes(r chi.Router) {
	r.Get("/push/publickey", h.publicKey)
	r.Post("/push/subscribe", h.subscribe)
	r.Post("/push/unsubscribe", h.unsubscribe)
}

func (h *pushHandlers) publicKey(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": h.svc.PublicKey()})
}

// pushSubscription mirrors the browser's PushSubscription JSON shape.
type pushSubscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func (h *pushHandlers) subscribe(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body pushSubscription
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.svc.Subscribe(r.Context(), u.ID, body.Endpoint, body.Keys.P256dh, body.Keys.Auth); err != nil {
		writeError(w, http.StatusBadRequest, "invalid", "invalid push subscription")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *pushHandlers) unsubscribe(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.svc.Unsubscribe(r.Context(), u.ID, body.Endpoint); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not unsubscribe")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
