package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // DecodeConfig reads a JPEG's size
	_ "image/png"  // and a PNG's
	"net/http"
)

// A receipt (#707): the photo of a receipt, which the browser has already
// shrunk (and so stripped of its EXIF), read into the entry sheet's fields.
// The photo goes to the provider and nowhere else: not to disk, not to the
// log, which keeps a line about it.

// ReceiptMax is the largest photo accepted.
const ReceiptMax = 5 << 20

// ErrBadImage is a photo that is not a JPEG, PNG or WebP, or is too large.
var ErrBadImage = errors.New("ai: send a JPEG, PNG or WebP photo of up to 5 MB")

// ErrNoVision is a provider that refused the photo: most often a model that
// does not read images.
var ErrNoVision = errors.New("ai: the provider refused the photo; the model chosen may not read images")

// CheckImage tells a photo's type from its bytes, never from what the client
// says it is, and reads its size where the standard library can.
func CheckImage(data []byte) (*Image, error) {
	if len(data) == 0 || len(data) > ReceiptMax {
		return nil, ErrBadImage
	}
	img := &Image{Type: http.DetectContentType(data), Data: data}
	switch img.Type {
	case "image/jpeg", "image/png":
		cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return nil, ErrBadImage
		}
		img.Width, img.Height = cfg.Width, cfg.Height
	case "image/webp":
	default:
		return nil, ErrBadImage
	}
	return img, nil
}

const receiptSystem = "You read the photo of a single shop receipt or invoice and extract the fields of " +
	"the expense it records, replying with ONLY a minified JSON object — no prose, no code fences. " +
	entryKeys +
	"The amount is the receipt's total, never one line of it; the date is the one printed on the " +
	"receipt; the payee is the shop's name as a person would say it; the memo says in a few words " +
	"what was bought, like \"Bread and pastries\". If the photo is not a receipt, reply {}."

// ParseReceipt reads a receipt's photo into transaction fields. today
// (YYYY-MM-DD) is the date when the receipt shows none. confirm is the user's
// yes to a call past this month's limit.
func (s *Service) ParseReceipt(ctx context.Context, userID, walletID int64, confirm bool, img *Image, today string) (*ParsedEntry, error) {
	e, err := s.parseFields(ctx, Call{
		UserID: userID, WalletID: walletID, Feature: FeatureReceipts, Confirm: confirm,
		System: receiptSystem, Image: img,
	}, today, "\nThe receipt is in the photo.")
	var se *StatusError
	if errors.As(err, &se) {
		switch se.Status {
		case http.StatusBadRequest, http.StatusNotFound, http.StatusUnsupportedMediaType, http.StatusUnprocessableEntity:
			return nil, fmt.Errorf("%w (%v)", ErrNoVision, err)
		}
	}
	return e, err
}
