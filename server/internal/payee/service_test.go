package payee

import (
	"context"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newTestService(t *testing.T) (*Service, *db.Queries, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	w, err := q.CreateWallet(context.Background(), db.CreateWalletParams{Title: "W"})
	if err != nil {
		t.Fatal(err)
	}
	return NewService(st.Write()), q, w.ID
}

func TestCrudAndDuplicate(t *testing.T) {
	s, q, wid := newTestService(t)
	ctx := context.Background()

	cat, err := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Shopping"})
	if err != nil {
		t.Fatal(err)
	}

	p, err := s.Create(ctx, wid, "Acme", nil, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.Create(ctx, wid, "Acme", nil, nil); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate = %v, want ErrDuplicate", err)
	}

	mode := int64(3)
	up, err := s.Update(ctx, p.ID, "Acme Inc", &cat.ID, &mode)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if up.Name != "Acme Inc" || up.DefaultCategoryID == nil || *up.DefaultCategoryID != cat.ID || up.DefaultPaymentMode == nil || *up.DefaultPaymentMode != 3 {
		t.Fatalf("updated = %+v", up)
	}
}

func TestMergeAndDelete(t *testing.T) {
	s, _, wid := newTestService(t)
	ctx := context.Background()
	a, _ := s.Create(ctx, wid, "A", nil, nil)
	b, _ := s.Create(ctx, wid, "B", nil, nil)

	if err := s.Merge(ctx, wid, a.ID, a.ID); err != ErrSelfReference {
		t.Fatalf("self merge = %v, want ErrSelfReference", err)
	}
	if err := s.Merge(ctx, wid, a.ID, b.ID); err != nil {
		t.Fatalf("merge: %v", err)
	}
	if _, err := s.Get(ctx, a.ID); err != ErrNotFound {
		t.Fatal("merged source still exists")
	}
	if err := s.Delete(ctx, wid, b.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	list, _ := s.List(ctx, wid)
	if len(list) != 0 {
		t.Fatalf("payees remain: %+v", list)
	}
}

// "bar Centrale" is the same payee as "Bar Centrale" (#531): refused on create
// and on rename, and the error names the one that exists.
func TestDuplicateIgnoresCaseAndSpaces(t *testing.T) {
	s, _, wid := newTestService(t)
	ctx := context.Background()

	bar, err := s.Create(ctx, wid, "  Bar Centrale ", nil, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if bar.Name != "Bar Centrale" {
		t.Fatalf("name = %q, want it trimmed", bar.Name)
	}
	var dup *DuplicateError
	if _, err := s.Create(ctx, wid, "bar centrale", nil, nil); !errors.As(err, &dup) || dup.Existing != "Bar Centrale" {
		t.Fatalf("case-different create = %v, want a DuplicateError naming Bar Centrale", err)
	}
	other, err := s.Create(ctx, wid, "Pharmacy", nil, nil)
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	if _, err := s.Update(ctx, other.ID, "BAR CENTRALE", nil, nil); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("rename onto another = %v, want ErrDuplicate", err)
	}
	// Changing only the case of its own name is fine.
	if _, err := s.Update(ctx, bar.ID, "Bar centrale", nil, nil); err != nil {
		t.Fatalf("recase own name: %v", err)
	}
}
