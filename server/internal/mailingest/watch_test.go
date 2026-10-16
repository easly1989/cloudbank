package mailingest

import (
	"context"
	"io"
	"net"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// fastTiming makes the listener's clocks short enough for a test. The full
// check stays long, so a mail that arrives quickly came from IDLE or polling,
// not from the safety net.
var fastTiming = watchTiming{
	renew:        300 * time.Millisecond,
	full:         time.Hour,
	poll:         100 * time.Millisecond,
	backoffFirst: 20 * time.Millisecond,
	backoffMax:   100 * time.Millisecond,
	look:         50 * time.Millisecond,
	stable:       time.Hour,
	bye:          time.Second,
}

// run starts the listener for the test and returns a stop that waits for it.
func (f *fixture) run(t *testing.T) (stop func()) {
	t.Helper()
	f.svc.timing = fastTiming
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		f.svc.Run(ctx, nil)
		close(done)
	}()
	var once sync.Once
	stop = func() {
		once.Do(func() {
			cancel()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("the listener did not stop")
			}
		})
	}
	t.Cleanup(stop)
	return stop
}

// eventually waits for cond, failing the test after a few seconds.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func (f *fixture) messages(t *testing.T, id int64) []db.ListMailMessagesRow {
	t.Helper()
	rows, err := f.q.ListMailMessages(context.Background(), db.ListMailMessagesParams{MailboxID: id, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func (f *fixture) mode(t *testing.T, id int64) string {
	t.Helper()
	boxes, err := f.svc.ListMailboxes(context.Background(), f.wallet)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range boxes {
		if b.ID == id {
			return b.Mode
		}
	}
	return "gone"
}

func TestListenerHearsNewMailThroughIdle(t *testing.T) {
	withKey(t)
	f := newFixtureWith(t, fixtureOpts{})
	mb := f.connect(t)
	f.run(t)

	eventually(t, "the listener to idle", func() bool { return f.mode(t, mb.ID) == ModeIdle })
	appendMail(t, f.user, "INBOX", 1)
	eventually(t, "the mail to arrive", func() bool { return len(f.messages(t, mb.ID)) == 1 })

	// It keeps listening across an IDLE renewal.
	time.Sleep(2 * fastTiming.renew)
	appendMail(t, f.user, "INBOX", 2)
	eventually(t, "the second mail", func() bool { return len(f.messages(t, mb.ID)) == 2 })
	if got := f.mode(t, mb.ID); got != ModeIdle {
		t.Fatalf("mode = %q, want idle", got)
	}
}

func TestListenerPollsAServerWithoutIdle(t *testing.T) {
	withKey(t)
	f := newFixtureWith(t, fixtureOpts{noIdle: true})
	mb := f.connect(t)
	f.run(t)

	eventually(t, "polling", func() bool { return f.mode(t, mb.ID) == ModePolling })
	appendMail(t, f.user, "INBOX", 1)
	eventually(t, "the mail to arrive", func() bool { return len(f.messages(t, mb.ID)) == 1 })
}

func TestListenerSkipsPausedMailboxes(t *testing.T) {
	withKey(t)
	f := newFixtureWith(t, fixtureOpts{})
	mb := f.connect(t)
	paused := true
	if _, err := f.svc.Update(context.Background(), f.wallet, mb.ID, nil, &paused); err != nil {
		t.Fatal(err)
	}
	f.run(t)
	appendMail(t, f.user, "INBOX", 1)
	time.Sleep(300 * time.Millisecond)
	if n := len(f.messages(t, mb.ID)); n != 0 || f.mode(t, mb.ID) != "" {
		t.Fatalf("a paused mailbox was read: %d mails, mode %q", n, f.mode(t, mb.ID))
	}

	// Resuming wakes the listener at once.
	paused = false
	if _, err := f.svc.Update(context.Background(), f.wallet, mb.ID, nil, &paused); err != nil {
		t.Fatal(err)
	}
	eventually(t, "the mail after resuming", func() bool { return len(f.messages(t, mb.ID)) == 1 })
}

func TestListenerRecoversWhatArrivedWhileDisconnected(t *testing.T) {
	withKey(t)
	px := &proxy{}
	f := newFixtureWith(t, fixtureOpts{route: func(ep Endpoint) Endpoint { return px.start(t, ep) }})
	mb := f.connect(t)
	f.run(t)
	eventually(t, "the listener to idle", func() bool { return f.mode(t, mb.ID) == ModeIdle })

	// The network goes: every connection is cut and new ones are refused.
	px.down()
	eventually(t, "the listener to notice", func() bool { return f.mode(t, mb.ID) == ModeRetry })
	appendMail(t, f.user, "INBOX", 1)
	appendMail(t, f.user, "INBOX", 2)
	time.Sleep(150 * time.Millisecond)
	if n := len(f.messages(t, mb.ID)); n != 0 {
		t.Fatalf("read %d mails with the network down", n)
	}

	px.up()
	eventually(t, "the mails from the outage", func() bool { return len(f.messages(t, mb.ID)) == 2 })
	eventually(t, "the listener to idle again", func() bool { return f.mode(t, mb.ID) == ModeIdle })
	appendMail(t, f.user, "INBOX", 3)
	eventually(t, "the next mail", func() bool { return len(f.messages(t, mb.ID)) == 3 })
	time.Sleep(150 * time.Millisecond)
	seen := map[string]bool{}
	for _, m := range f.messages(t, mb.ID) {
		if seen[m.MessageID] {
			t.Fatalf("mail %s read twice", m.MessageID)
		}
		seen[m.MessageID] = true
	}
	if len(seen) != 3 {
		t.Fatalf("%d mails, want 3", len(seen))
	}
}

func TestListenerLeavesNothingRunningWhenStopped(t *testing.T) {
	withKey(t)
	f := newFixtureWith(t, fixtureOpts{})
	mb := f.connect(t)
	// A second service on a server without IDLE, so a polling listener is
	// stopped too.
	f2 := newFixtureWith(t, fixtureOpts{noIdle: true})
	mb2 := f2.connect(t)
	before := runtime.NumGoroutine()
	stop := f.run(t)
	stop2 := f2.run(t)
	eventually(t, "listening", func() bool {
		return f.mode(t, mb.ID) == ModeIdle && f2.mode(t, mb2.ID) == ModePolling
	})
	stop()
	stop2()
	if f.mode(t, mb.ID) != "" || f2.mode(t, mb2.ID) != "" {
		t.Fatal("a stopped listener still reports a mode")
	}
	eventually(t, "every goroutine to end", func() bool { return runtime.NumGoroutine() <= before })
}

func TestListenerGivesUpUntilSignedInAgain(t *testing.T) {
	withKey(t)
	f := newFixtureWith(t, fixtureOpts{},
		oauthError("authorization_pending"), tokenOK("refresh-1"), oauthError("invalid_grant"))
	mb := f.connect(t)
	f.svc.mu.Lock()
	delete(f.svc.tokens, mb.ID) // the next login renews, and Microsoft refuses
	f.svc.mu.Unlock()
	f.run(t)
	eventually(t, "the mailbox to ask for a sign-in", func() bool {
		boxes, _ := f.svc.ListMailboxes(context.Background(), f.wallet)
		return len(boxes) == 1 && boxes[0].Status == StatusReauth && boxes[0].Mode == ""
	})
}

// proxy stands between the listener and the mail server, so a test can take
// the network away and give it back.
type proxy struct {
	mu     sync.Mutex
	target string
	isDown bool
	conns  []net.Conn
}

func (p *proxy) start(t *testing.T, ep Endpoint) Endpoint {
	t.Helper()
	p.target = ep.Addr
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = ln.Close()
		p.down()
	})
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			p.mu.Lock()
			if p.isDown {
				p.mu.Unlock()
				_ = c.Close()
				continue
			}
			up, err := net.Dial("tcp", p.target)
			if err != nil {
				p.mu.Unlock()
				_ = c.Close()
				continue
			}
			p.conns = append(p.conns, c, up)
			p.mu.Unlock()
			go func() { _, _ = io.Copy(up, c); _ = up.Close() }()
			go func() { _, _ = io.Copy(c, up); _ = c.Close() }()
		}
	}()
	return Endpoint{Addr: ln.Addr().String()}
}

func (p *proxy) down() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.isDown = true
	for _, c := range p.conns {
		_ = c.Close()
	}
	p.conns = nil
}

func (p *proxy) up() {
	p.mu.Lock()
	p.isDown = false
	p.mu.Unlock()
}
