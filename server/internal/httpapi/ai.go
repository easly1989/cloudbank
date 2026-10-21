package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/insight"
)

// aiErrorMessage renders an AI provider/parse error for the client. The user owns
// the AI provider (bring-your-own-key), so surfacing the reason (a provider
// 429/5xx, a timeout, an unparseable reply) is far more useful than a fixed
// string — matching how bank sync reports its failures. The provider's reply
// itself is never part of it (#543).
func aiErrorMessage(err error) string {
	msg := strings.TrimPrefix(err.Error(), "ai: ")
	if strings.TrimSpace(msg) == "" {
		return "the AI provider request failed"
	}
	return msg
}

// writeAIError answers for the errors every call to the model can end in: the
// AI, the job or the wallet switched off, the month's limit, the provider.
func writeAIError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ai.ErrNotConfigured):
		writeError(w, http.StatusBadRequest, "ai_disabled", "AI is not enabled")
	case errors.Is(err, ai.ErrLimit):
		writeError(w, http.StatusConflict, "ai_limit", "this month's AI request limit is reached")
	default:
		writeError(w, http.StatusBadGateway, "ai_error", aiErrorMessage(err))
	}
}

// aiHandlers serves the opt-in AI settings, its log, the suggestion endpoints
// and the reports.
type aiHandlers struct {
	svc      *ai.Service
	insights *insight.Service
}

// routes mounts the user-level AI endpoints (inside requireAuth).
func (h *aiHandlers) routes(r chi.Router) {
	r.Get("/ai/settings", h.getSettings)
	r.Put("/ai/settings", h.putSettings)
	r.Get("/ai/sends", h.listSends)
	r.Get("/ai/sends/{sendId}", h.getSend)
}

// walletRoutes mounts the wallet-scoped suggestion endpoints and the reports.
func (h *aiHandlers) walletRoutes(r chi.Router) {
	r.Post("/ai/suggest-category", h.suggestCategory)
	r.Post("/ai/parse-entry", h.parseEntry)
	r.Post("/ai/propose-categories", h.proposeCategories)
	if h.insights != nil {
		r.Get("/insights/reports", h.listReports)
		r.Post("/insights/reports", h.generateReport)
		r.Put("/insights/reports/{reportId}/feedback", h.reportFeedback)
		r.Get("/insights/proposals", h.listProposals)
		r.Post("/insights/proposals/{proposalId}/actions", h.proposalAction)
		r.Put("/insights/proposals/{proposalId}/feedback", h.proposalFeedback)
		r.Get("/insights/unusual", h.getUnusual)
		r.Post("/insights/unusual/{flagId}/fine", h.unusualFine)
		r.Put("/insights/unusual/feedback", h.unusualFeedback)
	}
}

func (h *aiHandlers) getSettings(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	st, err := h.svc.Settings(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load AI settings")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *aiHandlers) putSettings(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body struct {
		Enabled      bool         `json:"enabled"`
		BaseURL      string       `json:"baseUrl"`
		Model        string       `json:"model"`
		APIKey       *string      `json:"apiKey"` // omit to keep the stored key
		Features     *ai.Features `json:"features"`
		Schedule     *ai.Schedule `json:"schedule"`
		WalletsOff   []int64      `json:"walletsOff"`
		MonthlyLimit *int64       `json:"monthlyLimit"`
		Motion       *bool        `json:"motion"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	before, _ := h.svc.Settings(r.Context(), u.ID)
	st, err := h.svc.UpdateSettings(r.Context(), u.ID, u.IsAdmin, ai.SettingsInput{
		Enabled: body.Enabled, BaseURL: body.BaseURL, Model: body.Model, APIKey: body.APIKey,
		Features: body.Features, Schedule: body.Schedule, WalletsOff: body.WalletsOff, MonthlyLimit: body.MonthlyLimit, Motion: body.Motion,
	})
	switch {
	case errors.Is(err, ai.ErrLocalURL):
		writeError(w, http.StatusBadRequest, "ai_local_url", aiErrorMessage(err))
	case errors.Is(err, ai.ErrBadURL):
		writeError(w, http.StatusBadRequest, "ai_bad_url", aiErrorMessage(err))
	case errors.Is(err, ai.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid", aiErrorMessage(err))
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save AI settings")
	default:
		// Proposals just turned on come at once, not at the next run.
		turnedOn := func(was, is bool) bool { return st.Enabled && is && (!before.Enabled || !was) }
		if h.insights != nil && (turnedOn(before.Features.Budgets, st.Features.Budgets) ||
			turnedOn(before.Features.Subscriptions, st.Features.Subscriptions) ||
			turnedOn(before.Features.Savings, st.Features.Savings) ||
			turnedOn(before.Features.Goals, st.Features.Goals) ||
			turnedOn(before.Features.Rules, st.Features.Rules) ||
			turnedOn(before.Features.Unusual, st.Features.Unusual)) {
			ctx := context.WithoutCancel(r.Context())
			go func() {
				if err := h.insights.RunUser(ctx, u.ID); err != nil {
					slog.Warn("AI proposals", "err", err)
				}
			}()
		}
		writeJSON(w, http.StatusOK, st)
	}
}

func (h *aiHandlers) listSends(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	limit := int64(50)
	if v, err := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 64); err == nil && v >= 1 && v <= 200 {
		limit = v
	}
	sends, err := h.svc.Sends(r.Context(), u.ID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load what was sent")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sends": sends})
}

func (h *aiHandlers) getSend(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "sendId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	send, err := h.svc.SendOf(r.Context(), u.ID, id)
	if errors.Is(err, ai.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load what was sent")
		return
	}
	writeJSON(w, http.StatusOK, send)
}

func (h *aiHandlers) suggestCategory(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	var body struct {
		Payee   string `json:"payee"`
		Amount  string `json:"amount"`
		Confirm bool   `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	cat, err := h.svc.SuggestCategory(r.Context(), u.ID, wl.ID, body.Confirm, ai.SuggestInput{
		Payee: body.Payee, Amount: body.Amount,
	})
	if err != nil {
		writeAIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"category": cat})
}

