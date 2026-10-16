package mailingest

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

// sessionTimeout bounds one check: connect, select, fetch, log out. The IMAP
// client has no per-call context, so the connection carries a deadline.
const sessionTimeout = 2 * time.Minute

// Endpoint is where an IMAP server listens. TLS means implicit TLS (port 993);
// it is false only in tests.
type Endpoint struct {
	Addr       string
	TLS        bool
	ServerName string
}

// OutlookEndpoint is Microsoft's IMAP server for Outlook.com, Hotmail and Live.
var OutlookEndpoint = Endpoint{Addr: "outlook.office365.com:993", TLS: true, ServerName: "outlook.office365.com"}

// EndpointFor is the IMAP server at addr (host:port). One on this machine
// (localhost or a loopback address) is reached without TLS: that is the
// end-to-end tests' pretend server. Any other is reached with TLS.
func EndpointFor(addr string) (Endpoint, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || host == "" || port == "" {
		return Endpoint{}, fmt.Errorf("want host:port, got %q", addr)
	}
	if isLoopback(host) {
		return Endpoint{Addr: addr}, nil
	}
	return Endpoint{Addr: addr, TLS: true, ServerName: host}, nil
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// Credentials log in either with an OAuth access token (SASL XOAUTH2) or with
// a password.
type Credentials struct {
	Username    string
	AccessToken string
	Password    string
}

// Cursor is how far a folder has been read: mails with a UID above LastUID
// are new, as long as the folder's UIDVALIDITY is still the same.
type Cursor struct {
	UIDValidity uint32
	LastUID     uint32
}

// Fetched is one mail as the server returned it.
type Fetched struct {
	UID uint32
	Raw []byte
}

// Session is one logged-in IMAP connection. It only ever opens folders
// read-only (EXAMINE) and fetches bodies with BODY.PEEK, so reading changes
// nothing in the mailbox.
type Session struct {
	c *imapclient.Client
}

// Connect dials, logs in and returns the session.
func Connect(ctx context.Context, ep Endpoint, cred Credentials) (*Session, error) {
	return dial(ctx, ep, cred, nil)
}

// connectWatch is Connect for a session that listens: each time the server
// announces a change in the open folder, a signal lands on wake. The channel is
// never blocked on, so it should have room for one signal.
func connectWatch(ctx context.Context, ep Endpoint, cred Credentials, wake chan<- struct{}) (*Session, error) {
	poke := func() {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
	return dial(ctx, ep, cred, &imapclient.Options{
		UnilateralDataHandler: &imapclient.UnilateralDataHandler{
			Mailbox: func(d *imapclient.UnilateralDataMailbox) {
				if d.NumMessages != nil {
					poke()
				}
			},
		},
	})
}

func dial(ctx context.Context, ep Endpoint, cred Credentials, opts *imapclient.Options) (*Session, error) {
	d := net.Dialer{Timeout: 30 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", ep.Addr)
	if err != nil {
		return nil, fmt.Errorf("mailingest: cannot reach the mail server: %w", err)
	}
	_ = conn.SetDeadline(time.Now().Add(sessionTimeout))
	if ep.TLS {
		tc := tls.Client(conn, &tls.Config{ServerName: ep.ServerName, MinVersion: tls.VersionTLS12})
		if err := tc.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("mailingest: TLS with the mail server failed: %w", err)
		}
		conn = tc
	}
	c := imapclient.New(conn, opts)
	if err := c.WaitGreeting(); err != nil {
		_ = c.Close()
		return nil, fmt.Errorf("mailingest: the mail server did not greet: %w", err)
	}
	if cred.AccessToken != "" {
		err = c.Authenticate(&xoauth2{user: cred.Username, token: cred.AccessToken})
	} else {
		err = c.Login(cred.Username, cred.Password).Wait()
	}
	if err != nil {
		_ = c.Close()
		return nil, fmt.Errorf("%w: %v", ErrLogin, err)
	}
	if opts != nil {
		// A listening session lives for hours: the client bounds each command
		// by itself, so the session-wide deadline goes.
		_ = conn.SetDeadline(time.Time{})
	}
	return &Session{c: c}, nil
}

// ErrLogin means the mail server refused the credentials.
var ErrLogin = errors.New("mailingest: the mail server refused the login")

// Close logs out and closes the connection.
func (s *Session) Close() {
	_ = s.c.Logout().Wait()
	_ = s.c.Close()
}

// CanIdle reports whether the server announces IDLE, so it can tell this
// session about new mail instead of being asked.
func (s *Session) CanIdle() bool {
	caps := s.c.Caps()
	return caps.Has(imap.CapIdle) || caps.Has(imap.CapIMAP4rev2)
}

// Examine opens folder read-only and leaves it open, for listening to it.
func (s *Session) Examine(folder string) error {
	if _, err := s.c.Select(folder, &imap.SelectOptions{ReadOnly: true}).Wait(); err != nil {
		return fmt.Errorf("mailingest: cannot open folder %q: %w", folder, err)
	}
	return nil
}

// Folders lists the folders that can be opened, the inbox first.
func (s *Session) Folders() ([]string, error) {
	list, err := s.c.List("", "*", nil).Collect()
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(list))
	for _, l := range list {
		selectable := true
		for _, a := range l.Attrs {
			if a == imap.MailboxAttrNoSelect || a == imap.MailboxAttrNonExistent {
				selectable = false
			}
		}
		if selectable {
			out = append(out, l.Mailbox)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		ii, jj := strings.EqualFold(out[i], "INBOX"), strings.EqualFold(out[j], "INBOX")
		if ii != jj {
			return ii
		}
		return strings.ToLower(out[i]) < strings.ToLower(out[j])
	})
	return out, nil
}

// End returns a cursor at the folder's current end: what is there now is the
// past, and only what arrives after it will be read.
func (s *Session) End(folder string) (Cursor, error) {
	sd, err := s.c.Select(folder, &imap.SelectOptions{ReadOnly: true}).Wait()
	if err != nil {
		return Cursor{}, fmt.Errorf("mailingest: cannot open folder %q: %w", folder, err)
	}
	return endOf(sd), nil
}

func endOf(sd *imap.SelectData) Cursor {
	last := uint32(0)
	if sd.UIDNext > 0 {
		last = uint32(sd.UIDNext) - 1
	}
	return Cursor{UIDValidity: sd.UIDValidity, LastUID: last}
}

// Since returns the mails that arrived in folder after cur, oldest first, and
// the cursor after them. At most limit are returned, the newest ones: a backlog
// larger than that is skipped rather than flooding the register. A changed
// UIDVALIDITY means the folder was rebuilt: the cursor restarts at its end and
// nothing from before is read.
func (s *Session) Since(folder string, cur Cursor, limit int) ([]Fetched, Cursor, error) {
	sd, err := s.c.Select(folder, &imap.SelectOptions{ReadOnly: true}).Wait()
	if err != nil {
		return nil, cur, fmt.Errorf("mailingest: cannot open folder %q: %w", folder, err)
	}
	end := endOf(sd)
	if sd.UIDValidity != cur.UIDValidity {
		return nil, end, nil
	}
	if end.LastUID <= cur.LastUID || sd.NumMessages == 0 {
		return nil, cur, nil
	}
	from := cur.LastUID + 1
	if limit > 0 && end.LastUID-cur.LastUID > uint32(limit) {
		from = end.LastUID - uint32(limit) + 1
	}
	var set imap.UIDSet
	set.AddRange(imap.UID(from), imap.UID(end.LastUID))
	body := &imap.FetchItemBodySection{Peek: true}
	msgs, err := s.c.Fetch(set, &imap.FetchOptions{UID: true, BodySection: []*imap.FetchItemBodySection{body}}).Collect()
	if err != nil {
		return nil, cur, fmt.Errorf("mailingest: fetching mails failed: %w", err)
	}
	out := make([]Fetched, 0, len(msgs))
	for _, m := range msgs {
		uid := uint32(m.UID)
		if uid <= cur.LastUID {
			continue
		}
		out = append(out, Fetched{UID: uid, Raw: m.FindBodySection(body)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UID < out[j].UID })
	next := cur
	next.LastUID = end.LastUID
	return out, next, nil
}

// xoauth2 is the SASL mechanism Microsoft and Google use for OAuth access
// tokens over IMAP. go-sasl ships OAUTHBEARER but not this one.
type xoauth2 struct {
	user, token string
}

func (x *xoauth2) Start() (string, []byte, error) {
	return "XOAUTH2", []byte("user=" + x.user + "\x01auth=Bearer " + x.token + "\x01\x01"), nil
}

// Next answers the error challenge the server sends on a failed login with an
// empty response, after which the server ends the exchange with NO.
func (x *xoauth2) Next([]byte) ([]byte, error) {
	return []byte{}, nil
}
