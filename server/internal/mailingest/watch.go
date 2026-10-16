package mailingest

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/emersion/go-imap/v2/imapclient"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Listener modes, as Mailbox.Mode shows them.
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
	// look is how often the supervisor looks for mailboxes added or removed
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

// liveState is what the listener is doing for one mailbox right now.
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

// wake asks the supervisor to look at the mailboxes again now.
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

// Run listens to every mailbox that is not paused and not waiting for a new
// sign-in, until ctx ends; then it closes every connection and returns once
// all of them are gone. It does nothing where mailboxes cannot be connected.
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
		rows, err := s.rq.ListMailboxesToWatch(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Warn("mail: cannot list the mailboxes to listen to", "error", err)
		} else {
			want := make(map[int64]db.Mailbox, len(rows))
			for _, r := range rows {
				want[r.ID] = r
			}
			for id, w := range running {
				r, ok := want[id]
				finished := false
				select {
				case <-w.done:
					finished = true
				default:
				}
				if !ok || r.Folder != w.folder || finished {
					stop(id)
				}
			}
			for id, r := range want {
				if _, ok := running[id]; ok {
					continue
				}
				wctx, cancel := context.WithCancel(ctx)
				w := &watcher{folder: r.Folder, cancel: cancel, done: make(chan struct{})}
				running[id] = w
				go func(mb db.Mailbox) {
					defer close(w.done)
					s.watch(wctx, mb, logger)
				}(r)
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

// watch keeps one mailbox listened to: it reconnects after a failure, waiting
// longer each time, and gives up only when the mailbox needs a new sign-in or
// is gone.
func (s *Service) watch(ctx context.Context, mb db.Mailbox, logger *slog.Logger) {
	defer s.setLive(mb.ID, "", time.Time{})
	var wait time.Duration
	for {
		began := time.Now()
		err := s.listen(ctx, mb)
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
			logger.Info("mail: listening stopped, will try again", "mailbox", mb.ID, "in", wait, "error", err)
		}
		s.setLive(mb.ID, ModeRetry, s.now().Add(wait))
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
func (s *Service) listen(ctx context.Context, mb db.Mailbox) error {
	wake := make(chan struct{}, 1)
	sess, err := s.openWatch(ctx, mb, wake)
	if err != nil {
		return err
	}
	if !s.canIdle(sess) {
		sess.Close()
		return s.poll(ctx, mb)
	}
	var idle *imapclient.IdleCommand
	defer func() { s.goodbye(sess, idle) }()
	if err := sess.Examine(mb.Folder); err != nil {
		// The card says why (a failed login or check records itself; a
		// connection that drops says nothing, as it is nobody's fault).
		s.record(ctx, mb, err)
		return err
	}
	// The safety net first: whatever arrived while nobody was listening.
	if err := s.check(ctx, mb); err != nil {
		return err
	}
	if idle, err = sess.c.Idle(); err != nil {
		return err
	}

	full := time.NewTimer(s.timing.full)
	defer full.Stop()
	renew := time.NewTimer(s.timing.renew)
	defer renew.Stop()
	s.setLive(mb.ID, ModeIdle, s.now().Add(s.timing.full))
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-sess.c.Closed():
			return errDropped
		case <-wake:
			if err := s.check(ctx, mb); err != nil {
				return err
			}
		case <-full.C:
			if err := s.check(ctx, mb); err != nil {
				return err
			}
			full.Reset(s.timing.full)
			s.setLive(mb.ID, ModeIdle, s.now().Add(s.timing.full))
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
func (s *Service) poll(ctx context.Context, mb db.Mailbox) error {
	t := time.NewTimer(0)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
		if err := s.check(ctx, mb); err != nil {
			return err
		}
		s.setLive(mb.ID, ModePolling, s.now().Add(s.timing.poll))
		t.Reset(s.timing.poll)
	}
}

// check is Check for the listener, which knows the mailbox but not the request
// that would carry its wallet.
func (s *Service) check(ctx context.Context, mb db.Mailbox) error {
	_, err := s.Check(ctx, mb.WalletID, mb.ID)
	return err
}

// openWatch logs in for listening. The token is fetched under the mailbox's
// lock, like every other use of the credential, since renewing it rotates it.
func (s *Service) openWatch(ctx context.Context, mb db.Mailbox, wake chan<- struct{}) (*Session, error) {
	lock := s.lockFor(mb.ID)
	lock.Lock()
	defer lock.Unlock()
	fresh, err := s.get(ctx, mb.WalletID, mb.ID)
	if err != nil {
		return nil, err
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
