package mailingest

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The mails below are invented, shaped like a card-payment notice. None is a
// real bank's mail.

func (f *fixture) addSource(t *testing.T, mb Mailbox, name, folder string) Source {
	t.Helper()
	s, err := f.svc.CreateSource(context.Background(), f.wallet, mb.ID, name, folder)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func (f *fixture) history(t *testing.T, mb Mailbox) []MailSummary {
	t.Helper()
	msgs, err := f.svc.Messages(context.Background(), f.wallet, mb.ID)
	if err != nil {
		t.Fatal(err)
	}
	return msgs
}

func (f *fixture) sourceOf(t *testing.T, mb Mailbox, id int64) Source {
	t.Helper()
	list, err := f.svc.ListMailboxes(context.Background(), f.wallet)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range list {
		for _, s := range b.Sources {
			if b.ID == mb.ID && s.ID == id {
				return s
			}
		}
	}
	return Source{Mode: "gone"}
}

func TestSourcesAreLimitedAndNamed(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	mb := f.connect(t)
	if _, err := f.svc.CreateSource(ctx, f.wallet, mb.ID, " inbox ", "Banca"); !errors.Is(err, ErrSourceNameTaken) {
		t.Fatalf("a name taken in another case: %v", err)
	}
	if _, err := f.svc.CreateSource(ctx, f.wallet, mb.ID, "  ", "Banca"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an empty name: %v", err)
	}
	if _, err := f.svc.CreateSource(ctx, f.wallet, mb.ID, "Nope", "Nope"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a folder that does not exist: %v", err)
	}
	for i := 2; i <= maxSources; i++ {
		// Two sources may read one folder.
		s := f.addSource(t, mb, fmt.Sprintf(" Fonte %d ", i), "Banca")
		if s.Name != fmt.Sprintf("Fonte %d", i) || s.Position != i-1 || s.AI.Mode != AIModePatterns {
			t.Fatalf("source = %+v", s)
		}
	}
	if _, err := f.svc.CreateSource(ctx, f.wallet, mb.ID, "Sesta", "Banca"); !errors.Is(err, ErrSourceLimit) {
		t.Fatalf("a sixth source: %v", err)
	}
	list, _ := f.svc.ListMailboxes(ctx, f.wallet)
	second := list[0].Sources[1]
	if _, err := f.svc.UpdateSource(ctx, f.wallet, mb.ID, second.ID, ptr("fonte 3"), nil); !errors.Is(err, ErrSourceNameTaken) {
		t.Fatalf("renamed to another's name: %v", err)
	}
	got, err := f.svc.UpdateSource(ctx, f.wallet, mb.ID, second.ID, ptr("FONTE 2"), nil)
	if err != nil || got.Name != "FONTE 2" {
		t.Fatalf("renamed in another case: %+v, %v", got, err)
	}
}

func TestASharedFolderGoesToTheFirstSourceThatReadsIt(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, cardAcc := f.ledger(t)
	mb := f.connect(t)
	first := src(mb)
	card := f.addSource(t, mb, "Carta", "INBOX")
	if _, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, first, cardPattern(acc)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, card.ID, cardPattern(cardAcc)); err != nil {
		t.Fatal(err)
	}

	sendMail(t, f, "o1", "6,43", "Bar Demo", "1234", true)
	if res, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil || res != (CheckResult{New: 1, Created: 1}) {
		t.Fatalf("check = %+v, %v", res, err)
	}
	if len(f.transactions(t, acc)) != 1 || len(f.transactions(t, cardAcc)) != 0 {
		t.Fatal("the first source did not win")
	}
	if m := f.history(t, mb)[0]; m.SourceID == nil || *m.SourceID != first || *m.SourceName != "INBOX" {
		t.Fatalf("mail = %+v", m)
	}

	got, err := f.svc.ReorderSources(ctx, f.wallet, mb.ID, []int64{card.ID, first})
	if err != nil || got.Sources[0].ID != card.ID {
		t.Fatalf("reorder = %+v, %v", got, err)
	}
	sendMail(t, f, "o2", "6,43", "Bar Demo", "1234", true)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	if len(f.transactions(t, cardAcc)) != 1 {
		t.Fatal("after reordering, the new first source did not win")
	}
	if m := f.history(t, mb)[0]; m.SourceID == nil || *m.SourceID != card.ID || *m.SourceName != "Carta" {
		t.Fatalf("mail = %+v", m)
	}
	if _, err := f.svc.ReorderSources(ctx, f.wallet, mb.ID, []int64{card.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an order missing a source: %v", err)
	}
}

// A mail no source reads goes to the first; a source that gets a pattern for
// it later takes it, unless a source before it would read it.
func TestAnUnclaimedMailGoesToTheFirstSource(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, _ := f.ledger(t)
	mb := f.connect(t)
	first := src(mb)
	later := f.addSource(t, mb, "Carta", "INBOX")
	sendMail(t, f, "w1", "6,43", "Bar Demo", "1234", true)
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.Unrecognized != 1 {
		t.Fatalf("check = %+v", res)
	}
	if m := f.history(t, mb)[0]; m.SourceID == nil || *m.SourceID != first || m.Outcome != OutcomeUnrecognized {
		t.Fatalf("mail = %+v", m)
	}

	saved, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, later.ID, cardPattern(acc))
	if err != nil {
		t.Fatal(err)
	}
	if tried, _ := f.svc.TestPattern(ctx, f.wallet, mb.ID, later.ID, cardPattern(acc)); tried.Retry != 1 || tried.Total != 1 {
		t.Fatalf("test = %+v", tried)
	}
	if res, err := f.svc.ApplyPattern(ctx, f.wallet, mb.ID, later.ID, saved.ID); err != nil || res.Created != 1 {
		t.Fatalf("apply = %+v, %v", res, err)
	}
	if m := f.history(t, mb)[0]; m.SourceID == nil || *m.SourceID != later.ID || m.Outcome != OutcomeCreated {
		t.Fatalf("mail = %+v", m)
	}

	// A mail waiting that a source before it would read stays out of its
	// reach: here one its pattern found unverified, which the first source
	// now claims too.
	sendMail(t, f, "w2", "3,00", "Edicola Demo", "1234", false)
	_, _ = f.svc.Check(ctx, f.wallet, mb.ID)
	if m := f.history(t, mb)[0]; *m.SourceID != later.ID || m.Outcome != OutcomeUnverified {
		t.Fatalf("mail = %+v", m)
	}
	if _, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, first, cardPattern(acc)); err != nil {
		t.Fatal(err)
	}
	trusting := cardPattern(acc)
	trusting.RequireAuth = false
	if tried, _ := f.svc.TestPattern(ctx, f.wallet, mb.ID, later.ID, trusting); tried.Retry != 0 {
		t.Fatalf("a mail the first source claims counted for the later: %+v", tried)
	}
}

