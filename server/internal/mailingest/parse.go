package mailingest

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"html"
	"io"
	"mime"
	"regexp"
	"strings"
	"time"

	_ "github.com/emersion/go-message/charset" // decode every charset banks send
	"github.com/emersion/go-message/mail"
)

// maxBody caps the text kept of one mail: a notification is a few lines, and
// the cap keeps a stray newsletter from bloating the database.
const maxBody = 16 << 10

// Message is a mail reduced to what reading it needs.
type Message struct {
	MessageID string
	From      string
	Subject   string
	// Date is the mail's own Date header, in the offset it was written with.
	Date time.Time
	// Body is the text, from the plain-text part when there is one, otherwise
	// from the HTML part with its markup removed.
	Body string
}

// Parse reads a raw RFC 5322 mail.
func Parse(raw []byte) (Message, error) {
	r, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil && r == nil {
		return Message{}, err
	}
	var m Message
	h := r.Header
	if from, err := h.AddressList("From"); err == nil && len(from) > 0 {
		m.From = strings.ToLower(from[0].Address)
	}
	if s, err := h.Subject(); err == nil {
		m.Subject = strings.TrimSpace(s)
	}
	if id, err := h.MessageID(); err == nil && id != "" {
		m.MessageID = id
	} else {
		sum := sha256.Sum256(raw)
		m.MessageID = "sha256:" + hex.EncodeToString(sum[:])
	}
	if d, err := h.Date(); err == nil {
		m.Date = d
	}

	var plain, htmlText string
	for {
		p, err := r.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			// A broken part ends the walk; what was read so far is kept.
			break
		}
		ih, ok := p.Header.(*mail.InlineHeader)
		if !ok {
			continue
		}
		ct, _, _ := mime.ParseMediaType(ih.Get("Content-Type"))
		if ct == "" {
			ct = "text/plain"
		}
		b, _ := io.ReadAll(io.LimitReader(p.Body, 4*maxBody))
		switch ct {
		case "text/plain":
			if plain == "" {
				plain = string(b)
			}
		case "text/html":
			if htmlText == "" {
				htmlText = htmlToText(string(b))
			}
		}
	}
	body := plain
	if strings.TrimSpace(body) == "" {
		body = htmlText
	}
	m.Body = capText(cleanText(body), maxBody)
	return m, nil
}

var (
	reDropBlocks = regexp.MustCompile(`(?is)<(script|style|head)\b.*?</(script|style|head)>`)
	reBreaks     = regexp.MustCompile(`(?i)<br\s*/?>|</(p|div|tr|li|h[1-6]|table)>`)
	reTags       = regexp.MustCompile(`(?s)<[^>]*>`)
	reSpaces     = regexp.MustCompile(`[ \t\f\v\x{00a0}]+`)
	reBlankLines = regexp.MustCompile(`\n{2,}`)
)

// htmlToText keeps the words and the line breaks of an HTML mail and drops
// the rest. A notification is simple markup; nothing here renders anything.
func htmlToText(s string) string {
	s = reDropBlocks.ReplaceAllString(s, "")
	s = reBreaks.ReplaceAllString(s, "\n")
	s = reTags.ReplaceAllString(s, "")
	return html.UnescapeString(s)
}

// cleanText trims each line, folds runs of spaces (non-breaking ones too) and
// drops blank lines, so models match the words and not the layout.
func cleanText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimSpace(reSpaces.ReplaceAllString(l, " "))
	}
	out := reBlankLines.ReplaceAllString(strings.Join(lines, "\n"), "\n")
	return strings.TrimSpace(out)
}

// capText cuts s to at most n bytes without splitting a UTF-8 character.
func capText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for len(s) > 0 && !utf8Start(s[len(s)-1]) {
		s = s[:len(s)-1]
	}
	if len(s) > 0 {
		s = s[:len(s)-1]
	}
	return s
}

func utf8Start(b byte) bool { return b < 0x80 || b >= 0xC0 }
