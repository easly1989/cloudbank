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
	r.Put("/notifications/digest", h.setDigest)
	r.Get("/notifications/channels", h.channels)
	r.Put("/notifications/channels/{channel}", h.saveChannel)
	r.Delete("/notifications/channels/{channel}", h.deleteChannel)
	r.Post("/notifications/channels/{channel}/test", h.testChannel)
	r.Post("/notifications/channels/{channel}/code", h.resendCode)
	r.Post("/notifications/channels/{channel}/confirm", h.confirmChannel)
	r.Get("/notifications/settings", h.settings)
	r.Put("/notifications/settings", h.setSettings)
}

// walletRoutes are the reader's choices about one wallet (#691), inside
// walletContext: whether they hear from it, and their thresholds on its
// accounts.
func (h *notificationHandlers) walletRoutes(r chi.Router) {
	r.Get("/notifications", h.walletSettings)
	r.Put("/notifications", h.setWalletIncluded)
	r.Put("/notifications/thresholds/{accountId}", h.setThreshold)
}

func (h *notificationHandlers) settings(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.GetSettings(r.Context(), userFromContext(r.Context()).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the notification settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"amountsOutside": st.AmountsOutside, "timezone": st.Timezone, "digestAt": st.DigestAt,
		"quietHours": st.QuietHours, "quietFrom": st.QuietFrom, "quietTo": st.QuietTo, "reviewDays": st.ReviewDays,
	})
}

// setSettings changes the settings the body names and keeps the others.
func (h *notificationHandlers) setSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AmountsOutside *bool   `json:"amountsOutside"`
		Timezone       *string `json:"timezone"`
		DigestAt       *string `json:"digestAt"`
		QuietHours     *bool   `json:"quietHours"`
		QuietFrom      *string `json:"quietFrom"`
		QuietTo        *string `json:"quietTo"`
		ReviewDays     *int    `json:"reviewDays"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	userID := userFromContext(r.Context()).ID
	st, err := h.svc.GetSettings(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the notification settings")
		return
	}
	set := func(dst *string, v *string) {
		if v != nil {
			*dst = *v
		}
	}
	if body.AmountsOutside != nil {
		st.AmountsOutside = *body.AmountsOutside
	}
	if body.QuietHours != nil {
		st.QuietHours = *body.QuietHours
	}
	if body.ReviewDays != nil {
		st.ReviewDays = *body.ReviewDays
	}
	set(&st.Timezone, body.Timezone)
	set(&st.DigestAt, body.DigestAt)
	set(&st.QuietFrom, body.QuietFrom)
	set(&st.QuietTo, body.QuietTo)
	switch err := h.svc.SetSettings(r.Context(), userID, st); {
	case errors.Is(err, notify.ErrBadSettings):
		writeError(w, http.StatusBadRequest, "invalid", err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the notification settings")
	default:
		h.settings(w, r)
	}
}

type thresholdJSON struct {
	AccountID int64  `json:"accountId"`
	LargeOver *int64 `json:"largeOver"`
	LowUnder  *int64 `json:"lowUnder"`
}

func (h *notificationHandlers) walletSettings(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	st, err := h.svc.Wallet(r.Context(), userFromContext(r.Context()).ID, wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the notification settings")
		return
	}
	out := make([]thresholdJSON, 0, len(st.Thresholds))
	for _, t := range st.Thresholds {
		out = append(out, thresholdJSON{AccountID: t.AccountID, LargeOver: t.LargeOver, LowUnder: t.LowUnder})
	}
	writeJSON(w, http.StatusOK, map[string]any{"included": st.Included, "thresholds": out})
}

func (h *notificationHandlers) setWalletIncluded(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		Included *bool `json:"included"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Included == nil {
		writeError(w, http.StatusBadRequest, "invalid", "included is required")
		return
	}
	if err := h.svc.SetWalletIncluded(r.Context(), userFromContext(r.Context()).ID, wl.ID, *body.Included); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not save the notification settings")
		return
	}
	h.walletSettings(w, r)
}

