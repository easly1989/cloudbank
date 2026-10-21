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

	"golang.org/x/text/unicode/norm"

	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Review's bulk categorisation (#706): a category, and a payee, for each
// imported row still without a category. The payee is the row's own or an
// existing payee whose name is in the bank's text, found here without the
// model; a row with neither gets nothing. A payee whose past transactions
// nearly all share one category gets it from that history, no model either.
// Only the rest go to the model, bulkMax rows a call, and only with the
// payee, the amount and the date: never the bank's text. Nothing is saved here.

// Sources of a proposal.
const (
	SourceHistory = "history"
	SourceAI      = "ai"
)

const (
	// bulkMax bounds the rows of one call to the model; more rows take more calls.
	bulkMax = 30
	// A payee's category comes from history with at least historyMin of its
	// transactions of the last historyMonths with a category, historyShare
	// percent or more of them in one.
	historyMonths = 12
	historyMin    = 3
	historyShare  = 80
	// payeeMinLen is the shortest payee name looked for in the bank's text.
	payeeMinLen = 3
)

// BulkProposal is one row's proposed payee and category; no category when
// the model had none for the payee.
type BulkProposal struct {
	ID         int64  `json:"id"`
	PayeeID    int64  `json:"payeeId"`
	CategoryID *int64 `json:"categoryId,omitempty"`
	Source     string `json:"source"`
}

// ProposeCategories proposes for the wallet's rows that need a category, one
// call to the model for each bulkMax rows it is left with; confirm is the
// user's yes to calls past this month's limit. A call after the first that
// fails leaves its rows, and the later ones, with their payee only.
func (s *Service) ProposeCategories(ctx context.Context, userID, walletID int64, confirm bool) ([]BulkProposal, error) {
	if _, err := s.allowed(ctx, userID, walletID, FeatureSuggest); err != nil {
		return nil, err
	}
	rows, err := s.rq.ListImportedUncategorized(ctx, walletID)
	if err != nil {
		return nil, err
	}
	payees, err := s.rq.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	since := s.now().AddDate(0, -historyMonths, 0).Format("2006-01-02")
	counts, err := s.rq.ListPayeeCategoryCounts(ctx, db.ListPayeeCategoryCountsParams{WalletID: walletID, Date: since})
	if err != nil {
		return nil, err
	}
	history := historyCategories(counts)
	names := make(map[int64]string, len(payees))
	for _, p := range payees {
		names[p.ID] = p.Name
	}

	out := []BulkProposal{}
	var ask []BulkProposal
	var asked []db.Transaction
	for _, r := range rows {
		payee := r.PayeeID.Int64
		if !r.PayeeID.Valid {
			payee = payeeInText(r.Memo, payees)
		}
		if payee == 0 {
			continue
		}
		if cat, ok := history[payee]; ok {
			out = append(out, BulkProposal{ID: r.ID, PayeeID: payee, CategoryID: &cat, Source: SourceHistory})
		} else {
			ask = append(ask, BulkProposal{ID: r.ID, PayeeID: payee, Source: SourceAI})
			asked = append(asked, r)
		}
	}
	if len(ask) == 0 {
		return out, nil
	}

	cats, err := s.rq.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	catNames, byName := categoryIndex(cats)
	if len(catNames) == 0 {
		return sortByRows(append(out, ask...), rows), nil
	}
	accounts, err := s.rq.ListAccountsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for start := 0; start < len(ask); start += bulkMax {
		end := min(start+bulkMax, len(ask))
		reply, err := s.Ask(ctx, Call{
			UserID: userID, WalletID: walletID, Feature: FeatureSuggest, Confirm: confirm,
			System: bulkSystem, User: bulkPrompt(asked[start:end], ask[start:end], names, accounts, catNames),
			MaxTokens: 50 + 25*(end-start),
		})
		if err != nil && start == 0 {
			return nil, err
		}
		if err != nil {
			// What the earlier calls found is kept; these rows keep their payee.
			slog.Warn("AI bulk categories", "err", err)
			break
		}
		picked := parseBulkReply(reply.Text, byName)
		for i := start; i < end; i++ {
			if cat, ok := picked[i-start+1]; ok {
				ask[i].CategoryID = &cat
			}
		}
	}
	// The payee found stands even when the model proposes no category.
	return sortByRows(append(out, ask...), rows), nil
}

