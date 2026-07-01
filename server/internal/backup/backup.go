// Package backup exports a wallet to a self-contained, versioned JSON document
// and restores such a document into a brand-new wallet. Restore never mutates an
// existing wallet, so a backup → restore round-trip is always non-destructive.
package backup

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/easly1989/cloudbank/server/internal/attachment"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/wallet"
)

// Version is the backup document schema version.
const Version = 1

// Document is the root of a wallet backup.
type Document struct {
	Version      int           `json:"version"`
	ExportedAt   string        `json:"exportedAt"`
	Wallet       WalletMeta    `json:"wallet"`
	Currencies   []Currency    `json:"currencies"`
	Accounts     []Account     `json:"accounts"`
	Payees       []Payee       `json:"payees"`
	Categories   []Category    `json:"categories"`
	Tags         []Tag         `json:"tags"`
	Transactions []Transaction `json:"transactions"`
	Transfers    []Transfer    `json:"transfers"`
	Templates    []Template    `json:"templates"`
	Schedules    []Schedule    `json:"schedules"`
	Assignments  []Assignment  `json:"assignments"`
	Budgets      []Budget      `json:"budgets"`
	Attachments  []Attachment  `json:"attachments,omitempty"`
}

// Attachment is a backed-up transaction file: its metadata plus the file bytes
// (base64) so a restore is fully self-contained. TransactionID references the
// transaction by its in-document id.
type Attachment struct {
	TransactionID int64  `json:"transactionId"`
	Filename      string `json:"filename"`
	ContentType   string `json:"contentType"`
	Size          int64  `json:"size"`
	Content       string `json:"content"` // base64-encoded file bytes
}

// WalletMeta is the wallet's own metadata.
type WalletMeta struct {
	Title     string `json:"title"`
	OwnerName string `json:"ownerName"`
}

// Currency is a backed-up currency plus its rate history.
type Currency struct {
	ID           int64   `json:"id"`
	IsoCode      string  `json:"isoCode"`
	Name         string  `json:"name"`
	Symbol       string  `json:"symbol"`
	SymbolPrefix bool    `json:"symbolPrefix"`
	DecimalChar  string  `json:"decimalChar"`
	GroupChar    string  `json:"groupChar"`
	FracDigits   int64   `json:"fracDigits"`
	IsBase       bool    `json:"isBase"`
	Rate         float64 `json:"rate"`
	Rates        []Rate  `json:"rates,omitempty"`
}

// Rate is one exchange-rate history record.
type Rate struct {
	Date   string  `json:"date"`
	Rate   float64 `json:"rate"`
	Source string  `json:"source"`
}

// Account is a backed-up account.
type Account struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	Type           string `json:"type"`
	CurrencyID     int64  `json:"currencyId"`
	Institution    string `json:"institution"`
	Number         string `json:"number"`
	InitialBalance int64  `json:"initialBalance"`
	MinimumBalance int64  `json:"minimumBalance"`
	Closed         bool   `json:"closed"`
	NoSummary      bool   `json:"noSummary"`
	NoBudget       bool   `json:"noBudget"`
	NoReport       bool   `json:"noReport"`
	Position       int64  `json:"position"`
	GroupName      string `json:"groupName"`
	Notes          string `json:"notes"`
	Website        string `json:"website"`
}

// Payee is a backed-up payee.
type Payee struct {
	ID                 int64  `json:"id"`
	Name               string `json:"name"`
	DefaultCategoryID  *int64 `json:"defaultCategoryId,omitempty"`
	DefaultPaymentMode *int64 `json:"defaultPaymentMode,omitempty"`
}

// Category is a backed-up category.
type Category struct {
	ID       int64  `json:"id"`
	ParentID *int64 `json:"parentId,omitempty"`
	Name     string `json:"name"`
	IsIncome bool   `json:"isIncome"`
	NoBudget bool   `json:"noBudget"`
	NoReport bool   `json:"noReport"`
}

// Tag is a backed-up tag.
type Tag struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// Split is one split line of a transaction or template.
type Split struct {
	CategoryID *int64 `json:"categoryId,omitempty"`
	Amount     int64  `json:"amount"`
	Memo       string `json:"memo"`
	Position   int64  `json:"position"`
}

