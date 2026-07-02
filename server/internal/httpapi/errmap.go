package httpapi

import (
	"errors"
	"net/http"
)

// errCase maps a domain sentinel error to the HTTP response it should produce.
type errCase struct {
	target  error
	status  int
	code    string
	message string
}

// mapError renders an HTTP error response for err. The first case whose target
// matches (errors.Is) wins; a non-nil error that matches nothing becomes a 500
// with fallbackMsg. It returns true when err is nil (nothing written) and false
// otherwise, so handlers can early-return with `if !mapError(...) { return }`.
func mapError(w http.ResponseWriter, err error, fallbackMsg string, cases ...errCase) bool {
	if err == nil {
		return true
	}
	for _, c := range cases {
		if errors.Is(err, c.target) {
			writeError(w, c.status, c.code, c.message)
			return false
		}
	}
	writeError(w, http.StatusInternalServerError, "internal", fallbackMsg)
	return false
}
