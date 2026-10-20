package insight

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/goal"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Goal proposals (#699): the goals worth a look, by the Goals page's own
// arithmetic. A dated goal whose pace over the last three full months falls
// short of its monthly share is told to put that share aside, or, when the
// share is more than the wallet kept a month in those months, to move its
// date to when its pace gets there; a goal with no date is told when its
// pace gets there.

// Why a goal is proposed.
const (
	reasonLate = "late" // put aside the share
	reasonMove = "move" // the share is more than is kept: move the date
	reasonETA  = "eta"  // no date: when the pace gets there
)

// SetGoals wires the goals in; without them there are no goal proposals.
func (s *Service) SetGoals(g *goal.Service) { s.goals = g }

// endOfMonth is the last day of a month index, as a civil date.
func endOfMonth(i int) string {
	return time.Date(i/12, time.Month(i%12+2), 0, 0, 0, 0, 0, time.UTC).Format(day)
}

// goalRows works out the rows for a wallet, with today the person's local
// date: late goals first, then dates to move, then goals with no date.
func (s *Service) goalRows(ctx context.Context, walletID int64, today time.Time) (ProposalBasis, error) {
	basis := ProposalBasis{Months: []string{}, Rows: []ProposalRow{}}
	if s.goals == nil {
		return basis, nil
	}
	currencies, err := s.rq.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return basis, err
	}
	curByID := map[int64]db.Currency{}
	var base db.Currency
	for _, c := range currencies {
		curByID[c.ID] = c
		if c.IsBase != 0 {
			base = c
		}
	}
	if basis.Currency, _, err = s.baseCurrency(ctx, walletID); err != nil {
		return basis, err
	}
	frac := int(base.FracDigits)
	goals, err := s.goals.List(ctx, walletID)
	if err != nil {
		return basis, err
	}
	// What the wallet kept a month in the last three full months.
	month := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
	f, err := s.figures(ctx, walletID, month.AddDate(0, -3, 0), month.AddDate(0, 0, -1), curByID, base)
	if err != nil {
		return basis, err
	}
	kept := f.Net / 3
	basis.Kept = kept

	t := today.Format(day)
	now := goal.MonthIndex(t)
	for _, g := range goals {
		if g.ClosedOn != nil || g.TargetAmount <= 0 || g.Saved >= g.TargetAmount {
			continue
		}
		moves, err := s.goals.Contributions(ctx, walletID, g.ID)
		if err != nil {
			return basis, err
		}
		pace := goal.Pace(moves, t, frac)
		left := g.TargetAmount - g.Saved
		row := ProposalRow{GoalID: g.ID, Name: g.Name, Months: []int64{}, Pace: pace, Left: left}
		if pace > 0 {
			row.NewDate = endOfMonth(now + int((left+pace-1)/pace))
		}
		switch {
		case g.TargetDate != nil:
			need, _ := goal.ShareAndPace(g, moves, t, frac)
			if pace >= need {
				continue
			}
			row.Date, row.Proposed, row.Reason = *g.TargetDate, need, reasonLate
			if need > kept {
				if row.NewDate == "" {
					continue // nothing goes in: no date to move it to
				}
				row.Reason = reasonMove
			}
		case row.NewDate != "":
			row.Proposed, row.Reason = pace, reasonETA
		default:
			continue
		}
		basis.Rows = append(basis.Rows, row)
	}
	rank := map[string]int{reasonLate: 0, reasonMove: 1, reasonETA: 2}
	sort.SliceStable(basis.Rows, func(i, j int) bool {
		ri, rj := basis.Rows[i], basis.Rows[j]
		if rank[ri.Reason] != rank[rj.Reason] {
			return rank[ri.Reason] < rank[rj.Reason]
		}
		return ri.Date+ri.NewDate < rj.Date+rj.NewDate
	})
	if len(basis.Rows) > proposalRows {
		basis.Rows = basis.Rows[:proposalRows]
	}
	return basis, nil
}

const goalSystem = "You explain goal proposals to the owner of a personal-finance wallet: savings " +
	"goals behind the pace their date needs, dates worth moving, and when a goal with no date gets " +
	"there. CloudBank worked out every number: use only those, never invent one. Write 2 or 3 short " +
	"sentences of plain text, with no headings, no lists and no markdown: say what to do first and " +
	"why. Give no investment advice. Never say where to keep or invest the money. Write amounts as " +
	"the reader's language writes them, with the currency symbol."

func (b ProposalBasis) goalPrompt(lang string) string {
	var w strings.Builder
	plain := Basis{Currency: b.Currency}.plain
	ym := func(d string) string { return d[:7] }
	fmt.Fprintf(&w, "Goal proposals (currency %s, symbol %s). A goal's pace is what went in a month over "+
		"the last 3 full months; in them the wallet kept %s a month.\n", b.Currency.Code, b.Currency.Symbol, plain(b.Kept))
	for _, r := range b.Rows {
		switch r.Reason {
		case reasonLate:
			fmt.Fprintf(&w, "- %s: %s left by %s, needs %s a month, goes in at %s a month", r.Name, plain(r.Left), ym(r.Date), plain(r.Proposed), plain(r.Pace))
			if r.NewDate != "" {
				fmt.Fprintf(&w, ", which gets there in %s", ym(r.NewDate))
			}
			fmt.Fprintf(&w, "; proposed: put aside %s a month\n", plain(r.Proposed))
		case reasonMove:
			fmt.Fprintf(&w, "- %s: %s left by %s, needs %s a month, more than the wallet keeps; goes in at %s a month; proposed: move the date to %s\n",
				r.Name, plain(r.Left), ym(r.Date), plain(r.Proposed), plain(r.Pace), ym(r.NewDate))
		default:
			fmt.Fprintf(&w, "- %s: no date, %s left, goes in at %s a month; proposed: set the date to %s, when it gets there\n",
				r.Name, plain(r.Left), plain(r.Pace), ym(r.NewDate))
		}
	}
	name := languages[lang]
	if name == "" {
		name = "English"
	}
	fmt.Fprintf(&w, "\nWrite the text in %s.", name)
	return w.String()
}

// goalNotes is a goal proposal's notification, two lines in each language;
// %s is the wallet.
var goalNotes = map[string][2]string{
	"en":    {"Goals to look at", "%s: in Goals."},
	"it":    {"Obiettivi da guardare", "%s: li trovi in Obiettivi."},
	"es":    {"Metas que revisar", "%s: las encontrarás en Metas."},
	"fr":    {"Objectifs à vérifier", "%s : à voir dans Objectifs."},
	"de":    {"Sparziele zum Ansehen", "%s: unter Sparziele."},
	"pt-BR": {"Metas para conferir", "%s: estão em Metas."},
}
