package updates

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
)

type fakeNotifier struct{ got []notify.Event }

func (f *fakeNotifier) NotifyAdmins(_ context.Context, build func(string) notify.Event) error {
	f.got = append(f.got, build("it"))
	return nil
}

// A newer build is announced to the admins with a ref per build, leading to
// About; an up-to-date one is not.
func TestNewVersionIsAnnounced(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct{ version, ref, title string }{
		{"v3.6.1", "new-version:v3.7.0", "È uscito CloudBank v3.7.0"},
		{"nightly-1111111", "new-version:33f8c80b53332c046f7ad94e7bf0ccd05f8b98ce", "È uscita una nightly più recente"},
	} {
		s, _ := newService(t, c.version, true)
		n := &fakeNotifier{}
		s.SetNotify(n)
		if _, err := s.Check(ctx); err != nil {
			t.Fatal(err)
		}
		if len(n.got) != 1 {
			t.Fatalf("%s: announced %+v", c.version, n.got)
		}
		e := n.got[0]
		if e.Kind != notify.KindNewVersion || e.Ref != c.ref || e.Title != c.title || e.URL != aboutURL ||
			e.Body != "Stai usando "+c.version+". Apri Informazioni per vedere le novità e come aggiornare." {
			t.Fatalf("%s: event = %+v", c.version, e)
		}
	}

	s, _ := newService(t, "v3.7.0", true)
	n := &fakeNotifier{}
	s.SetNotify(n)
	if _, err := s.Check(ctx); err != nil || len(n.got) != 0 {
		t.Fatalf("up to date: %v, announced %+v", err, n.got)
	}
}

// Every language CloudBank speaks has the notification's wording.
func TestAlertLanguages(t *testing.T) {
	for _, lang := range locale.Supported {
		x, ok := alertTexts[lang]
		if !ok || x.title == "" || x.nightly == "" || x.body == "" {
			t.Errorf("no complete update wording for %q", lang)
		}
	}
}
