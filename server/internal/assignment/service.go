package assignment

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/dbconv"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/walletref"
)

// ErrNotFound is returned when a rule does not exist (engine ErrInvalid* errors
// are reused for validation).
var ErrNotFound = errors.New("assignment: not found")

// Definition is the public representation of a rule. Matches and Reach are
// filled in by List only.
type Definition struct {
	ID             int64    `json:"id"`
	Position       int      `json:"position"`
	MatchField     string   `json:"matchField"`
	MatchType      string   `json:"matchType"`
	Pattern        string   `json:"pattern"`
	CaseSensitive  bool     `json:"caseSensitive"`
	MatchAccountID *int64   `json:"matchAccountId,omitempty"`
	SetPayeeID     *int64   `json:"setPayeeId,omitempty"`
	SetCategoryID  *int64   `json:"setCategoryId,omitempty"`
	SetPaymentMode *int     `json:"setPaymentMode,omitempty"`
	SetInfo        *string  `json:"setInfo,omitempty"`
	SetTags        []string `json:"setTags"`
	ApplyOnManual  bool     `json:"applyOnManual"`
	ApplyOnImport  bool     `json:"applyOnImport"`
	// Matches is how many of the wallet's transactions this rule is the first
	// to match: the ones it decides. Reach is how many it matches at all, so
	// Reach > Matches means rules above it take some first.
	Matches *int `json:"matches,omitempty"`
	Reach   *int `json:"reach,omitempty"`
}

// Input carries the editable fields of a rule.
type Input struct {
	MatchField     string
	MatchType      string
	Pattern        string
	CaseSensitive  bool
	MatchAccountID *int64
	SetPayeeID     *int64
	SetCategoryID  *int64
	SetPaymentMode *int
	SetInfo        *string
	SetTags        []string
	ApplyOnManual  bool
	ApplyOnImport  bool
}

// MatchedTransaction is a transaction surfaced by the rule tester.
type MatchedTransaction struct {
	ID         int64    `json:"id"`
	AccountID  int64    `json:"accountId"`
	Date       string   `json:"date"`
	Memo       string   `json:"memo"`
	PayeeName  string   `json:"payeeName"`
	CategoryID *int64   `json:"categoryId,omitempty"`
	Tags       []string `json:"tags"`
}

// TestResult is what a rule would match, worked out without changing
// anything: the rule tester's dry run.
type TestResult struct {
	// Count is every transaction the rule matches.
	Count int `json:"count"`
	// Taken is how many of those a rule above it matches first, so this one
	// never fills them in.
	Taken int `json:"taken"`
	// WithoutCategory is how many of the ones it would fill in have no
	// category yet.
	WithoutCategory int `json:"withoutCategory"`
	// Latest are the most recent matches, newest first.
	Latest []MatchedTransaction `json:"latest"`
}

// Service implements rule management and application.
type Service struct {
	db *sql.DB
	q  *db.Queries // write pool (mutations)
	rq *db.Queries // read pool (read-only methods)
}

// NewService builds a Service backed by the write connection pool for both
// reads and writes.
func NewService(write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write), rq: db.New(write)}
}

// NewServiceWithRead builds a Service whose read-only methods run on the read
// pool while mutations use the single write connection.
func NewServiceWithRead(read, write *sql.DB) *Service {
	return &Service{db: write, q: db.New(write), rq: db.New(read)}
}

func (in Input) toRule() Rule {
	return Rule{
		Field: in.MatchField, Type: in.MatchType, Pattern: in.Pattern, CaseSensitive: in.CaseSensitive,
		MatchAccountID: in.MatchAccountID, SetPayeeID: in.SetPayeeID, SetCategoryID: in.SetCategoryID,
		SetPaymentMode: in.SetPaymentMode, SetInfo: in.SetInfo, SetTags: cleanTags(in.SetTags),
	}
}

// cleanTags trims the names and drops blanks and repeats, keeping the order.
func cleanTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := map[string]bool{}
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

