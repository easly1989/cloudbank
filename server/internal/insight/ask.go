package insight

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Ask your data (#704): a question in the user's words, two calls to the
// model. The first is told the question and the wallet's names (categories,
// accounts, tags, the busiest payees) and picks up to three of CloudBank's own
// read-only queries; CloudBank runs them on this wallet alone; the second is
// told the question and the results and answers it. The model never writes a
// query, never sees a transaction, and nothing is stored.

// ErrBadQuestion is an empty question, or one too long.
var ErrBadQuestion = errors.New("insight: ask a question of up to 300 characters")

const (
	questionMax = 300
	askToolsMax = 3
	askPayees   = 200
)

// The read-only queries the model can pick.
const (
	ToolTotal      = "total"
	ToolByMonth    = "by_month"
	ToolByCategory = "by_category"
	ToolLargest    = "largest"
	ToolBalances   = "balances"
)

// AskItem is one line of a query's result: a month, a category, an expense or
// an account, with its amount signed in the base currency.
type AskItem struct {
	Label  string `json:"label"`
	Date   string `json:"date,omitempty"`
	Amount int64  `json:"amount"`
}

// AskUsed is a query CloudBank ran for the answer, with the filters as the
// wallet names them and what it returned: what "Numbers used" shows.
type AskUsed struct {
	Tool     string    `json:"tool"`
	Category string    `json:"category,omitempty"`
	Payee    string    `json:"payee,omitempty"`
	Account  string    `json:"account,omitempty"`
	Tag      string    `json:"tag,omitempty"`
	Type     string    `json:"type,omitempty"`
	From     string    `json:"from,omitempty"`
	To       string    `json:"to,omitempty"`
	Date     string    `json:"date,omitempty"`
	Total    int64     `json:"total"`
	Count    int64     `json:"count"`
	Items    []AskItem `json:"items"`
}

// AskAnswer is the model's answer and the numbers it rests on. An empty
// answer means no query could answer the question: nothing was asked twice.
type AskAnswer struct {
	Answer   string    `json:"answer"`
	Used     []AskUsed `json:"used"`
	Currency Currency  `json:"currency"`
}

// toolCall is one query as the model asks for it.
type toolCall struct {
	Tool     string `json:"tool"`
	From     string `json:"from"`
	To       string `json:"to"`
	Category string `json:"category"`
	Payee    string `json:"payee"`
	Account  string `json:"account"`
	Tag      string `json:"tag"`
	Type     string `json:"type"`
	N        int    `json:"n"`
	Date     string `json:"date"`
}

const askPickSystem = "You choose which of a personal-finance app's read-only queries answer a question " +
	"about the user's wallet. Reply with one JSON object and nothing else: {\"tools\":[...]} with 1 to 3 " +
	"queries, or {\"tools\":[]} when none can answer. The queries:\n" +
	"- {\"tool\":\"total\",\"from\":\"YYYY-MM-DD\",\"to\":\"YYYY-MM-DD\"}: the sum of the transactions in the " +
	"period and how many they are. It takes the optional filters \"category\", \"payee\", \"account\", " +
	"\"tag\" (names exactly as listed) and \"type\" (\"expense\" or \"income\").\n" +
	"- {\"tool\":\"by_month\",...}: the same sum, month by month, with the same filters.\n" +
	"- {\"tool\":\"by_category\",\"from\":...,\"to\":...}: the sum by top-level category, with the same " +
	"filters except category.\n" +
	"- {\"tool\":\"largest\",\"from\":...,\"to\":...,\"n\":5}: the largest expenses in the period, n up to 10.\n" +
	"- {\"tool\":\"balances\",\"date\":\"YYYY-MM-DD\"}: every open account's balance on that day.\n" +
	"Transfers between accounts are never counted. A category includes its subcategories. Expenses are " +
	"negative amounts. Read periods such as \"this summer\" or \"last month\" from today's date."

const askAnswerSystem = "You answer a question about the user's personal-finance wallet in 1 to 3 short " +
	"sentences of plain text, with no markdown. Use only the results given, which the app computed: " +
	"never invent a number, and compute nothing but simple sums, differences, averages and percentages " +
	"of them. Expenses are negative amounts: say them as money spent. If the results do not answer the " +
	"question, say so. Write amounts as the reader's language writes them, with the currency symbol. " +
	"Give no investment advice."

// askNames are a wallet's names, as the model reads them and as its picks
// resolve against them, case aside.
type askNames struct {
	categories map[string]int64 // full "Parent:Child" and unambiguous leaf names
	catNames   map[int64]string
	payees     map[string]db.Payee
	accounts   map[string]db.ListAccountsForWalletRow
	tags       map[string]string
	prompt     string
}

func (s *Service) askNames(ctx context.Context, walletID int64) (askNames, error) {
	n := askNames{
		categories: map[string]int64{}, catNames: map[int64]string{}, payees: map[string]db.Payee{},
		accounts: map[string]db.ListAccountsForWalletRow{}, tags: map[string]string{},
	}
	var w strings.Builder

	cats, err := s.rq.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return n, err
	}
	leaf := map[int64]string{}
	for _, c := range cats {
		leaf[c.ID] = c.Name
	}
	leaves := map[string][]int64{}
	full := []string{}
	for _, c := range cats {
		name := c.Name
		if c.ParentID.Valid {
			name = leaf[c.ParentID.Int64] + ":" + c.Name
		}
		n.catNames[c.ID] = name
		n.categories[strings.ToLower(name)] = c.ID
		leaves[strings.ToLower(c.Name)] = append(leaves[strings.ToLower(c.Name)], c.ID)
		full = append(full, name)
	}
	for k, ids := range leaves {
		if _, taken := n.categories[k]; !taken && len(ids) == 1 {
			n.categories[k] = ids[0]
		}
	}
	sort.Strings(full)
	fmt.Fprintf(&w, "Categories: %s\n", strings.Join(full, ", "))

	accounts, err := s.rq.ListAccountsForWallet(ctx, walletID)
	if err != nil {
		return n, err
	}
	accNames := []string{}
	for _, a := range accounts {
		n.accounts[strings.ToLower(a.Name)] = a
		accNames = append(accNames, a.Name)
	}
	fmt.Fprintf(&w, "Accounts: %s\n", strings.Join(accNames, ", "))

	tags, err := s.rq.ListTagsForWallet(ctx, walletID)
	if err != nil {
		return n, err
	}
	tagNames := []string{}
	for _, t := range tags {
		n.tags[strings.ToLower(t.Name)] = t.Name
		tagNames = append(tagNames, t.Name)
	}
	fmt.Fprintf(&w, "Tags: %s\n", strings.Join(tagNames, ", "))

	// The busiest payees only, so a long list does not drown the question.
	payees, err := s.rq.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return n, err
	}
	counts, err := s.rq.CountTransactionsByPayee(ctx, walletID)
	if err != nil {
		return n, err
	}
	used := map[int64]int64{}
	for _, c := range counts {
		used[c.PayeeID.Int64] = c.TxnCount
	}
	for _, p := range payees {
		n.payees[strings.ToLower(p.Name)] = p
	}
	sort.SliceStable(payees, func(i, j int) bool { return used[payees[i].ID] > used[payees[j].ID] })
	payeeNames := []string{}
	for _, p := range payees[:min(len(payees), askPayees)] {
		payeeNames = append(payeeNames, p.Name)
	}
	fmt.Fprintf(&w, "Payees: %s\n", strings.Join(payeeNames, ", "))
	n.prompt = w.String()
	return n, nil
}

