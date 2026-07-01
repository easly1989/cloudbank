// Package attachment stores files (receipts, invoices) attached to
// transactions. Metadata lives in the attachments table; the bytes live on disk
// under <dir>/<walletId>/<storageKey> so the SQLite database stays small.
package attachment

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// DefaultMaxSize caps a single upload (10 MiB) — enough for a photographed
// receipt or a PDF invoice without letting the /data volume balloon.
const DefaultMaxSize int64 = 10 << 20

var (
	// ErrNotFound is returned when the attachment (or its transaction) does not
	// exist in the given wallet.
	ErrNotFound = errors.New("attachment not found")
	// ErrTooLarge is returned when the upload exceeds the size limit.
	ErrTooLarge = errors.New("attachment too large")
	// ErrEmpty is returned when the upload has no bytes.
	ErrEmpty = errors.New("attachment is empty")
)

// Attachment is the metadata for a stored file.
type Attachment struct {
	ID            int64  `json:"id"`
	TransactionID int64  `json:"transactionId"`
	Filename      string `json:"filename"`
	ContentType   string `json:"contentType"`
	Size          int64  `json:"size"`
	CreatedAt     string `json:"createdAt"`
}

func toAttachment(r db.Attachment) Attachment {
	return Attachment{
		ID: r.ID, TransactionID: r.TransactionID, Filename: r.Filename,
		ContentType: r.ContentType, Size: r.Size, CreatedAt: r.CreatedAt,
	}
}

// Service persists attachment files and their metadata.
type Service struct {
	q       *db.Queries
	dir     string // base directory (e.g. ${CB_DATA_DIR}/attachments)
	maxSize int64
}

// NewService builds an attachment Service. dir is the base directory that holds
// per-wallet subdirectories of files.
func NewService(write *sql.DB, dir string) *Service {
	return &Service{q: db.New(write), dir: dir, maxSize: DefaultMaxSize}
}

// MaxSize is the per-file upload limit in bytes.
func (s *Service) MaxSize() int64 { return s.maxSize }

func (s *Service) walletDir(walletID int64) string {
	return filepath.Join(s.dir, strconv.FormatInt(walletID, 10))
}

func (s *Service) path(walletID int64, storageKey string) string {
	return filepath.Join(s.walletDir(walletID), storageKey)
}

// Create validates that txnID belongs to walletID, streams the upload to disk
// under the size limit, then records the metadata. filename is the client's
// original name (used for downloads); contentType is its MIME type.
func (s *Service) Create(ctx context.Context, walletID, txnID int64, filename, contentType string, r io.Reader) (Attachment, error) {
	if err := s.transactionInWallet(ctx, walletID, txnID); err != nil {
		return Attachment{}, err
	}
	filename = sanitizeName(filename)
	key, err := randomKey()
	if err != nil {
		return Attachment{}, err
	}
	if err := os.MkdirAll(s.walletDir(walletID), 0o750); err != nil {
		return Attachment{}, err
	}
	full := s.path(walletID, key)
	f, err := os.OpenFile(full, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return Attachment{}, err
	}
	// Copy at most maxSize+1 so we can detect an over-limit upload.
	n, copyErr := io.Copy(f, io.LimitReader(r, s.maxSize+1))
	closeErr := f.Close()
	if copyErr != nil {
		_ = os.Remove(full)
		return Attachment{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(full)
		return Attachment{}, closeErr
	}
	if n > s.maxSize {
		_ = os.Remove(full)
		return Attachment{}, ErrTooLarge
	}
	if n == 0 {
		_ = os.Remove(full)
		return Attachment{}, ErrEmpty
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	row, err := s.q.InsertAttachment(ctx, db.InsertAttachmentParams{
		WalletID: walletID, TransactionID: txnID, Filename: filename,
		ContentType: contentType, Size: n, StorageKey: key,
	})
	if err != nil {
		_ = os.Remove(full)
		return Attachment{}, err
	}
	return toAttachment(row), nil
}

// List returns a transaction's attachments (validates wallet ownership).
func (s *Service) List(ctx context.Context, walletID, txnID int64) ([]Attachment, error) {
	if err := s.transactionInWallet(ctx, walletID, txnID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListAttachmentsForTransaction(ctx, txnID)
	if err != nil {
		return nil, err
	}
	out := make([]Attachment, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAttachment(r))
	}
	return out, nil
}

// Open returns an attachment's metadata and an open file handle for streaming.
// The caller must close the file. Validates wallet ownership.
func (s *Service) Open(ctx context.Context, walletID, id int64) (Attachment, *os.File, error) {
	row, err := s.q.GetAttachment(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && row.WalletID != walletID) {
		return Attachment{}, nil, ErrNotFound
	}
	if err != nil {
		return Attachment{}, nil, err
	}
	f, err := os.Open(s.path(walletID, row.StorageKey))
	if errors.Is(err, os.ErrNotExist) {
		return Attachment{}, nil, ErrNotFound
	}
	if err != nil {
		return Attachment{}, nil, err
	}
	return toAttachment(row), f, nil
}

// Delete removes an attachment's row and file (validates wallet ownership).
func (s *Service) Delete(ctx context.Context, walletID, id int64) error {
	row, err := s.q.GetAttachment(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && row.WalletID != walletID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := s.q.DeleteAttachment(ctx, id); err != nil {
		return err
	}
	_ = os.Remove(s.path(walletID, row.StorageKey))
	return nil
}

// PurgeTransactions removes the files backing the given transactions'
// attachments. Wired into the transaction service and called BEFORE the
// transactions (and their cascading attachment rows) are deleted.
func (s *Service) PurgeTransactions(ctx context.Context, txnIDs []int64) error {
	for _, txnID := range txnIDs {
		rows, err := s.q.ListAttachmentsForTransaction(ctx, txnID)
		if err != nil {
			return err
		}
		for _, r := range rows {
			_ = os.Remove(s.path(r.WalletID, r.StorageKey))
		}
	}
	return nil
}

// PurgeWallet removes an entire wallet's attachment directory. Called when a
// wallet is deleted (its rows cascade at the DB level).
func (s *Service) PurgeWallet(walletID int64) error {
	return os.RemoveAll(s.walletDir(walletID))
}

// transactionInWallet verifies the transaction exists and belongs to walletID.
func (s *Service) transactionInWallet(ctx context.Context, walletID, txnID int64) error {
	row, err := s.q.GetTransaction(ctx, txnID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && row.WalletID != walletID) {
		return ErrNotFound
	}
	return err
}

// randomKey returns an unguessable 32-hex-character storage key.
func randomKey() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// sanitizeName reduces a client filename to a safe base name for later download.
func sanitizeName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == '/' || r == '\\' {
			return -1
		}
		return r
	}, name)
	if name == "" || name == "." || name == ".." {
		return "file"
	}
	if len(name) > 255 {
		name = name[:255]
	}
	return name
}