func (h *notificationHandlers) setThreshold(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "accountId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "no such account")
		return
	}
	var body struct {
		LargeOver *int64 `json:"largeOver"`
		LowUnder  *int64 `json:"lowUnder"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	err = h.svc.SetThreshold(r.Context(), userFromContext(r.Context()).ID, wl.ID,
		notify.Threshold{AccountID: id, LargeOver: body.LargeOver, LowUnder: body.LowUnder})
	switch {
	case errors.Is(err, notify.ErrUnknownAccount):
		writeError(w, http.StatusNotFound, "not_found", "no such account")
	case errors.Is(err, notify.ErrBadThreshold):
		writeError(w, http.StatusBadRequest, "invalid", "a large expense threshold must be above zero")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the threshold")
	default:
		writeJSON(w, http.StatusOK, thresholdJSON{AccountID: id, LargeOver: body.LargeOver, LowUnder: body.LowUnder})
	}
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
	Digest   bool                    `json:"digest"`
}

func (h *notificationHandlers) preferences(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	prefs, err := h.svc.Preferences(r.Context(), u.ID, u.IsAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read notification preferences")
		return
	}
	out := make([]notificationPrefJSON, 0, len(prefs))
	for _, p := range prefs {
		out = append(out, notificationPrefJSON{Kind: p.Kind, Group: p.Group, Channels: p.Channels, Digest: p.Digest})
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
	case errors.Is(err, notify.ErrAlwaysOn):
		writeError(w, http.StatusBadRequest, "always_on", "security events always reach the bell")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the notification preference")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// setDigest collects one event in the daily digest, or sends it at once.
func (h *notificationHandlers) setDigest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind   notify.Kind `json:"kind"`
		Digest *bool       `json:"digest"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Digest == nil {
		writeError(w, http.StatusBadRequest, "invalid", "digest is required")
		return
	}
	switch err := h.svc.SetDigest(r.Context(), userFromContext(r.Context()).ID, body.Kind, *body.Digest); {
	case errors.Is(err, notify.ErrUnknownEvent):
		writeError(w, http.StatusBadRequest, "invalid", "unknown event")
	case errors.Is(err, notify.ErrAlwaysImmediate):
		writeError(w, http.StatusBadRequest, "always_immediate", "this event cannot go in the digest")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the notification preference")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

type channelJSON struct {
	Channel     notify.Channel        `json:"channel"`
	Available   bool                  `json:"available"`
	Configured  bool                  `json:"configured"`
	Target      string                `json:"target"`
	HasSecret   bool                  `json:"hasSecret"`
	Server      string                `json:"server"`
	Shared      bool                  `json:"shared"`
	Bot         string                `json:"bot"`
	Options     notify.ChannelOptions `json:"options"`
	Pending     bool                  `json:"pending"`
	Link        string                `json:"link,omitempty"`
	GroupLink   string                `json:"groupLink,omitempty"`
	LastError   string                `json:"lastError"`
	LastErrorAt *string               `json:"lastErrorAt"`
	LastOKAt    *string               `json:"lastOkAt"`
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
			HasSecret: c.HasSecret, Server: c.Server, Shared: c.Shared, Bot: c.Bot, Options: c.Options,
			Pending: c.Pending, Link: c.Link, GroupLink: c.GroupLink,
			LastError: c.LastError, LastErrorAt: orNull(c.LastErrorAt), LastOKAt: orNull(c.LastOKAt),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": out})
}

func (h *notificationHandlers) saveChannel(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body struct {
		Target  *string                `json:"target"`
		Secret  *string                `json:"secret"`
		Server  *string                `json:"server"`
		Options *notify.ChannelOptions `json:"options"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	err := h.svc.SaveChannel(r.Context(), u.ID, u.IsAdmin, notify.Channel(chi.URLParam(r, "channel")),
		notify.ChannelInput{Target: body.Target, Secret: body.Secret, Server: body.Server, Options: body.Options, Lang: u.Locale})
	switch {
	case errors.Is(err, notify.ErrChannelUnavailable):
		writeError(w, http.StatusNotFound, "not_found", "channel not available")
	case errors.Is(err, notify.ErrLocalTarget):
		writeError(w, http.StatusBadRequest, "local_network", "only an administrator can send to the local network")
	case errors.Is(err, notify.ErrBadTarget):
		writeError(w, http.StatusBadRequest, "invalid", "invalid address")
	case err != nil:
		writeCodeError(w, err, "could not save the channel")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// writeCodeError answers a failure to send a confirmation code (#716).
func writeCodeError(w http.ResponseWriter, err error, internal string) {
	var de *notify.DeliveryError
	switch {
	case errors.As(err, &de):
		writeError(w, http.StatusBadGateway, "delivery_failed", de.Error())
	case errors.Is(err, notify.ErrNotInvited):
		writeError(w, http.StatusConflict, "not_invited", "invite the bot to the room first")
	case errors.Is(err, notify.ErrTooSoon):
		writeError(w, http.StatusTooManyRequests, "rate_limited", "a code was sent moments ago, try again shortly")
	case errors.Is(err, notify.ErrHourlyLimit):
		writeError(w, http.StatusTooManyRequests, "hourly_limit", "too many messages this hour")
	default:
		writeError(w, http.StatusInternalServerError, "internal", internal)
	}
}

func (h *notificationHandlers) resendCode(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	err := h.svc.ResendCode(r.Context(), u.ID, u.Locale, notify.Channel(chi.URLParam(r, "channel")))
	switch {
	case errors.Is(err, notify.ErrChannelUnavailable), errors.Is(err, notify.ErrNotSetUp):
		writeError(w, http.StatusNotFound, "not_found", "no code is pending on that channel")
	case err != nil:
		writeCodeError(w, err, "could not send a new code")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *notificationHandlers) confirmChannel(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body struct {
		Code string `json:"code"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	err := h.svc.ConfirmChannel(r.Context(), u.ID, notify.Channel(chi.URLParam(r, "channel")), body.Code)
	switch {
	case errors.Is(err, notify.ErrChannelUnavailable), errors.Is(err, notify.ErrNotSetUp):
		writeError(w, http.StatusNotFound, "not_found", "no code is pending on that channel")
	case errors.Is(err, notify.ErrWrongCode):
		writeError(w, http.StatusBadRequest, "wrong_code", "that is not the code")
	case errors.Is(err, notify.ErrCodeExpired):
		writeError(w, http.StatusGone, "code_expired", "the code expired, ask for a new one")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not confirm the channel")
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
	case errors.Is(err, notify.ErrHourlyLimit):
		writeError(w, http.StatusTooManyRequests, "hourly_limit", "too many messages this hour")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not send the test")
	}
}
