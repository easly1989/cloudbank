package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

type bellJSON struct {
	Items []struct {
		ID       int64  `json:"id"`
		Kind     string `json:"kind"`
		Title    string `json:"title"`
		URL      string `json:"url"`
		WalletID *int64 `json:"walletId"`
		Read     bool   `json:"read"`
	} `json:"items"`
	Unread int `json:"unread"`
}

func (c *testClient) bell() bellJSON {
	c.t.Helper()
	resp := c.do(http.MethodGet, "/api/v1/notifications", nil, false)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		c.t.Fatalf("GET notifications = %d", resp.StatusCode)
	}
	var b bellJSON
	if err := json.NewDecoder(resp.Body).Decode(&b); err != nil {
		c.t.Fatal(err)
	}
	return b
}

func (c *testClient) userID(name string) int64 {
	c.t.Helper()
	u, err := db.New(c.st.Read()).GetUserByUsername(context.Background(), name)
	if err != nil {
		c.t.Fatal(err)
	}
	return u.ID
}

// Each person sees and marks only their own notifications, and one about a
// wallet only while they are a member of it.
func TestNotificationsAreTheirOwn(t *testing.T) {
	admin := newTestAPI(t)
	setupAdmin(admin)
	w := decodeWallet(t, admin.do(http.MethodPost, "/api/v1/wallets", map[string]any{"title": "Home"}, true))
	admin.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret", "isAdmin": false}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	ctx := context.Background()
	svc := notify.NewService(admin.st.Read(), admin.st.Write(), nil)
	adminID, bobID := admin.userID("admin"), admin.userID("bob")
	_ = svc.Notify(ctx, adminID, notify.Event{Kind: notify.KindBills, Title: "Rent", URL: "/schedules", WalletID: w.ID})
	_ = svc.Notify(ctx, adminID, notify.Event{Kind: notify.KindMailStopped, Title: "Mailbox"})
	// Bob is not a member of Home: an event about it never shows in his bell.
	_ = svc.Notify(ctx, bobID, notify.Event{Kind: notify.KindBills, Title: "Not yours", WalletID: w.ID})

	got := admin.bell()
	if len(got.Items) != 2 || got.Unread != 2 || got.Items[0].Title != "Mailbox" || got.Items[0].WalletID != nil ||
		got.Items[1].WalletID == nil || *got.Items[1].WalletID != w.ID || got.Items[1].URL != "/schedules" {
		t.Fatalf("admin's bell = %+v", got)
	}
	if b := bob.bell(); len(b.Items) != 0 || b.Unread != 0 {
		t.Fatalf("bob's bell = %+v, want empty", b)
	}

	// Bob marking the admin's notification read changes nothing.
	id := strconv.FormatInt(got.Items[0].ID, 10)
	if resp := bob.do(http.MethodPost, "/api/v1/notifications/"+id+"/read", nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("bob's mark = %d", resp.StatusCode)
	}
	if admin.bell().Unread != 2 {
		t.Fatal("bob's mark changed the admin's bell")
	}
	if resp := admin.do(http.MethodPost, "/api/v1/notifications/"+id+"/read", nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("mark = %d", resp.StatusCode)
	}
	if b := admin.bell(); b.Unread != 1 || !b.Items[0].Read {
		t.Fatalf("after mark = %+v", b)
	}
	if resp := admin.do(http.MethodPost, "/api/v1/notifications/read-all", nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("read-all = %d", resp.StatusCode)
	}
	if admin.bell().Unread != 0 {
		t.Fatal("read-all left unread notifications")
	}
	if resp := admin.do(http.MethodPost, "/api/v1/notifications/x/read", nil, true); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad id = %d, want 400", resp.StatusCode)
	}
}

