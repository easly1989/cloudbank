package mailingest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// How an IMAP mailbox's connection is encrypted: TLS from the first byte, or
// a plain connection that must switch with STARTTLS. There is no third way.
const (
	SecurityTLS      = "tls"
	SecurityStartTLS = "starttls"
)

// IMAPSettings are where an IMAP mailbox's server is and who logs in to it.
// The app password is not among them: it never leaves the server.
type IMAPSettings struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Security string `json:"security"`
	Username string `json:"username"`
}

// IMAPInput is what the connect form sends (#658). Username defaults to the
// address. A MailboxID above zero gives that IMAP mailbox new settings (a new
// app password, most often) and keeps its folder and history; Address is then
// ignored.
type IMAPInput struct {
	MailboxID int64  `json:"mailboxId"`
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Security  string `json:"security"`
}

// SetLocalIMAP lets mailboxes use one IMAP server on this machine (host:port,
// a loopback address), without TLS: the end-to-end tests' pretend server
// (CB_MAIL_LOCAL_IMAP). Every other address on this machine stays refused.
func (s *Service) SetLocalIMAP(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" || !isLoopback(host) {
		return fmt.Errorf("want a loopback host:port, got %q", addr)
	}
	s.localIMAP = addr
	return nil
}

// imapEndpoint is how to reach the server a user named. It is always an
// encrypted connection, dialled to public addresses only, except for the one
// local server SetLocalIMAP allows.
func (s *Service) imapEndpoint(host string, port int, security string) (Endpoint, error) {
	if host == "" || strings.ContainsAny(host, " /\\@?#") {
		return Endpoint{}, fmt.Errorf("%w: the server is a name like imap.example.com", ErrInvalid)
	}
	if port < 1 || port > 65535 {
		return Endpoint{}, fmt.Errorf("%w: the port is a number from 1 to 65535", ErrInvalid)
	}
	if security != SecurityTLS && security != SecurityStartTLS {
		return Endpoint{}, fmt.Errorf("%w: the connection is encrypted with tls or starttls", ErrInvalid)
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	if s.localIMAP != "" && addr == s.localIMAP {
		return Endpoint{Addr: addr}, nil
	}
	return Endpoint{
		Addr: addr, TLS: security == SecurityTLS, StartTLS: security == SecurityStartTLS,
		ServerName: host, Public: true,
	}, nil
}

// ConnectIMAP connects a mailbox with an app password, or gives one new
// settings. It logs in first: a server that refuses, or cannot be reached,
// leaves nothing saved and nothing changed. A new mailbox reads its inbox
// from the current end, like a Microsoft one.
func (s *Service) ConnectIMAP(ctx context.Context, walletID, userID int64, in IMAPInput) (Mailbox, error) {
	if !s.enabled() {
		return Mailbox{}, ErrUnavailable
	}
	in.Host = strings.ToLower(strings.TrimSpace(in.Host))
	in.Username = strings.TrimSpace(in.Username)
	if in.Password == "" {
		return Mailbox{}, fmt.Errorf("%w: the app password is missing", ErrInvalid)
	}

	var existing *db.Mailbox
	if in.MailboxID > 0 {
		lock := s.lockFor(in.MailboxID)
		lock.Lock()
		defer lock.Unlock()
		mb, err := s.get(ctx, walletID, in.MailboxID)
		if err != nil {
			return Mailbox{}, err
		}
		if mb.Provider != ProviderIMAP {
			return Mailbox{}, fmt.Errorf("%w: not an IMAP mailbox", ErrInvalid)
		}
		existing = &mb
		in.Address = mb.Address
	} else {
		in.Address = strings.ToLower(strings.TrimSpace(in.Address))
		if !strings.Contains(in.Address, "@") {
			return Mailbox{}, fmt.Errorf("%w: the address is like name@example.com", ErrInvalid)
		}
	}
	if in.Username == "" {
		in.Username = in.Address
	}
	ep, err := s.imapEndpoint(in.Host, in.Port, in.Security)
	if err != nil {
		return Mailbox{}, err
	}

	sess, err := Connect(ctx, ep, Credentials{Username: in.Username, Password: in.Password})
	if err != nil {
		return Mailbox{}, err
	}
	defer sess.Close()

	if existing == nil {
		// The same address again is the same mailbox, with new settings.
		found, ferr := s.q.FindMailboxByAddress(ctx, db.FindMailboxByAddressParams{
			WalletID: walletID, Provider: ProviderIMAP, Address: in.Address,
		})
		switch {
		case ferr == nil:
			existing = &found
			// Like any change to the credential, under the mailbox's lock.
			lock := s.lockFor(found.ID)
			lock.Lock()
			defer lock.Unlock()
		case !errors.Is(ferr, sql.ErrNoRows):
			return Mailbox{}, ferr
		}
	}
	var id int64
	if existing != nil {
		id = existing.ID
		err = s.q.SetMailboxIMAP(ctx, db.SetMailboxIMAPParams{
			Secret: s.seal(in.Password), ImapHost: in.Host, ImapPort: int64(in.Port),
			ImapSecurity: in.Security, ImapUsername: in.Username, ID: id,
		})
	} else {
		cur, cerr := sess.End("INBOX")
		if cerr != nil {
			return Mailbox{}, cerr
		}
		var mb db.Mailbox
		mb, err = s.q.InsertIMAPMailbox(ctx, db.InsertIMAPMailboxParams{
			WalletID: walletID, CreatedBy: sql.NullInt64{Int64: userID, Valid: userID > 0},
			Address: in.Address, Secret: s.seal(in.Password), ImapHost: in.Host, ImapPort: int64(in.Port),
			ImapSecurity: in.Security, ImapUsername: in.Username,
			UidValidity: int64(cur.UIDValidity), LastUid: int64(cur.LastUID),
		})
		id = mb.ID
	}
	if err != nil {
		return Mailbox{}, err
	}
	mb, err := s.get(ctx, walletID, id)
	if err != nil {
		return Mailbox{}, err
	}
	// The login worked: whatever stopped the mailbox is over.
	s.record(ctx, mb, nil)
	s.wake()
	return s.reload(ctx, walletID, id)
}

// imapLogin connects to an IMAP mailbox with its stored password. A refused
// password is not tried again on a timer, as providers lock accounts that
// keep failing: the mailbox waits for a new one (ErrReauth).
func (s *Service) imapLogin(mb db.Mailbox, connect func(Endpoint, Credentials) (*Session, error)) (*Session, error) {
	ep, err := s.imapEndpoint(mb.ImapHost, int(mb.ImapPort), mb.ImapSecurity)
	if err != nil {
		return nil, err
	}
	sess, err := connect(ep, Credentials{Username: mb.ImapUsername, Password: s.open(mb.Secret)})
	if errors.Is(err, ErrLogin) {
		return nil, fmt.Errorf("%w: %w", ErrReauth, err)
	}
	return sess, err
}

func imapSettings(m db.Mailbox) *IMAPSettings {
	if m.Provider != ProviderIMAP {
		return nil
	}
	return &IMAPSettings{Host: m.ImapHost, Port: int(m.ImapPort), Security: m.ImapSecurity, Username: m.ImapUsername}
}