// sortByRows puts the proposals in the rows' order.
func sortByRows(out []BulkProposal, rows []db.Transaction) []BulkProposal {
	at := make(map[int64]int, len(rows))
	for i, r := range rows {
		at[r.ID] = i
	}
	sort.SliceStable(out, func(i, j int) bool { return at[out[i].ID] < at[out[j].ID] })
	return out
}

// historyCategories is each payee's category when its history decides it.
func historyCategories(counts []db.ListPayeeCategoryCountsRow) map[int64]int64 {
	type tally struct{ total, best, bestN int64 }
	by := map[int64]*tally{}
	for _, c := range counts {
		t := by[c.PayeeID.Int64]
		if t == nil {
			t = &tally{}
			by[c.PayeeID.Int64] = t
		}
		t.total += c.N
		if c.N > t.bestN || (c.N == t.bestN && c.CategoryID.Int64 < t.best) {
			t.best, t.bestN = c.CategoryID.Int64, c.N
		}
	}
	out := map[int64]int64{}
	for payee, t := range by {
		if t.total >= historyMin && t.bestN*100 >= t.total*historyShare {
			out[payee] = t.best
		}
	}
	return out
}

// folded lowercases a text and keeps its letters and digits as words, marks
// dropped, so "CAFE'" and "Café" meet, in any script.
func folded(s string) string {
	var b strings.Builder
	space := true
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		switch {
		case unicode.Is(unicode.Mn, r):
			continue
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			if f, ok := unmarked[r]; ok {
				b.WriteString(f)
			} else {
				b.WriteRune(r)
			}
			space = false
		case !space:
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}

// unmarked spells the letters that carry their mark without decomposing.
var unmarked = map[rune]string{'ł': "l", 'ø': "o", 'đ': "d", 'ħ': "h", 'ß': "ss", 'æ': "ae", 'œ': "oe", 'ı': "i"}

// payeeInText is the existing payee whose whole name is in the bank's text,
// the longest when several are; 0 when none.
func payeeInText(text string, payees []db.Payee) int64 {
	t := " " + folded(text) + " "
	var best int64
	bestLen := 0
	for _, p := range payees {
		n := folded(p.Name)
		if len(n) < payeeMinLen || len(n) <= bestLen {
			continue
		}
		if strings.Contains(t, " "+n+" ") {
			best, bestLen = p.ID, len(n)
		}
	}
	return best
}

const bulkSystem = "You are a personal-finance assistant. For each numbered transaction, choose the " +
	"single best-matching category from the list. Reply with one line per transaction, in the form " +
	"\"number: category\", the category name copied verbatim from the list, or \"number: none\" when " +
	"nothing fits. Do not explain."

func bulkPrompt(rows []db.Transaction, ask []BulkProposal, payees map[int64]string, accounts []db.ListAccountsForWalletRow, cats []string) string {
	acc := make(map[int64]db.ListAccountsForWalletRow, len(accounts))
	for _, a := range accounts {
		acc[a.ID] = a
	}
	var b strings.Builder
	b.WriteString("Transactions:\n")
	for i, r := range rows {
		a := acc[r.AccountID]
		amount := money.Format(r.Amount, int(a.CurrencyFracDigits), ".", "", "", false) + " " + a.CurrencyCode
		fmt.Fprintf(&b, "%d. Payee: %s; Amount: %s; Date: %s\n", i+1, payees[ask[i].PayeeID], amount, r.Date)
	}
	b.WriteString("\nCategories:\n")
	for _, n := range cats {
		fmt.Fprintf(&b, "- %s\n", n)
	}
	return b.String()
}

var bulkLine = regexp.MustCompile(`^\s*(\d+)\s*[:.)\-]\s*(.+?)\s*$`)

// parseBulkReply reads "number: category" lines into categories by number;
// "none", an unlisted name and a line out of shape are left out.
func parseBulkReply(reply string, byName map[string]Category) map[int]int64 {
	out := map[int]int64{}
	for _, line := range strings.Split(reply, "\n") {
		m := bulkLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		if id, _, ok := matchCategory(m[2], byName); ok {
			out[n] = id
		}
	}
	return out
}
