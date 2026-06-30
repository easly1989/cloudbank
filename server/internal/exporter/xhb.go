// Package exporter writes a wallet to a HomeBank .xhb file — the reverse of the
// importer. It reuses the importer's XHB structs so an exported file re-imports
// symmetrically, and maps a backup.Document (the clean domain snapshot) to the
// HomeBank XML encoding (Julian dates, dot-decimal amounts, flag bitmasks,
// kxfer-paired transfers, split lists and category budgets).
package exporter

import (
	"encoding/xml"
	"strconv"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/backup"
	"github.com/easly1989/cloudbank/server/internal/importer"
)

// HomeBank flag bits (mirror of the importer's).
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
	favAuto   = 1 << 0
)

// homeBankEpoch is the HomeBank Julian day number for 1970-01-01.
const homeBankEpoch = 719163

var epoch1970 = time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)

// dateToJulian converts a civil YYYY-MM-DD date to a HomeBank Julian day number.
func dateToJulian(date string) int {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return 0
	}
	return int(t.Sub(epoch1970).Hours()/24) + homeBankEpoch
}

// formatAmount renders signed minor units as a dot-separated C-locale decimal
// with frac fractional digits (the inverse of the importer's parseAmount).
func formatAmount(minor int64, frac int) string {
	neg := minor < 0
	if neg {
		minor = -minor
	}
	digits := strconv.FormatInt(minor, 10)
	var out string
	if frac <= 0 {
		out = digits
	} else {
		for len(digits) <= frac {
			digits = "0" + digits
		}
		out = digits[:len(digits)-frac] + "." + digits[len(digits)-frac:]
	}
	if neg {
		out = "-" + out
	}
	return out
}

// accountTypeCode maps a CloudBank account type to a HomeBank type code (the
// inverse of the importer's accountType; checking/savings fold into bank and
// investment into asset, matching HomeBank's supported set).
func accountTypeCode(t string) int {
	switch t {
	case "cash":
		return 2
	case "asset", "investment":
		return 3
	case "creditcard":
		return 4
	case "liability":
		return 5
	default: // bank, checking, savings
		return 1
	}
}

func scheduleUnitCode(unit string) int {
	switch unit {
	case "day":
		return 0
	case "week":
		return 1
	case "year":
		return 3
	default: // month
		return 2
	}
}

