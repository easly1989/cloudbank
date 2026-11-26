package mailingest

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/emersion/go-imap/v2/imapclient"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Listener modes, as Source.Mode shows them.
const (
	ModeIdle    = "idle"
	ModePolling = "polling"
	ModeRetry   = "retry"
)

// watchTiming is how the listener paces itself. Tests shorten it.
type watchTiming struct {
	// renew ends and restarts IDLE, before the 29 minutes after which a
	// server may drop an idle client (RFC 2177); it also proves the
	// connection is still alive.
	renew time.Duration
	// full is the safety net: a complete check even when the server said
	// nothing, for a notification that got lost.
	full time.Duration
	// poll is how often a server without IDLE is asked.
	poll time.Duration
	// backoffFirst and backoffMax bound the wait before reconnecting, which
	// doubles after each failed attempt.
	backoffFirst, backoffMax time.Duration
	// look is how often the supervisor looks for sources added or removed
	// behind its back; changes made through the service wake it at once.
	look time.Duration
	// stable is how long a connection must have lasted for its loss to be
	// the server's housekeeping rather than a failure: the next attempt
	// comes at once, with no backoff.
	stable time.Duration
	// bye bounds the polite goodbye (DONE, LOGOUT) when shutting down.
	bye time.Duration
}

var defaultTiming = watchTiming{
	renew:        25 * time.Minute,
	full:         15 * time.Minute,
	poll:         5 * time.Minute,
	backoffFirst: 10 * time.Second,
	backoffMax:   10 * time.Minute,
	look:         time.Minute,
	stable:       5 * time.Minute,
	bye:          3 * time.Second,
}

// liveState is what the listener is doing for one source right now.
type liveState struct {
	mode string
	next time.Time
}

// errDropped means the server closed a listening connection.
var errDropped = errors.New("mailingest: the mail server closed the connection")

func (s *Service) setLive(id int64, mode string, next time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if mode == "" {
		delete(s.live, id)
		return
	}
	s.live[id] = liveState{mode: mode, next: next}
}