func nullID(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func nullStr(p *string) sql.NullString {
	if p == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *p, Valid: true}
}

func strPtr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	v := n.String
	return &v
}

func nullInt(p *int) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*p), Valid: true}
}

func idPtr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

func intPtr(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}

func toDefinition(a db.Assignment, tags []string) Definition {
	if tags == nil {
		tags = []string{}
	}
	return Definition{
		ID: a.ID, Position: int(a.Position), MatchField: a.MatchField, MatchType: a.MatchType,
		Pattern: a.Pattern, CaseSensitive: a.CaseSensitive != 0,
		MatchAccountID: idPtr(a.MatchAccountID),
		SetPayeeID:     idPtr(a.SetPayeeID), SetCategoryID: idPtr(a.SetCategoryID),
		SetPaymentMode: intPtr(a.SetPaymentMode), SetInfo: strPtr(a.SetInfo), SetTags: tags,
		ApplyOnManual: a.ApplyOnManual != 0, ApplyOnImport: a.ApplyOnImport != 0,
	}
}

func toEngineRule(a db.Assignment, tags []string) Rule {
	return Rule{
		ID: a.ID, Field: a.MatchField, Type: a.MatchType, Pattern: a.Pattern,
		CaseSensitive: a.CaseSensitive != 0, MatchAccountID: idPtr(a.MatchAccountID),
		SetPayeeID: idPtr(a.SetPayeeID), SetCategoryID: idPtr(a.SetCategoryID),
		SetPaymentMode: intPtr(a.SetPaymentMode), SetInfo: strPtr(a.SetInfo), SetTags: tags,
	}
}

// ruleTags returns the tags each of the wallet's rules adds, by rule id.
func (s *Service) ruleTags(ctx context.Context, q *db.Queries, walletID int64) (map[int64][]string, error) {
	rows, err := q.ListAssignmentTagsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := map[int64][]string{}
	for _, r := range rows {
		out[r.AssignmentID] = append(out[r.AssignmentID], r.Name)
	}
	return out, nil
}

// checkRefs rejects a rule whose account, payee or category is not the
// wallet's own.
func (s *Service) checkRefs(ctx context.Context, walletID int64, in Input) error {
	return walletref.Check(ctx, s.q, walletID,
		(&walletref.Refs{}).Account(in.MatchAccountID).Payee(in.SetPayeeID).Category(in.SetCategoryID))
}

// writeTags replaces the tags a rule adds, creating the ones the wallet does
// not have yet (as a transaction's tags are).
func writeTags(ctx context.Context, qtx *db.Queries, walletID, id int64, tags []string) error {
	if err := qtx.DeleteAssignmentTags(ctx, id); err != nil {
		return err
	}
	for _, name := range tags {
		tagID, err := tagIDFor(ctx, qtx, walletID, name)
		if err != nil {
			return err
		}
		if err := qtx.AddAssignmentTag(ctx, db.AddAssignmentTagParams{AssignmentID: id, TagID: tagID}); err != nil {
			return err
		}
	}
	return nil
}

