package auth

import (
	"sync"
	"time"
)

// rateLimiter is a small in-memory fixed-window limiter keyed by an arbitrary
// string (here: client IP + username). It bounds failed-login attempts without
// any external dependency. Successful logins reset the key.
type rateLimiter struct {
	mu          sync.Mutex
	window      time.Duration
	maxAttempts int
	hits        map[string]*window
	now         func() time.Time
	lastGC      time.Time
	gcEvery     time.Duration
}

type window struct {
	count int
	start time.Time
}

func newRateLimiter(maxAttempts int, win time.Duration) *rateLimiter {
	return &rateLimiter{
		window:      win,
		maxAttempts: maxAttempts,
		hits:        make(map[string]*window),
		now:         time.Now,
		gcEvery:     10 * time.Minute,
	}
}

// allow reports whether an attempt for key is permitted right now. It does not
// itself count the attempt; call record on failure.
func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.hits[key]
	if w == nil {
		return true
	}
	if l.now().Sub(w.start) >= l.window {
		delete(l.hits, key)
		return true
	}
	return w.count < l.maxAttempts
}

// record counts a failed attempt for key.
func (l *rateLimiter) record(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.gcLocked()
	now := l.now()
	w := l.hits[key]
	if w == nil || now.Sub(w.start) >= l.window {
		l.hits[key] = &window{count: 1, start: now}
		return
	}
	w.count++
}

// reset clears the counter for key, e.g. after a successful login.
func (l *rateLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

// gcLocked drops expired windows occasionally to bound memory. Caller holds mu.
func (l *rateLimiter) gcLocked() {
	now := l.now()
	if now.Sub(l.lastGC) < l.gcEvery {
		return
	}
	l.lastGC = now
	for k, w := range l.hits {
		if now.Sub(w.start) >= l.window {
			delete(l.hits, k)
		}
	}
}
