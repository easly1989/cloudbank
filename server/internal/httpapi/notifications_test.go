package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
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
		if !e.Channels["inapp"] || !e.Channels["push"] {
			t.Errorf("%s is not on by default: %+v", e.Kind, e.Channels)
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
