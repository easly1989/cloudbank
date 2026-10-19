package banksync

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Notifier is the dispatcher (internal/notify): a connection that stops
// syncing, or whose consent is about to end, is announced to every member of
// its wallet (#690).
type Notifier interface {
	NotifyWallet(ctx context.Context, walletID int64, build func(locale string) notify.Event) error
}

// SetNotify wires the notifications. Without it nothing is announced.
func (s *Service) SetNotify(n Notifier) { s.notify = n }

// alertsURL is where a notification about a connection leads.
const alertsURL = "/settings/bank-sync"

// consentWarning is how long before a bank consent ends its warning comes.
const consentWarning = 7 * 24 * time.Hour

// alertText is the wording of the notifications, one per language
// (internal/locale's codes); a test asks every listed language for an entry.
// No account number goes in them: only the connection's name.
type alertText struct {
	failedTitle  string
	failed       string // %s: the connection
	consentTitle string
	consent      string // %[1]s: the connection, %[2]s: the day its consent ends
	date         string // the layout of that day
}

var alertTexts = map[string]alertText{
	"en": {
		failedTitle:  "Bank sync failed",
		failed:       "CloudBank could not sync %s. Open Bank sync to see why.",
		consentTitle: "Bank consent ending",
		consent:      "The consent for %[1]s ends on %[2]s: renew it to keep syncing.",
		date:         "2 January 2006",
	},
	"it": {
		failedTitle:  "Sync bancario non riuscito",
		failed:       "CloudBank non è riuscito a sincronizzare %s. Apri Sync bancario per vedere perché.",
		consentTitle: "Consenso della banca in scadenza",
		consent:      "Il consenso per %[1]s scade il %[2]s: rinnovalo per continuare a sincronizzare.",
		date:         "02/01/2006",
	},
	"es": {
		failedTitle:  "La sincronización bancaria ha fallado",
		failed:       "CloudBank no ha podido sincronizar %s. Abre Conexión bancaria para ver por qué.",
		consentTitle: "El consentimiento del banco caduca",
		consent:      "El consentimiento de %[1]s caduca el %[2]s: renuévalo para seguir sincronizando.",
		date:         "02/01/2006",
	},
	"fr": {
		failedTitle:  "Échec de la synchronisation bancaire",
		failed:       "CloudBank n’a pas pu synchroniser %s. Ouvrez Connexion bancaire pour savoir pourquoi.",
		consentTitle: "Consentement bancaire bientôt expiré",
		consent:      "Le consentement pour %[1]s expire le %[2]s : renouvelez-le pour continuer la synchronisation.",
		date:         "02/01/2006",
	},
	"de": {
		failedTitle:  "Bankanbindung fehlgeschlagen",
		failed:       "CloudBank konnte %s nicht abgleichen. Öffne Bankanbindung, um den Grund zu sehen.",
		consentTitle: "Bankfreigabe läuft ab",
		consent:      "Die Freigabe für %[1]s läuft am %[2]s ab: Erneuere sie, damit der Abgleich weiterläuft.",
		date:         "02.01.2006",
	},
	"pt-BR": {
		failedTitle:  "Falha na sincronização bancária",
		failed:       "O CloudBank não conseguiu sincronizar %s. Abra Sincronização bancária para ver o motivo.",
		consentTitle: "Consentimento do banco expirando",
		consent:      "O consentimento de %[1]s expira em %[2]s: renove para continuar sincronizando.",
		date:         "02/01/2006",
	},
}

// connName is how the notifications name a connection: the name it was
// given, else its bank's.
func connName(name, aspsp string) string {
	if name != "" {
		return name
	}
	return aspsp
}

func (s *Service) alert(ctx context.Context, walletID int64, build func(alertText) notify.Event) {
	if s.notify == nil {
		return
	}
	_ = s.notify.NotifyWallet(ctx, walletID, func(lang string) notify.Event {
		e := build(locale.Pick(alertTexts, lang))
		e.URL = alertsURL
		return e
	})
}

// alertFailed announces a background sync that failed, once per episode: the
// first failure after one that was not.
func (s *Service) alertFailed(ctx context.Context, before db.BankConnection, res SyncResult, err error) {
	if status, _ := syncStatusMessage(res, err); status != "error" || before.LastSyncStatus == "error" {
		return
	}
	name := connName(before.Name, before.AspspName)
	ref := "bank-sync-failed:" + strconv.FormatInt(before.ID, 10) + ":" + strconv.FormatInt(time.Now().UnixNano(), 10)
	s.alert(ctx, before.WalletID, func(t alertText) notify.Event {
		return notify.Event{Kind: notify.KindBankSyncFailed, Ref: ref, Title: t.failedTitle, Body: fmt.Sprintf(t.failed, name)}
	})
}

// WarnExpiringConsents announces every bank consent that ends within a week,
// once per consent: renewing it brings a new end, and a new warning.
func (s *Service) WarnExpiringConsents(ctx context.Context, now time.Time) error {
	rows, err := s.rq.ListConsentConnections(ctx)
	if err != nil {
		return err
	}
	for _, c := range rows {
		end, err := time.Parse(time.RFC3339, c.ValidUntil)
		if err != nil || !end.After(now) || end.Sub(now) > consentWarning {
			continue
		}
		name := connName(c.Name, c.AspspName)
		ref := "consent-expiring:" + strconv.FormatInt(c.ID, 10) + ":" + c.ValidUntil
		s.alert(ctx, c.WalletID, func(t alertText) notify.Event {
			return notify.Event{Kind: notify.KindConsentExpiring, Ref: ref, Title: t.consentTitle,
				Body: fmt.Sprintf(t.consent, name, end.Format(t.date))}
		})
	}
	return nil
}