func tagIDFor(ctx context.Context, qtx *db.Queries, walletID int64, name string) (int64, error) {
	tag, err := qtx.GetTagByName(ctx, db.GetTagByNameParams{WalletID: walletID, Name: name})
	if err == nil {
		return tag.ID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	tag, err = qtx.InsertTag(ctx, db.InsertTagParams{WalletID: walletID, Name: name})
	return tag.ID, err
}

// Create validates and stores a new rule (appended at the end).
func (s *Service) Create(ctx context.Context, walletID int64, in Input) (Definition, error) {
	rule := in.toRule()
	if err := rule.Compile(); err != nil {
		return Definition{}, err
	}
	if err := s.checkRefs(ctx, walletID, in); err != nil {
		return Definition{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Definition{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	pos, err := qtx.NextAssignmentPosition(ctx, walletID)
	if err != nil {
		return Definition{}, err
	}
	row, err := qtx.InsertAssignment(ctx, db.InsertAssignmentParams{
		WalletID: walletID, Position: pos, MatchField: in.MatchField, MatchType: in.MatchType,
		Pattern: in.Pattern, CaseSensitive: dbconv.B2i(in.CaseSensitive), MatchAccountID: nullID(in.MatchAccountID),
		SetPayeeID: nullID(in.SetPayeeID), SetCategoryID: nullID(in.SetCategoryID),
		SetPaymentMode: nullInt(in.SetPaymentMode), SetInfo: nullStr(in.SetInfo),
		ApplyOnManual: dbconv.B2i(in.ApplyOnManual), ApplyOnImport: dbconv.B2i(in.ApplyOnImport),
	})
	if err != nil {
		return Definition{}, err
	}
	if err := writeTags(ctx, qtx, walletID, row.ID, rule.SetTags); err != nil {
		return Definition{}, err
	}
	if err := tx.Commit(); err != nil {
		return Definition{}, err
	}
	return s.get(ctx, s.q, row.ID)
}

// Get returns one rule.
func (s *Service) Get(ctx context.Context, id int64) (Definition, error) {
	return s.get(ctx, s.rq, id)
}

func (s *Service) get(ctx context.Context, q *db.Queries, id int64) (Definition, error) {
	a, err := q.GetAssignment(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Definition{}, ErrNotFound
	}
	if err != nil {
		return Definition{}, err
	}
	tags, err := s.ruleTags(ctx, q, a.WalletID)
	if err != nil {
		return Definition{}, err
	}
	return toDefinition(a, tags[a.ID]), nil
}

// WalletOf returns the wallet a rule belongs to (for ownership checks).
func (s *Service) WalletOf(ctx context.Context, id int64) (int64, error) {
	a, err := s.rq.GetAssignment(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return a.WalletID, nil
}

// List returns a wallet's rules in match order, each with how many of the
// wallet's transactions it decides (Matches) and matches at all (Reach).
func (s *Service) List(ctx context.Context, walletID int64) ([]Definition, error) {
	rows, err := s.rq.ListAssignmentsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	tags, err := s.ruleTags(ctx, s.rq, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Definition, 0, len(rows))
	rules := make([]Rule, 0, len(rows))
	for _, a := range rows {
		out = append(out, toDefinition(a, tags[a.ID]))
		r := toEngineRule(a, tags[a.ID])
		if r.Compile() != nil {
			r = Rule{} // never matches: an empty field reads nothing
		}
		rules = append(rules, r)
	}
	if len(rows) == 0 {
		return out, nil
	}
	txns, err := s.rq.ListWalletTransactionsForRules(ctx, walletID)
	if err != nil {
		return nil, err
	}
	matches := make([]int, len(rules))
	reach := make([]int, len(rules))
	for _, t := range txns {
		subj := subjectOf(t)
		first := true
		for i := range rules {
			if rules[i].Field == "" || !rules[i].Matches(subj) {
				continue
			}
			reach[i]++
			if first {
				matches[i]++
				first = false
			}
		}
	}
	for i := range out {
		out[i].Matches, out[i].Reach = &matches[i], &reach[i]
	}
	return out, nil
}

// subjectOf is what a rule reads of a stored transaction.
func subjectOf(t db.ListWalletTransactionsForRulesRow) Subject {
	var tags []string
	if t.TagNames != "" {
		tags = strings.Split(t.TagNames, "\x1f")
	}
	return Subject{Memo: t.Memo, Payee: t.PayeeName, Tags: tags, AccountID: t.AccountID}
}

// Update validates and replaces a rule's configuration.
func (s *Service) Update(ctx context.Context, walletID, id int64, in Input) (Definition, error) {
	rule := in.toRule()
	if err := rule.Compile(); err != nil {
		return Definition{}, err
	}
	if err := s.checkRefs(ctx, walletID, in); err != nil {
		return Definition{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Definition{}, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	if err := qtx.UpdateAssignment(ctx, db.UpdateAssignmentParams{
		MatchField: in.MatchField, MatchType: in.MatchType, Pattern: in.Pattern,
		CaseSensitive: dbconv.B2i(in.CaseSensitive), MatchAccountID: nullID(in.MatchAccountID),
		SetPayeeID: nullID(in.SetPayeeID), SetCategoryID: nullID(in.SetCategoryID),
		SetPaymentMode: nullInt(in.SetPaymentMode), SetInfo: nullStr(in.SetInfo),
		ApplyOnManual: dbconv.B2i(in.ApplyOnManual), ApplyOnImport: dbconv.B2i(in.ApplyOnImport), ID: id,
	}); err != nil {
		return Definition{}, err
	}
	if err := writeTags(ctx, qtx, walletID, id, rule.SetTags); err != nil {
		return Definition{}, err
	}
	if err := tx.Commit(); err != nil {
		return Definition{}, err
	}
	return s.get(ctx, s.q, id)
}

// Delete removes a rule.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.q.DeleteAssignment(ctx, id)
}

// Reorder sets each rule's position from the given id order (first-match-wins).
func (s *Service) Reorder(ctx context.Context, walletID int64, ids []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)
	for pos, id := range ids {
		if err := qtx.SetAssignmentPosition(ctx, db.SetAssignmentPositionParams{
			Position: int64(pos), ID: id, WalletID: walletID,
		}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// rules loads the wallet's rules that keep(rule) accepts, compiled for
// matching, in match order.
func (s *Service) rules(ctx context.Context, q *db.Queries, walletID int64, keep func(db.Assignment) bool) ([]Rule, error) {
	rows, err := q.ListAssignmentsForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	tags, err := s.ruleTags(ctx, q, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Rule, 0, len(rows))
	for _, a := range rows {
		if !keep(a) {
			continue
		}
		r := toEngineRule(a, tags[a.ID])
		if err := r.Compile(); err != nil {
			continue // skip a rule that somehow no longer compiles
		}
		out = append(out, r)
	}
	return out, nil
}

// Suggest returns the assignments of the first apply-on-manual rule that
// matches the transaction being entered (used by the entry form). AccountID 0
// means no account selected yet, so account-conditioned rules won't match.
func (s *Service) Suggest(ctx context.Context, walletID int64, subj Subject) (Result, bool, error) {
	rules, err := s.rules(ctx, s.rq, walletID, func(a db.Assignment) bool { return a.ApplyOnManual != 0 })
	if err != nil {
		return Result{}, false, err
	}
	res, ok := FirstMatch(rules, subj)
	return res, ok, nil
}

// ImportRules returns the compiled apply-on-import rules for the wallet, in
// priority order. The file importers use them to auto-categorise rows.
func (s *Service) ImportRules(ctx context.Context, walletID int64) ([]Rule, error) {
	return s.rules(ctx, s.rq, walletID, func(a db.Assignment) bool { return a.ApplyOnImport != 0 })
}

// MatchRow applies the first matching rule (from ImportRules) to an incoming
// row and returns the assignment to apply, if any. It is a thin convenience
// wrapper around FirstMatch for the importers.
func MatchRow(rules []Rule, subj Subject) (Result, bool) {
	return FirstMatch(rules, subj)
}

// Test works out, without changing anything, what a candidate rule would
// match among the wallet's transactions. exceptID is the rule being edited
// (0 for a new one): the rules above it are the ones that can take a match
// first; a new rule goes last, so every existing rule is above it.
func (s *Service) Test(ctx context.Context, walletID, exceptID int64, in Input, latest int) (TestResult, error) {
	rule := in.toRule()
	if err := rule.Compile(); err != nil {
		return TestResult{}, err
	}
	all, err := s.rules(ctx, s.rq, walletID, func(db.Assignment) bool { return true })
	if err != nil {
		return TestResult{}, err
	}
	above := all
	for i, r := range all {
		if r.ID == exceptID {
			above = all[:i]
			break
		}
	}
	rows, err := s.rq.ListWalletTransactionsForRules(ctx, walletID)
	if err != nil {
		return TestResult{}, err
	}
	res := TestResult{Latest: []MatchedTransaction{}}
	var hits []MatchedTransaction
	for _, r := range rows {
		subj := subjectOf(r)
		if !rule.Matches(subj) {
			continue
		}
		res.Count++
		if _, taken := FirstMatch(above, subj); taken {
			res.Taken++
		} else if !r.CategoryID.Valid {
			res.WithoutCategory++
		}
		tags := subj.Tags
		if tags == nil {
			tags = []string{}
		}
		hits = append(hits, MatchedTransaction{
			ID: r.ID, AccountID: r.AccountID, Date: r.Date, Memo: r.Memo, PayeeName: r.PayeeName,
			CategoryID: idPtr(r.CategoryID), Tags: tags,
		})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Date != hits[j].Date {
			return hits[i].Date > hits[j].Date
		}
		return hits[i].ID > hits[j].ID
	})
	if latest > 0 && len(hits) > latest {
		hits = hits[:latest]
	}
	res.Latest = append(res.Latest, hits...)
	return res, nil
}

// ApplyToExisting runs every rule over the wallet's transactions (optionally a
// single account) and applies the first match to each. With ruleID set, only
// the transactions that rule matches first are changed. When onlyFillEmpty is
// true, a field is set only if currently empty; tags are only ever added.
// Returns the number of transactions changed; the whole batch is one
// transaction.
func (s *Service) ApplyToExisting(ctx context.Context, walletID int64, accountID, ruleID *int64, onlyFillEmpty bool) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	rules, err := s.rules(ctx, qtx, walletID, func(db.Assignment) bool { return true })
	if err != nil {
		return 0, err
	}
	if len(rules) == 0 {
		return 0, nil
	}
	rows, err := qtx.ListWalletTransactionsForRules(ctx, walletID)
	if err != nil {
		return 0, err
	}

	tagIDs := map[string]int64{}
	changed := 0
	for _, r := range rows {
		if accountID != nil && r.AccountID != *accountID {
			continue
		}
		subj := subjectOf(r)
		res, ok := FirstMatch(rules, subj)
		if !ok || (ruleID != nil && res.RuleID != *ruleID) {
			continue
		}
		touched := false
		if res.PayeeID != nil && (!onlyFillEmpty || !r.PayeeID.Valid) {
			if err := qtx.SetTransactionPayee(ctx, db.SetTransactionPayeeParams{PayeeID: nullID(res.PayeeID), ID: r.ID}); err != nil {
				return 0, err
			}
			touched = true
		}
		if res.CategoryID != nil && (!onlyFillEmpty || !r.CategoryID.Valid) {
			if err := qtx.SetTransactionCategory(ctx, db.SetTransactionCategoryParams{CategoryID: nullID(res.CategoryID), ID: r.ID}); err != nil {
				return 0, err
			}
			touched = true
		}
		if res.PaymentMode != nil && (!onlyFillEmpty || r.PaymentMode == 0) {
			if err := qtx.SetTransactionPaymentMode(ctx, db.SetTransactionPaymentModeParams{PaymentMode: int64(*res.PaymentMode), ID: r.ID}); err != nil {
				return 0, err
			}
			touched = true
		}
		if res.Info != nil && (!onlyFillEmpty || r.Info == "") {
			if err := qtx.SetTransactionInfo(ctx, db.SetTransactionInfoParams{Info: *res.Info, ID: r.ID}); err != nil {
				return 0, err
			}
			touched = true
		}
		have := map[string]bool{}
		for _, t := range subj.Tags {
			have[t] = true
		}
		for _, name := range res.Tags {
			if have[name] {
				continue
			}
			id, ok := tagIDs[name]
			if !ok {
				if id, err = tagIDFor(ctx, qtx, walletID, name); err != nil {
					return 0, err
				}
				tagIDs[name] = id
			}
			if err := qtx.AddTransactionTag(ctx, db.AddTransactionTagParams{TransactionID: r.ID, TagID: id}); err != nil {
				return 0, err
			}
			touched = true
		}
		if touched {
			changed++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return changed, nil
}
