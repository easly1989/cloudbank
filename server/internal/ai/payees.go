package ai

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The payee cleanup (#708): the model groups the wallet's payee names that are
// one merchant or person and gives each group a clean name ("AMZN MKTP IT*2K3"
// → "Amazon"). It is sent the names alone, payeesMax a call. CloudBank adds
// what the preview shows: how many transactions each payee has, the payee that
// already has the clean name, and the text of a rule for the next imports.
// Nothing is changed here.

const (
	payeesMax = 100
	// ruleMin is the shortest rule text proposed: shorter matches too much.
	ruleMin = 4
)

// CleanupPayee is one payee of a group.
type CleanupPayee struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Transactions int64  `json:"transactions"`
}

// CleanupProposal is one clean name and the payees that would take it, the
// one that keeps its row first; TargetID is a payee outside the group that
// already has the name, which the group would merge into. Rule is the text a
// "payee contains" rule would match, empty when no text is long enough.
type CleanupProposal struct {
	Name     string         `json:"name"`
	TargetID *int64         `json:"targetId,omitempty"`
	Payees   []CleanupPayee `json:"payees"`
	Rule     string         `json:"rule"`
}

// ProposePayeeCleanup asks the model for the wallet's payee groups; confirm
// is the user's yes to calls past this month's limit. A call after the first
// that fails leaves its names out.
func (s *Service) ProposePayeeCleanup(ctx context.Context, userID, walletID int64, confirm bool) ([]CleanupProposal, error) {
	if _, err := s.allowed(ctx, userID, walletID, FeaturePayees); err != nil {
		return nil, err
	}
	payees, err := s.rq.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	counts, err := s.rq.CountTransactionsByPayee(ctx, walletID)
	if err != nil {
		return nil, err
	}
	used := make(map[int64]int64, len(counts))
	for _, c := range counts {
		used[c.PayeeID.Int64] = c.TxnCount
	}

	out := []CleanupProposal{}
	taken := map[int64]bool{}
	// Sorted by name, so the names alike tend to share a call.
	for start := 0; start < len(payees); start += payeesMax {
		chunk := payees[start:min(start+payeesMax, len(payees))]
		reply, err := s.Ask(ctx, Call{
			UserID: userID, WalletID: walletID, Feature: FeaturePayees, Confirm: confirm,
			System: payeesSystem, User: payeesPrompt(chunk), MaxTokens: 60 + 15*len(chunk),
		})
		if err != nil && start == 0 {
			return nil, err
		}
		if err != nil {
			slog.Warn("AI payee cleanup", "err", err)
			break
		}
		for _, g := range parsePayeesReply(reply.Text, len(chunk)) {
			var members []db.Payee
			for _, n := range g.numbers {
				if p := chunk[n-1]; !taken[p.ID] {
					taken[p.ID] = true
					members = append(members, p)
				}
			}
			if len(members) == 0 || (len(members) == 1 && members[0].Name == g.name) {
				continue
			}
			out = append(out, cleanupProposal(g.name, members, payees, used))
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return total(out[i]) > total(out[j]) })
	return out, nil
}

func total(p CleanupProposal) (n int64) {
	for _, x := range p.Payees {
		n += x.Transactions
	}
	return n
}

// cleanupProposal fills a group in: the payee that keeps its row first (the
// one already spelled like the clean name, else the one with the most
// transactions), the payee outside it with the name, and the rule text.
func cleanupProposal(name string, members, all []db.Payee, used map[int64]int64) CleanupProposal {
	p := CleanupProposal{Name: name}
	in := map[int64]bool{}
	for _, m := range members {
		in[m.ID] = true
	}
	for _, x := range all {
		if !in[x.ID] && strings.EqualFold(x.Name, name) {
			id := x.ID
			p.TargetID = &id
			break
		}
	}
	sort.SliceStable(members, func(i, j int) bool {
		fi, fj := strings.EqualFold(members[i].Name, name), strings.EqualFold(members[j].Name, name)
		if fi != fj {
			return fi
		}
		return used[members[i].ID] > used[members[j].ID]
	})
	names := make([]string, 0, len(members))
	for _, m := range members {
		p.Payees = append(p.Payees, CleanupPayee{ID: m.ID, Name: m.Name, Transactions: used[m.ID]})
		names = append(names, m.Name)
	}
	p.Rule = ruleText(names)
	return p
}

