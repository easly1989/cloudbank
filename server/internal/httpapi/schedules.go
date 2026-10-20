package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
)

// scheduleHandlers serves wallet-scoped schedule endpoints (mounted inside the
// walletContext middleware).
type scheduleHandlers struct {
	svc *schedule.Service
}

func (h *scheduleHandlers) walletRoutes(r chi.Router) {
	r.Get("/schedules", h.list)
	r.Post("/schedules", h.create)
	r.Get("/schedules/upcoming", h.upcoming)
	r.Get("/schedules/calendar", h.calendar)
	r.Get("/schedules/proposals", h.proposals)
	r.Post("/schedules/proposals/ignore", h.ignoreProposal)
	r.Get("/schedules/calendar-feed", h.getFeed)
	r.Post("/schedules/calendar-feed", h.newFeed)
	r.Delete("/schedules/calendar-feed", h.deleteFeed)
	r.Get("/schedules/calendar.ics", h.downloadICS)
	r.Route("/schedules/{scheduleId}", func(r chi.Router) {
		r.Get("/", h.get)
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
		r.Post("/post", h.postNow)
		r.Post("/skip", h.skip)
		r.Post("/apply-payee", h.applyPayee)
	})
}

type scheduleInput struct {
	TemplateID  int64  `json:"templateId"`
	Unit        string `json:"unit"`
	EveryN      int    `json:"everyN"`
	NextDue     string `json:"nextDue"`
	WeekendMode int    `json:"weekendMode"`
	Remaining   *int64 `json:"remaining"`
	PostAdvance int    `json:"postAdvance"`
	AutoPost    bool   `json:"autoPost"`
}

func (in scheduleInput) toServiceInput() schedule.Input {
	return schedule.Input{
		TemplateID: in.TemplateID, Unit: in.Unit, EveryN: in.EveryN, NextDue: in.NextDue,
		WeekendMode: in.WeekendMode, Remaining: in.Remaining, PostAdvance: in.PostAdvance,
		AutoPost: in.AutoPost,
	}
}

