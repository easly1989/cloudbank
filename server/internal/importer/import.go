package importer

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/dbconv"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/wallet"
)

// HomeBank flag bits (from the documented file format).
const (
	catIncome = 1 << 1
	catCustom = 1 << 2
	catBudget = 1 << 3
	accClosed = 1 << 0
	accNoSum  = 1 << 3
	accNoBudg = 1 << 4
	accNoRep  = 1 << 5
	asgDoCat  = 1 << 1
	asgDoPay  = 1 << 2
	asgDoMode = 1 << 3
	asgExact  = 1 << 4
	asgRegex  = 1 << 5
	favAuto   = 1 << 0 // auto-post when scheduled
)

// Result summarizes an import.
type Result struct {
	WalletID int64          `json:"walletId"`
	Counts   map[string]int `json:"counts"`
	Warnings []string       `json:"warnings"`
}

// Service imports HomeBank files.
type Service struct {
	db *sql.DB
}

// NewService builds an import Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write}
}

// accountType maps a HomeBank account type code to a CloudBank type.
func accountType(code int) string {
	switch code {
	case 1:
		return "bank"
	case 2:
		return "cash"
	case 3:
		return "asset"
	case 4:
		return "creditcard"
	case 5:
		return "liability"
	default:
		return "bank"
	}
}

func clamp(v, lo, hi int) int64 {
	if v < lo {
		v = lo
	}
	if v > hi {
		v = hi
	}
	return int64(v)
}

