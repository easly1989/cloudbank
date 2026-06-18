package csvio

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// ErrNotFound is returned when an account does not belong to the wallet.
var ErrNotFound = errors.New("csvio: account not found in wallet")

// Service previews and commits CSV imports and exports account CSV.
type Service struct {
	db    *sql.DB
	q     *db.Queries
	txn   *transaction.Service
	rules *assignment.Service
	accts *account.Service
}

// NewService builds a CSV import/export Service backed by the write pool and the
// transaction, assignment and account services it composes.
func NewService(write *sql.DB, txn *transaction.Service, rules *assignment.Service, accts *account.Service) *Service {
	return &Service{db: write, q: db.New(write), txn: txn, rules: rules, accts: accts}
}

// PreviewRequest configures a preview.
type PreviewRequest struct {
	AccountID   int64
	Content     string
	Dialect     Dialect
	Delimiter   string
	HasHeader   bool
	DateFormat  string
	DecimalChar string
	Mapping     map[string]int
	ApplyRules  bool
}

// PreviewRow is a parsed-and-resolved row shown in the wizard. Include defaults
// false for duplicates and parse errors so they are flagged, never silently
// imported.
type PreviewRow struct {
	Line        int      `json:"line"`
	Include     bool     `json:"include"`
	Duplicate   bool     `json:"duplicate"`
	RuleApplied bool     `json:"ruleApplied"`
	Error       string   `json:"error,omitempty"`
	Date        string   `json:"date"`
	Amount      int64    `json:"amount"`
	PaymentMode int      `json:"paymentMode"`
	Info        string   `json:"info"`
	Payee       string   `json:"payee"`
	Memo        string   `json:"memo"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
}

// Preview is the wizard's preview payload.
type Preview struct {
	Columns []string     `json:"columns"`
	Rows    []PreviewRow `json:"rows"`
}

// Preview parses the CSV, rescales amounts to the account currency, flags
// duplicates against existing transactions and (optionally) applies import
// rules. A generic file with no mapping yet returns only the detected columns.
func (s *Service) Preview(ctx context.Context, walletID int64, req PreviewRequest) (Preview, error) {
	if ok, err := s.txn.AccountInWallet(ctx, walletID, req.AccountID); err != nil {
		return Preview{}, err
	} else if !ok {
		return Preview{}, ErrNotFound
	}

	delimiter := req.Delimiter
	if req.Dialect == DialectHomeBank {
		delimiter = ";"
	} else if delimiter == "" {
		delimiter = ","
	}
	columns, err := detectColumns(req.Content, delimiter, req.HasHeader)
	if err != nil {
		return Preview{}, err
	}
	// Generic file without a mapping: hand back the columns so the UI can map.
	if req.Dialect == DialectGeneric && len(req.Mapping) == 0 {
		return Preview{Columns: columns, Rows: []PreviewRow{}}, nil
	}

	acc, err := s.accts.Get(ctx, req.AccountID)
	if err != nil {
		return Preview{}, err
	}
	frac := acc.CurrencyFracDigits

	rows, err := Parse(req.Content, ParseOptions{
		Dialect: req.Dialect, Delimiter: req.Delimiter, HasHeader: req.HasHeader,
		DateFormat: req.DateFormat, DecimalChar: req.DecimalChar, Mapping: req.Mapping,
	})
	if err != nil {
		return Preview{}, err
	}

	var idToPayee map[int64]string
	var idToCat map[int64]string
	var importRules []assignment.Rule
	if req.ApplyRules {
		if importRules, err = s.rules.ImportRules(ctx, walletID); err != nil {
			return Preview{}, err
		}
		if idToPayee, err = s.payeeNames(ctx, walletID); err != nil {
			return Preview{}, err
		}
		if idToCat, _, err = s.categoryNames(ctx, walletID); err != nil {
			return Preview{}, err
		}
	}

	out := make([]PreviewRow, 0, len(rows))
	for _, r := range rows {
		pr := PreviewRow{
			Line: r.Line, Date: r.Date, PaymentMode: r.PaymentMode, Info: r.Info,
			Payee: r.Payee, Memo: r.Memo, Category: r.Category, Tags: r.Tags,
		}
		if r.Err != "" {
			pr.Error = r.Err
			out = append(out, pr)
			continue
		}
		pr.Amount = rescaleAmount(r.Amount, frac)

		if req.ApplyRules {
			if res, ok := assignment.MatchRow(importRules, r.Memo, r.Payee); ok {
				pr.RuleApplied = true
				if res.PayeeID != nil {
					if n, ok := idToPayee[*res.PayeeID]; ok {
						pr.Payee = n
					}
				}
				if res.CategoryID != nil {
					if n, ok := idToCat[*res.CategoryID]; ok {
						pr.Category = n
					}
				}
				if res.PaymentMode != nil {
					pr.PaymentMode = *res.PaymentMode
				}
			}
		}

		dups, err := s.txn.FindDuplicates(ctx, req.AccountID, pr.Date, pr.Amount, 0)
		if err != nil {
			return Preview{}, err
		}
		pr.Duplicate = len(dups) > 0
		pr.Include = !pr.Duplicate
		out = append(out, pr)
	}
	return Preview{Columns: columns, Rows: out}, nil
}

// CommitRow is a resolved row to persist (the wizard sends back only the rows
// the user kept, with any edits applied).
type CommitRow struct {
	Date        string   `json:"date"`
	Amount      int64    `json:"amount"`
	PaymentMode int      `json:"paymentMode"`
	Info        string   `json:"info"`
	Payee       string   `json:"payee"`
	Memo        string   `json:"memo"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
}

