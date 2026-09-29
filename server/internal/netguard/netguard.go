// Package netguard keeps the server's requests to URLs its users supply off the
// network it runs on (#543). A SimpleFIN setup token, a browser's push endpoint
// or an AI provider URL is data from a user, so the server must not become their
// way into the LAN, the host or a cloud metadata service.
//
// The check runs where the connection is made, on the address actually dialled,
// so a name that resolves to a public address when saved and to a private one
// later (DNS rebinding) is still refused. CheckURL repeats it when a URL is
// saved, to turn a doomed setting into a clear error up front.
package netguard

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"syscall"
	"time"
)

// ErrNotPublic means an address, or a name that resolves to one, is not on the
// public internet: loopback, private, link-local, carrier-grade NAT and the like.
var ErrNotPublic = errors.New("netguard: not a public internet address")

// ErrScheme means a URL is not http(s), or not https where https is required.
var ErrScheme = errors.New("netguard: unsupported URL scheme")

// special are non-public ranges the netip predicates leave out.
var special = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"), // carrier-grade NAT (RFC 6598)
	netip.MustParsePrefix("192.0.0.0/24"),  // IETF protocol assignments
	netip.MustParsePrefix("198.18.0.0/15"), // benchmarking (RFC 2544)
}

// nat64 is the well-known NAT64 prefix: its addresses carry an IPv4 address in
// their last 32 bits, which is what the check has to look at.
var nat64 = netip.MustParsePrefix("64:ff9b::/96")

// IsPublic reports whether a is an address on the public internet.
func IsPublic(a netip.Addr) bool {
	a = a.Unmap()
	if a.Is6() && nat64.Contains(a) {
		b := a.As16()
		a = netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]})
	}
	if !a.IsGlobalUnicast() || a.IsPrivate() {
		return false
	}
	for _, p := range special {
		if p.Contains(a) {
			return false
		}
	}
	return true
}

// control refuses a connection to a non-public address. It runs after name
// resolution, on the address about to be dialled.
func control(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return err
	}
	if !IsPublic(ip) {
		return ErrNotPublic
	}
	return nil
}

// Transport returns an http.Transport that dials public addresses only.
// It ignores proxy settings: a proxy would dial on its behalf, out of reach of
// the check.
func Transport() *http.Transport {
	d := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second, Control: control}
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = nil
	t.DialContext = d.DialContext
	return t
}

// CheckURL returns nil when raw is an http(s) URL (https only if httpsOnly)
// whose host is, or resolves only to, public addresses.
func CheckURL(ctx context.Context, raw string, httpsOnly bool) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ErrScheme
	}
	switch {
	case u.Scheme == "https":
	case u.Scheme == "http" && !httpsOnly:
	default:
		return ErrScheme
	}
	host := u.Hostname()
	if ip, err := netip.ParseAddr(host); err == nil {
		if !IsPublic(ip) {
			return ErrNotPublic
		}
		return nil
	}
	addrs, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return err
	}
	for _, a := range addrs {
		if !IsPublic(a) {
			return ErrNotPublic
		}
	}
	return nil
}