const payeesSystem = "You clean up the payee names of a personal-finance wallet. Banks often write a " +
	"payee as a raw code, such as AMZN MKTP IT*2K3 for Amazon, and the same merchant or person can " +
	"appear under several spellings. Group the numbered names that are the same merchant or person " +
	"and give each group the short name people use for it. Reply with one line per group that " +
	"needs a change, in the form \"1, 4, 7 -> Clean name\". Leave out a name that is already clean " +
	"and alone. Never join different merchants. Do not explain."

func payeesPrompt(chunk []db.Payee) string {
	var b strings.Builder
	b.WriteString("Payees:\n")
	for i, p := range chunk {
		fmt.Fprintf(&b, "%d. %s\n", i+1, p.Name)
	}
	return b.String()
}

type payeesLine struct {
	numbers []int
	name    string
}

var payeesLineRe = regexp.MustCompile(`^\s*([\d\s,]+?)\s*(?:->|→|=>)\s*(.+?)\s*$`)

// parsePayeesReply reads "1, 4 -> Name" lines; numbers out of range, a name
// left empty or too long, and lines out of shape are left out.
func parsePayeesReply(reply string, n int) []payeesLine {
	var out []payeesLine
	for _, line := range strings.Split(reply, "\n") {
		m := payeesLineRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		name := strings.TrimSpace(strings.Trim(m[2], "\"'`*"))
		if name == "" || len(name) > 100 {
			continue
		}
		var nums []int
		for _, f := range strings.FieldsFunc(m[1], func(r rune) bool { return r == ',' || unicode.IsSpace(r) }) {
			if k, err := strconv.Atoi(f); err == nil && k >= 1 && k <= n {
				nums = append(nums, k)
			}
		}
		if len(nums) > 0 {
			out = append(out, payeesLine{numbers: nums, name: name})
		}
	}
	return out
}

// ruleText is the text a "payee contains" rule matches for a group: for one
// name, its leading words before a code (a word with a digit or a star); for
// several, the longest text two of them share that covers the most. Empty when
// it would be shorter than ruleMin.
func ruleText(names []string) string {
	if len(names) == 1 {
		var lead []string
		for _, w := range strings.Fields(names[0]) {
			if strings.ContainsFunc(w, func(r rune) bool { return unicode.IsDigit(r) || r == '*' }) {
				break
			}
			lead = append(lead, w)
		}
		return long(trimText(strings.Join(lead, " ")))
	}
	best, cover := "", 0
	for i := range names {
		for j := i + 1; j < len(names); j++ {
			c := trimText(commonText(names[i], names[j]))
			if len([]rune(c)) < ruleMin {
				continue
			}
			n := 0
			for _, x := range names {
				if strings.Contains(strings.ToLower(x), strings.ToLower(c)) {
					n++
				}
			}
			if n > cover || (n == cover && len(c) > len(best)) {
				best, cover = c, n
			}
		}
	}
	return best
}

func long(s string) string {
	if len([]rune(s)) < ruleMin {
		return ""
	}
	return s
}

// trimText drops what is not a letter or a digit from both ends.
func trimText(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

// commonText is the longest run two names share, case aside, spelled as in a.
func commonText(a, b string) string {
	ar, br := []rune(a), []rune(b)
	al, bl := make([]rune, len(ar)), make([]rune, len(br))
	for i, r := range ar {
		al[i] = unicode.ToLower(r)
	}
	for i, r := range br {
		bl[i] = unicode.ToLower(r)
	}
	prev, cur := make([]int, len(bl)+1), make([]int, len(bl)+1)
	end, size := 0, 0
	for i := 1; i <= len(al); i++ {
		for j := 1; j <= len(bl); j++ {
			if al[i-1] == bl[j-1] {
				cur[j] = prev[j-1] + 1
				if cur[j] > size {
					end, size = i, cur[j]
				}
			} else {
				cur[j] = 0
			}
		}
		prev, cur = cur, prev
	}
	return string(ar[end-size : end])
}
