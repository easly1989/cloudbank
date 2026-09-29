package netguard

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestIsPublic(t *testing.T) {
	for addr, want := range map[string]bool{
		"8.8.8.8":              true,
		"2606:4700:4700::1111": true,
		"127.0.0.1":            false,
		"::1":                  false,
		"10.1.2.3":             false,
		"172.16.0.1":           false,
		"192.168.1.14":         false,
		"169.254.169.254":      false, // cloud metadata
		"100.64.0.1":           false, // carrier-grade NAT
		"198.18.0.1":           false,
		"0.0.0.0":              false,
		"fd00::1":              false,
		"fe80::1":              false,
		"::ffff:192.168.1.1":   false, // IPv4-mapped
		"64:ff9b::a00:1":       false, // NAT64 of 10.0.0.1
		"64:ff9b::808:808":     true,  // NAT64 of 8.8.8.8
		"224.0.0.1":            false,
	} {
		if got := IsPublic(netip.MustParseAddr(addr)); got != want {
			t.Errorf("IsPublic(%s) = %v, want %v", addr, got, want)
		}
	}
}

func TestCheckURL(t *testing.T) {
	ctx := context.Background()
	for raw, want := range map[string]error{
		"https://8.8.8.8/v1":            nil,
		"http://8.8.8.8/v1":             nil,
		"http://127.0.0.1:11434/v1":     ErrNotPublic,
		"http://localhost:11434/v1":     ErrNotPublic,
		"https://[::1]/":                ErrNotPublic,
		"http://192.168.1.14/":          ErrNotPublic,
		"ftp://8.8.8.8/":                ErrScheme,
		"8.8.8.8":                       ErrScheme,
		"http://169.254.169.254/":       ErrNotPublic,
		"https://user:pw@10.0.0.2/sfin": ErrNotPublic,
	} {
		if err := CheckURL(ctx, raw, false); !errors.Is(err, want) {
			t.Errorf("CheckURL(%q) = %v, want %v", raw, err, want)
		}
	}
	if err := CheckURL(ctx, "http://8.8.8.8/", true); !errors.Is(err, ErrScheme) {
		t.Errorf("https-only CheckURL of http = %v, want ErrScheme", err)
	}
}

// The transport refuses to connect to a loopback server, which a plain client
// reaches.
func TestTransportRefusesLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer srv.Close()
	if resp, err := http.Get(srv.URL); err != nil {
		t.Fatalf("plain client: %v", err)
	} else {
		_ = resp.Body.Close()
	}
	_, err := (&http.Client{Transport: Transport()}).Get(srv.URL)
	if !errors.Is(err, ErrNotPublic) {
		t.Fatalf("guarded client err = %v, want ErrNotPublic", err)
	}
}
