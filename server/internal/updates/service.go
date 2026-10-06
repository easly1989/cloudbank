// Package updates tells an admin that a newer CloudBank has been published
// (#582). Once a day the server reads the list of published versions — the
// same versions.json the website reads, on the repository's site-data branch —
// and compares it with the version it was built as. It sends nothing: it is a
// plain request for a public file, made by the server so that GitHub sees one
// address rather than every device that opens the app.
//
// Updating stays outside the app. Replacing the container from inside would
// need the Docker socket, and whoever holds that socket holds the host.
package updates

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// DefaultURL is where the published versions are listed.
const DefaultURL = "https://raw.githubusercontent.com/easly1989/cloudbank/site-data/versions.json"

const repo = "https://github.com/easly1989/cloudbank"

// settingKey stores whether an admin left the check on ("1") or turned it off ("0").
const settingKey = "update_check"

// Channels: what a build follows, read from its version.
const (
	Stable  = "stable"
	Nightly = "nightly"
)

// Status is what the app shows: the build, the newest published one on its
// channel, and whether the check runs at all.
type Status struct {
	// Enabled is the admin's choice; Allowed is the server's (CB_UPDATE_CHECK).
	Enabled bool   `json:"enabled"`
	Allowed bool   `json:"allowed"`
	Channel string `json:"channel"`
	Current string `json:"current"`
	// Latest and the fields after it are set once a check has succeeded.
	Latest     string `json:"latest,omitempty"`
	Available  bool   `json:"available"`
	Published  string `json:"published,omitempty"`
	ReleaseURL string `json:"releaseUrl,omitempty"`
	CheckedAt  string `json:"checkedAt,omitempty"`
	Error      string `json:"error,omitempty"`
}

// Service runs the check and remembers its last answer.
type Service struct {
	q       *db.Queries
	current string
	allowed bool
	url     string
	client  *http.Client
	now     func() time.Time

	mu   sync.Mutex
	last *result
}

type result struct {
	latest, published, sha string
	checkedAt              time.Time
	err                    error
}

// New prepares the check for a build of the given version. allowed is false
// when CB_UPDATE_CHECK turns it off for the whole installation.
func New(write *sql.DB, version string, allowed bool) *Service {
	return &Service{
		q:       db.New(write),
		current: version,
		allowed: allowed,
		url:     DefaultURL,
		client:  &http.Client{Timeout: 15 * time.Second},
		now:     time.Now,
	}
}

// SetURL points the check elsewhere (tests).
func (s *Service) SetURL(u string) { s.url = u }

// ChannelOf says which published versions a build follows: "v1.2.3" a stable
// release, "nightly-<sha>" the nightly; anything else (a local "dev" build) none.
func ChannelOf(version string) string {
	switch {
	case strings.HasPrefix(version, "nightly-"):
		return Nightly
	case parseSemver(version) != nil:
		return Stable
	}
	return ""
}

func (s *Service) enabled(ctx context.Context) (bool, error) {
	v, err := s.q.GetInstanceSetting(ctx, settingKey)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil // on unless an admin turned it off
	}
	if err != nil {
		return false, err
	}
	return v != "0", nil
}

// active reports whether checks run: allowed, enabled and on a channel.
func (s *Service) active(ctx context.Context) (bool, error) {
	if !s.allowed || ChannelOf(s.current) == "" {
		return false, nil
	}
	return s.enabled(ctx)
}

// Status returns the last answer without asking again.
func (s *Service) Status(ctx context.Context) (Status, error) {
	on, err := s.enabled(ctx)
	if err != nil {
		return Status{}, err
	}
	st := Status{Enabled: on, Allowed: s.allowed, Channel: ChannelOf(s.current), Current: s.current}
	s.mu.Lock()
	last := s.last
	s.mu.Unlock()
	if last == nil || !on || !s.allowed {
		return st, nil
	}
	st.CheckedAt = last.checkedAt.UTC().Format(time.RFC3339)
	if last.err != nil {
		st.Error = last.err.Error()
		return st, nil
	}
	st.Latest, st.Published = last.latest, last.published
	switch st.Channel {
	case Stable:
		st.Available = newer(last.latest, s.current)
		st.ReleaseURL = repo + "/releases/tag/" + last.latest
	case Nightly:
		cur := strings.TrimPrefix(s.current, "nightly-")
		st.Available = last.sha != "" && !strings.HasPrefix(last.sha, cur)
		st.ReleaseURL = repo + "/compare/" + cur + "..." + shortSHA(last.sha)
	}
	return st, nil
}

// SetEnabled records the admin's choice; turning the check on runs it.
func (s *Service) SetEnabled(ctx context.Context, on bool) (Status, error) {
	v := "0"
	if on {
		v = "1"
	}
	if err := s.q.SetInstanceSetting(ctx, db.SetInstanceSettingParams{Key: settingKey, Value: v}); err != nil {
		return Status{}, err
	}
	if on {
		return s.Check(ctx)
	}
	return s.Status(ctx)
}

// Check asks for the published versions now, when checks are active.
func (s *Service) Check(ctx context.Context) (Status, error) {
	active, err := s.active(ctx)
	if err != nil {
		return Status{}, err
	}
	if active {
		r := s.fetch(ctx)
		s.mu.Lock()
		s.last = &r
		s.mu.Unlock()
	}
	return s.Status(ctx)
}

type published struct {
	Version   string `json:"version"`
	SHA       string `json:"sha"`
	Published string `json:"published"`
}

func (s *Service) fetch(ctx context.Context) result {
	r := result{checkedAt: s.now()}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		r.err = err
		return r
	}
	resp, err := s.client.Do(req)
	if err != nil {
		r.err = errors.New("could not reach GitHub")
		return r
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		r.err = fmt.Errorf("GitHub answered %d", resp.StatusCode)
		return r
	}
	var list map[string]published
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		r.err = errors.New("the list of versions could not be read")
		return r
	}
	p, ok := list[ChannelOf(s.current)]
	if !ok || p.Version == "" {
		r.err = errors.New("no version is published on this channel")
		return r
	}
	r.latest, r.published, r.sha = p.Version, p.Published, p.SHA
	return r
}

// Run checks a minute after start, then once a day, while checks are active.
func (s *Service) Run(ctx context.Context, logger *slog.Logger) {
	run := func() {
		st, err := s.Check(ctx)
		switch {
		case err != nil:
			logger.Error("update check failed", "error", err)
		case st.Error != "":
			logger.Warn("update check: no answer", "reason", st.Error)
		case st.Available:
			logger.Info("a newer CloudBank is published", "current", st.Current, "latest", st.Latest)
		}
	}
	timer := time.NewTimer(time.Minute)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return
	case <-timer.C:
	}
	run()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func shortSHA(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

// parseSemver reads "v1.2.3" (a suffix after the patch, like "-rc1", is
// ignored); nil when the version is not one.
func parseSemver(v string) []int {
	v, ok := strings.CutPrefix(v, "v")
	if !ok {
		return nil
	}
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return nil
	}
	out := make([]int, 3)
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil
		}
		out[i] = n
	}
	return out
}

// newer reports whether version a is later than b.
func newer(a, b string) bool {
	x, y := parseSemver(a), parseSemver(b)
	if x == nil || y == nil {
		return false
	}
	for i := range x {
		if x[i] != y[i] {
			return x[i] > y[i]
		}
	}
	return false
}
