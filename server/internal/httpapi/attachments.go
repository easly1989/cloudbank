package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/attachment"
)

// attachmentHandlers serve transaction file attachments. Upload and list are
// scoped to a transaction (passed as a form/query field to avoid nesting under
// the transaction subrouter); download and delete address an attachment by id.
type attachmentHandlers struct {
	svc *attachment.Service
}

func (h *attachmentHandlers) walletRoutes(r chi.Router) {
	r.Route("/attachments", func(r chi.Router) {
		r.Get("/", h.list)    // ?transactionId=
		r.Post("/", h.upload) // multipart: transactionId, file
		r.Route("/{attachmentId}", func(r chi.Router) {
			r.Get("/", h.download)
			r.Delete("/", h.delete)
		})
	})
}

func (h *attachmentHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	txnID, err := strconv.ParseInt(r.URL.Query().Get("transactionId"), 10, 64)
	if err != nil || txnID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "transactionId is required")
		return
	}
	out, err := h.svc.List(r.Context(), wl.ID, txnID)
	if !writeAttachmentError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *attachmentHandlers) upload(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	// Bound the whole request so an oversized upload can't exhaust memory/disk;
	// leave headroom over the file limit for the multipart envelope.
	limit := h.svc.MaxSize() + (1 << 20)
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large",
			fmt.Sprintf("upload exceeds the %d-byte limit or is malformed", h.svc.MaxSize()))
		return
	}
	txnID, err := strconv.ParseInt(r.FormValue("transactionId"), 10, 64)
	if err != nil || txnID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "transactionId is required")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "a file field is required")
		return
	}
	defer func() { _ = file.Close() }()
	att, err := h.svc.Create(r.Context(), wl.ID, txnID, header.Filename, header.Header.Get("Content-Type"), file)
	if !writeAttachmentError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, att)
}

func (h *attachmentHandlers) download(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := attachmentIDParam(w, r)
	if !ok {
		return
	}
	att, f, err := h.svc.Open(r.Context(), wl.ID, id)
	if !writeAttachmentError(w, err) {
		return
	}
	defer func() { _ = f.Close() }()
	w.Header().Set("Content-Type", att.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(att.Size, 10))
	// An attachment is untrusted user-supplied content, so it must never be able
	// to execute in the app's origin. Only known-safe preview types (raster
	// images, PDF) get an "inline" disposition; everything else — SVG, HTML,
	// scripts, unknown types — is forced to download, so a crafted file can't
	// render and run script when another wallet member views it. The sandbox CSP
	// is defence-in-depth that neutralises active content even for inline types.
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("%s; filename=%q", contentDisposition(att.ContentType), att.Filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Referrer-Policy", "no-referrer")
	// Zero modtime: skip Last-Modified/If-Modified-Since (files are immutable).
	http.ServeContent(w, r, att.Filename, time.Time{}, f)
}

// inlineSafeTypes are the content types served with an "inline" disposition so
// they preview in the browser. Raster images can't execute; PDFs are inline for
// convenience but the sandbox CSP blocks any embedded scripts. Every other type
// (notably image/svg+xml and text/html) is served as a download instead.
var inlineSafeTypes = map[string]bool{
	"image/png":       true,
	"image/jpeg":      true,
	"image/gif":       true,
	"image/webp":      true,
	"application/pdf": true,
}

// contentDisposition returns "inline" for known-safe preview types and
// "attachment" (forced download) for everything else. The content type is
// normalised (parameters stripped, lower-cased) before the allowlist check.
func contentDisposition(contentType string) string {
	ct := contentType
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	if inlineSafeTypes[strings.ToLower(strings.TrimSpace(ct))] {
		return "inline"
	}
	return "attachment"
}

func (h *attachmentHandlers) delete(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := attachmentIDParam(w, r)
	if !ok {
		return
	}
	if !writeAttachmentError(w, h.svc.Delete(r.Context(), wl.ID, id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func attachmentIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "attachmentId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "attachment not found")
		return 0, false
	}
	return id, true
}

// writeAttachmentError maps service errors to HTTP responses. Returns false when
// it has written an error (the caller should stop).
func writeAttachmentError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "attachment operation failed",
		errCase{attachment.ErrNotFound, http.StatusNotFound, "not_found", "attachment not found"},
		errCase{attachment.ErrTooLarge, http.StatusRequestEntityTooLarge, "too_large", "attachment too large"},
		errCase{attachment.ErrEmpty, http.StatusBadRequest, "invalid_request", "attachment is empty"},
	)
}
