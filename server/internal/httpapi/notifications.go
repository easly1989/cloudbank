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
	r.Get("/notifications/channels", h.channels)
	r.Put("/notifications/channels/{channel}", h.saveChannel)
	r.Delete("/notifications/channels/{channel}", h.deleteChannel)
	r.Post("/notifications/channels/{channel}/test", h.testChannel)
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

type channelJSON struct {
	Channel     notify.Channel `json:"channel"`
	Available   bool           `json:"available"`
	Configured  bool           `json:"configured"`
	Target      string         `json:"target"`
	HasSecret   bool           `json:"hasSecret"`
	LastError   string         `json:"lastError"`
	LastErrorAt *string        `json:"lastErrorAt"`
	LastOKAt    *string        `json:"lastOkAt"`
}

func orNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (h *notificationHandlers) channels(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	chans, err := h.svc.AddressedChannels(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list notification channels")
		return
	}
	out := make([]channelJSON, 0, len(chans))
	for _, c := range chans {
		out = append(out, channelJSON{
			Channel: c.Channel, Available: c.Available, Configured: c.Configured, Target: c.Target,
			HasSecret: c.HasSecret, LastError: c.LastError, LastErrorAt: orNull(c.LastErrorAt), LastOKAt: orNull(c.LastOKAt),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": out})
}

func (h *notificationHandlers) saveChannel(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body struct {
		Target *string `json:"target"`
		Secret *string `json:"secret"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	err := h.svc.SaveChannel(r.Context(), u.ID, u.IsAdmin, notify.Channel(chi.URLParam(r, "channel")), body.Target, body.Secret)
	switch {
	case errors.Is(err, notify.ErrChannelUnavailable):
		writeError(w, http.StatusNotFound, "not_found", "channel not available")
	case errors.Is(err, notify.ErrLocalTarget):
		writeError(w, http.StatusBadRequest, "local_network", "only an administrator can send to the local network")
	case errors.Is(err, notify.ErrBadTarget):
		writeError(w, http.StatusBadRequest, "invalid", "invalid address")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the channel")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *notificationHandlers) deleteChannel(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	err := h.svc.DeleteChannel(r.Context(), u.ID, notify.Channel(chi.URLParam(r, "channel")))
	switch {
	case errors.Is(err, notify.ErrChannelUnavailable):
		writeError(w, http.StatusNotFound, "not_found", "channel not available")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not remove the channel")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *notificationHandlers) testChannel(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	err := h.svc.TestChannel(r.Context(), u.ID, u.Locale, notify.Channel(chi.URLParam(r, "channel")))
	var de *notify.DeliveryError
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case errors.As(err, &de):
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": de.Error()})
	case errors.Is(err, notify.ErrChannelUnavailable), errors.Is(err, notify.ErrNotSetUp):
		writeError(w, http.StatusNotFound, "not_found", "channel not set up")
	case errors.Is(err, notify.ErrTooSoon):
		writeError(w, http.StatusTooManyRequests, "rate_limited", "a test was sent moments ago, try again shortly")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not send the test")
	}
}