func TestRemovingASourceKeepsItsMails(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, _ := f.ledger(t)
	mb := f.connect(t)
	banca := f.addSource(t, mb, "Banca", "Banca")
	if _, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, banca.ID, cardPattern(acc)); err != nil {
		t.Fatal(err)
	}
	sendMailIn(t, f, "Banca", "d1", "6,43", "Bar Demo", "1234", true)
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.Created != 1 {
		t.Fatalf("check = %+v", res)
	}
	if err := f.svc.DeleteSource(ctx, f.wallet, mb.ID, banca.ID); err != nil {
		t.Fatal(err)
	}
	msgs := f.history(t, mb)
	if len(msgs) != 1 || msgs[0].SourceID != nil || msgs[0].SourceName != nil || msgs[0].Outcome != OutcomeCreated || msgs[0].TransactionID == nil {
		t.Fatalf("history = %+v", msgs)
	}
	if left, _ := f.q.ListMailPatterns(ctx, nullable(banca.ID)); len(left) != 0 {
		t.Fatalf("its patterns stayed: %+v", left)
	}
	if _, err := f.svc.Patterns(ctx, f.wallet, mb.ID, banca.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("patterns of a removed source: %v", err)
	}
	if err := f.svc.DeleteSource(ctx, f.wallet, mb.ID, src(mb)); !errors.Is(err, ErrLastSource) {
		t.Fatalf("the last source: %v", err)
	}
}

