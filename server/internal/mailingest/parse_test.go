package mailingest

import (
	"strings"
	"testing"
	"time"
)

func TestParsePlainQuotedPrintableLatin1(t *testing.T) {
	raw := "From: =?utf-8?q?Banca_Demo?= <avvisi@banca.example>\r\n" +
		"Subject: =?iso-8859-1?q?Pagamento_effettuato_=E0_Demo?=\r\n" +
		"Message-ID: <abc@banca.example>\r\n" +
		"Date: Thu, 15 Oct 2026 23:30:00 +0200\r\n" +
		"Content-Type: text/plain; charset=iso-8859-1\r\n" +
		"Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
		"=C8 stato richiesto un pagamento di 6,43 EUR=\r\n presso Supermercato Demo.\r\n"
	m, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if m.From != "avvisi@banca.example" {
		t.Errorf("from = %q", m.From)
	}
	if m.Subject != "Pagamento effettuato à Demo" {
		t.Errorf("subject = %q", m.Subject)
	}
	if m.MessageID != "abc@banca.example" {
		t.Errorf("message id = %q", m.MessageID)
	}
	if m.Body != "È stato richiesto un pagamento di 6,43 EUR presso Supermercato Demo." {
		t.Errorf("body = %q", m.Body)
	}
	// The date keeps the sender's offset: 23:30 in Italy is still the 15th.
	if m.Date.Format(time.RFC3339) != "2026-10-15T23:30:00+02:00" {
		t.Errorf("date = %s", m.Date.Format(time.RFC3339))
	}
}

func TestParsePrefersPlainOverHTML(t *testing.T) {
	raw := "From: avvisi@banca.example\r\nSubject: x\r\nMessage-ID: <p@x>\r\n" +
		"Date: Thu, 15 Oct 2026 10:00:00 +0000\r\n" +
		"Content-Type: multipart/alternative; boundary=b\r\n\r\n" +
		"--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>html version</p>\r\n" +
		"--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nplain version\r\n--b--\r\n"
	m, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if m.Body != "plain version" {
		t.Fatalf("body = %q", m.Body)
	}
}

func TestParseHTMLOnly(t *testing.T) {
	raw := "From: avvisi@banca.example\r\nSubject: x\r\nMessage-ID: <h@x>\r\n" +
		"Date: Thu, 15 Oct 2026 10:00:00 +0000\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" +
		"<html><head><style>p{color:red}</style><script>alert(1)</script></head><body>" +
		"<p>Gentile cliente,</p><p>pagamento di <b>6,43&nbsp;EUR</b> presso Bar &amp; Caff&egrave;<br>ore 17:56</p>" +
		"</body></html>"
	m, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	want := "Gentile cliente,\npagamento di 6,43 EUR presso Bar & Caffè\nore 17:56"
	if m.Body != want {
		t.Fatalf("body = %q, want %q", m.Body, want)
	}
}

func TestParseWithoutMessageIDOrDate(t *testing.T) {
	raw := "From: avvisi@banca.example\r\nSubject: x\r\n\r\nbody\r\n"
	m, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(m.MessageID, "sha256:") {
		t.Fatalf("a mail without Message-ID gets a content hash, got %q", m.MessageID)
	}
	if !m.Date.IsZero() {
		t.Fatalf("date = %v", m.Date)
	}
	m2, _ := Parse([]byte(raw))
	if m2.MessageID != m.MessageID {
		t.Fatal("the content hash must be stable")
	}
}

func TestParseCapsTheBody(t *testing.T) {
	raw := "From: a@x\r\nSubject: x\r\nMessage-ID: <c@x>\r\nContent-Type: text/plain\r\n\r\n" + strings.Repeat("a", maxBody+100)
	m, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Body) > maxBody {
		t.Fatalf("body is %d bytes", len(m.Body))
	}
}