// askQuery is a pick resolved against the wallet: the filter to run and how
// "Numbers used" names it.
type askQuery struct {
	used   AskUsed
	filter report.Filter
	n      int
}

// resolve turns the model's picks into queries; one naming something the
// wallet does not have, or with a period that is not one, is dropped.
func (n askNames) resolve(calls []toolCall, today string) []askQuery {
	out := []askQuery{}
	for _, c := range calls {
		if len(out) == askToolsMax {
			break
		}
		q := askQuery{used: AskUsed{Tool: c.Tool, Items: []AskItem{}}, filter: report.Filter{Transfers: report.TransfersNone}}
		switch c.Tool {
		case ToolBalances:
			d := strings.TrimSpace(c.Date)
			if d == "" {
				d = today
			}
			if _, err := time.Parse(day, d); err != nil {
				continue
			}
			q.used.Date = d
			out = append(out, q)
			continue
		case ToolTotal, ToolByMonth, ToolByCategory, ToolLargest:
		default:
			continue
		}
		from, errF := time.Parse(day, c.From)
		to, errT := time.Parse(day, c.To)
		if errF != nil || errT != nil || to.Before(from) {
			continue
		}
		q.used.From, q.used.To = c.From, c.To
		q.filter.From, q.filter.To = c.From, c.To
		if c.Tool == ToolLargest {
			q.n = min(max(c.N, 1), 10)
			if c.N == 0 {
				q.n = 5
			}
			out = append(out, q)
			continue
		}
		ok := true
		if v := strings.ToLower(strings.TrimSpace(c.Category)); v != "" && c.Tool != ToolByCategory {
			id, found := n.categories[v]
			q.filter.CategoryID, q.used.Category, ok = &id, n.catNames[id], ok && found
		}
		if v := strings.ToLower(strings.TrimSpace(c.Payee)); v != "" {
			p, found := n.payees[v]
			q.filter.PayeeID, q.used.Payee, ok = &p.ID, p.Name, ok && found
		}
		if v := strings.ToLower(strings.TrimSpace(c.Account)); v != "" {
			a, found := n.accounts[v]
			q.filter.AccountID, q.used.Account, ok = &a.ID, a.Name, ok && found
		}
		if v := strings.ToLower(strings.TrimSpace(c.Tag)); v != "" {
			t, found := n.tags[v]
			q.filter.Tags, q.used.Tag, ok = []string{t}, t, ok && found
		}
		if c.Type == report.TypeExpense || c.Type == report.TypeIncome {
			q.filter.Type, q.used.Type = c.Type, c.Type
		}
		if ok {
			out = append(out, q)
		}
	}
	return out
}