// ImportXHB parses a HomeBank file and creates a fully-populated wallet owned by
// userID, in a single transaction. The whole import rolls back on any error.
func (s *Service) ImportXHB(ctx context.Context, userID int64, x *XHB) (Result, error) {
	res := Result{Counts: map[string]int{}, Warnings: []string{}}
	if major := strings.SplitN(x.Version, ".", 2)[0]; major != "" && major != "1" {
		res.Warnings = append(res.Warnings, fmt.Sprintf("file format version %q is newer than supported; some data may be skipped", x.Version))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return res, err
	}
	defer func() { _ = tx.Rollback() }()
	q := db.New(tx)

	title := strings.TrimSpace(x.Properties.Title)
	if title == "" {
		title = "Imported wallet"
	}
	w, err := q.CreateWallet(ctx, db.CreateWalletParams{Title: title})
	if err != nil {
		return res, err
	}
	res.WalletID = w.ID
	if err := q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: userID, Role: wallet.RoleOwner}); err != nil {
		return res, err
	}

	curID := map[int]int64{} // xhb currency key → our id
	curFrac := map[int]int{} // our currency id → frac digits
	for _, c := range x.Currencies {
		row, err := q.InsertCurrency(ctx, db.InsertCurrencyParams{
			WalletID: w.ID, IsoCode: c.ISO, Name: orDefault(c.Name, c.ISO), Symbol: c.Symb,
			SymbolPrefix: int64(c.Syprf), DecimalChar: orDefault(c.Dchar, "."), GroupChar: orDefault(c.Gchar, ","),
			FracDigits: clamp(c.Frac, 0, 6), IsBase: dbconv.B2i(c.Key == x.Properties.Curr), Rate: c.Rate,
		})
		if err != nil {
			return res, err
		}
		curID[c.Key] = row.ID
		curFrac[c.Key] = c.Frac
		res.Counts["currencies"]++
	}
	if baseID, ok := curID[x.Properties.Curr]; ok {
		if err := q.UpdateWalletBaseCurrency(ctx, db.UpdateWalletBaseCurrencyParams{BaseCurrencyID: sql.NullInt64{Int64: baseID, Valid: true}, ID: w.ID}); err != nil {
			return res, err
		}
	}

	accID := map[int]int64{} // xhb account key → our id
	accFrac := map[int]int{} // xhb account key → frac digits (of its currency)
	for _, a := range x.Accounts {
		cid, ok := curID[a.Curr]
		if !ok {
			res.Warnings = append(res.Warnings, fmt.Sprintf("account %q references unknown currency %d, skipped", a.Name, a.Curr))
			continue
		}
		frac := curFrac[a.Curr]
		row, err := q.InsertAccount(ctx, db.InsertAccountParams{
			WalletID: w.ID, Name: a.Name, Type: accountType(a.Type), CurrencyID: cid,
			Institution: a.Bankname, Number: a.Number, Notes: a.Notes,
			InitialBalance: parseAmount(a.Initial, frac), MinimumBalance: parseAmount(a.Minimum, frac),
			Closed: dbconv.B2i(a.Flags&accClosed != 0), NoSummary: dbconv.B2i(a.Flags&accNoSum != 0),
			NoBudget: dbconv.B2i(a.Flags&accNoBudg != 0), NoReport: dbconv.B2i(a.Flags&accNoRep != 0),
			Position: int64(a.Pos),
		})
		if err != nil {
			return res, err
		}
		accID[a.Key] = row.ID
		accFrac[a.Key] = frac
		res.Counts["accounts"]++
	}

	payID := map[int]int64{}
	for _, p := range x.Payees {
		row, err := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: w.ID, Name: p.Name})
		if err != nil {
			return res, err
		}
		payID[p.Key] = row.ID
		res.Counts["payees"]++
	}

	// Categories: parents first so children can resolve their parent.
	baseFrac := curFrac[x.Properties.Curr]
	catID := map[int]int64{}
	insertCat := func(c XCat) error {
		var parent sql.NullInt64
		if c.Parent != 0 {
			if pid, ok := catID[c.Parent]; ok {
				parent = sql.NullInt64{Int64: pid, Valid: true}
			}
		}
		row, err := q.InsertCategory(ctx, db.InsertCategoryParams{
			WalletID: w.ID, ParentID: parent, Name: c.Name, IsIncome: dbconv.B2i(c.Flags&catIncome != 0),
		})
		if err != nil {
			return err
		}
		catID[c.Key] = row.ID
		res.Counts["categories"]++
		if c.Flags&catBudget != 0 {
			months := c.months()
			if c.Flags&catCustom != 0 {
				for m := 1; m <= 12; m++ {
					if v := parseAmount(months[m], baseFrac); v != 0 {
						if err := q.InsertBudget(ctx, db.InsertBudgetParams{WalletID: w.ID, CategoryID: row.ID, Month: int64(m), Amount: v}); err != nil {
							return err
						}
						res.Counts["budgets"]++
					}
				}
			} else if v := parseAmount(months[0], baseFrac); v != 0 {
				if err := q.InsertBudget(ctx, db.InsertBudgetParams{WalletID: w.ID, CategoryID: row.ID, Month: 0, Amount: v}); err != nil {
					return err
				}
				res.Counts["budgets"]++
			}
		}
		return nil
	}
	for _, c := range x.Categories {
		if c.Parent == 0 {
			if err := insertCat(c); err != nil {
				return res, err
			}
		}
	}
	for _, c := range x.Categories {
		if c.Parent != 0 {
			if err := insertCat(c); err != nil {
				return res, err
			}
		}
	}

	tagID := map[string]int64{}
	ensureTag := func(name string) (int64, error) {
		name = strings.TrimSpace(name)
		if name == "" {
			return 0, nil
		}
		if id, ok := tagID[name]; ok {
			return id, nil
		}
		row, err := q.InsertTag(ctx, db.InsertTagParams{WalletID: w.ID, Name: name})
		if err != nil {
			return 0, err
		}
		tagID[name] = row.ID
		res.Counts["tags"]++
		return row.ID, nil
	}
	for _, tg := range x.Tags {
		if _, err := ensureTag(tg.Name); err != nil {
			return res, err
		}
	}

	// Transactions. Remember each transfer leg's inserted id for re-pairing.
	type leg struct {
		txnID  int64
		amount int64
	}
	xfer := map[int][]leg{} // kxfer → its legs
	for _, o := range x.Operations {
		aid, ok := accID[o.Account]
		if !ok {
			res.Warnings = append(res.Warnings, "transaction references unknown account, skipped")
			continue
		}
		frac := accFrac[o.Account]
		amount := parseAmount(o.Amount, frac)
		splits := splitList(o.Scat)
		isSplit := len(splits) > 0
		var payee, category sql.NullInt64
		if pid, ok := payID[o.Payee]; ok {
			payee = sql.NullInt64{Int64: pid, Valid: true}
		}
		if !isSplit {
			if cid, ok := catID[o.Category]; ok {
				category = sql.NullInt64{Int64: cid, Valid: true}
			}
		}
		row, err := q.InsertTransaction(ctx, db.InsertTransactionParams{
			WalletID: w.ID, AccountID: aid, Date: julianToDate(o.Date), Amount: amount,
			PaymentMode: clamp(o.Paymode, 0, 11), Status: clamp(o.St, 0, 4), Info: o.Info,
			PayeeID: payee, CategoryID: category, Memo: o.Wording, IsSplit: dbconv.B2i(isSplit),
		})
		if err != nil {
			return res, err
		}
		res.Counts["transactions"]++

		if isSplit {
			amts := splitList(o.Samt)
			mems := splitList(o.Smem)
			for i, sc := range splits {
				var scat sql.NullInt64
				if cid, ok := catID[atoi(sc)]; ok {
					scat = sql.NullInt64{Int64: cid, Valid: true}
				}
				var samt int64
				if i < len(amts) {
					samt = parseAmount(amts[i], frac)
				}
				smem := ""
				if i < len(mems) {
					smem = mems[i]
				}
				if err := q.InsertSplit(ctx, db.InsertSplitParams{TransactionID: row.ID, CategoryID: scat, Amount: samt, Memo: smem, Position: int64(i)}); err != nil {
					return res, err
				}
			}
		}
		for _, name := range strings.Fields(o.Tags) {
			tid, err := ensureTag(name)
			if err != nil {
				return res, err
			}
			if tid != 0 {
				if err := q.AddTransactionTag(ctx, db.AddTransactionTagParams{TransactionID: row.ID, TagID: tid}); err != nil {
					return res, err
				}
			}
		}
		if o.Kxfer > 0 {
			xfer[o.Kxfer] = append(xfer[o.Kxfer], leg{txnID: row.ID, amount: amount})
		}
	}

	// Re-pair transfers: the negative leg is the source, the positive the dest.
	for k, legs := range xfer {
		if len(legs) != 2 {
			res.Warnings = append(res.Warnings, fmt.Sprintf("transfer %d has %d legs (expected 2), skipped", k, len(legs)))
			continue
		}
		from, to := legs[0], legs[1]
		if from.amount > 0 {
			from, to = to, from
		}
		if _, err := q.InsertTransfer(ctx, db.InsertTransferParams{TxnFromID: from.txnID, TxnToID: to.txnID}); err != nil {
			return res, err
		}
		res.Counts["transfers"]++
	}

	if err := s.importAssignments(ctx, q, w.ID, x, payID, catID, &res); err != nil {
		return res, err
	}
	if err := s.importTemplates(ctx, q, w.ID, x, accID, accFrac, payID, catID, &res); err != nil {
		return res, err
	}

	if err := tx.Commit(); err != nil {
		return res, err
	}
	return res, nil
}