// CommitResult reports how many transactions were created.
type CommitResult struct {
	Created int `json:"created"`
}

// Commit creates a transaction for every row in one database transaction,
// creating any missing payees, categories (two-level) and tags by name.
func (s *Service) Commit(ctx context.Context, walletID, accountID int64, rows []CommitRow) (CommitResult, error) {
	if ok, err := s.txn.AccountInWallet(ctx, walletID, accountID); err != nil {
		return CommitResult{}, err
	} else if !ok {
		return CommitResult{}, ErrNotFound
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CommitResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := db.New(tx)

	// Existing payees and categories, keyed case-insensitively for reuse.
	payeeByName := map[string]int64{}
	pays, err := qtx.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return CommitResult{}, err
	}
	for _, p := range pays {
		payeeByName[strings.ToLower(p.Name)] = p.ID
	}
	catByFull := map[string]int64{}
	cats, err := qtx.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return CommitResult{}, err
	}
	catName := map[int64]db.Category{}
	for _, c := range cats {
		catName[c.ID] = c
	}
	for _, c := range cats {
		catByFull[strings.ToLower(fullCategoryName(c, catName))] = c.ID
	}

	ensurePayee := func(name string) (*int64, error) {
		name = strings.TrimSpace(name)
		if name == "" {
			return nil, nil
		}
		if id, ok := payeeByName[strings.ToLower(name)]; ok {
			return &id, nil
		}
		row, err := qtx.InsertPayee(ctx, db.InsertPayeeParams{WalletID: walletID, Name: name})
		if err != nil {
			return nil, err
		}
		payeeByName[strings.ToLower(name)] = row.ID
		return &row.ID, nil
	}
	ensureTop := func(name string) (int64, error) {
		if id, ok := catByFull[strings.ToLower(name)]; ok {
			return id, nil
		}
		row, err := qtx.InsertCategory(ctx, db.InsertCategoryParams{WalletID: walletID, Name: name})
		if err != nil {
			return 0, err
		}
		catByFull[strings.ToLower(name)] = row.ID
		return row.ID, nil
	}
	ensureCategory := func(full string) (*int64, error) {
		full = strings.TrimSpace(full)
		if full == "" {
			return nil, nil
		}
		if id, ok := catByFull[strings.ToLower(full)]; ok {
			return &id, nil
		}
		parts := strings.SplitN(full, CategorySep, 2)
		parent := strings.TrimSpace(parts[0])
		if len(parts) == 2 && strings.TrimSpace(parts[1]) != "" {
			pid, err := ensureTop(parent)
			if err != nil {
				return nil, err
			}
			child := strings.TrimSpace(parts[1])
			row, err := qtx.InsertCategory(ctx, db.InsertCategoryParams{
				WalletID: walletID, ParentID: sql.NullInt64{Int64: pid, Valid: true}, Name: child,
			})
			if err != nil {
				return nil, err
			}
			catByFull[strings.ToLower(full)] = row.ID
			return &row.ID, nil
		}
		id, err := ensureTop(parent)
		if err != nil {
			return nil, err
		}
		return &id, nil
	}

	created := 0
	for _, r := range rows {
		if !isISODate(r.Date) {
			continue
		}
		pid, err := ensurePayee(r.Payee)
		if err != nil {
			return CommitResult{}, err
		}
		cid, err := ensureCategory(r.Category)
		if err != nil {
			return CommitResult{}, err
		}
		mode := r.PaymentMode
		if mode < 0 {
			mode = 0
		} else if mode > 11 {
			mode = 11
		}
		in := transaction.Input{
			AccountID: accountID, Date: r.Date, Amount: r.Amount, PaymentMode: mode,
			Status: 0, Info: r.Info, PayeeID: pid, CategoryID: cid, Memo: r.Memo, Tags: r.Tags,
		}
		if _, err := s.txn.CreateInTx(ctx, qtx, walletID, in); err != nil {
			return CommitResult{}, err
		}
		created++
	}

	if err := tx.Commit(); err != nil {
		return CommitResult{}, err
	}
	return CommitResult{Created: created}, nil
}

