package auth

import (
	"context"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
)

type told struct {
	userID int64
	e      notify.Event
}

type fakeNotifier struct{ got []told }

func (f *fakeNotifier) Notify(_ context.Context, userID int64, e notify.Event) error {
	f.got = append(f.got, told{userID, e})
	return nil
}

// take returns what was told since the last call.
func (f *fakeNotifier) take() []told {
	got := f.got
	f.got = nil
	return got
}

const (
	firefoxWindows    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"
	firefoxWindowsNew = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"
	chromeAndroid     = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
)

// The security events start where they happen and lead to the Security
// page: a sign-in from a device the account never used (not its first one,
// not a browser update), turning two-factor off, creating an API token.
func TestSecurityAlerts(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	n := &fakeNotifier{}
	s.SetNotify(n)

	u, _, err := s.Setup(ctx, "admin", "", "s3cret-pass", firefoxWindows)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateSettings(ctx, u.ID, "it", "", "{}"); err != nil {
		t.Fatal(err)
	}
	for _, ua := range []string{firefoxWindows, firefoxWindowsNew} {
		if _, _, err := s.Login(ctx, "1.2.3.4", "admin", "s3cret-pass", "", ua); err != nil {
			t.Fatal(err)
		}
	}
	if got := n.take(); len(got) != 0 {
		t.Fatalf("known device announced: %+v", got)
	}

	for range 2 {
		if _, _, err := s.Login(ctx, "1.2.3.4", "admin", "s3cret-pass", "", chromeAndroid); err != nil {
			t.Fatal(err)
		}
	}
	got := n.take()
	if len(got) != 1 || got[0].userID != u.ID || got[0].e.Kind != notify.KindNewDevice || got[0].e.URL != securityURL ||
		got[0].e.Title != "Nuovo accesso" || !strings.Contains(got[0].e.Body, "da Chrome su Android") {
		t.Fatalf("new device = %+v", got)
	}
	// SSO opens sessions the same way.
	if _, err := s.IssueSession(ctx, u.ID, "curl/8.5.0"); err != nil {
		t.Fatal(err)
	}
	if got := n.take(); len(got) != 1 || !strings.Contains(got[0].e.Body, "da curl.") {
		t.Fatalf("new client = %+v", got)
	}

	secret, _, err := s.Begin2FASetup(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	code, _ := totpCode(secret, s.now())
	if _, err := s.Enable2FA(ctx, u.ID, secret, code); err != nil {
		t.Fatal(err)
	}
	if got := n.take(); len(got) != 0 {
		t.Fatalf("turning 2FA on announced: %+v", got)
	}
	if err := s.Disable2FA(ctx, u.ID, "s3cret-pass"); err != nil {
		t.Fatal(err)
	}
	if got := n.take(); len(got) != 1 || got[0].e.Kind != notify.KindTwoFactorOff || got[0].e.URL != securityURL {
		t.Fatalf("2FA off = %+v", got)
	}

	if _, _, err := s.CreateAPIToken(ctx, u.ID, "Home Assistant", ScopeWrite, ""); err != nil {
		t.Fatal(err)
	}
	got = n.take()
	if len(got) != 1 || got[0].e.Kind != notify.KindNewAPIToken || got[0].e.URL != securityURL ||
		!strings.Contains(got[0].e.Body, "«Home Assistant» (lettura e scrittura)") {
		t.Fatalf("new token = %+v", got)
	}
}

func TestDeviceOf(t *testing.T) {
	for ua, want := range map[string][2]string{
		firefoxWindows: {"Firefox", "Windows"},
		chromeAndroid:  {"Chrome", "Android"},
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15":                  {"Safari", "macOS"},
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1": {"Chrome", "iOS"},
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0":          {"Edge", "Windows"},
		"Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0":                                                                 {"Firefox", "Linux"},
		"python-requests/2.32":        {"python-requests", ""},
		"<script>alert(1)</script>/1": {"scriptalert1", ""},
		"":                            {"", ""},
	} {
		if b, s := deviceOf(ua); b != want[0] || s != want[1] {
			t.Errorf("deviceOf(%q) = %q, %q; want %q", ua, b, s, want)
		}
	}
}

// Every language CloudBank speaks has the security notifications' wording.
func TestAlertLanguages(t *testing.T) {
	for _, lang := range locale.Supported {
		x, ok := alertTexts[lang]
		if !ok || x.deviceTitle == "" || x.device == "" || x.on == "" || x.unknown == "" || x.twoFATitle == "" ||
			x.twoFA == "" || x.tokenTitle == "" || x.token == "" || x.read == "" || x.write == "" {
			t.Errorf("no complete security wording for %q", lang)
		}
	}
}