// parsePicks reads the first call's reply: the JSON object, wherever the model
// put it.
func parsePicks(reply string) ([]toolCall, error) {
	i, j := strings.Index(reply, "{"), strings.LastIndex(reply, "}")
	if i < 0 || j < i {
		return nil, errors.New("the AI's reply could not be read")
	}
	var out struct {
		Tools []toolCall `json:"tools"`
	}
	if err := json.Unmarshal([]byte(reply[i:j+1]), &out); err != nil {
		return nil, errors.New("the AI's reply could not be read")
	}
	return out.Tools, nil
}

// Ask answers a question about a wallet. confirm is the user's yes to calls
// past this month's limit.
func (s *Service) Ask(ctx context.Context, userID, walletID int64, question string, confirm bool) (AskAnswer, error) {
	question = strings.Join(strings.Fields(question), " ")
	if question == "" || utf8.RuneCountInString(question) > questionMax {
		return AskAnswer{}, ErrBadQuestion
	}
	names, err := s.askNames(ctx, walletID)
	if err != nil {
		return AskAnswer{}, err
	}
	curByID, err := s.currencies(ctx, walletID)
	if err != nil {
		return AskAnswer{}, err
	}
	out := AskAnswer{Used: []AskUsed{}, Currency: currencyOf(baseOf(curByID))}
	today := s.now().UTC().Format(day)

	pick, err := s.ai.Ask(ctx, ai.Call{
		UserID: userID, WalletID: walletID, Feature: ai.FeatureAsk, Confirm: confirm,
		System: askPickSystem, User: fmt.Sprintf("Question: %s\nToday: %s\n%s", question, today, names.prompt), MaxTokens: 300,
	})
	if err != nil {
		return AskAnswer{}, err
	}
	calls, err := parsePicks(pick.Text)
	if err != nil {
		return AskAnswer{}, err
	}
	queries := names.resolve(calls, today)
	if len(queries) == 0 {
		return out, nil
	}
	for _, q := range queries {
		u, err := s.runQuery(ctx, walletID, q, curByID)
		if err != nil {
			return AskAnswer{}, err
		}
		out.Used = append(out.Used, u)
	}

	ans, err := s.ai.Ask(ctx, ai.Call{
		UserID: userID, WalletID: walletID, Feature: ai.FeatureAsk, Confirm: confirm,
		System: askAnswerSystem, User: askResults(question, today, s.language(ctx, userID), out), MaxTokens: 300,
	})
	if err != nil {
		return AskAnswer{}, err
	}
	out.Answer = strings.TrimSpace(ans.Text)
	if len(out.Answer) > bodyMax {
		out.Answer = strings.ToValidUTF8(out.Answer[:bodyMax], "")
	}
	return out, nil
}

func baseOf(byID map[int64]db.Currency) db.Currency {
	for _, c := range byID {
		if c.IsBase != 0 {
			return c
		}
	}
	return db.Currency{}
}