func TestSourcesStayInTheirMailboxAndWallet(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	mb := f.connect(t)
	own := src(mb)
	other, err := f.svc.insertMailbox(ctx, Cursor{}, func(q *db.Queries) (db.Mailbox, error) {
		return q.InsertMailbox(ctx, db.InsertMailboxParams{WalletID: f.wallet, Provider: ProviderIMAP, Address: "altro.demo@example.com", Secret: "x"})
	})
	if err != nil {
		t.Fatal(err)
	}
	foreign, _ := f.q.ListMailSources(ctx, other.ID)
	for name, c := range map[string]struct{ wallet, mailbox, source int64 }{
		"another wallet":           {f.other, mb.ID, own},
		"another mailbox's source": {f.wallet, mb.ID, foreign[0].ID},
		"through another mailbox":  {f.wallet, other.ID, own},
	} {
		for op, err := range map[string]error{
			"update": func() error {
				_, err := f.svc.UpdateSource(ctx, c.wallet, c.mailbox, c.source, ptr("X"), nil)
				return err
			}(),
			"delete": f.svc.DeleteSource(ctx, c.wallet, c.mailbox, c.source),
			"ai": func() error {
				_, err := f.svc.UpdateSourceAI(ctx, c.wallet, c.mailbox, c.source, SourceAI{Mode: AIModePatterns})
				return err
			}(),
			"check":    func() error { _, err := f.svc.CheckSource(ctx, c.wallet, c.mailbox, c.source); return err }(),
			"patterns": func() error { _, err := f.svc.Patterns(ctx, c.wallet, c.mailbox, c.source); return err }(),
			"create pattern": func() error {
				_, err := f.svc.CreatePattern(ctx, c.wallet, c.mailbox, c.source, cardPattern(1))
				return err
			}(),
			"apply": func() error { _, err := f.svc.ApplyPattern(ctx, c.wallet, c.mailbox, c.source, 1); return err }(),
		} {
			if !errors.Is(err, ErrNotFound) {
				t.Errorf("%s, %s: %v, want ErrNotFound", name, op, err)
			}
		}
	}
	if _, err := f.svc.CreateSource(ctx, f.other, mb.ID, "X", "INBOX"); !errors.Is(err, ErrNotFound) {
		t.Errorf("create in another wallet: %v", err)
	}
	if _, err := f.svc.ReorderSources(ctx, f.other, mb.ID, []int64{own}); !errors.Is(err, ErrNotFound) {
		t.Errorf("reorder in another wallet: %v", err)
	}
	if _, err := f.svc.ReorderSources(ctx, f.wallet, mb.ID, []int64{foreign[0].ID}); !errors.Is(err, ErrInvalid) {
		t.Errorf("reorder with another mailbox's source: %v", err)
	}
	if list, _ := f.svc.ListMailboxes(ctx, f.wallet); list[0].Sources[0].Name != "INBOX" {
		t.Fatalf("a refused call changed the source: %+v", list[0].Sources)
	}
}

// A folder deleted on the server is its source's trouble: the others are read,
// and the mailbox stays fine.
func TestAFolderThatIsGoneMarksOnlyItsSource(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	mb := f.connect(t)
	banca := f.addSource(t, mb, "Banca", "Banca")
	if err := f.user.Delete("Banca"); err != nil {
		t.Fatal(err)
	}
	appendMail(t, f.user, "INBOX", 1)
	if res, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil || res.New != 1 {
		t.Fatalf("check = %+v, %v", res, err)
	}
	list, _ := f.svc.ListMailboxes(ctx, f.wallet)
	got := list[0]
	if got.Status != StatusOK || got.Sources[0].Status != StatusOK || got.Sources[1].Status != StatusError ||
		!strings.Contains(got.Sources[1].StatusDetail, "Banca") || got.Sources[1].LastCheckAt == nil {
		t.Fatalf("mailbox = %+v", got)
	}
	if _, err := f.svc.CheckSource(ctx, f.wallet, mb.ID, banca.ID); !errors.Is(err, ErrFolder) {
		t.Fatalf("checking the source alone: %v", err)
	}
	if s, err := f.svc.UpdateSource(ctx, f.wallet, mb.ID, banca.ID, nil, ptr("INBOX")); err != nil || s.Status != StatusOK || s.StatusDetail != "" {
		t.Fatalf("another folder: %+v, %v", s, err)
	}
}

// A mail in two folders is stored once. Stored unclaimed, a source of the
// other folder that reads it takes it; claimed (an AI sender here, though the
// AI took it for no payment), it stays.
func TestTheSameMailInTwoFolders(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, _ := f.ledger(t)
	fa := &fakeAI{configured: true}
	f.svc.SetAI(fa)
	mb := f.connect(t)
	banca := f.addSource(t, mb, "Banca", "Banca")
	if _, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, banca.ID, cardPattern(acc)); err != nil {
		t.Fatal(err)
	}
	sendMail(t, f, "x1", "6,43", "Bar Demo", "1234", true)
	_, _ = f.svc.Check(ctx, f.wallet, mb.ID)
	sendMailIn(t, f, "Banca", "x1", "6,43", "Bar Demo", "1234", true)
	if res, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil || res.Created != 1 {
		t.Fatalf("check = %+v, %v", res, err)
	}
	msgs := f.history(t, mb)
	if len(msgs) != 1 || *msgs[0].SourceID != banca.ID || msgs[0].Outcome != OutcomeCreated {
		t.Fatalf("history = %+v", msgs)
	}

	f.setAI(t, mb, acc, AIModeAI)
	sendMail(t, f, "x2", "18,00", "Libreria Demo", "1234", true)
	_, _ = f.svc.Check(ctx, f.wallet, mb.ID)
	sendMailIn(t, f, "Banca", "x2", "18,00", "Libreria Demo", "1234", true)
	_, _ = f.svc.Check(ctx, f.wallet, mb.ID)
	msgs = f.history(t, mb)
	if len(msgs) != 2 || *msgs[0].SourceID != src(mb) || msgs[0].Outcome != OutcomeUnrecognized || len(fa.calls) != 1 {
		t.Fatalf("history = %+v, AI asked %d times", msgs, len(fa.calls))
	}
	if len(f.transactions(t, acc)) != 1 {
		t.Fatal("a claimed mail was read again by another source")
	}
}

