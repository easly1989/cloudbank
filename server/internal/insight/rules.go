package insight

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/assignment"
)

// Rule proposals (#705): the payees whose transactions of the last twelve
// months, the ones no rule decides yet, nearly always have one category. Apply
// opens a new rule filled in: the payee is exactly the name, that category.
// The model is told the payees, the categories and the counts: never an
// amount, a memo or a date.

// reasonRule is a payee filed under one category by hand, again and again.
const reasonRule = "rule"

const (
	rulesMonths = 12
	// A payee is proposed a rule with at least rulesMin transactions with a
	// category, rulesShare percent or more of them in one.
	rulesMin   = 3
	rulesShare = 80
	rulesMax   = 8
	// rulesGrown is how much a payee's transactions must grow for an ignored
	// proposal to come back with it.
	rulesGrown = 0.5
)

// SetRules wires the rules in; without them there are no rule proposals.
func (s *Service) SetRules(r *assignment.Service) { s.rules = r }

// ruleRows works out the rows for a wallet, with today the person's local
// date: the payees with the most transactions still without a category first.
func (s *Service) ruleRows(ctx context.Context, walletID int64, today time.Time) (ProposalBasis, error) {
	basis := ProposalBasis{Months: []string{}, Rows: []ProposalRow{}}
	if s.rules == nil {
		return basis, nil
	}
	tallies, err := s.rules.Unruled(ctx, walletID, today.AddDate(0, -rulesMonths, 0).Format(day))
	if err != nil {
		return basis, err
	}
	names, err := s.categoryNames(ctx, walletID)
	if err != nil {
		return basis, err
	}
	for _, p := range tallies {
		filed := p.Total - p.Without
		var best int64
		for id, n := range p.Categories {
			if n > p.Categories[best] || (n == p.Categories[best] && id < best) {
				best = id
			}
		}
		hits := p.Categories[best]
		if filed < rulesMin || hits*100 < filed*rulesShare {
			continue
		}
		basis.Rows = append(basis.Rows, ProposalRow{
			PayeeID: p.PayeeID, Name: p.Payee, CategoryID: best, Category: names[best], Reason: reasonRule,
			Hits: hits, Total: p.Total, Without: p.Without,
		})
	}
	sort.Slice(basis.Rows, func(i, j int) bool {
		a, b := basis.Rows[i], basis.Rows[j]
		if a.Without != b.Without {
			return a.Without > b.Without
		}
		if a.Hits != b.Hits {
			return a.Hits > b.Hits
		}
		return a.Name < b.Name
	})
	if len(basis.Rows) > rulesMax {
		basis.Rows = basis.Rows[:rulesMax]
	}
	return basis, nil
}

// categoryNames is each category of a wallet as Parent:Child.
func (s *Service) categoryNames(ctx context.Context, walletID int64) (map[int64]string, error) {
	cats, err := s.rq.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	names := map[int64]string{}
	for _, c := range cats {
		names[c.ID] = c.Name
	}
	for _, c := range cats {
		if c.ParentID.Valid {
			names[c.ID] = names[c.ParentID.Int64] + ":" + c.Name
		}
	}
	return names, nil
}

const rulesSystem = "You explain rule proposals to the owner of a personal-finance wallet. A rule files " +
	"every new transaction of a payee under a category by itself, on entry, import and bank sync. " +
	"CloudBank worked out every number: use only those, never invent one. Write 2 or 3 short " +
	"sentences of plain text, with no headings, no lists and no markdown: say what the payees have " +
	"in common and what the rules save the reader. Give no investment advice."

func (b ProposalBasis) rulesPrompt(lang string) string {
	var w strings.Builder
	fmt.Fprintf(&w, "Rule proposals: payees whose transactions of the last %d months, the ones no rule fills in yet, nearly always have one category.\n", rulesMonths)
	without := 0
	for _, r := range b.Rows {
		fmt.Fprintf(&w, "- %s: %s in %d of %d transactions", r.Name, r.Category, r.Hits, r.Total)
		if r.Without > 0 {
			fmt.Fprintf(&w, ", %d without a category", r.Without)
		}
		w.WriteString("\n")
		without += r.Without
	}
	if without > 0 {
		fmt.Fprintf(&w, "In all, %d transactions without a category that the rules would fill in.\n", without)
	}
	name := languages[lang]
	if name == "" {
		name = "English"
	}
	fmt.Fprintf(&w, "\nWrite the text in %s.", name)
	return w.String()
}

// rulesNotes is a rule proposal's notification, two lines in each language;
// %s is the wallet.
var rulesNotes = map[string][2]string{
	"en":    {"Rules to add", "%s: in Rules."},
	"it":    {"Regole da aggiungere", "%s: le trovi in Regole."},
	"es":    {"Reglas que añadir", "%s: las encontrarás en Reglas."},
	"fr":    {"Règles à ajouter", "%s : à voir dans Règles."},
	"de":    {"Regeln zum Anlegen", "%s: unter Regeln."},
	"pt-BR": {"Regras para adicionar", "%s: estão em Regras."},
}
