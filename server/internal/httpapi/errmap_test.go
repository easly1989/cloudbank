package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMapError(t *testing.T) {
	errA := errors.New("a")
	errB := errors.New("b")
	cases := []errCase{
		{errA, http.StatusNotFound, "not_found", "the a"},
		{errB, http.StatusConflict, "conflict", "the b"},
	}

	readBody := func(t *testing.T, rec *httptest.ResponseRecorder) (string, string) {
		t.Helper()
		var body struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
		}
		return body.Error.Code, body.Error.Message
	}

	t.Run("nil error returns true and writes nothing", func(t *testing.T) {
		rec := httptest.NewRecorder()
		if !mapError(rec, nil, "fallback", cases...) {
			t.Fatal("nil err should return true")
		}
		if rec.Body.Len() != 0 {
			t.Fatalf("body = %q, want empty", rec.Body.String())
		}
	})

	t.Run("matching sentinel (through a wrap) maps to its case", func(t *testing.T) {
		rec := httptest.NewRecorder()
		if mapError(rec, fmt.Errorf("context: %w", errB), "fallback", cases...) {
			t.Fatal("non-nil err should return false")
		}
		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", rec.Code)
		}
		if code, msg := readBody(t, rec); code != "conflict" || msg != "the b" {
			t.Fatalf("body = %q/%q", code, msg)
		}
	})

	t.Run("first matching case wins", func(t *testing.T) {
		rec := httptest.NewRecorder()
		mapError(rec, errA, "fallback", cases...)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
		if code, _ := readBody(t, rec); code != "not_found" {
			t.Fatalf("code = %q", code)
		}
	})

	t.Run("unmatched error falls back to 500", func(t *testing.T) {
		rec := httptest.NewRecorder()
		if mapError(rec, errors.New("surprise"), "fallback msg", cases...) {
			t.Fatal("non-nil err should return false")
		}
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if code, msg := readBody(t, rec); code != "internal" || msg != "fallback msg" {
			t.Fatalf("fallback body = %q/%q", code, msg)
		}
	})
}