// ExportAccount renders all of an account's transactions as a HomeBank CSV.
func (s *Service) ExportAccount(ctx context.Context, walletID, accountID int64) (string, error) {
	if ok, err := s.txn.AccountInWallet(ctx, walletID, accountID); err != nil {
		return "", err
	} else if !ok {
		return "", ErrNotFound
	}
	acc, err := s.accts.Get(ctx, accountID)
	if err != nil {
		return "", err
	}
	idToCat, _, err := s.categoryNames(ctx, walletID)
	if err != nil {
		return "", err
	}

	txns, _, err := s.txn.List(ctx, accountID, 1_000_000, 0)
	if err != nil {
		return "", err
	}
	// List returns newest-first; export oldest-first for readability.
	sort.SliceStable(txns, func(i, j int) bool {
		if txns[i].Date != txns[j].Date {
			return txns[i].Date < txns[j].Date
		}
		return txns[i].ID < txns[j].ID
	})

	rows := make([]ExportRow, 0, len(txns))
	for _, t := range txns {
		cat := ""
		if t.CategoryID != nil {
			cat = idToCat[*t.CategoryID]
		}
		tags, err := s.q.ListTransactionTags(ctx, t.ID)
		if err != nil {
			return "", err
		}
		rows = append(rows, ExportRow{
			Date: t.Date, PaymentMode: t.PaymentMode, Info: t.Info, Payee: t.PayeeName,
			Memo: t.Memo, Amount: t.Amount, FracDigits: acc.CurrencyFracDigits, Category: cat, Tags: tags,
		})
	}
	return FormatHomeBankCSV(rows)
}

// payeeNames returns an id→name map for the wallet's payees.
func (s *Service) payeeNames(ctx context.Context, walletID int64) (map[int64]string, error) {
	pays, err := s.q.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(pays))
	for _, p := range pays {
		out[p.ID] = p.Name
	}
	return out, nil
}

// categoryNames returns an id→full-name map and the raw category index.
func (s *Service) categoryNames(ctx context.Context, walletID int64) (map[int64]string, map[int64]db.Category, error) {
	cats, err := s.q.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, nil, err
	}
	byID := make(map[int64]db.Category, len(cats))
	for _, c := range cats {
		byID[c.ID] = c
	}
	out := make(map[int64]string, len(cats))
	for _, c := range cats {
		out[c.ID] = fullCategoryName(c, byID)
	}
	return out, byID, nil
}

// fullCategoryName joins a sub-category with its parent ("Parent:Sub").
func fullCategoryName(c db.Category, byID map[int64]db.Category) string {
	if c.ParentID.Valid {
		if p, ok := byID[c.ParentID.Int64]; ok {
			return p.Name + CategorySep + c.Name
		}
	}
	return c.Name
}

func isISODate(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return false
	}
	for i, c := range s {
		if i == 4 || i == 7 {
			continue
		}
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