// runQuery runs one query on the wallet, amounts in the base currency.
func (s *Service) runQuery(ctx context.Context, walletID int64, q askQuery, curByID map[int64]db.Currency) (AskUsed, error) {
	u := q.used
	base := baseOf(curByID)
	switch u.Tool {
	case ToolTotal, ToolByMonth, ToolByCategory:
		group := report.GroupMonth
		if u.Tool == ToolByCategory {
			group = report.GroupCategory
		}
		res, err := s.reports.Statistics(ctx, walletID, q.filter, group)
		if err != nil {
			return u, err
		}
		u.Total = res.Total
		switch u.Tool {
		case ToolTotal:
			if u.Count, err = s.reports.Count(ctx, walletID, q.filter); err != nil {
				return u, err
			}
		case ToolByMonth:
			sort.Slice(res.Groups, func(i, j int) bool { return res.Groups[i].Key < res.Groups[j].Key })
			for _, g := range res.Groups {
				u.Items = append(u.Items, AskItem{Label: g.Label, Amount: g.Amount})
			}
		case ToolByCategory:
			for _, g := range res.Groups[:min(len(res.Groups), 10)] {
				u.Items = append(u.Items, AskItem{Label: g.Label, Amount: g.Amount})
			}
		}
	case ToolLargest:
		rows, err := s.rq.LargestExpenses(ctx, db.LargestExpensesParams{WalletID: walletID, FromDate: u.From, ToDate: u.To})
		if err != nil {
			return u, err
		}
		for _, r := range rows {
			u.Items = append(u.Items, AskItem{Label: r.Payee, Date: r.Date, Amount: convertToBase(r.Amount, curByID[r.CurrencyID], base)})
		}
		sort.SliceStable(u.Items, func(i, j int) bool { return u.Items[i].Amount < u.Items[j].Amount })
		u.Items = u.Items[:min(len(u.Items), q.n)]
	case ToolBalances:
		accounts, err := s.rq.ListAccountsForWallet(ctx, walletID)
		if err != nil {
			return u, err
		}
		deltas, err := s.rq.AccountBalanceDeltas(ctx, db.AccountBalanceDeltasParams{Today: u.Date, WalletID: walletID})
		if err != nil {
			return u, err
		}
		delta := map[int64]int64{}
		for _, d := range deltas {
			delta[d.AccountID] = d.TodayDelta
		}
		for _, a := range accounts {
			if a.Closed != 0 {
				continue
			}
			v := convertToBase(a.InitialBalance+delta[a.ID], curByID[a.CurrencyID], base)
			u.Items = append(u.Items, AskItem{Label: a.Name, Amount: v})
			u.Total += v
		}
	}
	return u, nil
}

// language is the user's language for the model.
func (s *Service) language(ctx context.Context, userID int64) string {
	if u, err := s.rq.GetUserByID(ctx, userID); err == nil && languages[u.Locale] != "" {
		return languages[u.Locale]
	}
	return "English"
}

// askResults is what the second call is told: the question and the results,
// line by line.
func askResults(question, today, lang string, a AskAnswer) string {
	var w strings.Builder
	plain := a.Currency.plain
	fmt.Fprintf(&w, "Question: %s\nToday: %s\nCurrency: %s (symbol %s)\nResults:\n", question, today, a.Currency.Code, a.Currency.Symbol)
	for i, u := range a.Used {
		what := []string{u.Tool}
		for _, f := range [][2]string{{"category", u.Category}, {"payee", u.Payee}, {"account", u.Account}, {"tag", u.Tag}} {
			if f[1] != "" {
				what = append(what, f[0]+" "+f[1])
			}
		}
		if u.Type != "" {
			what = append(what, u.Type+"s only")
		}
		if u.Date != "" {
			what = append(what, "on "+u.Date)
		} else {
			what = append(what, u.From+" to "+u.To)
		}
		fmt.Fprintf(&w, "%d. %s: ", i+1, strings.Join(what, ", "))
		switch u.Tool {
		case ToolTotal:
			fmt.Fprintf(&w, "%s over %d transactions\n", plain(u.Total), u.Count)
		default:
			parts := []string{}
			for _, it := range u.Items {
				label := it.Label
				if label == "" {
					label = "(no payee)"
				}
				if it.Date != "" {
					label = it.Date + " " + label
				}
				parts = append(parts, label+" "+plain(it.Amount))
			}
			if len(parts) == 0 {
				parts = append(parts, "nothing")
			}
			fmt.Fprintf(&w, "%s", strings.Join(parts, "; "))
			if u.Tool != ToolLargest {
				fmt.Fprintf(&w, " (total %s)", plain(u.Total))
			}
			w.WriteString("\n")
		}
	}
	fmt.Fprintf(&w, "\nAnswer in %s.", lang)
	return w.String()
}