// Transaction is a backed-up transaction with its splits and tag names.
type Transaction struct {
	ID          int64    `json:"id"`
	AccountID   int64    `json:"accountId"`
	Date        string   `json:"date"`
	Amount      int64    `json:"amount"`
	PaymentMode int64    `json:"paymentMode"`
	Status      int64    `json:"status"`
	Info        string   `json:"info"`
	PayeeID     *int64   `json:"payeeId,omitempty"`
	CategoryID  *int64   `json:"categoryId,omitempty"`
	Memo        string   `json:"memo"`
	IsSplit     bool     `json:"isSplit"`
	ImportRef   string   `json:"importRef,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Splits      []Split  `json:"splits,omitempty"`
}

// Transfer links two transactions as an internal transfer.
type Transfer struct {
	TxnFromID int64 `json:"txnFromId"`
	TxnToID   int64 `json:"txnToId"`
}

// Template is a backed-up transaction template with its splits.
type Template struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	AccountID   *int64  `json:"accountId,omitempty"`
	Amount      int64   `json:"amount"`
	PaymentMode int64   `json:"paymentMode"`
	Status      int64   `json:"status"`
	Info        string  `json:"info"`
	PayeeID     *int64  `json:"payeeId,omitempty"`
	CategoryID  *int64  `json:"categoryId,omitempty"`
	Memo        string  `json:"memo"`
	Tags        string  `json:"tags"`
	IsSplit     bool    `json:"isSplit"`
	IsTransfer  bool    `json:"isTransfer"`
	ToAccountID *int64  `json:"toAccountId,omitempty"`
	Splits      []Split `json:"splits,omitempty"`
}

// Schedule is a backed-up scheduled transaction.
type Schedule struct {
	ID          int64  `json:"id"`
	TemplateID  int64  `json:"templateId"`
	Unit        string `json:"unit"`
	EveryN      int64  `json:"everyN"`
	NextDue     string `json:"nextDue"`
	WeekendMode int64  `json:"weekendMode"`
	Remaining   *int64 `json:"remaining,omitempty"`
	PostAdvance int64  `json:"postAdvance"`
	AutoPost    int64  `json:"autoPost"`
	LastPosted  string `json:"lastPosted,omitempty"`
}

// Assignment is a backed-up assignment rule.
type Assignment struct {
	ID             int64  `json:"id"`
	Position       int64  `json:"position"`
	MatchField     string `json:"matchField"`
	MatchType      string `json:"matchType"`
	Pattern        string `json:"pattern"`
	CaseSensitive  bool   `json:"caseSensitive"`
	SetPayeeID     *int64 `json:"setPayeeId,omitempty"`
	SetCategoryID  *int64 `json:"setCategoryId,omitempty"`
	SetPaymentMode *int64 `json:"setPaymentMode,omitempty"`
	ApplyOnManual  bool   `json:"applyOnManual"`
	ApplyOnImport  bool   `json:"applyOnImport"`
}

// Budget is a backed-up per-category budget entry.
type Budget struct {
	ID         int64 `json:"id"`
	CategoryID int64 `json:"categoryId"`
	Year       int64 `json:"year"`
	Month      int64 `json:"month"`
	Amount     int64 `json:"amount"`
}

// Service exports and restores wallets.
type Service struct {
	db          *sql.DB
	q           *db.Queries
	attachments *attachment.Service
}

// NewService builds a backup Service backed by the write connection pool.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write)}
}

// SetAttachments wires the attachment service so exports embed attachment files
// and restores recreate them. Optional; when unset, attachments are skipped.
func (s *Service) SetAttachments(a *attachment.Service) { s.attachments = a }

func np(n sql.NullInt64) *int64 {
	if n.Valid {
		v := n.Int64
		return &v
	}
	return nil
}

func nn(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func b2i(v bool) int64 {
	if v {
		return 1
	}
	return 0
}

// Export reads a whole wallet into a backup document.
func (s *Service) Export(ctx context.Context, walletID int64) (*Document, error) {
	q := s.q
	wal, err := q.GetWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	doc := &Document{
		Version:    Version,
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Wallet:     WalletMeta{Title: wal.Title, OwnerName: wal.OwnerName},
	}

	curs, err := q.ListCurrenciesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, c := range curs {
		cur := Currency{
			ID: c.ID, IsoCode: c.IsoCode, Name: c.Name, Symbol: c.Symbol,
			SymbolPrefix: c.SymbolPrefix != 0, DecimalChar: c.DecimalChar, GroupChar: c.GroupChar,
			FracDigits: c.FracDigits, IsBase: c.IsBase != 0, Rate: c.Rate,
		}
		rates, err := q.ListExchangeRates(ctx, c.ID)
		if err != nil {
			return nil, err
		}
		for _, r := range rates {
			cur.Rates = append(cur.Rates, Rate{Date: r.Date, Rate: r.Rate, Source: r.Source})
		}
		doc.Currencies = append(doc.Currencies, cur)
	}

	accts, err := q.ListAccountsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, a := range accts {
		doc.Accounts = append(doc.Accounts, Account{
			ID: a.ID, Name: a.Name, Type: a.Type, CurrencyID: a.CurrencyID,
			Institution: a.Institution, Number: a.Number, InitialBalance: a.InitialBalance,
			MinimumBalance: a.MinimumBalance, Closed: a.Closed != 0, NoSummary: a.NoSummary != 0,
			NoBudget: a.NoBudget != 0, NoReport: a.NoReport != 0, Position: a.Position,
			GroupName: a.GroupName, Notes: a.Notes, Website: a.Website,
		})
	}

	payees, err := q.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, p := range payees {
		doc.Payees = append(doc.Payees, Payee{
			ID: p.ID, Name: p.Name, DefaultCategoryID: np(p.DefaultCategoryID),
			DefaultPaymentMode: np(p.DefaultPaymentMode),
		})
	}

	cats, err := q.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, c := range cats {
		doc.Categories = append(doc.Categories, Category{
			ID: c.ID, ParentID: np(c.ParentID), Name: c.Name,
			IsIncome: c.IsIncome != 0, NoBudget: c.NoBudget != 0, NoReport: c.NoReport != 0,
		})
	}

	tags, err := q.ListTagsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, t := range tags {
		doc.Tags = append(doc.Tags, Tag{ID: t.ID, Name: t.Name})
	}

	for _, a := range accts {
		rows, err := q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{
			AccountID: a.ID, Limit: 1 << 31, Offset: 0,
		})
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			txn := Transaction{
				ID: r.ID, AccountID: r.AccountID, Date: r.Date, Amount: r.Amount,
				PaymentMode: r.PaymentMode, Status: r.Status, Info: r.Info,
				PayeeID: np(r.PayeeID), CategoryID: np(r.CategoryID), Memo: r.Memo,
				IsSplit: r.IsSplit != 0, ImportRef: r.ImportRef,
			}
			if txn.Tags, err = q.ListTransactionTags(ctx, r.ID); err != nil {
				return nil, err
			}
			splits, err := q.ListSplits(ctx, r.ID)
			if err != nil {
				return nil, err
			}
			for _, sp := range splits {
				txn.Splits = append(txn.Splits, Split{
					CategoryID: np(sp.CategoryID), Amount: sp.Amount, Memo: sp.Memo, Position: sp.Position,
				})
			}
			doc.Transactions = append(doc.Transactions, txn)
		}
	}

	transfers, err := q.ListTransfersForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, t := range transfers {
		doc.Transfers = append(doc.Transfers, Transfer{TxnFromID: t.TxnFromID, TxnToID: t.TxnToID})
	}

	tpls, err := q.ListTemplatesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, t := range tpls {
		tpl := Template{
			ID: t.ID, Name: t.Name, AccountID: np(t.AccountID), Amount: t.Amount,
			PaymentMode: t.PaymentMode, Status: t.Status, Info: t.Info,
			PayeeID: np(t.PayeeID), CategoryID: np(t.CategoryID), Memo: t.Memo, Tags: t.Tags,
			IsSplit: t.IsSplit != 0, IsTransfer: t.IsTransfer != 0, ToAccountID: np(t.ToAccountID),
		}
		splits, err := q.ListTemplateSplits(ctx, t.ID)
		if err != nil {
			return nil, err
		}
		for _, sp := range splits {
			tpl.Splits = append(tpl.Splits, Split{
				CategoryID: np(sp.CategoryID), Amount: sp.Amount, Memo: sp.Memo, Position: sp.Position,
			})
		}
		doc.Templates = append(doc.Templates, tpl)
	}

	scheds, err := q.ListSchedulesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, s := range scheds {
		sc := Schedule{
			ID: s.ID, TemplateID: s.TemplateID, Unit: s.Unit, EveryN: s.EveryN,
			NextDue: s.NextDue, WeekendMode: s.WeekendMode, Remaining: np(s.Remaining),
			PostAdvance: s.PostAdvance, AutoPost: s.AutoPost,
		}
		if s.LastPosted.Valid {
			sc.LastPosted = s.LastPosted.String
		}
		doc.Schedules = append(doc.Schedules, sc)
	}

	asgs, err := q.ListAssignmentsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, a := range asgs {
		doc.Assignments = append(doc.Assignments, Assignment{
			ID: a.ID, Position: a.Position, MatchField: a.MatchField, MatchType: a.MatchType,
			Pattern: a.Pattern, CaseSensitive: a.CaseSensitive != 0, SetPayeeID: np(a.SetPayeeID),
			SetCategoryID: np(a.SetCategoryID), SetPaymentMode: np(a.SetPaymentMode),
			ApplyOnManual: a.ApplyOnManual != 0, ApplyOnImport: a.ApplyOnImport != 0,
		})
	}

	budgets, err := q.ListBudgetsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	for _, bd := range budgets {
		doc.Budgets = append(doc.Budgets, Budget{
			ID: bd.ID, CategoryID: bd.CategoryID, Year: bd.Year, Month: bd.Month, Amount: bd.Amount,
		})
	}

	// Embed attachment files (metadata + base64 bytes) so the backup is
	// self-contained. Skipped when no attachment store is wired.
	if s.attachments != nil {
		atts, err := q.ListAttachmentsForWallet(ctx, walletID)
		if err != nil {
			return nil, err
		}
		for _, a := range atts {
			data, err := s.attachments.Bytes(walletID, a.StorageKey)
			if err != nil {
				return nil, fmt.Errorf("read attachment %d: %w", a.ID, err)
			}
			doc.Attachments = append(doc.Attachments, Attachment{
				TransactionID: a.TransactionID, Filename: a.Filename, ContentType: a.ContentType,
				Size: a.Size, Content: base64.StdEncoding.EncodeToString(data),
			})
		}
	}

	return doc, nil
}

// Restore writes a backup document into a brand-new wallet owned by userID and
// returns the new wallet id. The whole restore runs in one transaction.
func (s *Service) Restore(ctx context.Context, userID int64, doc *Document) (int64, error) {
	if doc.Version != Version {
		return 0, fmt.Errorf("unsupported backup version %d", doc.Version)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	q := db.New(tx)

	title := doc.Wallet.Title
	if title == "" {
		title = "Restored wallet"
	}
	w, err := q.CreateWallet(ctx, db.CreateWalletParams{Title: title, OwnerName: doc.Wallet.OwnerName})
	if err != nil {
		return 0, err
	}
	if err := q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: w.ID, UserID: userID, Role: wallet.RoleOwner}); err != nil {
		return 0, err
	}

	curMap := map[int64]int64{}
	var baseCurrencyNew int64
	for _, c := range doc.Currencies {
		row, err := q.InsertCurrency(ctx, db.InsertCurrencyParams{
			WalletID: w.ID, IsoCode: c.IsoCode, Name: c.Name, Symbol: c.Symbol,
			SymbolPrefix: b2i(c.SymbolPrefix), DecimalChar: c.DecimalChar, GroupChar: c.GroupChar,
			FracDigits: c.FracDigits, IsBase: b2i(c.IsBase), Rate: c.Rate,
		})
		if err != nil {
			return 0, err
		}
		curMap[c.ID] = row.ID
		if c.IsBase {
			baseCurrencyNew = row.ID
		}
		for _, r := range c.Rates {
			if err := q.UpsertExchangeRate(ctx, db.UpsertExchangeRateParams{
				CurrencyID: row.ID, Date: r.Date, Rate: r.Rate, Source: r.Source,
			}); err != nil {
				return 0, err
			}
		}
	}
	if baseCurrencyNew != 0 {
		if err := q.UpdateWalletBaseCurrency(ctx, db.UpdateWalletBaseCurrencyParams{
			BaseCurrencyID: sql.NullInt64{Int64: baseCurrencyNew, Valid: true}, ID: w.ID,
		}); err != nil {
			return 0, err
		}
	}

	accMap := map[int64]int64{}
	for _, a := range doc.Accounts {
		row, err := q.InsertAccount(ctx, db.InsertAccountParams{
			WalletID: w.ID, Name: a.Name, Type: a.Type, CurrencyID: curMap[a.CurrencyID],
			Institution: a.Institution, Number: a.Number, InitialBalance: a.InitialBalance,
			MinimumBalance: a.MinimumBalance, Closed: b2i(a.Closed), NoSummary: b2i(a.NoSummary),
			NoBudget: b2i(a.NoBudget), NoReport: b2i(a.NoReport), Position: a.Position,
			GroupName: a.GroupName, Notes: a.Notes, Website: a.Website,
		})
		if err != nil {
			return 0, err
		}
		accMap[a.ID] = row.ID
	}

	// Categories: parents first so children resolve their parent.
	catMap := map[int64]int64{}
	insertCat := func(c Category) error {
		var parent sql.NullInt64
		if c.ParentID != nil {
			if pid, ok := catMap[*c.ParentID]; ok {
				parent = sql.NullInt64{Int64: pid, Valid: true}
			}
		}
		row, err := q.InsertCategory(ctx, db.InsertCategoryParams{
			WalletID: w.ID, ParentID: parent, Name: c.Name,
			IsIncome: b2i(c.IsIncome), NoBudget: b2i(c.NoBudget), NoReport: b2i(c.NoReport),
		})
		if err != nil {
			return err
		}
		catMap[c.ID] = row.ID
		return nil
	}
	for _, c := range doc.Categories {
		if c.ParentID == nil {
			if err := insertCat(c); err != nil {
				return 0, err
			}
		}
	}
	for _, c := range doc.Categories {
		if c.ParentID != nil {
			if err := insertCat(c); err != nil {
				return 0, err
			}
		}
	}

	remapCat := func(p *int64) *int64 {
		if p == nil {
			return nil
		}
		if v, ok := catMap[*p]; ok {
			return &v
		}
		return nil
	}

	payMap := map[int64]int64{}
	for _, p := range doc.Payees {
		row, err := q.InsertPayee(ctx, db.InsertPayeeParams{
			WalletID: w.ID, Name: p.Name, DefaultCategoryID: nn(remapCat(p.DefaultCategoryID)),
			DefaultPaymentMode: nn(p.DefaultPaymentMode),
		})
		if err != nil {
			return 0, err
		}
		payMap[p.ID] = row.ID
	}
	remapPayee := func(p *int64) *int64 {
		if p == nil {
			return nil
		}
		if v, ok := payMap[*p]; ok {
			return &v
		}
		return nil
	}

	tagByName := map[string]int64{}
	for _, t := range doc.Tags {
		row, err := q.InsertTag(ctx, db.InsertTagParams{WalletID: w.ID, Name: t.Name})
		if err != nil {
			return 0, err
		}
		tagByName[t.Name] = row.ID
	}

	txnMap := map[int64]int64{}
	for _, t := range doc.Transactions {
		row, err := q.InsertTransaction(ctx, db.InsertTransactionParams{
			WalletID: w.ID, AccountID: accMap[t.AccountID], Date: t.Date, Amount: t.Amount,
			PaymentMode: t.PaymentMode, Status: t.Status, Info: t.Info,
			PayeeID: nn(remapPayee(t.PayeeID)), CategoryID: nn(remapCat(t.CategoryID)),
			Memo: t.Memo, IsSplit: b2i(t.IsSplit), ImportRef: t.ImportRef,
		})
		if err != nil {
			return 0, err
		}
		txnMap[t.ID] = row.ID
		for _, sp := range t.Splits {
			if err := q.InsertSplit(ctx, db.InsertSplitParams{
				TransactionID: row.ID, CategoryID: nn(remapCat(sp.CategoryID)),
				Amount: sp.Amount, Memo: sp.Memo, Position: sp.Position,
			}); err != nil {
				return 0, err
			}
		}
		for _, name := range t.Tags {
			if tagID, ok := tagByName[name]; ok {
				if err := q.AddTransactionTag(ctx, db.AddTransactionTagParams{
					TransactionID: row.ID, TagID: tagID,
				}); err != nil {
					return 0, err
				}
			}
		}
	}

	for _, tr := range doc.Transfers {
		from, ok1 := txnMap[tr.TxnFromID]
		to, ok2 := txnMap[tr.TxnToID]
		if !ok1 || !ok2 {
			continue
		}
		if _, err := q.InsertTransfer(ctx, db.InsertTransferParams{TxnFromID: from, TxnToID: to}); err != nil {
			return 0, err
		}
	}

	// Recreate attachments: insert the metadata rows inside the transaction, and
	// stage the file bytes to write to disk only after a successful commit (so a
	// rollback never leaves orphaned files). Skipped when no store is wired.
	type pendingFile struct {
		key  string
		data []byte
	}
	var pendingFiles []pendingFile
	if s.attachments != nil {
		for _, a := range doc.Attachments {
			newTxn, ok := txnMap[a.TransactionID]
			if !ok {
				continue
			}
			data, err := base64.StdEncoding.DecodeString(a.Content)
			if err != nil {
				return 0, fmt.Errorf("decode attachment for txn %d: %w", a.TransactionID, err)
			}
			key, err := attachment.NewStorageKey()
			if err != nil {
				return 0, err
			}
			if _, err := q.InsertAttachment(ctx, db.InsertAttachmentParams{
				WalletID: w.ID, TransactionID: newTxn, Filename: a.Filename,
				ContentType: a.ContentType, Size: a.Size, StorageKey: key,
			}); err != nil {
				return 0, err
			}
			pendingFiles = append(pendingFiles, pendingFile{key: key, data: data})
		}
	}

	remapAcc := func(p *int64) *int64 {
		if p == nil {
			return nil
		}
		if v, ok := accMap[*p]; ok {
			return &v
		}
		return nil
	}
	for _, t := range doc.Templates {
		row, err := q.InsertTemplate(ctx, db.InsertTemplateParams{
			WalletID: w.ID, Name: t.Name, AccountID: nn(remapAcc(t.AccountID)), Amount: t.Amount,
			PaymentMode: t.PaymentMode, Status: t.Status, Info: t.Info,
			PayeeID: nn(remapPayee(t.PayeeID)), CategoryID: nn(remapCat(t.CategoryID)),
			Memo: t.Memo, Tags: t.Tags, IsSplit: b2i(t.IsSplit), IsTransfer: b2i(t.IsTransfer),
			ToAccountID: nn(remapAcc(t.ToAccountID)),
		})
		if err != nil {
			return 0, err
		}
		for _, sp := range t.Splits {
			if err := q.InsertTemplateSplit(ctx, db.InsertTemplateSplitParams{
				TemplateID: row.ID, CategoryID: nn(remapCat(sp.CategoryID)),
				Amount: sp.Amount, Memo: sp.Memo, Position: sp.Position,
			}); err != nil {
				return 0, err
			}
		}
		for _, sc := range doc.Schedules {
			if sc.TemplateID != t.ID {
				continue
			}
			if _, err := q.InsertSchedule(ctx, db.InsertScheduleParams{
				WalletID: w.ID, TemplateID: row.ID, Unit: sc.Unit, EveryN: sc.EveryN,
				NextDue: sc.NextDue, WeekendMode: sc.WeekendMode, Remaining: nn(sc.Remaining),
				PostAdvance: sc.PostAdvance, AutoPost: sc.AutoPost,
			}); err != nil {
				return 0, err
			}
		}
	}

	for _, a := range doc.Assignments {
		if _, err := q.InsertAssignment(ctx, db.InsertAssignmentParams{
			WalletID: w.ID, Position: a.Position, MatchField: a.MatchField, MatchType: a.MatchType,
			Pattern: a.Pattern, CaseSensitive: b2i(a.CaseSensitive), SetPayeeID: nn(remapPayee(a.SetPayeeID)),
			SetCategoryID: nn(remapCat(a.SetCategoryID)), SetPaymentMode: nn(a.SetPaymentMode),
			ApplyOnManual: b2i(a.ApplyOnManual), ApplyOnImport: b2i(a.ApplyOnImport),
		}); err != nil {
			return 0, err
		}
	}

	for _, bd := range doc.Budgets {
		if cid, ok := catMap[bd.CategoryID]; ok {
			if err := q.InsertBudget(ctx, db.InsertBudgetParams{
				WalletID: w.ID, CategoryID: cid, Year: bd.Year, Month: bd.Month, Amount: bd.Amount,
			}); err != nil {
				return 0, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	// The DB rows are committed; now write the attachment files. A failure here
	// leaves a row without its file (download 404) rather than failing the whole
	// restore — the ledger data is already safely persisted.
	for _, pf := range pendingFiles {
		if err := s.attachments.Put(w.ID, pf.key, pf.data); err != nil {
			return 0, fmt.Errorf("write restored attachment: %w", err)
		}
	}
	return w.ID, nil
}