// Build maps a wallet backup document to a HomeBank .xhb file.
func Build(doc *backup.Document) ([]byte, error) {
	x := importer.XHB{Version: "1.4"}

	// Assign HomeBank keys to each entity (1-based, in document order).
	curKey := make(map[int64]int, len(doc.Currencies))
	curFrac := make(map[int64]int, len(doc.Currencies))
	baseFrac := 2
	for i, c := range doc.Currencies {
		key := i + 1
		curKey[c.ID] = key
		curFrac[c.ID] = int(c.FracDigits)
		if c.IsBase {
			x.Properties.Curr = key
			baseFrac = int(c.FracDigits)
		}
		x.Currencies = append(x.Currencies, importer.XCur{
			Key: key, ISO: c.IsoCode, Name: c.Name, Symb: c.Symbol, Syprf: b2i(c.SymbolPrefix),
			Dchar: c.DecimalChar, Gchar: c.GroupChar, Frac: int(c.FracDigits), Rate: c.Rate,
		})
	}
	x.Properties.Title = doc.Wallet.Title

	accKey := make(map[int64]int, len(doc.Accounts))
	accFrac := make(map[int64]int, len(doc.Accounts))
	for i, a := range doc.Accounts {
		key := i + 1
		accKey[a.ID] = key
		frac := curFrac[a.CurrencyID]
		accFrac[a.ID] = frac
		flags := 0
		if a.Closed {
			flags |= accClosed
		}
		if a.NoSummary {
			flags |= accNoSum
		}
		if a.NoBudget {
			flags |= accNoBudg
		}
		if a.NoReport {
			flags |= accNoRep
		}
		x.Accounts = append(x.Accounts, importer.XAccount{
			Key: key, Pos: int(a.Position), Type: accountTypeCode(a.Type), Curr: curKey[a.CurrencyID],
			Flags: flags, Name: a.Name, Number: a.Number, Bankname: a.Institution,
			Initial: formatAmount(a.InitialBalance, frac), Minimum: formatAmount(a.MinimumBalance, frac),
			Notes: a.Notes,
		})
	}

	payKey := make(map[int64]int, len(doc.Payees))
	for i, p := range doc.Payees {
		key := i + 1
		payKey[p.ID] = key
		x.Payees = append(x.Payees, importer.XPayee{Key: key, Name: p.Name})
	}

	// Budgets grouped by category for the b0..b12 attributes. HomeBank has no
	// per-year budgets, so only the "every year" (year 0) defaults are exported.
	budByCat := make(map[int64][]backup.Budget)
	for _, b := range doc.Budgets {
		if b.Year != 0 {
			continue
		}
		budByCat[b.CategoryID] = append(budByCat[b.CategoryID], b)
	}

	catKey := make(map[int64]int, len(doc.Categories))
	for i, c := range doc.Categories {
		catKey[c.ID] = i + 1
	}
	for i, c := range doc.Categories {
		xc := importer.XCat{Key: i + 1, Name: c.Name}
		if c.ParentID != nil {
			xc.Parent = catKey[*c.ParentID]
		}
		if c.IsIncome {
			xc.Flags |= catIncome
		}
		applyBudget(&xc, budByCat[c.ID], baseFrac)
		x.Categories = append(x.Categories, xc)
	}

	for i, tg := range doc.Tags {
		x.Tags = append(x.Tags, importer.XTag{Key: i + 1, Name: tg.Name})
	}

	// Transfers: assign a kxfer key to each leg.
	kxfer := make(map[int64]int, len(doc.Transfers)*2)
	for i, tr := range doc.Transfers {
		kxfer[tr.TxnFromID] = i + 1
		kxfer[tr.TxnToID] = i + 1
	}

	for _, op := range doc.Transactions {
		xo := importer.XOpe{
			Date: dateToJulian(op.Date), Amount: formatAmount(op.Amount, accFrac[op.AccountID]),
			Account: accKey[op.AccountID], Paymode: int(op.PaymentMode), St: int(op.Status),
			Wording: op.Memo, Info: op.Info, Tags: strings.Join(op.Tags, " "), Kxfer: kxfer[op.ID],
		}
		if op.PayeeID != nil {
			xo.Payee = payKey[*op.PayeeID]
		}
		if op.IsSplit {
			cats := make([]string, 0, len(op.Splits))
			amts := make([]string, 0, len(op.Splits))
			mems := make([]string, 0, len(op.Splits))
			for _, sp := range op.Splits {
				k := 0
				if sp.CategoryID != nil {
					k = catKey[*sp.CategoryID]
				}
				cats = append(cats, strconv.Itoa(k))
				amts = append(amts, formatAmount(sp.Amount, accFrac[op.AccountID]))
				mems = append(mems, sp.Memo)
			}
			xo.Scat = strings.Join(cats, "||")
			xo.Samt = strings.Join(amts, "||")
			xo.Smem = strings.Join(mems, "||")
		} else if op.CategoryID != nil {
			xo.Category = catKey[*op.CategoryID]
		}
		x.Operations = append(x.Operations, xo)
	}

	// Templates (+ their schedule, if any) become favorites.
	schedByTpl := make(map[int64]backup.Schedule, len(doc.Schedules))
	for _, s := range doc.Schedules {
		schedByTpl[s.TemplateID] = s
	}
	for _, tpl := range doc.Templates {
		frac := baseFrac
		fav := importer.XFav{
			Amount:  formatAmount(tpl.Amount, fracOr(tpl.AccountID, accFrac, frac)),
			Paymode: int(tpl.PaymentMode), Wording: tpl.Name,
		}
		if tpl.AccountID != nil {
			fav.Account = accKey[*tpl.AccountID]
		}
		if tpl.PayeeID != nil {
			fav.Payee = payKey[*tpl.PayeeID]
		}
		if tpl.CategoryID != nil {
			fav.Category = catKey[*tpl.CategoryID]
		}
		if s, ok := schedByTpl[tpl.ID]; ok {
			fav.Nextdate = dateToJulian(s.NextDue)
			fav.Every = int(s.EveryN)
			fav.Unit = scheduleUnitCode(s.Unit)
			fav.Weekend = int(s.WeekendMode)
			if s.Remaining != nil {
				fav.Limit = int(*s.Remaining)
			}
			if s.AutoPost != 0 {
				fav.Flags |= favAuto
			}
		}
		x.Favorites = append(x.Favorites, fav)
	}

	for i, a := range doc.Assignments {
		xa := importer.XAsg{Key: i + 1, Name: a.Pattern}
		if a.MatchField == "payee" {
			xa.Field = 1
		}
		switch a.MatchType {
		case "regex":
			xa.Flags |= asgRegex
		case "exact":
			xa.Flags |= asgExact
		}
		if a.SetPayeeID != nil {
			xa.Flags |= asgDoPay
			xa.Payee = payKey[*a.SetPayeeID]
		}
		if a.SetCategoryID != nil {
			xa.Flags |= asgDoCat
			xa.Category = catKey[*a.SetCategoryID]
		}
		if a.SetPaymentMode != nil {
			xa.Flags |= asgDoMode
			xa.Paymode = int(*a.SetPaymentMode)
		}
		x.Assignments = append(x.Assignments, xa)
	}

	body, err := xml.MarshalIndent(&x, "", " ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), body...), nil
}

// applyBudget fills a category's b0..b12 attributes and budget flags. Per-month
// values (months 1..12) take precedence and set the "custom" flag; otherwise a
// single month-0 value applies every month.
func applyBudget(c *importer.XCat, budgets []backup.Budget, frac int) {
	if len(budgets) == 0 {
		return
	}
	monthly := [13]string{}
	hasCustom := false
	var same string
	for _, b := range budgets {
		if b.Month >= 1 && b.Month <= 12 {
			monthly[b.Month] = formatAmount(b.Amount, frac)
			hasCustom = true
		} else if b.Month == 0 {
			same = formatAmount(b.Amount, frac)
		}
	}
	c.Flags |= catBudget
	if hasCustom {
		c.Flags |= catCustom
		c.B1, c.B2, c.B3, c.B4, c.B5, c.B6 = monthly[1], monthly[2], monthly[3], monthly[4], monthly[5], monthly[6]
		c.B7, c.B8, c.B9, c.B10, c.B11, c.B12 = monthly[7], monthly[8], monthly[9], monthly[10], monthly[11], monthly[12]
	} else {
		c.B0 = same
	}
}

func fracOr(accountID *int64, accFrac map[int64]int, def int) int {
	if accountID != nil {
		if f, ok := accFrac[*accountID]; ok {
			return f
		}
	}
	return def
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
