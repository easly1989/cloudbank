// Package schedule runs recurring scheduled transactions: a schedule drives a
// template, posting a copy on a cadence (every N days/weeks/months/years) with
// month-end clamping, weekend adjustment, an optional occurrence limit, and
// post-in-advance. Auto-posting is idempotent — each occurrence is inserted and
// the schedule advanced in one DB transaction, so a restart never double-posts.
package schedule

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/dbconv"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
)

// catchUpCap bounds how many occurrences a single schedule posts in one run, so
// a long-dormant daily schedule cannot create unbounded transactions.
const catchUpCap = 1000

// Sentinel errors.
var (
	ErrNotFound       = errors.New("schedule: not found")
	ErrInvalidUnit    = errors.New("schedule: invalid unit")
	ErrInvalidEveryN  = errors.New("schedule: every_n must be >= 1")
	ErrInvalidDate    = errors.New("schedule: invalid next-due date (want YYYY-MM-DD)")
	ErrTemplate       = errors.New("schedule: template not found in this wallet")
	ErrTemplateNoAcct = errors.New("schedule: template must target an account")
)

// Schedule is the public representation of a schedule with its template summary.
type Schedule struct {
	ID                 int64  `json:"id"`
	TemplateID         int64  `json:"templateId"`
	TemplateName       string `json:"templateName"`
	TemplateAmount     int64  `json:"templateAmount"`
	TemplateIsTransfer bool   `json:"templateIsTransfer"`
	Unit               string `json:"unit"`
	EveryN             int    `json:"everyN"`
	NextDue            string `json:"nextDue"`
	WeekendMode        int    `json:"weekendMode"`
	Remaining          *int64 `json:"remaining,omitempty"`
	PostAdvance        int    `json:"postAdvance"`
	AutoPost           bool   `json:"autoPost"`
	LastPosted         string `json:"lastPosted,omitempty"`
}

// Input carries the editable fields of a schedule.
type Input struct {
	TemplateID  int64
	Unit        string
	EveryN      int
	NextDue     string
	WeekendMode int
	Remaining   *int64
	PostAdvance int
	AutoPost    bool
}

// Service runs schedules. It materializes templates through the transaction and
// transfer services.
type Service struct {
	db        *sql.DB
	q         *db.Queries // write pool (mutations)
	rq        *db.Queries // read pool (read-only methods)
	txns      *transaction.Service
	transfers *transfer.Service
	logger    *slog.Logger
}

// NewService builds a Service backed by the write connection pool for both
// reads and writes.
func NewService(write *sql.DB, txns *transaction.Service, transfers *transfer.Service, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{db: write, q: db.New(write), rq: db.New(write), txns: txns, transfers: transfers, logger: logger}
}

// NewServiceWithRead builds a Service whose read-only methods run on the read
// pool while mutations use the single write connection.
func NewServiceWithRead(read, write *sql.DB, txns *transaction.Service, transfers *transfer.Service, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{db: write, q: db.New(write), rq: db.New(read), txns: txns, transfers: transfers, logger: logger}
}

func validUnit(u string) bool {
	switch u {
	case UnitDay, UnitWeek, UnitMonth, UnitYear:
		return true
	}
	return false
}

func nptr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

func nval(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

func (s *Service) validate(ctx context.Context, walletID int64, in *Input) (db.Template, error) {
	if !validUnit(in.Unit) {
		return db.Template{}, ErrInvalidUnit
	}
	if in.EveryN < 1 {
		return db.Template{}, ErrInvalidEveryN
	}
	if _, err := ParseDate(in.NextDue); err != nil {
		return db.Template{}, ErrInvalidDate
	}
	tpl, err := s.q.GetTemplate(ctx, in.TemplateID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && tpl.WalletID != walletID) {
		return db.Template{}, ErrTemplate
	}
	if err != nil {
		return db.Template{}, err
	}
	if !tpl.AccountID.Valid {
		return db.Template{}, ErrTemplateNoAcct
	}
	return tpl, nil
}

// Create stores a new schedule.
func (s *Service) Create(ctx context.Context, walletID int64, in Input) (Schedule, error) {
	if _, err := s.validate(ctx, walletID, &in); err != nil {
		return Schedule{}, err
	}
	row, err := s.q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: walletID, TemplateID: in.TemplateID, Unit: in.Unit, EveryN: int64(in.EveryN),
		NextDue: in.NextDue, WeekendMode: int64(in.WeekendMode), Remaining: nval(in.Remaining),
		PostAdvance: int64(in.PostAdvance), AutoPost: dbconv.B2i(in.AutoPost),
	})
	if err != nil {
		return Schedule{}, err
	}
	return s.Get(ctx, row.ID)
}

