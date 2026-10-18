package push

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Valid example subscription keys (from webpush-go's own tests) so payload
// encryption succeeds; the mock transport captures the request instead of
// hitting the network.
const (
	testP256dh = "BNNL5ZaTfK81qhXOx23-wewhigUeFb632jN6LvRWCFH1ubQr77FE_9qV1FuojuRmHP42zmf34rXgW80OvUVDgTk"
	testAuth   = "zqbxT6JKstKSY9JKibZLSQ"
)

type mockClient struct {
	calls  int
	status int
}

func (m *mockClient) Do(_ *http.Request) (*http.Response, error) {
	m.calls++
	return &http.Response{StatusCode: m.status, Body: io.NopCloser(strings.NewReader(""))}, nil
}

func newFixture(t *testing.T) (*store.Store, *Service) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	svc, err := NewService(st.Read(), st.Write(), "mailto:test@example.com", nil)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	// The fixtures' push.example does not resolve; the scheme rule still holds.
	svc.checkEndpoint = func(_ context.Context, endpoint string) error {
		if !strings.HasPrefix(endpoint, "https://") {
			return errors.New("not https")
		}
		return nil
	}
	return st, svc
}

// A subscription whose endpoint is not a public https URL is refused (#543).
func TestSubscribeRefusesNonPublicEndpoints(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	svc, err := NewService(st.Read(), st.Write(), "mailto:test@example.com", nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, _ := db.New(st.Write()).CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})
	for _, ep := range []string{
		"https://127.0.0.1/push", "https://192.168.1.14/push", "https://169.254.169.254/latest",
		"http://8.8.8.8/push", "https://[::1]/push",
	} {
		if err := svc.Subscribe(ctx, u.ID, ep, testP256dh, testAuth); err == nil {
			t.Errorf("Subscribe(%s) accepted, want refused", ep)
		}
	}
}

func TestVAPIDPersistedAndStable(t *testing.T) {
	st, svc := newFixture(t)
	if svc.PublicKey() == "" {
		t.Fatal("empty VAPID public key")
	}
	// A second service over the same DB reuses the stored keypair.
	svc2, err := NewService(st.Read(), st.Write(), "mailto:test@example.com", nil)
	if err != nil {
		t.Fatalf("NewService(2): %v", err)
	}
	if svc2.PublicKey() != svc.PublicKey() {
		t.Fatal("VAPID public key changed across restarts")
	}
}

func TestSubscribeSendAndPrune(t *testing.T) {
	st, svc := newFixture(t)
	ctx := context.Background()
	q := db.New(st.Write())
	u, _ := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x"})

	if err := svc.Subscribe(ctx, u.ID, "https://push.example/ep1", testP256dh, testAuth); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	// Re-subscribing the same endpoint upserts (still one row).
	if err := svc.Subscribe(ctx, u.ID, "https://push.example/ep1", testP256dh, testAuth); err != nil {
		t.Fatalf("re-subscribe: %v", err)
	}
	subs, _ := q.ListPushSubscriptionsForUser(ctx, u.ID)
	if len(subs) != 1 {
		t.Fatalf("subscriptions = %d, want 1", len(subs))
	}

	// A 201 leaves the subscription in place.
	ok := &mockClient{status: http.StatusCreated}
	svc.client = ok
	if err := svc.SendToUser(ctx, u.ID, Payload{Title: "hi"}); err != nil {
		t.Fatalf("sendToUser: %v", err)
	}
	if ok.calls != 1 {
		t.Fatalf("send calls = %d, want 1", ok.calls)
	}
	if subs, _ := q.ListPushSubscriptionsForUser(ctx, u.ID); len(subs) != 1 {
		t.Fatalf("subscription should remain after 201")
	}

	// A 410 Gone prunes the dead subscription.
	gone := &mockClient{status: http.StatusGone}
	svc.client = gone
	if err := svc.SendToUser(ctx, u.ID, Payload{Title: "bye"}); err != nil {
		t.Fatalf("sendToUser(gone): %v", err)
	}
	if subs, _ := q.ListPushSubscriptionsForUser(ctx, u.ID); len(subs) != 0 {
		t.Fatalf("dead subscription should be pruned")
	}
}
