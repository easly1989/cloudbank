package notify

import (
	"context"
	"fmt"
	"time"

	"github.com/easly1989/cloudbank/server/internal/bills"
	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

const (
	// reminderLeadDays is how far ahead a bill is announced (plus anything overdue).
	reminderLeadDays = 3
	dateLayout       = "2006-01-02"
)

// RunBillsReminders tells every member of a wallet about its unpaid bills that
// are overdue or due within the lead window, one event per wallet. It is safe
// to run often: a bill occurrence is announced to a person only once.
func (s *Service) RunBillsReminders(ctx context.Context, now time.Time) error {
	if s.bills == nil {
		return nil
	}
	today := now.UTC().Format(dateLayout)
	horizon := now.UTC().AddDate(0, 0, reminderLeadDays).Format(dateLayout)

	users, err := s.rq.ListUsers(ctx)
	if err != nil {
		return err
	}
	// A wallet's bills are the same for every member: read them once per run.
	sums := map[int64][]bills.Bill{}
	for _, u := range users {
		wallets, err := s.rq.ListWalletsForUser(ctx, u.ID)
		if err != nil {
			s.logger.Warn("bills reminders: list wallets", "user", u.ID, "err", err)
			continue
		}
		for _, w := range wallets {
			due, ok := sums[w.ID]
			if !ok {
				sum, err := s.bills.Bills(ctx, w.ID, today)
				if err != nil {
					s.logger.Warn("bills reminders: bills", "wallet", w.ID, "err", err)
					continue
				}
				due = sum.Bills
				sums[w.ID] = due
			}
			pending := s.newlyDue(ctx, u.ID, w.ID, due, horizon)
			if len(pending) == 0 {
				continue
			}
			e := billsEvent(pending, u.Locale)
			e.WalletID = w.ID
			if err := s.Notify(ctx, u.ID, e); err != nil {
				s.logger.Warn("bills reminders: notify", "user", u.ID, "err", err)
			}
		}
	}
	return nil
}

// newlyDue is the wallet's bills to announce to this person that were not
// announced before, recording them as announced.
func (s *Service) newlyDue(ctx context.Context, userID, walletID int64, due []bills.Bill, horizon string) []bills.Bill {
	var pending []bills.Bill
	for _, b := range due {
		if b.State == bills.StatePaid || b.DueDate > horizon {
			continue
		}
		ref := fmt.Sprintf("bill:%d:%d:%s", walletID, b.ScheduleID, b.DueDate)
		n, err := s.q.InsertReminderIfNew(ctx, db.InsertReminderIfNewParams{UserID: userID, Ref: ref})
		if err != nil {
			continue
		}
		if n > 0 {
			pending = append(pending, b)
		}
	}
	return pending
}

// reminderText is the reminder's wording, one per language (internal/locale's
// codes); a language without its own gets the English one, and a test asks
// every listed language for an entry.
type reminderText struct {
	title string
	many  string // %d: how many bills
	one   string // %s: the bill's name
}

var reminderTexts = map[string]reminderText{
	"en":    {title: "Bills due", many: "%d bills need your attention", one: "%s is due or overdue"},
	"it":    {title: "Scadenze in arrivo", many: "%d scadenze richiedono attenzione", one: "%s è in scadenza o scaduta"},
	"de":    {title: "Anstehende Fälligkeiten", many: "%d Fälligkeiten brauchen deine Aufmerksamkeit", one: "%s ist fällig oder überfällig"},
	"fr":    {title: "Échéances à venir", many: "%d échéances demandent votre attention", one: "%s arrive à échéance ou est en retard"},
	"es":    {title: "Próximos vencimientos", many: "%d vencimientos necesitan tu atención", one: "%s vence pronto o está vencido"},
	"pt-BR": {title: "Próximos vencimentos", many: "%d vencimentos precisam da sua atenção", one: "%s vence em breve ou está vencido"},
}

// billsEvent builds the reminder in the person's language. It opens the
// Schedules page, where bills live since the Bills page was folded in.
func billsEvent(pending []bills.Bill, lang string) Event {
	text := locale.Pick(reminderTexts, lang)
	body := fmt.Sprintf(text.many, len(pending))
	if len(pending) == 1 {
		body = fmt.Sprintf(text.one, pending[0].Name)
	}
	return Event{Kind: KindBills, Title: text.title, Body: body, URL: "/schedules"}
}
