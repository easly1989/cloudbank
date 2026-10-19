package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ntfy publishes the topic, title and message, with the token when there is
// one; Gotify posts to /message with its application token; a refused token
// is a 401; a server on this machine needs a channel an administrator saved.
func TestSelfHostedSenders(t *testing.T) {
	var path, auth, key string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, auth, key = r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("X-Gotify-Key")
		body = nil
		_ = json.NewDecoder(r.Body).Decode(&body)
		if auth == "Bearer refused" || key == "refused" {
			w.WriteHeader(http.StatusUnauthorized)
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	e := Event{Title: "Bills due", Body: "Rent"}

	if err := NewNtfySender().Send(ctx, Recipient{Target: "family", Server: srv.URL + "/", Secret: "tk_abc", LocalOK: true}, e); err != nil {
		t.Fatal(err)
	}
	if path != "/" || auth != "Bearer tk_abc" || body["topic"] != "family" || body["title"] != "Bills due" || body["message"] != "Rent" {
		t.Fatalf("ntfy got %s %q %v", path, auth, body)
	}
	if err := NewNtfySender().Send(ctx, Recipient{Target: "family", Server: srv.URL, LocalOK: true}, e); err != nil || auth != "" {
		t.Fatalf("ntfy without a token = %v (auth %q)", err, auth)
	}
	if err := NewGotifySender().Send(ctx, Recipient{Server: srv.URL, Secret: "AbC.d-1", LocalOK: true}, e); err != nil {
		t.Fatal(err)
	}
	if path != "/message" || key != "AbC.d-1" || body["message"] != "Rent" || body["priority"] != float64(5) {
		t.Fatalf("gotify got %s %q %v", path, key, body)
	}
	var de *DeliveryError
	if err := NewGotifySender().Send(ctx, Recipient{Server: srv.URL, Secret: "refused", LocalOK: true}, e); !errors.As(err, &de) || de.Error() != "401" {
		t.Fatalf("refused gotify token = %v", err)
	}
	if err := NewNtfySender().Send(ctx, Recipient{Target: "family", Server: srv.URL}, e); !errors.As(err, &de) || de.Reason != ReasonLocal {
		t.Fatalf("local ntfy by a member = %v", err)
	}
}

// Saving: an ntfy topic, on ntfy.sh unless a server is named; a Gotify
// server with its token; a server on the local network only by an
// administrator.
func TestSaveSelfHostedChannels(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	u := f.user(t, "u")
	f.svc.SetSender(ChannelNtfy, NewNtfySender())
	f.svc.SetSender(ChannelGotify, NewGotifySender())
	save := func(ch Channel, admin bool, in ChannelInput) error {
		return f.svc.SaveChannel(ctx, u.ID, admin, ch, in)
	}

	for _, bad := range []string{"", "with space", "slash/topic"} {
		if err := save(ChannelNtfy, false, ChannelInput{Target: ptr(bad)}); !errors.Is(err, ErrBadTarget) {
			t.Errorf("topic %q = %v", bad, err)
		}
	}
	if err := save(ChannelNtfy, false, ChannelInput{Target: ptr("family"), Secret: ptr("bad token")}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("bad ntfy token = %v", err)
	}
	if err := save(ChannelNtfy, false, ChannelInput{Target: ptr("family"), Server: ptr("http://192.168.1.5")}); !errors.Is(err, ErrLocalTarget) {
		t.Fatalf("local ntfy by a member = %v", err)
	}
	if err := save(ChannelNtfy, false, ChannelInput{Target: ptr("family")}); err != nil {
		t.Fatal(err)
	}
	if to, ok, _ := f.svc.recipient(ctx, u.ID, ChannelNtfy); !ok || to.Server != DefaultNtfyServer || to.Target != "family" {
		t.Fatalf("ntfy = %+v %v", to, ok)
	}

	if err := save(ChannelGotify, true, ChannelInput{Server: ptr("http://192.168.1.5:8080")}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("gotify without a token = %v", err)
	}
	if err := save(ChannelGotify, false, ChannelInput{Server: ptr("http://192.168.1.5:8080"), Secret: ptr("AbC.d-1")}); !errors.Is(err, ErrLocalTarget) {
		t.Fatalf("local gotify by a member = %v", err)
	}
	if err := save(ChannelGotify, true, ChannelInput{Server: ptr("http://192.168.1.5:8080/"), Secret: ptr("AbC.d-1")}); err != nil {
		t.Fatal(err)
	}
	for _, c := range must(f.svc.AddressedChannels(ctx, u.ID)) {
		if c.Channel == ChannelGotify && (c.Server != "http://192.168.1.5:8080" || !c.HasSecret || c.Target != "" || c.Pending) {
			t.Fatalf("gotify info = %+v", c)
		}
	}
}