func (h *aiHandlers) proposeCategories(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	var body struct {
		Confirm bool `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	out, err := h.svc.ProposeCategories(r.Context(), u.ID, wl.ID, body.Confirm)
	if err != nil {
		writeAIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"proposals": out})
}

func (h *aiHandlers) parseEntry(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	var body struct {
		Text    string `json:"text"`
		Confirm bool   `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	today := time.Now().UTC().Format("2006-01-02")
	entry, err := h.svc.ParseEntry(r.Context(), u.ID, wl.ID, body.Confirm, body.Text, today)
	if err != nil {
		writeAIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": entry})
}

// The reports are the asking user's alone: every query is by user and wallet.

func (h *aiHandlers) listReports(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	reports, err := h.insights.List(r.Context(), u.ID, wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load the reports")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reports": reports})
}

func (h *aiHandlers) generateReport(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	var body struct {
		Period  string `json:"period"`
		Confirm bool   `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	rep, err := h.insights.Generate(r.Context(), u.ID, wl.ID, body.Period, body.Confirm)
	switch {
	case errors.Is(err, insight.ErrBadPeriod):
		writeError(w, http.StatusBadRequest, "bad_period", "choose a complete month from the last twelve")
	case errors.Is(err, insight.ErrNoData):
		writeError(w, http.StatusBadRequest, "no_data", "the month has no transactions")
	case err != nil:
		writeAIError(w, err)
	default:
		writeJSON(w, http.StatusCreated, rep)
	}
}

func (h *aiHandlers) reportFeedback(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "reportId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "report not found")
		return
	}
	var body struct {
		Feedback int64 `json:"feedback"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Feedback < -1 || body.Feedback > 1 {
		writeError(w, http.StatusBadRequest, "invalid", "feedback is -1, 0 or 1")
		return
	}
	switch err := h.insights.SetFeedback(r.Context(), u.ID, wl.ID, id, body.Feedback); {
	case errors.Is(err, insight.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "report not found")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the feedback")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// The proposals are the asking user's alone too.

func (h *aiHandlers) listProposals(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	props, err := h.insights.Proposals(r.Context(), u.ID, wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load the proposals")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"proposals": props})
}

func (h *aiHandlers) proposalAction(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "proposalId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "proposal not found")
		return
	}
	var body struct {
		Action     string `json:"action"`
		CategoryID int64  `json:"categoryId"`
		ScheduleID int64  `json:"scheduleId"`
		GoalID     int64  `json:"goalId"`
		PayeeID    int64  `json:"payeeId"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	row := max(body.CategoryID, body.ScheduleID, body.GoalID, body.PayeeID) // only one is sent
	switch err := h.insights.Act(r.Context(), u.ID, wl.ID, id, body.Action, row); {
	case errors.Is(err, insight.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "proposal not found")
	case errors.Is(err, insight.ErrBadAction):
		writeError(w, http.StatusBadRequest, "invalid", err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the proposal")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *aiHandlers) proposalFeedback(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "proposalId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "proposal not found")
		return
	}
	var body struct {
		Feedback int64 `json:"feedback"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Feedback < -1 || body.Feedback > 1 {
		writeError(w, http.StatusBadRequest, "invalid", "feedback is -1, 0 or 1")
		return
	}
	switch err := h.insights.SetProposalFeedback(r.Context(), u.ID, wl.ID, id, body.Feedback); {
	case errors.Is(err, insight.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "proposal not found")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the feedback")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// The unusual transactions (#700) are the asking user's alone too.

func (h *aiHandlers) getUnusual(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	out, err := h.insights.UnusualOf(r.Context(), u.ID, wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load the unusual transactions")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *aiHandlers) unusualFine(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "flagId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "flag not found")
		return
	}
	switch err := h.insights.UnusualFine(r.Context(), u.ID, wl.ID, id); {
	case errors.Is(err, insight.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "flag not found")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the flag")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *aiHandlers) unusualFeedback(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	var body struct {
		Feedback int64 `json:"feedback"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Feedback < -1 || body.Feedback > 1 {
		writeError(w, http.StatusBadRequest, "invalid", "feedback is -1, 0 or 1")
		return
	}
	switch err := h.insights.SetUnusualFeedback(r.Context(), u.ID, wl.ID, body.Feedback); {
	case errors.Is(err, insight.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "nothing written yet")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not save the feedback")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
