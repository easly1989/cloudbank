package vehicle

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newFixture(t *testing.T) (*Service, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	w, _ := db.New(st.Write()).CreateWallet(context.Background(), db.CreateWalletParams{Title: "W"})
	return NewService(st.Write()), w.ID
}

func TestVehicleCRUD(t *testing.T) {
	s, wid := newFixture(t)
	ctx := context.Background()

	// Create requires a name.
	if _, err := s.Create(ctx, wid, "  ", "", ""); err != ErrInvalid {
		t.Fatalf("empty name = %v, want ErrInvalid", err)
	}
	v, err := s.Create(ctx, wid, "Car", "AB123CD", "daily")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if v.Name != "Car" || v.Plate != "AB123CD" {
		t.Fatalf("created = %+v", v)
	}
	// Duplicate name rejected.
	if _, err := s.Create(ctx, wid, "Car", "", ""); err != ErrDuplicate {
		t.Fatalf("duplicate = %v, want ErrDuplicate", err)
	}

	// List returns it.
	list, err := s.List(ctx, wid)
	if err != nil || len(list) != 1 || list[0].ID != v.ID {
		t.Fatalf("list = %+v, err %v", list, err)
	}

	// Update edits fields.
	up, err := s.Update(ctx, wid, v.ID, "Van", "XY999ZZ", "work")
	if err != nil || up.Name != "Van" || up.Plate != "XY999ZZ" {
		t.Fatalf("update = %+v, err %v", up, err)
	}

	// Cross-wallet isolation: another wallet cannot touch it.
	if err := s.Delete(ctx, wid+999, v.ID); err != ErrNotFound {
		t.Fatalf("foreign delete = %v, want ErrNotFound", err)
	}
	// Delete removes it.
	if err := s.Delete(ctx, wid, v.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if list, _ := s.List(ctx, wid); len(list) != 0 {
		t.Fatalf("after delete = %+v, want none", list)
	}
}