func (s *Service) importAssignments(ctx context.Context, q *db.Queries, walletID int64, x *XHB, payID, catID map[int]int64, res *Result) error {
	for pos, a := range x.Assignments {
		matchType := "contains"
		if a.Flags&asgRegex != 0 {
			matchType = "regex"
		} else if a.Flags&asgExact != 0 {
			matchType = "exact"
		}
		field := "memo"
		if a.Field != 0 {
			field = "payee"
		}
		var setPayee, setCat, setMode sql.NullInt64
		if a.Flags&asgDoPay != 0 {
			if pid, ok := payID[a.Payee]; ok {
				setPayee = sql.NullInt64{Int64: pid, Valid: true}
			}
		}
		if a.Flags&asgDoCat != 0 {
			if cid, ok := catID[a.Category]; ok {
				setCat = sql.NullInt64{Int64: cid, Valid: true}
			}
		}
		if a.Flags&asgDoMode != 0 {
			setMode = sql.NullInt64{Int64: clamp(a.Paymode, 0, 11), Valid: true}
		}
		if strings.TrimSpace(a.Name) == "" {
			continue
		}
		if _, err := q.InsertAssignment(ctx, db.InsertAssignmentParams{
			WalletID: walletID, Position: int64(pos), MatchField: field, MatchType: matchType,
			Pattern: a.Name, CaseSensitive: 0, SetPayeeID: setPayee, SetCategoryID: setCat,
			SetPaymentMode: setMode, ApplyOnManual: 1, ApplyOnImport: 1,
		}); err != nil {
			return err
		}
		res.Counts["assignments"]++
	}
	return nil
}

func (s *Service) importTemplates(ctx context.Context, q *db.Queries, walletID int64, x *XHB, accID map[int]int64, accFrac map[int]int, payID, catID map[int]int64, res *Result) error {
	for _, fav := range x.Favorites {
		frac := accFrac[fav.Account]
		var acc, payee, cat sql.NullInt64
		if aid, ok := accID[fav.Account]; ok {
			acc = sql.NullInt64{Int64: aid, Valid: true}
		}
		if pid, ok := payID[fav.Payee]; ok {
			payee = sql.NullInt64{Int64: pid, Valid: true}
		}
		if cid, ok := catID[fav.Category]; ok {
			cat = sql.NullInt64{Int64: cid, Valid: true}
		}
		name := fav.Wording
		if strings.TrimSpace(name) == "" {
			name = "Template"
		}
		tpl, err := q.InsertTemplate(ctx, db.InsertTemplateParams{
			WalletID: walletID, Name: name, AccountID: acc, Amount: parseAmount(fav.Amount, frac),
			PaymentMode: clamp(fav.Paymode, 0, 11), Memo: fav.Wording, PayeeID: payee, CategoryID: cat,
		})
		if err != nil {
			return err
		}
		res.Counts["templates"]++

		if fav.Nextdate > 0 && fav.Every > 0 {
			var remaining sql.NullInt64
			if fav.Limit > 0 {
				remaining = sql.NullInt64{Int64: int64(fav.Limit), Valid: true}
			}
			if _, err := q.InsertSchedule(ctx, db.InsertScheduleParams{
				WalletID: walletID, TemplateID: tpl.ID, Unit: scheduleUnit(fav.Unit), EveryN: int64(fav.Every),
				NextDue: julianToDate(fav.Nextdate), WeekendMode: clamp(fav.Weekend, 0, 3),
				Remaining: remaining, PostAdvance: 0, AutoPost: dbconv.B2i(fav.Flags&favAuto != 0),
			}); err != nil {
				return err
			}
			res.Counts["schedules"]++
		}
	}
	return nil
}

func scheduleUnit(u int) string {
	switch u {
	case 0:
		return "day"
	case 1:
		return "week"
	case 3:
		return "year"
	default:
		return "month"
	}
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

func atoi(s string) int {
	n := 0
	for _, r := range strings.TrimSpace(s) {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
	}
	return n
}
