package insight

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/easly1989/cloudbank/server/internal/ai"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// The reports that come by themselves (#697): the monthly one on the 1st, the
// weekly one on Monday when it is on, the yearly one in January. Each is
// written at 07:00 in the person's time zone, or as soon after as the server
// runs while its period is still the latest; once only, per wallet.

// Notifier is how a scheduled report reaches its reader: the notifications
// dispatcher, and the time zone the person's notifications use.
type Notifier interface {
	Notify(ctx context.Context, userID int64, e notify.Event) error
	GetSettings(ctx context.Context, userID int64) (notify.Settings, error)
}

// SetNotify wires the dispatcher in.
func (s *Service) SetNotify(n Notifier) { s.notify = n }

// reportHour is the local hour a period's report is written at, on the day it
// becomes due.
const reportHour = 7

// due lists the periods whose report is due at local time t: the month before
// all through this month, the week before all through this week, the year
// before all through January; on the first day of each only from 07:00.
func due(t time.Time, weekly, yearly bool) []span {
	started := func(firstDay bool) bool { return !firstDay || t.Hour() >= reportHour }
	today := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	var out []span
	if started(t.Day() == 1) {
		out = append(out, monthSpan(today.AddDate(0, -1, 1-t.Day())))
	}
	if weekly {
		sinceMonday := (int(t.Weekday()) + 6) % 7
		if started(sinceMonday == 0) {
			out = append(out, weekSpan(today.AddDate(0, 0, -sinceMonday-7)))
		}
	}
	if yearly && t.Month() == time.January && started(t.Day() == 1) {
		out = append(out, yearSpan(t.Year()-1))
	}
	return out
}

// What the scheduler records about a period of a wallet.
const (
	outcomeWritten = "written"
	outcomeNoData  = "no_data"
	outcomeLimit   = "limit"
)