func toSchedule(r db.ListSchedulesForWalletRow) Schedule {
	sc := Schedule{
		ID: r.ID, TemplateID: r.TemplateID, TemplateName: r.TemplateName,
		TemplateAmount: r.TemplateAmount, TemplateIsTransfer: r.TemplateIsTransfer != 0,
		Unit: r.Unit, EveryN: int(r.EveryN), NextDue: r.NextDue, WeekendMode: int(r.WeekendMode),
		Remaining: nptr(r.Remaining), PostAdvance: int(r.PostAdvance), AutoPost: r.AutoPost != 0,
	}
	if r.LastPosted.Valid {
		sc.LastPosted = r.LastPosted.String
	}
	return sc
}

// Get returns one schedule (with template summary).
func (s *Service) Get(ctx context.Context, id int64) (Schedule, error) {
	// Reuse the list query shape by fetching the wallet's rows is wasteful;
	// instead load the raw schedule and its template name.
	sc, err := s.rq.GetSchedule(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Schedule{}, ErrNotFound
	}
	if err != nil {
		return Schedule{}, err
	}
	tpl, err := s.rq.GetTemplate(ctx, sc.TemplateID)
	if err != nil {
		return Schedule{}, err
	}
	out := Schedule{
		ID: sc.ID, TemplateID: sc.TemplateID, TemplateName: tpl.Name, TemplateAmount: tpl.Amount,
		TemplateIsTransfer: tpl.IsTransfer != 0, Unit: sc.Unit, EveryN: int(sc.EveryN),
		NextDue: sc.NextDue, WeekendMode: int(sc.WeekendMode), Remaining: nptr(sc.Remaining),
		PostAdvance: int(sc.PostAdvance), AutoPost: sc.AutoPost != 0,
	}
	if sc.LastPosted.Valid {
		out.LastPosted = sc.LastPosted.String
	}
	return out, nil
}

// WalletOf returns the wallet a schedule belongs to (for ownership checks).
func (s *Service) WalletOf(ctx context.Context, id int64) (int64, error) {
	sc, err := s.rq.GetSchedule(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return sc.WalletID, nil
}

// List returns a wallet's schedules.
func (s *Service) List(ctx context.Context, walletID int64) ([]Schedule, error) {
	rows, err := s.rq.ListSchedulesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Schedule, 0, len(rows))
	for _, r := range rows {
		out = append(out, toSchedule(r))
	}
	return out, nil
}

// Upcoming returns schedules whose next occurrence is due on or before `before`
// (used for the pending list and the dashboard's upcoming widget).
func (s *Service) Upcoming(ctx context.Context, walletID int64, before string) ([]Schedule, error) {
	rows, err := s.rq.ListUpcomingSchedules(ctx, db.ListUpcomingSchedulesParams{WalletID: walletID, NextDue: before})
	if err != nil {
		return nil, err
	}
	out := make([]Schedule, 0, len(rows))
	for _, r := range rows {
		out = append(out, toSchedule(db.ListSchedulesForWalletRow(r)))
	}
	return out, nil
}

