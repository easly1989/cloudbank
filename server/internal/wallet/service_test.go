package wallet

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return NewService(st.Write())
}

// seedUser inserts a user directly and returns its id.
func seedUser(t *testing.T, s *Service, username string) int64 {
	t.Helper()
	u, err := db.New(s.db).CreateUser(context.Background(), db.CreateUserParams{
		Username: username, PasswordHash: "x", Locale: "en", Theme: "auto",
	})
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return u.ID
}

func TestCreateAddsOwnerMembership(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	uid := seedUser(t, s, "alice")

	w, err := s.Create(ctx, uid, "Home", "Alice")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if w.Role != RoleOwner {
		t.Fatalf("role = %q, want owner", w.Role)
	}

	role, ok, err := s.Membership(ctx, w.ID, uid)
	if err != nil || !ok || role != RoleOwner {
		t.Fatalf("Membership = (%q,%v,%v)", role, ok, err)
	}

	list, err := s.List(ctx, uid)
	if err != nil || len(list) != 1 || list[0].ID != w.ID {
		t.Fatalf("List = %+v, %v", list, err)
	}
}

func TestMembershipFalseForNonMember(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	alice := seedUser(t, s, "alice")
	bob := seedUser(t, s, "bob")

	w, err := s.Create(ctx, alice, "Home", "Alice")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	_, ok, err := s.Membership(ctx, w.ID, bob)
	if err != nil {
		t.Fatalf("Membership err: %v", err)
	}
	if ok {
		t.Fatal("bob should not be a member of alice's wallet")
	}
	if got, err := s.List(ctx, bob); err != nil || len(got) != 0 {
		t.Fatalf("bob List = %+v, %v; want empty", got, err)
	}
}

func TestDeleteRemovesWallet(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	uid := seedUser(t, s, "alice")
	w, _ := s.Create(ctx, uid, "Home", "Alice")

	if err := s.Delete(ctx, w.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := s.Get(ctx, w.ID); err != ErrNotFound {
		t.Fatalf("Get after delete = %v, want ErrNotFound", err)
	}
	// Membership row cascaded away.
	if _, ok, _ := s.Membership(ctx, w.ID, uid); ok {
		t.Fatal("membership not cascaded on wallet delete")
	}
}

func TestUpdatePersistsSchedulePostMonths(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	uid := seedUser(t, s, "alice")
	w, err := s.Create(ctx, uid, "Home", "Alice")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if w.SchedulePostMonths != 0 {
		t.Fatalf("new wallet months = %d, want 0", w.SchedulePostMonths)
	}
	if err := s.Update(ctx, w.ID, "Home", "Alice", 2); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, err := s.Get(ctx, w.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.SchedulePostMonths != 2 {
		t.Fatalf("after update months = %d, want 2", got.SchedulePostMonths)
	}
	// Out-of-range values are clamped to the HomeBank-parity max of 3.
	if err := s.Update(ctx, w.ID, "Home", "Alice", 9); err != nil {
		t.Fatalf("Update clamp: %v", err)
	}
	got, _ = s.Get(ctx, w.ID)
	if got.SchedulePostMonths != 3 {
		t.Fatalf("clamped months = %d, want 3", got.SchedulePostMonths)
	}
}
