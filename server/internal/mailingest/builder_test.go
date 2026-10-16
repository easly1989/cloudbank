package mailingest

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// builderCase is an expression the web editor builds from the pieces a person
// highlighted, with the mails it must read. The web tests write the file
// (web/src/pages/mail/patternBuilder.re2.test.ts) and fail when it is stale.
type builderCase struct {
	Name       string `json:"name"`
	Expression string `json:"expression"`
	DateFormat string `json:"dateFormat"`
	Checks     []struct {
		Text string            `json:"text"`
		Want map[string]string `json:"want"`
	} `json:"checks"`
}

func TestRE2ReadsWhatTheEditorBuilds(t *testing.T) {
	raw, err := os.ReadFile("testdata/builder_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []builderCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, bc := range cases {
		t.Run(bc.Name, func(t *testing.T) {
			p := basePattern()
			p.Body = bc.Expression
			p.DateFormat = bc.DateFormat
			if strings.Contains(bc.Expression, "(?P<"+GroupDirection+">") {
				p.Direction, p.InWords = DirectionCapture, "accredito"
			}
			c, err := compile(p)
			if err != nil {
				t.Fatalf("the server refuses the editor's expression: %v", err)
			}
			names := c.body.SubexpNames()
			for _, check := range bc.Checks {
				sub := c.body.FindStringSubmatch(check.Text)
				if sub == nil {
					t.Fatalf("does not read %q", check.Text)
				}
				got := map[string]string{}
				for i, name := range names {
					if name != "" {
						got[name] = sub[i]
					}
				}
				if len(got) != len(check.Want) {
					t.Fatalf("groups %v, want %v", got, check.Want)
				}
				for k, v := range check.Want {
					if got[k] != v {
						t.Fatalf("%s = %q, want %q (in %q)", k, got[k], v, check.Text)
					}
				}
				subject, body, _ := strings.Cut(check.Text, "\n")
				m := mailInput{
					From: bankSender, Subject: subject, Body: body,
					Date: time.Date(2026, 10, 15, 17, 56, 0, 0, rome), Authenticated: true,
				}
				if _, ok, err := c.read(m, euros); !ok || err != nil {
					t.Fatalf("read = %v, %v", ok, err)
				}
			}
		})
	}
}
