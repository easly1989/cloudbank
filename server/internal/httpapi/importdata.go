package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/importio"
)

// importDataHandlers serves the wallet-scoped CSV/QIF/OFX import and CSV/QIF
// export endpoints (mounted inside the walletContext middleware).
type importDataHandlers struct {
	svc *importio.Service
}

func (h *importDataHandlers) walletRoutes(r chi.Router) {
	r.Post("/import/csv/preview", h.previewCSV)
	r.Post("/import/qif/preview", h.previewQIF)
	r.Post("/import/ofx/preview", h.previewOFX)
	r.Post("/import/commit", h.commit)
	r.Get("/export/csv", h.exportCSV)
	r.Get("/export/qif", h.exportQIF)
}

func notFoundOr(w http.ResponseWriter, err error, code, msg string, status int) {
	if errors.Is(err, importio.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "account not found")
		return
	}
	writeError(w, status, code, msg)
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

func (h *importDataHandlers) previewCSV(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body csvPreviewBody
	if !decodeJSON(w, r, &body) {
		return
	}
	dialect := importio.Dialect(body.Dialect)
	if dialect != importio.DialectHomeBank && dialect != importio.DialectGeneric {
		writeError(w, http.StatusBadRequest, "invalid", "dialect must be 'homebank' or 'generic'")
		return
	}
	res, err := h.svc.Preview(r.Context(), wl.ID, importio.PreviewRequest{
		AccountID: body.AccountID, Content: body.Content, Dialect: dialect,
		Delimiter: body.Delimiter, HasHeader: body.HasHeader, DateFormat: body.DateFormat,
		DecimalChar: body.DecimalChar, Mapping: body.Mapping, ApplyRules: body.ApplyRules,
	})
	if err != nil {
		notFoundOr(w, err, "invalid_file", "could not parse the CSV file", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// parsedPreviewBody is the request for the QIF and OFX previews (no column
// mapping; QIF additionally accepts a date-format hint).
type parsedPreviewBody struct {
	AccountID  int64  `json:"accountId"`
	Content    string `json:"content"`
	DateFormat string `json:"dateFormat"`
	ApplyRules bool   `json:"applyRules"`
}

func (h *importDataHandlers) previewQIF(w http.ResponseWriter, r *http.Request) {
	h.previewParsed(w, r, func(b parsedPreviewBody) ([]importio.Row, error) {
		return importio.ParseQIF(b.Content, b.DateFormat)
	}, "could not parse the QIF file")
}

func (h *importDataHandlers) previewOFX(w http.ResponseWriter, r *http.Request) {
	h.previewParsed(w, r, func(b parsedPreviewBody) ([]importio.Row, error) {
		return importio.ParseOFX(b.Content)
	}, "could not parse the OFX file")
}

func (h *importDataHandlers) previewParsed(
	w http.ResponseWriter, r *http.Request,
	parse func(parsedPreviewBody) ([]importio.Row, error), parseErr string,
) {
	wl, _ := walletFromContext(r.Context())
	var body parsedPreviewBody
	if !decodeJSON(w, r, &body) {
		return
	}
	rows, err := parse(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_file", parseErr)
		return
	}
	res, err := h.svc.PreviewParsed(r.Context(), wl.ID, body.AccountID, rows, body.ApplyRules)
	if err != nil {
		notFoundOr(w, err, "invalid_file", parseErr, http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type csvCommitBody struct {
	AccountID int64                `json:"accountId"`
	Rows      []importio.CommitRow `json:"rows"`
}

func (h *importDataHandlers) commit(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body csvCommitBody
	if !decodeJSON(w, r, &body) {
		return
	}
	res, err := h.svc.Commit(r.Context(), wl.ID, body.AccountID, body.Rows)
	if err != nil {
		notFoundOr(w, err, "internal", "could not import the rows", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

func (h *importDataHandlers) exportCSV(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, "text/csv; charset=utf-8", "transactions.csv", h.svc.ExportAccount)
}

func (h *importDataHandlers) exportQIF(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, "application/qif; charset=utf-8", "transactions.qif", h.svc.ExportAccountQIF)
}

func (h *importDataHandlers) export(
	w http.ResponseWriter, r *http.Request, contentType, filename string,
	render func(ctx context.Context, walletID, accountID int64) (string, error),
) {
	wl, _ := walletFromContext(r.Context())
	accountID, err := strconv.ParseInt(r.URL.Query().Get("accountId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid", "accountId is required")
		return
	}
	text, err := render(r.Context(), wl.ID, accountID)
	if err != nil {
		notFoundOr(w, err, "internal", "could not export the account", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(text))
}
