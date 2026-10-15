package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/mailingest"
)

// mailHandlers serves the wallet-scoped bank-mail endpoints (#654).
type mailHandlers struct {
	svc *mailingest.Service
}

func (h *mailHandlers) walletRoutes(r chi.Router) {
	r.Get("/mail", h.overview)
	r.Post("/mail/microsoft", h.startMicrosoft)
	r.Post("/mail/microsoft/{flowId}/poll", h.pollMicrosoft)
	r.Route("/mail/mailboxes/{mailboxId}", func(r chi.Router) {
		r.Patch("/", h.update)
		r.Delete("/", h.remove)
		r.Get("/folders", h.folders)
		r.Post("/check", h.check)
		r.Get("/messages", h.messages)
	})
}

func (h *mailHandlers) mailboxID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "mailboxId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid", "invalid mailbox id")
		return 0, false
	}
	return id, true
}

func (h *mailHandlers) writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mailingest.ErrUnavailable):
		writeError(w, http.StatusConflict, "unavailable", "reading bank mails needs CB_SECRET_KEY on the server")
	case errors.Is(err, mailingest.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "not found")
	case errors.Is(err, mailingest.ErrFlowNotFound):
		writeError(w, http.StatusNotFound, "flow_not_found", "this sign-in is over; start again")
	case errors.Is(err, mailingest.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid", strings.TrimPrefix(err.Error(), "mailingest: "))
	case errors.Is(err, mailingest.ErrReauth):
		writeError(w, http.StatusConflict, "reauth", "sign in to Microsoft again")
	case errors.Is(err, mailingest.ErrLogin):
		writeError(w, http.StatusBadGateway, "login_refused", "the mail server refused the login")
	default:
		// The mail server's or Microsoft's own words, so a failing mailbox can
		// be diagnosed instead of showing a bare 502.
		slog.Warn("mail: request failed", "error", err)
		writeError(w, http.StatusBadGateway, "mail_error", strings.TrimPrefix(err.Error(), "mailingest: "))
	}
}

func (h *mailHandlers) overview(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	boxes, err := h.svc.ListMailboxes(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list mailboxes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": h.svc.Available(), "mailboxes": boxes})
}

func (h *mailHandlers) startMicrosoft(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		MailboxID int64 `json:"mailboxId"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	fl, err := h.svc.StartMicrosoft(r.Context(), wl.ID, userFromContext(r.Context()).ID, body.MailboxID)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, fl)
}

func (h *mailHandlers) pollMicrosoft(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	st, err := h.svc.PollMicrosoft(r.Context(), wl.ID, userFromContext(r.Context()).ID, chi.URLParam(r, "flowId"))
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *mailHandlers) update(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.mailboxID(w, r)
	if !ok {
		return
	}
	var body struct {
		Folder *string `json:"folder"`
		Paused *bool   `json:"paused"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	mb, err := h.svc.Update(r.Context(), wl.ID, id, body.Folder, body.Paused)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, mb)
}

func (h *mailHandlers) remove(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.mailboxID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Remove(r.Context(), wl.ID, id); err != nil {
		h.writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *mailHandlers) folders(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.mailboxID(w, r)
	if !ok {
		return
	}
	folders, err := h.svc.Folders(r.Context(), wl.ID, id)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"folders": folders})
}

func (h *mailHandlers) check(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.mailboxID(w, r)
	if !ok {
		return
	}
	res, err := h.svc.Check(r.Context(), wl.ID, id)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *mailHandlers) messages(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := h.mailboxID(w, r)
	if !ok {
		return
	}
	msgs, err := h.svc.Messages(r.Context(), wl.ID, id)
	if err != nil {
		h.writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, msgs)
}
