package banksync

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
)

// walletTold is one NotifyWallet call, with the event built in two languages.
type walletTold struct {
	walletID int64
	en, it   notify.Event
}

type fakeNotifier struct{ got []walletTold }

func (f *fakeNotifier) NotifyWallet(_ context.Context, walletID int64, build func(string) notify.Event) error {
	f.got = append(f.got, walletTold{walletID, build("en"), build("it")})
	return nil
}

func (f *fakeNotifier) take() []walletTold {
	got := f.got
	f.got = nil
	return got
}

// failingDoer claims like mockDoer but the bank refuses every fetch while
// fail is set.
type failingDoer struct {
	mockDoer
	fail bool
}

func (d *failingDoer) Do(r *http.Request) (*http.Response, error) {
	if d.fail && r.Method == http.MethodGet {
		return &http.Response{StatusCode: http.StatusForbidden, Body: io.NopCloser(strings.NewReader(""))}, nil
	}
	return d.mockDoer.Do(r)
}

// A background sync that fails is announced to the wallet, once per episode,
// leading to the Bank sync page; a manual one is not, its failure is on screen.
func TestSyncFailureIsAnnouncedOncePerEpisode(t *testing.T) {
	svc, _, _, wid, acc := newFixture(t)
	ctx := context.Background()
	doer := &failingDoer{}
	svc.hc = doer
	n := &fakeNotifier{}
	svc.SetNotify(n)
	token := base64.StdEncoding.EncodeToString([]byte("https://example.test/claim/x"))
	conn, _, err := svc.Connect(ctx, wid, token, "Banca Demo")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Link(ctx, wid, conn.ID, "ACT-1", acc); err != nil {
		t.Fatal(err)
	}

	doer.fail = true
	_, _ = svc.Sync(ctx, wid, conn.ID)
	if got := n.take(); len(got) != 0 {
		t.Fatalf("manual failure announced: %+v", got)
	}
	// The manual failure already opened the episode.
	_, _ = svc.syncAndRecord(ctx, wid, conn.ID, "auto")
	if got := n.take(); len(got) != 0 {
		t.Fatalf("second failure announced: %+v", got)
	}

	doer.fail = false
	if _, err := svc.syncAndRecord(ctx, wid, conn.ID, "auto"); err != nil {
		t.Fatal(err)
	}
	doer.fail = true
	for range 2 {
		_, _ = svc.syncAndRecord(ctx, wid, conn.ID, "auto")
	}
	got := n.take()
	if len(got) != 1 || got[0].walletID != wid {
		t.Fatalf("announced %+v, want one for wallet %d", got, wid)
	}
	e := got[0].it
	if e.Kind != notify.KindBankSyncFailed || e.URL != alertsURL || e.Ref == "" ||
		e.Title != "Sync bancario non riuscito" || !strings.Contains(e.Body, "sincronizzare Banca Demo.") {
		t.Fatalf("event = %+v", e)
	}
}

// A bank consent that ends within a week is announced with its day, in each
// reader's language; one further away, already over or unreadable is not.
func TestWarnExpiringConsents(t *testing.T) {
	svc, _, st, wid, _ := newFixture(t)
	ctx := context.Background()
	n := &fakeNotifier{}
	svc.SetNotify(n)
	now := time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC)
	for _, c := range []struct{ name, aspsp, until string }{
		{"", "Banca Demo", "2026-10-25T00:00:00Z"},
		{"Later", "X", "2026-11-30T00:00:00Z"},
		{"Over", "X", "2026-10-18T00:00:00Z"},
		{"Broken", "X", "soon"},
	} {
		if _, err := st.Write().ExecContext(ctx,
			`INSERT INTO bank_connections (wallet_id, provider, access_url, name, aspsp_name, valid_until) VALUES (?, 'enablebanking', '', ?, ?, ?)`,
			wid, c.name, c.aspsp, c.until); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.WarnExpiringConsents(ctx, now); err != nil {
		t.Fatal(err)
	}
	got := n.take()
	if len(got) != 1 || got[0].walletID != wid {
		t.Fatalf("announced %+v", got)
	}
	it, en := got[0].it, got[0].en
	if it.Kind != notify.KindConsentExpiring || it.URL != alertsURL || it.Ref != "consent-expiring:1:2026-10-25T00:00:00Z" ||
		it.Body != "Il consenso per Banca Demo scade il 25/10/2026: rinnovalo per continuare a sincronizzare." {
		t.Fatalf("Italian event = %+v", it)
	}
	if en.Body != "The consent for Banca Demo ends on 25 October 2026: renew it to keep syncing." {
		t.Fatalf("English event = %+v", en)
	}
}

// Every language CloudBank speaks has the bank notifications' wording.
func TestAlertLanguages(t *testing.T) {
	for _, lang := range locale.Supported {
		x, ok := alertTexts[lang]
		if !ok || x.failedTitle == "" || x.failed == "" || x.consentTitle == "" || x.consent == "" || x.date == "" {
			t.Errorf("no complete bank wording for %q", lang)
		}
	}
}
