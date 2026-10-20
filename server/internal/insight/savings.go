package insight

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Savings proposals (#699): the categories that grew lately, and what going
// back to before would keep a month. CloudBank compares the last three
// complete months with the nine before; Apply opens the budget form at the
// earlier level. A category the budget proposal already has is left to it.

// reasonGrown is a category spent on more lately than before.
const reasonGrown = "grown"

const (
	savingsMonths = 12 // the nine before and the last three
	recentMonths  = 3
	savingsMax    = 3
	// A category is proposed when the last three months are at least this
	// percent of the nine before, and at least savingsFloor units a month more.
	grownPercent = 120
	savingsFloor = 10
)

// savingsRows works out the rows for a person's wallet, with today their
// local date: at most three, the most to keep first.
func (s *Service) savingsRows(ctx context.Context, userID, walletID int64, today time.Time) (ProposalBasis, error) {
	basis := ProposalBasis{Rows: []ProposalRow{}}
	sp, err := s.spendingOf(ctx, walletID, today, savingsMonths)
	if err != nil {
		return basis, err
	}
	basis.Currency, basis.Months = sp.currency, sp.months

	// What the budget proposal waiting on the wallet already proposes.
	proposed := map[int64]bool{}
	raw, err := s.rq.OpenAIProposalBasis(ctx, db.OpenAIProposalBasisParams{UserID: userID, WalletID: walletID, Kind: KindBudget})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return basis, err
	}
	var budgets ProposalBasis
	if err == nil && json.Unmarshal([]byte(raw), &budgets) == nil {
		for _, r := range budgets.Rows {
			proposed[r.CategoryID] = true
		}
	}

	floor := int64(savingsFloor * math.Pow10(sp.currency.FracDigits))
	before := savingsMonths - recentMonths
	for id, spent := range sp.spent {
		if proposed[id] || !sp.proposable(id) {
			continue
		}
		var old, recent int64
		for i, v := range spent {
			if i < before {
				old += v
			} else {
				recent += v
			}
		}
		old, recent = old/int64(before), recent/recentMonths
		if old == 0 || recent*100 < old*grownPercent || recent-old < floor {
			continue
		}
		row := ProposalRow{
			CategoryID: id, Name: sp.names[id], Reason: reasonGrown, Months: spent,
			Before: old, Recent: recent, Proposed: roundTo5(old, sp.currency.FracDigits),
			Budget: sp.today[id],
		}
		if row.Proposed >= recent {
			continue
		}
		basis.Rows = append(basis.Rows, row)
	}
	sort.Slice(basis.Rows, func(i, j int) bool {
		ki, kj := basis.Rows[i].kept(), basis.Rows[j].kept()
		if ki != kj {
			return ki > kj
		}
		return basis.Rows[i].Name < basis.Rows[j].Name
	})
	if len(basis.Rows) > savingsMax {
		basis.Rows = basis.Rows[:savingsMax]
	}
	return basis, nil
}

// kept is what a savings row keeps a month, back to the amount proposed.
func (r ProposalRow) kept() int64 { return r.Recent - r.Proposed }

const savingsSystem = "You explain savings proposals to the owner of a personal-finance wallet: " +
	"categories they spent more on in the last three months than in the nine before, and what going " +
	"back to before would keep each month. CloudBank worked out every number: use only those, never " +
	"invent one. Write 2 or 3 short sentences of plain text, with no headings, no lists and no " +
	"markdown: say which change weighs most. Give no investment advice. Never say where to put the " +
	"money kept. Write amounts as the reader's language writes them, with the currency symbol."

func (b ProposalBasis) savingsPrompt(lang string) string {
	var w strings.Builder
	plain := Basis{Currency: b.Currency}.plain
	fmt.Fprintf(&w, "Savings proposals (currency %s, symbol %s): the last 3 months, %s to %s, against the 9 before.\n",
		b.Currency.Code, b.Currency.Symbol, b.Months[len(b.Months)-recentMonths], b.Months[len(b.Months)-1])
	var kept int64
	for _, r := range b.Rows {
		fmt.Fprintf(&w, "- %s: %s a month lately against %s before (+%d%%); back to %s keeps %s a month\n",
			r.Name, plain(r.Recent), plain(r.Before), (r.Recent-r.Before)*100/r.Before, plain(r.Proposed), plain(r.kept()))
		kept += r.kept()
	}
	fmt.Fprintf(&w, "In all: %s a month.\n", plain(kept))
	name := languages[lang]
	if name == "" {
		name = "English"
	}
	fmt.Fprintf(&w, "\nWrite the text in %s.", name)
	return w.String()
}

// savingsNotes is a savings proposal's notification, two lines in each
// language; %s is the wallet.
var savingsNotes = map[string][2]string{
	"en":    {"Savings to look at", "%s: in AI insights."},
	"it":    {"Risparmi da guardare", "%s: li trovi in Approfondimenti AI."},
	"es":    {"Ahorros que revisar", "%s: los encontrarás en Análisis con IA."},
	"fr":    {"Économies possibles", "%s : à voir dans Analyses IA."},
	"de":    {"Sparmöglichkeiten", "%s: in den KI-Auswertungen."},
	"pt-BR": {"Economias para conferir", "%s: estão em Análises com IA."},
}
