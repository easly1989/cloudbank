package dbconv

import (
	"database/sql"
	"testing"
)

func TestB2i(t *testing.T) {
	if got := B2i(true); got != 1 {
		t.Errorf("B2i(true) = %d, want 1", got)
	}
	if got := B2i(false); got != 0 {
		t.Errorf("B2i(false) = %d, want 0", got)
	}
}

func TestNullToPtr(t *testing.T) {
	if got := NullToPtr(sql.NullInt64{}); got != nil {
		t.Errorf("NullToPtr(NULL) = %v, want nil", got)
	}
	got := NullToPtr(sql.NullInt64{Int64: 42, Valid: true})
	if got == nil || *got != 42 {
		t.Errorf("NullToPtr(42) = %v, want *42", got)
	}
}

func TestPtrToNull(t *testing.T) {
	if got := PtrToNull(nil); got.Valid {
		t.Errorf("PtrToNull(nil) = %+v, want invalid", got)
	}
	v := int64(7)
	got := PtrToNull(&v)
	if !got.Valid || got.Int64 != 7 {
		t.Errorf("PtrToNull(&7) = %+v, want {7 true}", got)
	}
}

// TestRoundTrip verifies NullToPtr and PtrToNull are inverses.
func TestRoundTrip(t *testing.T) {
	for _, n := range []sql.NullInt64{{}, {Int64: 0, Valid: true}, {Int64: -5, Valid: true}} {
		if got := PtrToNull(NullToPtr(n)); got != n {
			t.Errorf("round-trip %+v = %+v", n, got)
		}
	}
}
