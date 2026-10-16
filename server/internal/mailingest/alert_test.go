package mailingest

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/locale"
)

// pushes records what the service announced, sending each ref once like the
// push service does.
type pushes struct {
	mu   sync.Mutex
	refs map[string]bool
	sent []string // "user|title|body|url"
}

func (p *pushes) notify(_ context.Context, userID int64, ref, title, body, url string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.refs == nil {
		p.refs = map[string]bool{}
	}
	if p.refs[ref] {
		return nil
	}
	p.refs[ref] = true
	p.sent = append(p.sent, strings.Join([]string{strconv.FormatInt(userID, 10), title, body, url}, "|"))
	return nil
}

func (p *pushes) list() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.sent...)
}

func TestARefusedSignInIsAnnouncedOncePerEpisode(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	mb := f.connect(t)
	p := &pushes{}
	f.svc.SetNotify(p.notify)

	// The mail server refuses every token: three failed checks, one push.
	good := f.svc.tokenAuth
	f.svc.tokenAuth = func(user, _ string) Credentials { return Credentials{Username: user, Password: "wrong"} }
	for i := 0; i < 3; i++ {
		f.tick(time.Second)
		if _, err := f.svc.Check(ctx, f.wallet, mb.ID); !errors.Is(err, ErrLogin) {
			t.Fatalf("check %d: %v, want ErrLogin", i, err)
		}
	}
	got := p.list()
	if len(got) != 1 {
		t.Fatalf("pushes = %q, want one", got)
	}
	// In the language of the person who connected it (the fixture's users
	// speak Italian), leading to the mailbox's settings.
	if !strings.Contains(got[0], "Mail della banca ferme") || !strings.Contains(got[0], testUser) || !strings.HasSuffix(got[0], "|/settings/mail") {
		t.Fatalf("push = %q", got[0])
	}

	// A check that works ends the episode; the next failure is a new one.
	f.svc.tokenAuth = good
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	f.svc.tokenAuth = func(user, _ string) Credentials { return Credentials{Username: user, Password: "wrong"} }
	f.tick(time.Second)
	_, _ = f.svc.Check(ctx, f.wallet, mb.ID)
	if n := len(p.list()); n != 2 {
		t.Fatalf("pushes after a second episode = %d, want 2", n)
	}
}

func TestAStaleTokenIsRenewedBeforeTheLoginCounts(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	mb := f.connect(t)
	p := &pushes{}
	f.svc.SetNotify(p.notify)

	// The cached token is one the server no longer takes; the login renews it
	// and succeeds, so nothing is announced and the mailbox stays fine.
	f.svc.mu.Lock()
	f.svc.tokens[mb.ID] = cachedToken{access: "stale", expiry: f.clock.Add(time.Hour)}
	f.svc.mu.Unlock()
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatalf("check with a stale token: %v", err)
	}
	if got := p.list(); len(got) != 0 {
		t.Fatalf("pushes = %q", got)
	}
}

func TestUnrecognizedMailsAreAnnouncedAtMostOnceADay(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	mb := f.connect(t)
	p := &pushes{}
	f.svc.SetNotify(p.notify)

	appendMail(t, f.user, "INBOX", 1)
	appendMail(t, f.user, "INBOX", 2)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	appendMail(t, f.user, "INBOX", 3)
	f.tick(3 * time.Hour)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	got := p.list()
	if len(got) != 1 || !strings.Contains(got[0], "2 mail in "+testUser) {
		t.Fatalf("pushes the first day = %q", got)
	}

	f.tick(24 * time.Hour)
	appendMail(t, f.user, "INBOX", 4)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	if got := p.list(); len(got) != 2 || !strings.Contains(got[1], "Una mail in "+testUser) {
		t.Fatalf("pushes the next day = %q", got)
	}
}

func TestNothingIsAnnouncedWithoutPush(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	mb := f.connect(t)
	appendMail(t, f.user, "INBOX", 1)
	// No notifier wired: the check still works.
	if _, err := f.svc.Check(context.Background(), f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
}

func TestEveryLanguageHasAlertTexts(t *testing.T) {
	for _, code := range locale.Supported {
		txt, ok := alertTexts[code]
		if !ok {
			t.Fatalf("no alert texts for %q", code)
		}
		if txt.stoppedTitle == "" || txt.stopped == "" || txt.unrecTitle == "" || txt.unrecOne == "" || txt.unrecMany == "" {
			t.Fatalf("incomplete alert texts for %q", code)
		}
	}
}
