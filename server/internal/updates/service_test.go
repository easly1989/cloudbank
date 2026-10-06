package updates

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
)

const list = `{
 "nightly": {"image": "ghcr.io/easly1989/cloudbank:latest", "sha": "33f8c80b53332c046f7ad94e7bf0ccd05f8b98ce", "published": "2026-10-06T07:00:03Z", "version": "nightly-33f8c80"},
 "stable": {"image": "ghcr.io/easly1989/cloudbank:main", "sha": "8fad9493d984372b1eedf45e1450e7812e58374b", "published": "2026-09-29T13:40:17Z", "version": "v3.7.0"}
}`

func newService(t *testing.T, version string, allowed bool) (*Service, *int) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits++
		_, _ = w.Write([]byte(list))
	}))
	t.Cleanup(srv.Close)
	s := New(st.Write(), version, allowed)
	s.SetURL(srv.URL)
	return s, &hits
}

func TestChannelOf(t *testing.T) {
	for v, want := range map[string]string{
		"v3.6.1": Stable, "v3.7.0-rc1": Stable, "nightly-33f8c80": Nightly,
		"dev": "", "main": "", "3.6.1": "",
	} {
		if got := ChannelOf(v); got != want {
			t.Errorf("ChannelOf(%q) = %q, want %q", v, got, want)
		}
	}
}

func TestStableSeesANewerRelease(t *testing.T) {
	ctx := context.Background()
	s, _ := newService(t, "v3.6.1", true)
	st, err := s.Check(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Available || st.Latest != "v3.7.0" || st.Channel != Stable || !st.Enabled {
		t.Fatalf("status = %+v", st)
	}
	if st.ReleaseURL != "https://github.com/easly1989/cloudbank/releases/tag/v3.7.0" {
		t.Errorf("release url = %q", st.ReleaseURL)
	}
	if st.CheckedAt == "" {
		t.Error("checkedAt not set")
	}

	same, _ := newService(t, "v3.7.0", true)
	if st, _ := same.Check(ctx); st.Available {
		t.Errorf("the latest release itself is not an update: %+v", st)
	}
	ahead, _ := newService(t, "v3.8.0", true)
	if st, _ := ahead.Check(ctx); st.Available {
		t.Errorf("a build ahead of the list is not behind: %+v", st)
	}
}

func TestNightlyComparesCommits(t *testing.T) {
	ctx := context.Background()
	old, _ := newService(t, "nightly-1111111", true)
	st, _ := old.Check(ctx)
	if !st.Available || st.Latest != "nightly-33f8c80" {
		t.Fatalf("status = %+v", st)
	}
	if st.ReleaseURL != "https://github.com/easly1989/cloudbank/compare/1111111...33f8c80" {
		t.Errorf("release url = %q", st.ReleaseURL)
	}
	current, _ := newService(t, "nightly-33f8c80", true)
	if st, _ := current.Check(ctx); st.Available {
		t.Errorf("the latest nightly itself is not an update: %+v", st)
	}
}

func TestOffMeansNoRequest(t *testing.T) {
	ctx := context.Background()

	// The server's configuration turns it off.
	s, hits := newService(t, "v3.6.1", false)
	st, _ := s.Check(ctx)
	if *hits != 0 || st.Allowed || st.Available {
		t.Errorf("CB_UPDATE_CHECK=false still asked: hits=%d %+v", *hits, st)
	}

	// A local build follows no channel.
	dev, hits := newService(t, "dev", true)
	if _, _ = dev.Check(ctx); *hits != 0 {
		t.Errorf("a dev build asked: hits=%d", *hits)
	}

	// The admin turns it off, and back on.
	on, hits := newService(t, "v3.6.1", true)
	st, err := on.SetEnabled(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if st.Enabled || *hits != 0 {
		t.Errorf("after turning off: hits=%d %+v", *hits, st)
	}
	if st, _ := on.Check(ctx); *hits != 0 || st.Available {
		t.Errorf("turned off, a check still asked: hits=%d %+v", *hits, st)
	}
	st, _ = on.SetEnabled(ctx, true)
	if !st.Enabled || *hits != 1 || !st.Available {
		t.Errorf("turning on checks at once: hits=%d %+v", *hits, st)
	}
}

func TestUnreachableIsReportedNotFatal(t *testing.T) {
	s, _ := newService(t, "v3.6.1", true)
	s.SetURL("http://127.0.0.1:1/versions.json")
	st, err := s.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.Error == "" || st.Available {
		t.Errorf("status = %+v", st)
	}
}
