package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/schedule"
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
	r.Route("/schedules/{scheduleId}", func(r chi.Router) {
		r.Get("/", h.get)
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
		r.Post("/post", h.postNow)
		r.Post("/skip", h.skip)
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
	if err := h.svc.PostNow(r.Context(), sc.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not post schedule")
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
	)
}