// The preferences list every event with its channels; a change is the
// caller's alone.
func TestNotificationPreferences(t *testing.T) {
	admin := newTestAPI(t)
	setupAdmin(admin)
	type prefs struct {
		Events []struct {
			Kind     string          `json:"kind"`
			Group    string          `json:"group"`
			Channels map[string]bool `json:"channels"`
		} `json:"events"`
	}
	get := func() prefs {
		t.Helper()
		resp := admin.do(http.MethodGet, "/api/v1/notifications/preferences", nil, false)
		defer resp.Body.Close()
		var p prefs
		_ = json.NewDecoder(resp.Body).Decode(&p)
		return p
	}
	p := get()
	if len(p.Events) != len(notify.Catalog) {
		t.Fatalf("events = %d, want %d", len(p.Events), len(notify.Catalog))
	}
	for _, e := range p.Events {
		// The money events and the summaries start off (#691, #692), an
		// unusual transaction in the bell alone (#700); every other one on.
		on := e.Group != "money" && e.Group != "summaries" && e.Kind != "unusual_transaction"
		if e.Channels["inapp"] != (on || e.Kind == "unusual_transaction") || e.Channels["push"] != on {
			t.Errorf("%s default: %+v", e.Kind, e.Channels)
		}
	}

	put := func(body map[string]any) int {
		t.Helper()
		resp := admin.do(http.MethodPut, "/api/v1/notifications/preferences", body, true)
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := put(map[string]any{"kind": "bills", "channel": "push", "enabled": false}); code != http.StatusNoContent {
		t.Fatalf("put = %d", code)
	}
	for _, e := range get().Events {
		if e.Kind == "bills" && (e.Channels["push"] || !e.Channels["inapp"]) {
			t.Fatalf("bills after the change = %+v", e.Channels)
		}
	}
	for _, bad := range []map[string]any{
		{"kind": "nope", "channel": "push", "enabled": true},
		{"kind": "bills", "channel": "pigeon", "enabled": true},
		{"kind": "bills", "channel": "push"},
	} {
		if code := put(bad); code != http.StatusBadRequest {
			t.Errorf("put %v = %d, want 400", bad, code)
		}
	}
}

// A webhook is saved, tested for real and its failure shown; its URL never
// comes back; only an administrator may point it at the local network; email
// is not offered without a mail server.
func TestNotificationChannels(t *testing.T) {
	status := http.StatusNoContent
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) }))
	defer hook.Close()
	admin := newTestAPI(t)
	setupAdmin(admin)
	admin.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret", "isAdmin": false}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	url := hook.URL + "/api/webhook/secret-key"
	put := func(c *testClient, ch string, body map[string]any) (int, string) {
		t.Helper()
		resp := c.do(http.MethodPut, "/api/v1/notifications/channels/"+ch, body, true)
		defer resp.Body.Close()
		var e struct {
			Error struct{ Code string } `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&e)
		return resp.StatusCode, e.Error.Code
	}
	if code, ec := put(bob, "webhook", map[string]any{"target": url}); code != http.StatusBadRequest || ec != "local_network" {
		t.Fatalf("bob's local webhook = %d %s", code, ec)
	}
	if code, _ := put(admin, "email", map[string]any{"target": "demo@example.com"}); code != http.StatusNotFound {
		t.Fatalf("email without a mail server = %d", code)
	}
	if code, _ := put(admin, "webhook", map[string]any{"target": url, "secret": "s3"}); code != http.StatusNoContent {
		t.Fatalf("admin's webhook = %d", code)
	}

	test := func() (bool, string) {
		t.Helper()
		resp := admin.do(http.MethodPost, "/api/v1/notifications/channels/webhook/test", nil, true)
		defer resp.Body.Close()
		var out struct {
			OK    bool   `json:"ok"`
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return out.OK, out.Error
	}
	if ok, e := test(); !ok {
		t.Fatalf("test = %v %q", ok, e)
	}
	// The same address again so soon is refused; a new one is tried at once.
	if resp := admin.do(http.MethodPost, "/api/v1/notifications/channels/webhook/test", nil, true); resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second test at once = %d", resp.StatusCode)
	}
	url += "-new"
	if code, _ := put(admin, "webhook", map[string]any{"target": url}); code != http.StatusNoContent {
		t.Fatalf("new webhook URL = %d", code)
	}
	status = http.StatusUnauthorized
	if ok, e := test(); ok || e != "401" {
		t.Fatalf("test against a 401 = %v %q", ok, e)
	}

	resp := admin.do(http.MethodGet, "/api/v1/notifications/channels", nil, false)
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if strings.Contains(string(raw), "secret-key") || strings.Contains(string(raw), "s3") {
		t.Fatalf("channels leak the URL or secret: %s", raw)
	}
	var list struct {
		Channels []struct {
			Channel    string `json:"channel"`
			Available  bool   `json:"available"`
			Configured bool   `json:"configured"`
			HasSecret  bool   `json:"hasSecret"`
			LastError  string `json:"lastError"`
		} `json:"channels"`
	}
	_ = json.Unmarshal(raw, &list)
	for _, c := range list.Channels {
		switch c.Channel {
		case "email":
			if c.Available || c.Configured {
				t.Errorf("email = %+v", c)
			}
		case "webhook":
			if !c.Configured || !c.HasSecret || c.LastError != "401" {
				t.Errorf("webhook = %+v", c)
			}
		}
	}

	if resp := admin.do(http.MethodDelete, "/api/v1/notifications/channels/webhook", nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	if resp := admin.do(http.MethodPost, "/api/v1/notifications/channels/webhook/test", nil, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("test after delete = %d", resp.StatusCode)
	}
}

// The money settings (#691): thresholds only on the accounts of a wallet the
// reader is a member of, each reader's own, and a wallet turned off.
func TestNotificationThresholds(t *testing.T) {
	admin := newTestAPI(t)
	setupAdmin(admin)
	home := decodeWallet(t, admin.do(http.MethodPost, "/api/v1/wallets", map[string]any{"title": "Home"}, true))
	hs := strconv.FormatInt(home.ID, 10)
	acc := decodeAccount(t, admin.do(http.MethodPost, "/api/v1/wallets/"+hs+"/accounts", map[string]any{"name": "Conto", "type": "bank"}, true))
	admin.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret", "isAdmin": false}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	mine := decodeWallet(t, bob.do(http.MethodPost, "/api/v1/wallets", map[string]any{"title": "Bob's"}, true))
	ms := strconv.FormatInt(mine.ID, 10)
	path := "/notifications/thresholds/" + strconv.FormatInt(acc.ID, 10)
	body := map[string]any{"largeOver": 30000, "lowUnder": 10000}

	// Bob is no member of Home, and Home's account is not in his wallet.
	for _, p := range []string{"/api/v1/wallets/" + hs + path, "/api/v1/wallets/" + ms + path} {
		resp := bob.do(http.MethodPut, p, body, true)
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("bob PUT %s = %d, want 404", p, resp.StatusCode)
		}
	}
	if resp := bob.do(http.MethodGet, "/api/v1/wallets/"+hs+"/notifications", nil, false); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("bob GET Home's settings = %d", resp.StatusCode)
	}

	resp := admin.do(http.MethodPut, "/api/v1/wallets/"+hs+path, map[string]any{"largeOver": 0}, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("zero threshold = %d", resp.StatusCode)
	}
	admin.do(http.MethodPut, "/api/v1/wallets/"+hs+path, body, true).Body.Close()
	admin.do(http.MethodPut, "/api/v1/wallets/"+hs+"/notifications", map[string]any{"included": false}, true).Body.Close()
	resp = admin.do(http.MethodGet, "/api/v1/wallets/"+hs+"/notifications", nil, false)
	defer resp.Body.Close()
	var got struct {
		Included   bool `json:"included"`
		Thresholds []struct {
			AccountID int64  `json:"accountId"`
			LargeOver *int64 `json:"largeOver"`
			LowUnder  *int64 `json:"lowUnder"`
		} `json:"thresholds"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Included || len(got.Thresholds) != 1 || got.Thresholds[0].AccountID != acc.ID ||
		*got.Thresholds[0].LargeOver != 30000 || *got.Thresholds[0].LowUnder != 10000 {
		t.Fatalf("Home's settings = %+v", got)
	}

	resp = admin.do(http.MethodPut, "/api/v1/notifications/settings", map[string]any{"amountsOutside": false}, true)
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(b), `"amountsOutside":false`) {
		t.Fatalf("settings = %s", b)
	}

	// A transaction entered through the API remembers who entered it, which is
	// how a large expense is told to the others only.
	admin.do(http.MethodPost, "/api/v1/wallets/"+hs+"/transactions",
		map[string]any{"accountId": acc.ID, "date": "2026-10-19", "amount": -50000}, true).Body.Close()
	var by sql.NullInt64
	var origin string
	if err := admin.st.Read().QueryRow("SELECT created_by, origin FROM transactions ORDER BY id DESC LIMIT 1").Scan(&by, &origin); err != nil {
		t.Fatal(err)
	}
	if by.Int64 != admin.userID("admin") || origin != "" {
		t.Fatalf("created_by %v, origin %q", by, origin)
	}
}

