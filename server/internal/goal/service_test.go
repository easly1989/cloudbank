package goal

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newFixture(t *testing.T) (*Service, *db.Queries, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	w, _ := q.CreateWallet(context.Background(), db.CreateWalletParams{Title: "W"})
	return NewService(st.Write()), q, w.ID
}

func TestGoalCRUDAndContributions(t *testing.T) {
	s, q, wid := newFixture(t)
	ctx := context.Background()

	// Validation: a name and a positive target are required.
	if _, err := s.Create(ctx, wid, Input{Name: "  ", TargetAmount: 1000}); err != ErrInvalid {
		t.Fatalf("empty name = %v, want ErrInvalid", err)
	}
	if _, err := s.Create(ctx, wid, Input{Name: "Trip", TargetAmount: 0}); err != ErrInvalid {
		t.Fatalf("zero target = %v, want ErrInvalid", err)
	}

	date := "2026-05-01"
	g, err := s.Create(ctx, wid, Input{Name: "Trip", TargetAmount: 100000, TargetDate: &date})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if g.Saved != 0 || g.TargetAmount != 100000 || g.TargetDate == nil || *g.TargetDate != date {
		t.Fatalf("created = %+v", g)
	}

	// Signed contributions accumulate into Saved.
	if _, err := s.AddContribution(ctx, wid, g.ID, date, 30000, "start"); err != nil {
		t.Fatalf("add: %v", err)
	}
	c2, err := s.AddContribution(ctx, wid, g.ID, "2026-05-10", 25000, "")
	if err != nil {
		t.Fatalf("add2: %v", err)
	}
	if _, err := s.AddContribution(ctx, wid, g.ID, "2026-05-15", -5000, "oops"); err != nil {
		t.Fatalf("add3: %v", err)
	}
	if _, err := s.AddContribution(ctx, wid, g.ID, "", 100, ""); err != ErrBadContribution {
		t.Fatalf("empty date = %v, want ErrBadContribution", err)
	}
	if _, err := s.AddContribution(ctx, wid, g.ID, date, 0, ""); err != ErrBadContribution {
		t.Fatalf("zero amount = %v, want ErrBadContribution", err)
	}

	// saved = 30000 + 25000 - 5000 = 50000.
	list, err := s.List(ctx, wid)
	if err != nil || len(list) != 1 || list[0].Saved != 50000 {
		t.Fatalf("list = %+v, err %v", list, err)
	}

	contribs, err := s.Contributions(ctx, wid, g.ID)
	if err != nil || len(contribs) != 3 {
		t.Fatalf("contribs = %+v, err %v", contribs, err)
	}

	// Removing a contribution updates the saved total.
	if err := s.DeleteContribution(ctx, wid, g.ID, c2.ID); err != nil {
		t.Fatalf("del contrib: %v", err)
	}
	if got, _ := s.Get(ctx, wid, g.ID); got.Saved != 25000 {
		t.Fatalf("saved after delete = %d, want 25000", got.Saved)
	}

	// Cross-wallet isolation.
	if _, err := s.Get(ctx, wid+999, g.ID); err != ErrNotFound {
		t.Fatalf("cross-wallet get = %v, want ErrNotFound", err)
	}
	if err := s.Delete(ctx, wid+999, g.ID); err != ErrNotFound {
		t.Fatalf("cross-wallet delete = %v, want ErrNotFound", err)
	}

	// Deleting the goal cascades its remaining contributions.
	remaining, _ := s.Contributions(ctx, wid, g.ID)
	if err := s.Delete(ctx, wid, g.ID); err != nil {
		t.Fatalf("delete goal: %v", err)
	}
	if l, _ := s.List(ctx, wid); len(l) != 0 {
		t.Fatalf("goal not deleted: %+v", l)
	}
	for _, c := range remaining {
		if _, err := q.GetContribution(ctx, c.ID); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("contribution %d not cascaded: err=%v", c.ID, err)
		}
	}
}
