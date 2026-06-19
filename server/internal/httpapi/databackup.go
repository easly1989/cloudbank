package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/backup"
)

const maxRestoreBytes = 256 << 20 // 256 MiB

// HotBackuper produces a consistent on-disk copy of the whole database.
type HotBackuper interface {
	Backup(ctx context.Context, destPath string) error
}

// backupHandlers serves wallet JSON backup/restore and the admin hot-backup.
type backupHandlers struct {
	svc     *backup.Service
	hot     HotBackuper
	dataDir string
}

// walletRoutes mounts the per-wallet JSON backup download (inside walletContext).
func (h *backupHandlers) walletRoutes(r chi.Router) {
	r.Get("/backup", h.export)
}

func (h *backupHandlers) export(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	doc, err := h.svc.Export(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not export the wallet")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("attachment; filename=\"wallet-%d-backup.json\"", wl.ID))
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(doc)
}

// restore reads a backup document and restores it into a new wallet owned by the
// current user. Mounted in the authenticated group (not under walletContext).
func (h *backupHandlers) restore(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	body := http.MaxBytesReader(w, r.Body, maxRestoreBytes)
	var doc backup.Document
	if err := json.NewDecoder(body).Decode(&doc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_file", "could not parse the backup file")
		return
	}
	walletID, err := h.svc.Restore(r.Context(), user.ID, &doc)
	if err != nil {
		writeError(w, http.StatusBadRequest, "restore_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"walletId": walletID})
}

// hotBackup streams a VACUUM INTO copy of the entire database (all wallets and
// users). Admin only.
func (h *backupHandlers) hotBackup(w http.ResponseWriter, r *http.Request) {
	dir, err := os.MkdirTemp(h.dataDir, "hotbackup-")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not create a backup")
		return
	}
	defer func() { _ = os.RemoveAll(dir) }()

	dest := filepath.Join(dir, "cloudbank.db")
	if err := h.hot.Backup(r.Context(), dest); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not create a backup")
		return
	}
	f, err := os.Open(dest)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read the backup")
		return
	}
	defer func() { _ = f.Close() }()

	name := fmt.Sprintf("cloudbank-%s.db", time.Now().UTC().Format("20060102-150405"))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	http.ServeContent(w, r, name, time.Now(), f)
}
