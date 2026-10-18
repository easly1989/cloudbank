package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/notify"
)

// notificationHandlers serve the bell and the notification settings (#685),
// inside requireAuth. Everything is the signed-in user's own: a notification
// about a wallet is listed only while they are a member of it.
type notificationHandlers struct {
	svc *notify.Service
}

func (h *notificationHandlers) routes(r chi.Router) {
	r.Get("/notifications", h.list)
	r.Post("/notifications/{id}/read", h.markRead)
	r.Post("/notifications/read-all", h.markAllRead)
	r.Get("/notifications/preferences", h.preferences)
	r.Put("/notifications/preferences", h.setPreference)
}

type notificationJSON struct {
	ID        int64       `json:"id"`
	Kind      notify.Kind `json:"kind"`
	Title     string      `json:"title"`
	Body      string      `json:"body"`
	URL       string      `json:"url"`
	WalletID  *int64      `json:"walletId"`
	CreatedAt string      `json:"createdAt"`
	Read      bool        `json:"read"`
}

func (h *notificationHandlers) list(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	items, unread, err := h.svc.List(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list notifications")
		return
	}
	out := make([]notificationJSON, 0, len(items))
	for _, n := range items {
		j := notificationJSON{ID: n.ID, Kind: n.Kind, Title: n.Title, Body: n.Body, URL: n.URL, CreatedAt: n.CreatedAt, Read: n.Read}
		if n.WalletID != 0 {
			j.WalletID = &n.WalletID
		}
		out = append(out, j)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "unread": unread})
}

func (h *notificationHandlers) markRead(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid", "invalid notification id")
		return
	}
	if err := h.svc.MarkRead(r.Context(), u.ID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not mark the notification read")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *notificationHandlers) markAllRead(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	if err := h.svc.MarkAllRead(r.Context(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not mark the notifications read")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type notificationPrefJSON struct {
	Kind     notify.Kind             `json:"kind"`
	Group    notify.Group            `json:"group"`
	Channels map[notify.Channel]bool `json:"channels"`
}

func (h *notificationHandlers) preferences(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	prefs, err := h.svc.Preferences(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read notification preferences")
		return
	}
	out := make([]notificationPrefJSON, 0, len(prefs))
	for _, p := range prefs {
		out = append(out, notificationPrefJSON{Kind: p.Kind, Group: p.Group, Channels: p.Channels})
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": out})
}

func (h *notificationHandlers) setPreference(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body struct {
		Kind    notify.Kind    `json:"kind"`
		Channel notify.Channel `json:"channel"`
		Enabled *bool          `json:"enabled"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Enabled == nil {
		writeError(w, http.StatusBadRequest, "invalid", "enabled is required")
		return
	}
	err := h.svc.SetPreference(r.Context(), u.ID, body.Kind, body.Channel, *body.Enabled)
	switch {
	case errors.Is(err, notify.ErrUnknownEvent):
		writeError(w, http.StatusBadRequest, "invalid", "unknown event or channel")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the notification preference")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