// RunScheduled writes every report that is due and not written yet. It is safe
// to run often.
func (s *Service) RunScheduled(ctx context.Context) error {
	users, err := s.rq.ListAIReportUsers(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, u := range users {
		if err := s.runFor(ctx, u); err != nil {
			errs = append(errs, fmt.Errorf("user %d: %w", u.UserID, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Service) runFor(ctx context.Context, u db.ListAIReportUsersRow) error {
	loc := time.UTC
	if s.notify != nil {
		if st, err := s.notify.GetSettings(ctx, u.UserID); err == nil {
			loc = st.Location()
		}
	}
	spans := due(s.now().In(loc), u.WeeklyOn != 0, u.YearlyOn != 0)
	if len(spans) == 0 {
		return nil
	}
	wallets, err := s.rq.ListWalletsForUser(ctx, u.UserID)
	if err != nil {
		return err
	}
	offList, err := s.rq.ListAIWalletsOff(ctx, u.UserID)
	if err != nil {
		return err
	}
	off := map[int64]bool{}
	for _, id := range offList {
		off[id] = true
	}
	var errs []error
	for _, sp := range spans {
		for _, w := range wallets {
			if off[w.ID] {
				continue
			}
			done, err := s.rq.AIReportDone(ctx, db.AIReportDoneParams{UserID: u.UserID, WalletID: w.ID, Kind: sp.kind, Period: sp.period})
			if err != nil {
				return err
			}
			if done != 0 {
				continue
			}
			rep, err := s.write(ctx, u.UserID, w.ID, sp, false)
			switch {
			case err == nil:
				s.record(ctx, u.UserID, w.ID, sp, outcomeWritten)
				s.tell(ctx, u, sp, true, fmt.Sprintf("ai-report:%d", rep.ID),
					fmt.Sprintf("/insights?report=%d", rep.ID), w.ID, w.Title)
			case errors.Is(err, ErrNoData):
				s.record(ctx, u.UserID, w.ID, sp, outcomeNoData)
			case errors.Is(err, ai.ErrLimit):
				// Skipped, and not caught up after the limit resets; said once per period.
				s.record(ctx, u.UserID, w.ID, sp, outcomeLimit)
				s.tell(ctx, u, sp, false, "ai-limit:"+sp.kind+":"+sp.period, "/settings/ai", 0, "")
				return nil
			case errors.Is(err, ai.ErrNotConfigured):
				// Switched off since the list was read: nothing to do, nothing kept.
				return nil
			default:
				// Not kept: tried again next run, as a provider off at 07:00 is common
				// for a model at home; the monthly limit bounds the retries.
				errs = append(errs, fmt.Errorf("%s %s, wallet %d: %w", sp.kind, sp.period, w.ID, err))
			}
		}
	}
	return errors.Join(errs...)
}

func (s *Service) record(ctx context.Context, userID, walletID int64, sp span, outcome string) {
	_ = s.q.InsertAIReportRun(ctx, db.InsertAIReportRunParams{
		UserID: userID, WalletID: walletID, Kind: sp.kind, Period: sp.period, Outcome: outcome,
	})
}

// tell sends the two-line notification about a period's report: no amounts,
// so it is the same in the bell and outside the app.
func (s *Service) tell(ctx context.Context, u db.ListAIReportUsersRow, sp span, ready bool, ref, url string, walletID int64, walletName string) {
	if s.notify == nil {
		return
	}
	text := locale.Pick(reportNotes, u.Locale)
	titles, body := text.skipped, text.skippedBody
	if ready {
		titles, body = text.ready, text.readyBody
	}
	var title string
	switch sp.kind {
	case KindMonthly:
		title = fmt.Sprintf(titles[0], text.months[sp.from.Month()-1])
	case KindWeekly:
		title = titles[1]
	default:
		title = fmt.Sprintf(titles[2], sp.from.Year())
	}
	if walletName != "" {
		body = fmt.Sprintf(body, walletName)
	}
	_ = s.notify.Notify(ctx, u.UserID, notify.Event{
		Kind: notify.KindAIReport, Ref: ref, Title: title, Body: body, URL: url, WalletID: walletID,
	})
}

// reportNote is the notifications' wording in one language: the titles for a
// month (%s, its name), a week and a year (%d), and the line under them.
type reportNote struct {
	months      [12]string
	ready       [3]string
	readyBody   string // %s: the wallet
	skipped     [3]string
	skippedBody string
}

var reportNotes = map[string]reportNote{
	"en": {
		months:      [12]string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"},
		ready:       [3]string{"%s report ready", "Weekly report ready", "%d report ready"},
		readyBody:   "%s: in AI insights.",
		skipped:     [3]string{"%s report not written", "Weekly report not written", "%d report not written"},
		skippedBody: "This month's limit is reached: change it in Settings › AI.",
	},
	"it": {
		months:      [12]string{"gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"},
		ready:       [3]string{"Resoconto di %s pronto", "Resoconto della settimana pronto", "Resoconto del %d pronto"},
		readyBody:   "%s: lo trovi in Approfondimenti AI.",
		skipped:     [3]string{"Resoconto di %s non scritto", "Resoconto della settimana non scritto", "Resoconto del %d non scritto"},
		skippedBody: "Limite del mese raggiunto: lo cambi in Impostazioni › AI.",
	},
	"es": {
		months:      [12]string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"},
		ready:       [3]string{"Resumen de %s listo", "Resumen de la semana listo", "Resumen de %d listo"},
		readyBody:   "%s: lo encontrarás en Análisis con IA.",
		skipped:     [3]string{"Resumen de %s no escrito", "Resumen de la semana no escrito", "Resumen de %d no escrito"},
		skippedBody: "Se ha alcanzado el límite del mes: cámbialo en Ajustes › IA.",
	},
	"fr": {
		months:      [12]string{"janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"},
		ready:       [3]string{"Bilan mensuel prêt : %s", "Bilan de la semaine prêt", "Bilan %d prêt"},
		readyBody:   "%s : à lire dans Analyses IA.",
		skipped:     [3]string{"Bilan mensuel non écrit : %s", "Bilan de la semaine non écrit", "Bilan %d non écrit"},
		skippedBody: "La limite du mois est atteinte : modifiez-la dans Paramètres › IA.",
	},
	"de": {
		months:      [12]string{"Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"},
		ready:       [3]string{"Bericht für %s fertig", "Wochenbericht fertig", "Jahresbericht %d fertig"},
		readyBody:   "%s: in den KI-Auswertungen.",
		skipped:     [3]string{"Bericht für %s nicht geschrieben", "Wochenbericht nicht geschrieben", "Jahresbericht %d nicht geschrieben"},
		skippedBody: "Das Monatslimit ist erreicht: ändere es unter Einstellungen › KI.",
	},
	"pt-BR": {
		months:      [12]string{"janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"},
		ready:       [3]string{"Resumo de %s pronto", "Resumo da semana pronto", "Resumo de %d pronto"},
		readyBody:   "%s: está em Análises com IA.",
		skipped:     [3]string{"Resumo de %s não escrito", "Resumo da semana não escrito", "Resumo de %d não escrito"},
		skippedBody: "O limite do mês foi atingido: mude-o em Configurações › IA.",
	},
}

// Run writes the due reports now, then every interval, until ctx ends.
func (s *Service) Run(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	run := func() {
		if err := s.RunScheduled(ctx); err != nil {
			logger.Warn("scheduled AI reports", "err", err)
		}
	}
	run()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
