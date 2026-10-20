package insight

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Unusual transactions (#700): CloudBank flags, by fixed rules, the expenses
// it did not see the person type: written by the bank, a mail, a schedule or
// an import, or by another member. An amount out of scale for its payee, a
// new payee with a large amount, a payee charged twice. Each flag is told at
// once in the bell; the model only writes a sentence or two over the flags,
// one call when new ones come.

// Why an expense is flagged.
const (
	unusualScale  = "scale"
	unusualNew    = "new"
	unusualDouble = "double"
)

const (
	// unusualDays is how far back the first look goes, and how long a flag
	// stays on the page.
	unusualDays = 30
	// An amount is out of scale at scaleTimes the payee's median and
	// scaleOver units above it, the payee having scaleFloor expenses in the
	// year before.
	scaleTimes = 2
	scaleOver  = 20
	scaleFloor = 4
	// A new payee's expense is large above the wallet's newShare expenses of
	// the year before, and at least newFloor units.
	newShare = 0.95
	newFloor = 50
	// doubleDays is how close two charges of one amount to one payee are.
	doubleDays = 3
)

// UnusualRow is a flagged expense as the pages show it: the amount positive,
// in its account's currency.
type UnusualRow struct {
	ID            int64    `json:"id"`
	TransactionID int64    `json:"transactionId"`
	AccountID     int64    `json:"accountId"`
	Date          string   `json:"date"`
	Payee         string   `json:"payee"`
	Amount        int64    `json:"amount"`
	Currency      Currency `json:"currency"`
	Kind          string   `json:"kind"`
	// Usual is the payee's median (scale) or the wallet's yardstick (new);
	// Payments the payee's expenses in the year before (scale).
	Usual    int64 `json:"usual"`
	Payments int64 `json:"payments"`
	// A double's first charge.
	OtherID   int64  `json:"otherId,omitempty"`
	OtherDate string `json:"otherDate,omitempty"`
}

// Unusual is what the AI box shows: the model's sentences and the flags.
type Unusual struct {
	Body      string       `json:"body"`
	Model     string       `json:"model"`
	Feedback  int64        `json:"feedback"`
	CreatedAt string       `json:"createdAt"`
	Rows      []UnusualRow `json:"rows"`
}

// news reports whether the person did not type an expense in themselves:
// the bank, a mail, a schedule or an import wrote it, or another member.
// Rows from before CloudBank kept track are not.
func news(origin string, createdBy sql.NullInt64, reader int64) bool {
	return origin != "" || (createdBy.Valid && createdBy.Int64 != reader)
}

// flag is one expense flagged by a look.
type flag struct {
	t        db.ListUnusualExpensesRow
	kind     string
	other    db.ListUnusualExpensesRow
	usual    int64
	payments int64
}

func unitsOf(frac int64) int64 {
	u := int64(1)
	for range frac {
		u *= 10
	}
	return u
}

func percentile(v []int64, share float64) int64 {
	s := slices.Clone(v)
	slices.Sort(s)
	return s[min(len(s)-1, int(math.Ceil(share*float64(len(s))))-1)]
}

// unusualFlags applies the rules to a wallet's expenses since a year and 30
// days before today, for the reader: the expenses of the last 30 days that
// are news to them, against the year before each.
func unusualFlags(rows []db.ListUnusualExpensesRow, counts map[int64]int64, frac map[int64]int64, reader int64, since string) []flag {
	var out []flag
	for i, t := range rows {
		if t.Date < since || !news(t.Origin, t.CreatedBy, reader) {
			continue
		}
		amount := -t.Amount
		unit := unitsOf(frac[t.CurrencyID])
		yearBefore := shiftDate(t.Date, -365)
		// A double: the same payee, amount and account, by the same hands,
		// within days before.
		if t.PayeeID.Valid {
			found := false
			for j := i - 1; j >= 0 && rows[j].Date >= shiftDate(t.Date, -doubleDays); j-- {
				o := rows[j]
				if o.PayeeID == t.PayeeID && o.Amount == t.Amount && o.AccountID == t.AccountID && o.Origin != "" && o.Origin == t.Origin {
					out = append(out, flag{t: t, kind: unusualDouble, other: o})
					found = true
					break
				}
			}
			if found {
				continue
			}
		}
		var payee, all []int64
		for _, o := range rows[:i] {
			if o.Date < yearBefore || o.CurrencyID != t.CurrencyID {
				continue
			}
			all = append(all, -o.Amount)
			if t.PayeeID.Valid && o.PayeeID == t.PayeeID {
				payee = append(payee, -o.Amount)
			}
		}
		switch {
		case len(payee) >= scaleFloor:
			med := median(payee)
			if amount >= scaleTimes*med && amount-med >= scaleOver*unit {
				out = append(out, flag{t: t, kind: unusualScale, usual: med, payments: int64(len(payee))})
			}
		case t.PayeeID.Valid && counts[t.PayeeID.Int64] == 1:
			bar := newFloor * unit
			if len(all) > 0 {
				bar = max(bar, percentile(all, newShare))
			}
			if amount > bar {
				out = append(out, flag{t: t, kind: unusualNew, usual: bar})
			}
		}
	}
	return out
}

// shiftDate moves a civil date by days.
func shiftDate(d string, days int) string {
	t, err := time.Parse(day, d)
	if err != nil {
		return d
	}
	return t.AddDate(0, 0, days).Format(day)
}

// RunUnusual looks for unusual transactions for everyone whose AI does.
func (s *Service) RunUnusual(ctx context.Context) error {
	users, err := s.rq.ListAIUnusualUsers(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, u := range users {
		if err := s.unusualFor(ctx, u); err != nil {
			errs = append(errs, fmt.Errorf("user %d: %w", u.UserID, err))
		}
	}
	return errors.Join(errs...)
}

// RunUnusualEvery looks now, then every interval, until ctx ends.
func (s *Service) RunUnusualEvery(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if err := s.RunUnusual(ctx); err != nil && ctx.Err() == nil {
			logger.Warn("unusual transactions", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Service) unusualFor(ctx context.Context, u db.ListAIUnusualUsersRow) error {
	loc := time.UTC
	if s.notify != nil {
		if st, err := s.notify.GetSettings(ctx, u.UserID); err == nil {
			loc = st.Location()
		}
	}
	today := s.now().In(loc)
	wallets, err := s.rq.ListWalletsForUser(ctx, u.UserID)
	if err != nil {
		return err
	}
	offList, err := s.rq.ListAIWalletsOff(ctx, u.UserID)
	if err != nil {
		return err
	}
	var errs []error
	for _, w := range wallets {
		if slices.Contains(offList, w.ID) {
			continue
		}
		if err := s.unusualScan(ctx, u, w.ID, today); err != nil {
			errs = append(errs, fmt.Errorf("wallet %d: %w", w.ID, err))
		}
	}
	return errors.Join(errs...)
}

// unusualScan looks at a wallet when something was written since the last
// look. The first look flags the last 30 days without telling.
// shortcut: an expense edited later is looked at again only when a new one
// comes, which is enough for "It's fine" to hold until the amount changes.
func (s *Service) unusualScan(ctx context.Context, u db.ListAIUnusualUsersRow, walletID int64, today time.Time) error {
	scan, err := s.rq.GetAIUnusualScan(ctx, db.GetAIUnusualScanParams{UserID: u.UserID, WalletID: walletID})
	first := errors.Is(err, sql.ErrNoRows)
	if err != nil && !first {
		return err
	}
	top, err := s.rq.MaxWalletTransactionID(ctx, walletID)
	if err != nil {
		return err
	}
	if !first && top <= scan.LastTxn {
		return nil
	}
	since := today.AddDate(0, 0, -unusualDays).Format(day)
	rows, err := s.rq.ListUnusualExpenses(ctx, db.ListUnusualExpensesParams{WalletID: walletID, FromDate: shiftDate(since, -365)})
	if err != nil {
		return err
	}
	counted, err := s.rq.CountPayeeTransactions(ctx, walletID)
	if err != nil {
		return err
	}
	counts := map[int64]int64{}
	for _, c := range counted {
		counts[c.PayeeID] = c.N
	}
	curs, err := s.currencies(ctx, walletID)
	if err != nil {
		return err
	}
	frac := map[int64]int64{}
	for id, c := range curs {
		frac[id] = c.FracDigits
	}
	added := 0
	for _, f := range unusualFlags(rows, counts, frac, u.UserID, since) {
		other := sql.NullInt64{Int64: f.other.ID, Valid: f.kind == unusualDouble}
		_, err := s.q.InsertAIUnusual(ctx, db.InsertAIUnusualParams{
			UserID: u.UserID, WalletID: walletID, TransactionID: f.t.ID, Kind: f.kind, OtherID: other,
			Amount: -f.t.Amount, Usual: f.usual, Payments: f.payments,
		})
		if errors.Is(err, sql.ErrNoRows) {
			// Flagged before: back only if it was put away and its amount moved.
			if err := s.q.ReopenAIUnusual(ctx, db.ReopenAIUnusualParams{
				Kind: f.kind, OtherID: other, Amount: -f.t.Amount, Usual: f.usual, Payments: f.payments,
				UserID: u.UserID, TransactionID: f.t.ID,
			}); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		added++
		if !first {
			s.tellUnusual(ctx, u, walletID, f, curs[f.t.CurrencyID])
		}
	}
	if err := s.q.SetAIUnusualScanned(ctx, db.SetAIUnusualScannedParams{UserID: u.UserID, WalletID: walletID, LastTxn: top}); err != nil {
		return err
	}
	if added > 0 {
		s.writeUnusual(ctx, u, walletID)
	}
	return nil
}

// currencies are a wallet's currencies by id.
func (s *Service) currencies(ctx context.Context, walletID int64) (map[int64]db.Currency, error) {
	list, err := s.rq.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]db.Currency, len(list))
	for _, c := range list {
		out[c.ID] = c
	}
	return out, nil
}

func currencyOf(c db.Currency) Currency {
	return Currency{
		Code: c.IsoCode, Symbol: c.Symbol, SymbolPrefix: c.SymbolPrefix != 0,
		DecimalChar: c.DecimalChar, GroupChar: c.GroupChar, FracDigits: int(c.FracDigits),
	}
}

// times is how many times the usual an amount is, rounded: "3 times".
func times(amount, usual int64) int64 {
	return int64(math.Round(float64(amount) / float64(max(1, usual))))
}

func (s *Service) tellUnusual(ctx context.Context, u db.ListAIUnusualUsersRow, walletID int64, f flag, c db.Currency) {
	if s.notify == nil {
		return
	}
	x := locale.Pick(unusualNotes, u.Locale)
	amount := money.Format(-f.t.Amount, int(c.FracDigits), c.DecimalChar, c.GroupChar, c.Symbol, c.SymbolPrefix != 0)
	payee := f.t.Payee
	var why string
	switch f.kind {
	case unusualScale:
		why = fmt.Sprintf(x.scale, times(-f.t.Amount, f.usual))
	case unusualNew:
		why = x.fresh
	default:
		why = x.double
	}
	_ = s.notify.Notify(ctx, u.UserID, notify.Event{
		Kind: notify.KindUnusual, Ref: "unusual:" + strconv.FormatInt(f.t.ID, 10),
		Title: x.title, Body: fmt.Sprintf(x.body, amount, payee, why), Private: fmt.Sprintf(x.private, payee, why),
		URL:      fmt.Sprintf("/transactions?account=%d&txn=%d", f.t.AccountID, f.t.ID),
		WalletID: walletID,
	})
}

// unusualNote is the notification's wording in one language: the title; the
// line with the amount (%s), the payee (%s) and why (%s); the line without
// the amount; and why, for each kind (scale's %d: how many times the usual).
type unusualNote struct {
	title, body, private string
	scale, fresh, double string
}

var unusualNotes = map[string]unusualNote{
	"en": {
		title: "Unusual transaction", body: "%s at %s: %s.", private: "%s: %s.",
		scale: "%d times the usual", fresh: "a new payee, a large amount", double: "charged twice",
	},
	"it": {
		title: "Transazione insolita", body: "%s da %s: %s.", private: "%s: %s.",
		scale: "%d volte il solito", fresh: "beneficiario nuovo, importo alto", double: "addebitato due volte",
	},
	"es": {
		title: "Movimiento inusual", body: "%s en %s: %s.", private: "%s: %s.",
		scale: "%d veces lo habitual", fresh: "beneficiario nuevo, importe alto", double: "cobrado dos veces",
	},
	"fr": {
		title: "Opération inhabituelle", body: "%s chez %s : %s.", private: "%s : %s.",
		scale: "%d fois l’habitude", fresh: "nouveau tiers, montant élevé", double: "débité deux fois",
	},
	"de": {
		title: "Ungewöhnliche Buchung", body: "%s bei %s: %s.", private: "%s: %s.",
		scale: "das %d-Fache des Üblichen", fresh: "neuer Zahlungspartner, hoher Betrag", double: "doppelt abgebucht",
	},
	"pt-BR": {
		title: "Lançamento incomum", body: "%s em %s: %s.", private: "%s: %s.",
		scale: "%d vezes o habitual", fresh: "beneficiário novo, valor alto", double: "cobrado duas vezes",
	},
}

const unusualSystem = "You point out unusual expenses to the owner of a personal-finance wallet. " +
	"CloudBank found them and worked out every number: use only those, never invent one. Write 1 " +
	"or 2 short sentences of plain text, with no headings, no lists and no markdown: say which to " +
	"check first and why. Do not accuse anyone; an unusual expense can be right. Give no investment " +
	"advice. Write amounts as the reader's language writes them, with the currency symbol."

func unusualPrompt(rows []UnusualRow, lang string) string {
	var w strings.Builder
	w.WriteString("Unusual expenses, newest first.\n")
	for _, r := range rows {
		plain := Basis{Currency: r.Currency}.plain
		switch r.Kind {
		case unusualScale:
			fmt.Fprintf(&w, "- %s, %s: %s; usually (median) %s over %d payments in the year before\n",
				r.Payee, r.Date, plain(r.Amount), plain(r.Usual), r.Payments)
		case unusualNew:
			fmt.Fprintf(&w, "- %s, %s: %s; a new payee, above 95%% of the wallet's expenses in the year before (%s)\n",
				r.Payee, r.Date, plain(r.Amount), plain(r.Usual))
		default:
			fmt.Fprintf(&w, "- %s: %s charged twice, on %s and %s\n", r.Payee, plain(r.Amount), r.OtherDate, r.Date)
		}
	}
	name := languages[lang]
	if name == "" {
		name = "English"
	}
	fmt.Fprintf(&w, "\nWrite the text in %s.", name)
	return w.String()
}

// writeUnusual has the model write over the flags still open. A failure
// leaves the last sentences: the flags show without them.
func (s *Service) writeUnusual(ctx context.Context, u db.ListAIUnusualUsersRow, walletID int64) {
	rows, err := s.unusualRows(ctx, u.UserID, walletID)
	if err != nil || len(rows) == 0 {
		return
	}
	ans, err := s.ai.Ask(ctx, ai.Call{
		UserID: u.UserID, WalletID: walletID, Feature: ai.FeatureUnusual,
		System: unusualSystem, User: unusualPrompt(rows, u.Locale), MaxTokens: 200,
	})
	if err != nil {
		return
	}
	body := strings.TrimSpace(ans.Text)
	if len(body) > bodyMax {
		body = strings.ToValidUTF8(body[:bodyMax], "")
	}
	if body == "" {
		return
	}
	_ = s.q.SetAIUnusualBody(ctx, db.SetAIUnusualBodyParams{
		Body: body, Model: ans.Model, WrittenAt: s.now().UTC().Format(time.RFC3339),
		UserID: u.UserID, WalletID: walletID,
	})
}

func (s *Service) unusualRows(ctx context.Context, userID, walletID int64) ([]UnusualRow, error) {
	list, err := s.rq.ListOpenAIUnusual(ctx, db.ListOpenAIUnusualParams{
		UserID: userID, WalletID: walletID,
		Since: s.now().UTC().AddDate(0, 0, -unusualDays).Format("2006-01-02T15:04:05.000Z"),
	})
	if err != nil {
		return nil, err
	}
	curs, err := s.currencies(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]UnusualRow, 0, len(list))
	for _, r := range list {
		out = append(out, UnusualRow{
			ID: r.ID, TransactionID: r.TransactionID, AccountID: r.AccountID, Date: r.Date, Payee: r.Payee,
			Amount: -r.Amount, Currency: currencyOf(curs[r.CurrencyID]), Kind: r.Kind,
			Usual: r.Usual, Payments: r.Payments, OtherID: r.OtherID, OtherDate: r.OtherDate,
		})
	}
	return out, nil
}

// UnusualOf is what the AI box shows on a wallet.
func (s *Service) UnusualOf(ctx context.Context, userID, walletID int64) (Unusual, error) {
	out := Unusual{Rows: []UnusualRow{}}
	rows, err := s.unusualRows(ctx, userID, walletID)
	if err != nil {
		return out, err
	}
	out.Rows = rows
	scan, err := s.rq.GetAIUnusualScan(ctx, db.GetAIUnusualScanParams{UserID: userID, WalletID: walletID})
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	out.Body, out.Model, out.Feedback, out.CreatedAt = scan.Body, scan.Model, scan.Feedback, scan.WrittenAt
	return out, nil
}

// UnusualFine puts a flag away: "It's fine".
func (s *Service) UnusualFine(ctx context.Context, userID, walletID, id int64) error {
	n, err := s.q.SetAIUnusualFine(ctx, db.SetAIUnusualFineParams{ID: id, UserID: userID, WalletID: walletID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetUnusualFeedback records a thumb on the box's sentences.
func (s *Service) SetUnusualFeedback(ctx context.Context, userID, walletID, feedback int64) error {
	if feedback < -1 || feedback > 1 {
		return fmt.Errorf("insight: feedback is -1, 0 or 1")
	}
	n, err := s.q.SetAIUnusualFeedback(ctx, db.SetAIUnusualFeedbackParams{Feedback: feedback, UserID: userID, WalletID: walletID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
