package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/csvio"
)

// csvHandlers serves the wallet-scoped CSV import/export endpoints (mounted
// inside the walletContext middleware).
type csvHandlers struct {
	svc *csvio.Service
}

func (h *csvHandlers) walletRoutes(r chi.Router) {
	r.Post("/import/csv/preview", h.preview)
	r.Post("/import/csv/commit", h.commit)
	r.Get("/export/csv", h.export)
}

type csvPreviewBody struct {
	AccountID   int64          `json:"accountId"`
	Content     string         `json:"content"`
	Dialect     string         `json:"dialect"`
	Delimiter   string         `json:"delimiter"`
	HasHeader   bool           `json:"hasHeader"`
	DateFormat  string         `json:"dateFormat"`
	DecimalChar string         `json:"decimalChar"`
	Mapping     map[string]int `json:"mapping"`
	ApplyRules  bool           `json:"applyRules"`
}

func (h *csvHandlers) preview(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body csvPreviewBody
	if !decodeJSON(w, r, &body) {
		return
	}
	dialect := csvio.Dialect(body.Dialect)
	if dialect != csvio.DialectHomeBank && dialect != csvio.DialectGeneric {
		writeError(w, http.StatusBadRequest, "invalid", "dialect must be 'homebank' or 'generic'")
		return
	}
	res, err := h.svc.Preview(r.Context(), wl.ID, csvio.PreviewRequest{
		AccountID: body.AccountID, Content: body.Content, Dialect: dialect,
		Delimiter: body.Delimiter, HasHeader: body.HasHeader, DateFormat: body.DateFormat,
		DecimalChar: body.DecimalChar, Mapping: body.Mapping, ApplyRules: body.ApplyRules,
	})
	if err != nil {
		if errors.Is(err, csvio.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "account not found")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_file", "could not parse the CSV file")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type csvCommitBody struct {
	AccountID int64             `json:"accountId"`
	Rows      []csvio.CommitRow `json:"rows"`
}

func (h *csvHandlers) commit(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body csvCommitBody
	if !decodeJSON(w, r, &body) {
		return
	}
	res, err := h.svc.Commit(r.Context(), wl.ID, body.AccountID, body.Rows)
	if err != nil {
		if errors.Is(err, csvio.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not import the rows")
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

func (h *csvHandlers) export(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	accountID, err := strconv.ParseInt(r.URL.Query().Get("accountId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid", "accountId is required")
		return
	}
	csvText, err := h.svc.ExportAccount(r.Context(), wl.ID, accountID)
	if err != nil {
		if errors.Is(err, csvio.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not export the account")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"transactions.csv\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(csvText))
}