// wake asks the supervisor to look at the sources again now.
func (s *Service) wake() {
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

type watcher struct {
	folder string
	cancel context.CancelFunc
	done   chan struct{}
}

// Run listens to every source of every mailbox that is not paused and not
// waiting for a new sign-in, each on its own connection, until ctx ends; then
// it closes every connection and returns once all of them are gone. It does
// nothing where mailboxes cannot be connected.
func (s *Service) Run(ctx context.Context, logger *slog.Logger) {
	if !s.Available() {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	running := map[int64]*watcher{}
	stop := func(id int64) {
		w := running[id]
		w.cancel()
		<-w.done
		delete(running, id)
	}
	defer func() {
		for id := range running {
			stop(id)
		}
	}()

	look := time.NewTicker(s.timing.look)
	defer look.Stop()
	for {
		rows, err := s.q.ListSourcesToWatch(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Warn("mail: cannot list the sources to listen to", "error", err)
		} else {
			want := make(map[int64]db.ListSourcesToWatchRow, len(rows))
			for _, r := range rows {
				// Without an application id a Microsoft mailbox cannot be
				// reached: listening would fail and restart on every look.
				if r.Mailbox.Provider == ProviderMicrosoft && s.ms == nil {
					continue
				}
				want[r.MailSource.ID] = r
			}
			for id, w := range running {
				r, ok := want[id]
				finished := false
				select {
				case <-w.done:
					finished = true
				default:
				}
				if !ok || r.MailSource.Folder != w.folder || finished {
					stop(id)
				}
			}
			for id, r := range want {
				if _, ok := running[id]; ok {
					continue
				}
				wctx, cancel := context.WithCancel(ctx)
				w := &watcher{folder: r.MailSource.Folder, cancel: cancel, done: make(chan struct{})}
				running[id] = w
				go func(mb db.Mailbox, src db.MailSource) {
					defer close(w.done)
					s.watch(wctx, mb, src, logger)
				}(r.Mailbox, r.MailSource)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-s.kick:
		case <-look.C:
		}
	}
}

// watch keeps one source listened to: it reconnects after a failure, waiting
// longer each time, and gives up only when the mailbox needs a new sign-in or
// the source is gone.
func (s *Service) watch(ctx context.Context, mb db.Mailbox, src db.MailSource, logger *slog.Logger) {
	defer s.setLive(src.ID, "", time.Time{})
	var wait time.Duration
	for {
		began := time.Now()
		err := s.listen(ctx, mb, src)
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, ErrReauth) || errors.Is(err, ErrNotFound) || errors.Is(err, ErrUnavailable) {
			return
		}
		switch {
		case time.Since(began) >= s.timing.stable:
			// It worked for a good while: the server ended it, as servers do.
			wait = 0
		case wait == 0:
			wait = s.timing.backoffFirst
		default:
			wait = min(wait*2, s.timing.backoffMax)
		}
		if !errors.Is(err, errDropped) {
			logger.Info("mail: listening stopped, will try again", "mailbox", mb.ID, "source", src.ID, "in", wait, "error", err)
		}
		s.setLive(src.ID, ModeRetry, s.now().Add(wait))
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}

// listen runs one connection's worth of listening. It returns when the
// connection fails, the server ends it, or ctx ends.
func (s *Service) listen(ctx context.Context, mb db.Mailbox, src db.MailSource) error {
	wake := make(chan struct{}, 1)
	sess, err := s.openWatch(ctx, mb, wake)
	if err != nil {
		return err
	}
	if !s.canIdle(sess) {
		sess.Close()
		return s.poll(ctx, mb, src)
	}
	var idle *imapclient.IdleCommand
	defer func() { s.goodbye(sess, idle) }()
	if err := sess.Examine(src.Folder); err != nil {
		// The card says why (a failed login or check records itself; a
		// connection that drops says nothing, as it is nobody's fault). A
		// folder that is gone is its source's trouble only.
		s.recordSource(ctx, src, err)
		s.record(ctx, mb, err)
		return err
	}
	// The safety net first: whatever arrived while nobody was listening.
	if err := s.check(ctx, mb, src); err != nil {
		return err
	}
	if idle, err = sess.c.Idle(); err != nil {
		return err
	}

	full := time.NewTimer(s.timing.full)
	defer full.Stop()
	renew := time.NewTimer(s.timing.renew)
	defer renew.Stop()
	s.setLive(src.ID, ModeIdle, s.now().Add(s.timing.full))
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-sess.c.Closed():
			return errDropped
		case <-wake:
			if err := s.check(ctx, mb, src); err != nil {
				return err
			}
		case <-full.C:
			if err := s.check(ctx, mb, src); err != nil {
				return err
			}
			full.Reset(s.timing.full)
			s.setLive(src.ID, ModeIdle, s.now().Add(s.timing.full))
		case <-renew.C:
			// DONE and a fresh IDLE: the server's answer to DONE is also the
			// proof that the connection still works.
			cmd := idle
			idle = nil
			if err := cmd.Close(); err != nil {
				return err
			}
			if err := cmd.Wait(); err != nil {
				return err
			}
			if idle, err = sess.c.Idle(); err != nil {
				return err
			}
			renew.Reset(s.timing.renew)
		}
	}
}

// poll is listening for a server without IDLE: a check on a timer.
func (s *Service) poll(ctx context.Context, mb db.Mailbox, src db.MailSource) error {
	t := time.NewTimer(0)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
		if err := s.check(ctx, mb, src); err != nil {
			return err
		}
		s.setLive(src.ID, ModePolling, s.now().Add(s.timing.poll))
		t.Reset(s.timing.poll)
	}
}

// check is CheckSource for the listener, which knows the mailbox but not the
// request that would carry its wallet. It does not log in to a mailbox
// waiting for a new sign-in.
func (s *Service) check(ctx context.Context, mb db.Mailbox, src db.MailSource) error {
	_, err := s.checkAndAlert(ctx, mb.WalletID, mb.ID, src.ID, true)
	return err
}

// openWatch logs in for listening. The token is fetched under the mailbox's
// lock, like every other use of the credential, since renewing it rotates it.
// Another source's listener may have just found the login refused: then this
// one gives up without trying it again.
func (s *Service) openWatch(ctx context.Context, mb db.Mailbox, wake chan<- struct{}) (*Session, error) {
	lock := s.lockFor(mb.ID)
	lock.Lock()
	defer lock.Unlock()
	fresh, err := s.get(ctx, mb.WalletID, mb.ID)
	if err != nil {
		return nil, err
	}
	if fresh.Status == StatusReauth {
		return nil, ErrReauth
	}
	sess, err := s.connectTo(ctx, fresh, func(ep Endpoint, cred Credentials) (*Session, error) {
		return connectWatch(ctx, ep, cred, wake)
	})
	if err != nil {
		// A server that cannot run the feature says nothing about the mailbox.
		if !errors.Is(err, ErrUnavailable) {
			s.record(ctx, fresh, err)
		}
		return nil, err
	}
	return sess, nil
}

// goodbye ends a listening session politely (DONE if idling, then LOGOUT), but
// not for longer than a shutdown can wait: past that the connection is just
// closed.
func (s *Service) goodbye(sess *Session, idle *imapclient.IdleCommand) {
	done := make(chan struct{})
	go func() {
		if idle != nil {
			_ = idle.Close()
		}
		sess.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(s.timing.bye):
		_ = sess.c.Close()
		<-done
	}
}