// Update changes a schedule's configuration.
func (s *Service) Update(ctx context.Context, walletID, id int64, in Input) (Schedule, error) {
	if _, err := s.WalletOf(ctx, id); err != nil {
		return Schedule{}, err
	}
	if _, err := s.validate(ctx, walletID, &in); err != nil {
		return Schedule{}, err
	}
	if err := s.q.UpdateScheduleConfig(ctx, db.UpdateScheduleConfigParams{
		Unit: in.Unit, EveryN: int64(in.EveryN), NextDue: in.NextDue, WeekendMode: int64(in.WeekendMode),
		Remaining: nval(in.Remaining), PostAdvance: int64(in.PostAdvance), AutoPost: dbconv.B2i(in.AutoPost), ID: id,
	}); err != nil {
		return Schedule{}, err
	}
	return s.Get(ctx, id)
}

// Delete removes a schedule.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.q.DeleteSchedule(ctx, id)
}

// PostNow posts the current occurrence immediately (ignoring the due date and
// auto-post flag) and advances the schedule.
func (s *Service) PostNow(ctx context.Context, id int64) error {
	sc, err := s.q.GetSchedule(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	return s.postOnce(ctx, sc, true)
}

// Skip advances the schedule past the current occurrence without posting.
func (s *Service) Skip(ctx context.Context, id int64) error {
	sc, err := s.q.GetSchedule(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	return s.postOnce(ctx, sc, false)
}

// RunDue auto-posts every due occurrence of every auto-post schedule (catching
// up after downtime). It returns the number of occurrences posted.
func (s *Service) RunDue(ctx context.Context, now time.Time) (int, error) {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	schedules, err := s.q.ListAllSchedules(ctx)
	if err != nil {
		return 0, err
	}
	// Per-wallet "post up to N months ahead" horizon (HomeBank parity).
	monthsByWallet := map[int64]int{}
	if rows, err := s.q.ListWalletSettings(ctx); err == nil {
		for _, r := range rows {
			monthsByWallet[r.ID] = walletScheduleMonths(r.SettingsJson)
		}
	}
	posted := 0
	for _, sc := range schedules {
		if sc.AutoPost == 0 {
			continue
		}
		months := monthsByWallet[sc.WalletID]
		for i := 0; i < catchUpCap; i++ {
			due, err := isDue(sc, today, months)
			if err != nil {
				s.logger.Warn("schedule: bad next_due", "schedule", sc.ID, "error", err)
				break
			}
			if !due {
				break
			}
			if err := s.postOnce(ctx, sc, true); err != nil {
				return posted, err
			}
			posted++
			// Reload to see the advanced next_due / remaining (or absence).
			next, err := s.q.GetSchedule(ctx, sc.ID)
			if errors.Is(err, sql.ErrNoRows) {
				break // exhausted and deleted
			}
			if err != nil {
				return posted, err
			}
			sc = next
		}
	}
	if posted > 0 {
		s.logger.Info("schedules posted", "count", posted)
	}
	return posted, nil
}

// isDue reports whether the schedule's next occurrence falls on/before the
// posting horizon: the later of (today + per-schedule postAdvance days) and
// (today + the wallet's post-ahead months).
func isDue(sc db.Schedule, today time.Time, months int) (bool, error) {
	next, err := ParseDate(sc.NextDue)
	if err != nil {
		return false, err
	}
	cutoff := today.AddDate(0, 0, int(sc.PostAdvance))
	if months > 0 {
		if ahead := today.AddDate(0, months, 0); ahead.After(cutoff) {
			cutoff = ahead
		}
	}
	return !next.After(cutoff), nil
}

// walletScheduleMonths reads the auto-post horizon from a wallet's settings JSON
// (kept in sync with the wallet package's schedulePostMonths key).
func walletScheduleMonths(settingsJSON string) int {
	var s struct {
		SchedulePostMonths int `json:"schedulePostMonths"`
	}
	if settingsJSON != "" {
		_ = json.Unmarshal([]byte(settingsJSON), &s)
	}
	if s.SchedulePostMonths < 0 {
		return 0
	}
	if s.SchedulePostMonths > 3 {
		return 3
	}
	return s.SchedulePostMonths
}

// postOnce posts (when post is true) the schedule's current occurrence and
// advances next_due — all in one transaction, so it is safe to retry. When the
// occurrence lands on a weekend with "skip" mode, or post is false, nothing is
// inserted but the schedule still advances. An exhausted schedule (remaining
// hits zero) is deleted.
func (s *Service) postOnce(ctx context.Context, sc db.Schedule, post bool) error {
	due, err := ParseDate(sc.NextDue)
	if err != nil {
		return ErrInvalidDate
	}
	postDate, skip := AdjustWeekend(due, int(sc.WeekendMode))

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	if post && !skip {
		if err := s.materialize(ctx, qtx, sc, FormatDate(postDate)); err != nil {
			return err
		}
	}

	// Advance the cadence from the raw due date and apply the occurrence limit.
	nextDue := FormatDate(AddInterval(due, sc.Unit, int(sc.EveryN)))
	remaining := sc.Remaining
	exhausted := false
	if remaining.Valid {
		remaining.Int64--
		if remaining.Int64 <= 0 {
			exhausted = true
		}
	}
	if exhausted {
		if err := qtx.DeleteSchedule(ctx, sc.ID); err != nil {
			return err
		}
	} else {
		if err := qtx.AdvanceSchedule(ctx, db.AdvanceScheduleParams{
			NextDue: nextDue, Remaining: remaining, LastPosted: sql.NullString{String: FormatDate(due), Valid: true}, ID: sc.ID,
		}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// materialize inserts a transaction (or transfer) from the schedule's template
// on the given date and stamps it with the template id. All reads and writes go
// through qtx: the caller already holds the single write connection, so using
// s.q here would deadlock.
func (s *Service) materialize(ctx context.Context, qtx *db.Queries, sc db.Schedule, date string) error {
	tpl, err := qtx.GetTemplate(ctx, sc.TemplateID)
	if err != nil {
		return err
	}
	if !tpl.AccountID.Valid {
		return ErrTemplateNoAcct
	}
	// A posted scheduled transaction has actually occurred, so default it to
	// Cleared when the template leaves the status unset (None). An explicitly-set
	// Cleared/Reconciled status on the template is preserved. (#243)
	postStatus := int(tpl.Status)
	if postStatus == transaction.StatusNone {
		postStatus = transaction.StatusCleared
	}
	if tpl.IsTransfer != 0 {
		if !tpl.ToAccountID.Valid {
			return ErrTemplateNoAcct
		}
		fromID, toID, err := s.transfers.CreateInTx(ctx, qtx, sc.WalletID, transfer.Input{
			FromAccountID: tpl.AccountID.Int64, ToAccountID: tpl.ToAccountID.Int64, Date: date,
			FromAmount: -tpl.Amount, Memo: tpl.Memo, Status: postStatus,
		})
		if err != nil {
			return err
		}
		for _, id := range []int64{fromID, toID} {
			if err := qtx.SetTransactionTemplate(ctx, db.SetTransactionTemplateParams{
				TemplateID: sql.NullInt64{Int64: tpl.ID, Valid: true}, ID: id,
			}); err != nil {
				return err
			}
		}
		return nil
	}

	in := transaction.Input{
		AccountID: tpl.AccountID.Int64, Date: date, Amount: tpl.Amount,
		PaymentMode: int(tpl.PaymentMode), Status: postStatus, Info: tpl.Info,
		PayeeID: nptr(tpl.PayeeID), CategoryID: nptr(tpl.CategoryID), Memo: tpl.Memo,
		Tags: splitTags(tpl.Tags),
	}
	if tpl.IsSplit != 0 {
		splits, err := qtx.ListTemplateSplits(ctx, tpl.ID)
		if err != nil {
			return err
		}
		for _, sp := range splits {
			in.Splits = append(in.Splits, transaction.Split{CategoryID: nptr(sp.CategoryID), Amount: sp.Amount, Memo: sp.Memo})
		}
	}
	id, err := s.txns.CreateInTx(ctx, qtx, sc.WalletID, in)
	if err != nil {
		return err
	}
	return qtx.SetTransactionTemplate(ctx, db.SetTransactionTemplateParams{
		TemplateID: sql.NullInt64{Int64: tpl.ID, Valid: true}, ID: id,
	})
}

func splitTags(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, ",")
}