func (h *scheduleHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	out, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list schedules")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *scheduleHandlers) upcoming(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	before := r.URL.Query().Get("before")
	if before == "" {
		before = time.Now().UTC().AddDate(0, 0, 30).Format("2006-01-02")
	}
	out, err := h.svc.Upcoming(r.Context(), wl.ID, before)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list schedules")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// calendar lists the occurrences of the wallet's schedules between from and to.
// today is the reader's civil date, which decides what is overdue; it defaults
// to the server's.
func (h *scheduleHandlers) calendar(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	q := r.URL.Query()
	today, ok := readerToday(w, r)
	if !ok {
		return
	}
	out, err := h.svc.Calendar(r.Context(), wl.ID, q.Get("from"), q.Get("to"), today)
	if errors.Is(err, schedule.ErrInvalidRange) {
		writeError(w, http.StatusBadRequest, "invalid_range", "from and to must be dates at most 100 days apart")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load the calendar")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// readerToday is the reader's civil date from ?today=, or the server's.
func readerToday(w http.ResponseWriter, r *http.Request) (time.Time, bool) {
	s := r.URL.Query().Get("today")
	if s == "" {
		return time.Now().UTC(), true
	}
	d, err := schedule.ParseDate(s)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_date", "invalid today (want YYYY-MM-DD)")
		return time.Time{}, false
	}
	return d, true
}

// proposals lists the recurring payments found in the wallet's transactions
// that no schedule covers (#693).
func (h *scheduleHandlers) proposals(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	today, ok := readerToday(w, r)
	if !ok {
		return
	}
	out, err := h.svc.Proposals(r.Context(), wl.ID, today)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not find recurring payments")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ignoreProposal stops proposing a payee at a cadence.
func (h *scheduleHandlers) ignoreProposal(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in struct {
		PayeeID int64  `json:"payeeId"`
		Cadence string `json:"cadence"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !mapError(w, h.svc.Ignore(r.Context(), wl.ID, in.PayeeID, in.Cadence), "could not ignore the payment",
		errCase{schedule.ErrInvalidCadence, http.StatusBadRequest, "invalid_cadence", "cadence must be weekly, monthly, quarterly or yearly"},
		errCase{schedule.ErrPayee, http.StatusBadRequest, "invalid_payee", "payee not found in this wallet"},
	) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// getFeed is the reader's private calendar address for the wallet (#694), or
// null when they have none.
func (h *scheduleHandlers) getFeed(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	f, err := h.svc.FeedOf(r.Context(), userFromContext(r.Context()).ID, wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the calendar address")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"feed": f})
}

// newFeed makes the reader's address, or gives it a new token so the old one
// stops working.
func (h *scheduleHandlers) newFeed(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	f, err := h.svc.NewFeed(r.Context(), userFromContext(r.Context()).ID, wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not make the calendar address")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"feed": f})
}

// deleteFeed turns the reader's address off.
func (h *scheduleHandlers) deleteFeed(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	if err := h.svc.DeleteFeed(r.Context(), userFromContext(r.Context()).ID, wl.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not turn the calendar address off")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// downloadICS is the same calendar as a file, for a reader signed in.
func (h *scheduleHandlers) downloadICS(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	ics, err := h.svc.ICS(r.Context(), wl.ID, wl.Title, time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build the calendar")
		return
	}
	writeICS(w, ics, "attachment")
}

// feedICS serves a calendar at its private address, outside the API and its
// session: a calendar app sends no cookie, so the token in the path is the
// whole credential. It is the one schedule route outside the wallet subtree,
// and an unknown, regenerated or turned-off address answers 404 (#694).
func feedICS(svc *schedule.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "feedId"), 10, 64)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ics, err := svc.FeedICS(r.Context(), id, chi.URLParam(r, "token"), time.Now().UTC())
		if errors.Is(err, schedule.ErrFeedNotFound) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, "could not build the calendar", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Referrer-Policy", "no-referrer")
		writeICS(w, ics, "inline")
	}
}

func writeICS(w http.ResponseWriter, ics []byte, disposition string) {
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", disposition+`; filename="cloudbank.ics"`)
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write(ics)
}

func (h *scheduleHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in scheduleInput
	if !decodeJSON(w, r, &in) {
		return
	}
	sc, err := h.svc.Create(r.Context(), wl.ID, in.toServiceInput())
	if !writeScheduleError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, sc)
}

func (h *scheduleHandlers) get(w http.ResponseWriter, r *http.Request) {
	sc, ok := h.scheduleFromPath(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, sc)
}

func (h *scheduleHandlers) update(w http.ResponseWriter, r *http.Request) {
	current, ok := h.scheduleFromPath(w, r)
	if !ok {
		return
	}
	wl, _ := walletFromContext(r.Context())
	var in scheduleInput
	if !decodeJSON(w, r, &in) {
		return
	}
	sc, err := h.svc.Update(r.Context(), wl.ID, current.ID, in.toServiceInput())
	if !writeScheduleError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, sc)
}

func (h *scheduleHandlers) delete(w http.ResponseWriter, r *http.Request) {
	sc, ok := h.scheduleFromPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), sc.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete schedule")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *scheduleHandlers) postNow(w http.ResponseWriter, r *http.Request) {
	sc, ok := h.scheduleFromPath(w, r)
	if !ok {
		return
	}
	// The body is optional: without one, the occurrence is posted as the
	// schedule describes it.
	var ov *schedule.Override
	if r.ContentLength > 0 {
		var in struct {
			Amount *int64  `json:"amount"`
			Date   *string `json:"date"`
			Status *int    `json:"status"`
		}
		if !decodeJSON(w, r, &in) {
			return
		}
		ov = &schedule.Override{Amount: in.Amount, Date: in.Date, Status: in.Status}
	}
	err := h.svc.PostNowWith(r.Context(), sc.ID, ov)
	if !mapError(w, err, "could not post schedule",
		errCase{schedule.ErrInvalidDate, http.StatusBadRequest, "invalid_date", "invalid date (want YYYY-MM-DD)"},
		errCase{schedule.ErrSplitAmount, http.StatusBadRequest, "split_amount", "a split schedule's amount is changed in the schedule"},
		errCase{transaction.ErrInvalidStatus, http.StatusBadRequest, "invalid_status", "invalid status"},
		errCase{transfer.ErrInvalidAmount, http.StatusBadRequest, "invalid_amount", "a transfer's amount must be an outflow"},
	) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *scheduleHandlers) skip(w http.ResponseWriter, r *http.Request) {
	sc, ok := h.scheduleFromPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.Skip(r.Context(), sc.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not skip schedule")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// applyPayee gives the schedule's payee to the transactions it registered
// without one (#723).
func (h *scheduleHandlers) applyPayee(w http.ResponseWriter, r *http.Request) {
	sc, ok := h.scheduleFromPath(w, r)
	if !ok {
		return
	}
	wl, _ := walletFromContext(r.Context())
	n, err := h.svc.ApplyPayee(r.Context(), wl.ID, sc.ID)
	if !writeScheduleError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"updated": n})
}

func (h *scheduleHandlers) scheduleFromPath(w http.ResponseWriter, r *http.Request) (schedule.Schedule, bool) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "scheduleId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "schedule not found")
		return schedule.Schedule{}, false
	}
	walletID, err := h.svc.WalletOf(r.Context(), id)
	if errors.Is(err, schedule.ErrNotFound) || (err == nil && walletID != wl.ID) {
		writeError(w, http.StatusNotFound, "not_found", "schedule not found")
		return schedule.Schedule{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load schedule")
		return schedule.Schedule{}, false
	}
	sc, err := h.svc.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load schedule")
		return schedule.Schedule{}, false
	}
	return sc, true
}

func writeScheduleError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "could not save schedule",
		errCase{schedule.ErrNotFound, http.StatusNotFound, "not_found", "schedule not found"},
		errCase{schedule.ErrInvalidUnit, http.StatusBadRequest, "invalid_unit", "invalid unit (day, week, month or year)"},
		errCase{schedule.ErrInvalidEveryN, http.StatusBadRequest, "invalid_every_n", "every_n must be at least 1"},
		errCase{schedule.ErrInvalidDate, http.StatusBadRequest, "invalid_date", "invalid next-due date (want YYYY-MM-DD)"},
		errCase{schedule.ErrTemplate, http.StatusBadRequest, "invalid_template", "template not found in this wallet"},
		errCase{schedule.ErrTemplateNoAcct, http.StatusBadRequest, "template_no_account", "template must target an account"},
		errCase{schedule.ErrPayeeRequired, http.StatusBadRequest, "payee_required", "an income or expense schedule needs a payee"},
	)
}