// The timing settings change only what the body names and refuse what is not
// valid; an event goes in the digest unless it is security or a summary
// (#692).
func TestNotificationTiming(t *testing.T) {
	admin := newTestAPI(t)
	setupAdmin(admin)
	put := func(path string, body map[string]any) (int, string) {
		t.Helper()
		resp := admin.do(http.MethodPut, path, body, true)
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	admin.do(http.MethodPut, "/api/v1/notifications/settings", map[string]any{"amountsOutside": false}, true).Body.Close()
	code, b := put("/api/v1/notifications/settings", map[string]any{"timezone": "Europe/Rome", "quietHours": true, "quietFrom": "23:30"})
	for _, want := range []string{`"amountsOutside":false`, `"timezone":"Europe/Rome"`, `"quietHours":true`, `"quietFrom":"23:30"`, `"quietTo":"07:00"`, `"digestAt":"08:00"`, `"reviewDays":3`} {
		if code != http.StatusOK || !strings.Contains(b, want) {
			t.Fatalf("settings = %d %s, want %s", code, b, want)
		}
	}
	for _, bad := range []map[string]any{{"timezone": "Nowhere/Land"}, {"digestAt": "25:00"}, {"reviewDays": 5}} {
		if code, _ := put("/api/v1/notifications/settings", bad); code != http.StatusBadRequest {
			t.Errorf("%v = %d", bad, code)
		}
	}

	for _, c := range []struct {
		kind string
		code int
	}{{"new_device", http.StatusBadRequest}, {"summary_weekly", http.StatusBadRequest}, {"nope", http.StatusBadRequest}, {"bills", http.StatusNoContent}} {
		if code, b := put("/api/v1/notifications/digest", map[string]any{"kind": c.kind, "digest": true}); code != c.code {
			t.Errorf("digest %s = %d %s", c.kind, code, b)
		}
	}
	resp := admin.do(http.MethodGet, "/api/v1/notifications/preferences", nil, false)
	defer resp.Body.Close()
	var p struct {
		Events []struct {
			Kind   string `json:"kind"`
			Digest bool   `json:"digest"`
		} `json:"events"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&p)
	for _, e := range p.Events {
		if e.Digest != (e.Kind == "bills") {
			t.Errorf("%s digest = %v", e.Kind, e.Digest)
		}
	}
}
