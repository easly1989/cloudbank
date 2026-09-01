package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/ai"
)

// aiHandlers serves the opt-in AI settings and category-suggestion endpoints.
type aiHandlers struct {
	svc *ai.Service
}

// routes mounts the user-level AI settings endpoints (inside requireAuth).
func (h *aiHandlers) routes(r chi.Router) {
	r.Get("/ai/settings", h.getSettings)
	r.Put("/ai/settings", h.putSettings)
}

// walletRoutes mounts the wallet-scoped suggestion endpoint.
func (h *aiHandlers) walletRoutes(r chi.Router) {
	r.Post("/ai/suggest-category", h.suggestCategory)
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
		Enabled bool    `json:"enabled"`
		BaseURL string  `json:"baseUrl"`
		Model   string  `json:"model"`
		APIKey  *string `json:"apiKey"` // omit to keep the stored key
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	st, err := h.svc.UpdateSettings(r.Context(), u.ID, ai.SettingsInput{
		Enabled: body.Enabled, BaseURL: body.BaseURL, Model: body.Model, APIKey: body.APIKey,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not save AI settings")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *aiHandlers) suggestCategory(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	u := userFromContext(r.Context())
	var body struct {
		Payee  string `json:"payee"`
		Memo   string `json:"memo"`
		Amount string `json:"amount"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	cat, err := h.svc.SuggestCategory(r.Context(), u.ID, wl.ID, ai.SuggestInput{
		Payee: body.Payee, Memo: body.Memo, Amount: body.Amount,
	})
	if errors.Is(err, ai.ErrNotConfigured) {
		writeError(w, http.StatusBadRequest, "ai_disabled", "AI is not enabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "ai_error", "the AI provider request failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"category": cat})
}
