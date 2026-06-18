package httpapi

import (
	"net/http"

	"github.com/easly1989/cloudbank/server/internal/importer"
)

const maxImportBytes = 64 << 20 // 64 MiB

// importHandlers serves the file-import endpoints. They create a new wallet, so
// they are mounted in the authenticated group (not under walletContext).
type importHandlers struct {
	svc *importer.Service
}

// xhb imports a HomeBank .xhb file sent as the raw request body, creating a new
// wallet owned by the current user.
func (h *importHandlers) xhb(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	body := http.MaxBytesReader(w, r.Body, maxImportBytes)
	x, err := importer.ParseXHB(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_file", "could not parse the HomeBank file")
		return
	}
	res, err := h.svc.ImportXHB(r.Context(), user.ID, x)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not import the file")
		return
	}
	writeJSON(w, http.StatusCreated, res)
}