func TestListenerListensToEachSource(t *testing.T) {
	withKey(t)
	f := newFixtureWith(t, fixtureOpts{})
	ctx := context.Background()
	mb := f.connect(t)
	first := src(mb)
	banca := f.addSource(t, mb, "Banca", "Banca")
	f.run(t)
	eventually(t, "both to idle", func() bool {
		return f.sourceOf(t, mb, first).Mode == ModeIdle && f.sourceOf(t, mb, banca.ID).Mode == ModeIdle
	})
	appendMail(t, f.user, "Banca", 1)
	eventually(t, "the mail of the second folder", func() bool { return len(f.messages(t, mb.ID)) == 1 })
	if m := f.messages(t, mb.ID)[0]; m.SourceID.Int64 != banca.ID {
		t.Fatalf("mail = %+v", m)
	}

	// The second source moves to the inbox and the first goes: only the
	// second's new listener can hear the inbox now (the full check is hours
	// away).
	if _, err := f.svc.UpdateSource(ctx, f.wallet, mb.ID, banca.ID, nil, ptr("INBOX")); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.DeleteSource(ctx, f.wallet, mb.ID, first); err != nil {
		t.Fatal(err)
	}
	eventually(t, "the removed source's listener to stop", func() bool {
		f.svc.mu.Lock()
		defer f.svc.mu.Unlock()
		_, ok := f.svc.live[first]
		return !ok
	})
	appendMail(t, f.user, "INBOX", 2)
	eventually(t, "the inbox mail", func() bool { return len(f.messages(t, mb.ID)) == 2 })
	eventually(t, "the moved source to idle", func() bool { return f.sourceOf(t, mb, banca.ID).Mode == ModeIdle })
}

// One refused password stops every source's listener, after one login.
func TestARefusedPasswordStopsEverySource(t *testing.T) {
	withKey(t)
	px := &proxy{}
	f := newFixtureWith(t, fixtureOpts{route: func(ep Endpoint) Endpoint { return px.start(t, ep) }})
	ctx := context.Background()
	addr := f.svc.outlook.Addr
	if err := f.svc.SetLocalIMAP(addr); err != nil {
		t.Fatal(err)
	}
	host, port, _ := net.SplitHostPort(addr)
	p, _ := strconv.Atoi(port)
	mb, err := f.svc.ConnectIMAP(ctx, f.wallet, f.uid, IMAPInput{Address: testUser, Password: testPass, Host: host, Port: p, Security: SecurityTLS})
	if err != nil {
		t.Fatal(err)
	}
	ids := []int64{src(mb), f.addSource(t, mb, "Banca", "Banca").ID, f.addSource(t, mb, "Secondo", "INBOX").ID}
	f.run(t)
	eventually(t, "every source to idle", func() bool {
		for _, id := range ids {
			if f.sourceOf(t, mb, id).Mode != ModeIdle {
				return false
			}
		}
		return true
	})
	if err := f.q.SetMailboxSecret(ctx, db.SetMailboxSecretParams{Secret: f.svc.seal("revoked"), ID: mb.ID}); err != nil {
		t.Fatal(err)
	}
	px.mu.Lock()
	before := px.dialled
	px.mu.Unlock()
	appendMail(t, f.user, "INBOX", 1)
	eventually(t, "every listener to stop", func() bool {
		list, _ := f.svc.ListMailboxes(ctx, f.wallet)
		for _, s := range list[0].Sources {
			if s.Mode != "" {
				return false
			}
		}
		return list[0].Status == StatusReauth
	})
	time.Sleep(10 * fastTiming.backoffMax / 2)
	px.mu.Lock()
	logins := px.dialled - before
	px.mu.Unlock()
	if logins != 1 {
		t.Fatalf("%d logins after the password was revoked, want 1", logins)
	}
}
