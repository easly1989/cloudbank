package mailingest

import (
	"context"
	"fmt"
	"strconv"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Notify tells one user about one event of the given kind, once per ref: a
// second call with the same ref tells nothing. It is internal/notify's
// dispatcher, and the kinds are its own ("mail_stopped", "mail_unrecognized").
type Notify func(ctx context.Context, userID int64, kind, ref, title, body, url string) error

// SetNotify wires the notifications. Without it nothing is announced.
func (s *Service) SetNotify(n Notify) { s.notify = n }

// alertsURL is where a notification about a mailbox leads.
const alertsURL = "/settings/mail"

// alertText is the wording of the notifications, one per language
// (internal/locale's codes); a test asks every listed language for an entry.
type alertText struct {
	stoppedTitle string
	stopped      string // %s: the mailbox's address
	unrecTitle   string
	unrecOne     string // %s: the mailbox's address
	unrecMany    string // %[1]d: how many, %[2]s: the mailbox's address
}

var alertTexts = map[string]alertText{
	"en": {
		stoppedTitle: "Bank mails stopped",
		stopped:      "CloudBank can no longer read %s: sign in again.",
		unrecTitle:   "Bank mails not recognised",
		unrecOne:     "A mail in %s was not recognised.",
		unrecMany:    "%[1]d mails in %[2]s were not recognised.",
	},
	"it": {
		stoppedTitle: "Mail della banca ferme",
		stopped:      "CloudBank non riesce più a leggere %s: accedi di nuovo.",
		unrecTitle:   "Mail della banca non riconosciute",
		unrecOne:     "Una mail in %s non è stata riconosciuta.",
		unrecMany:    "%[1]d mail in %[2]s non sono state riconosciute.",
	},
	"es": {
		stoppedTitle: "Correos del banco detenidos",
		stopped:      "CloudBank ya no puede leer %s: vuelve a iniciar sesión.",
		unrecTitle:   "Correos del banco no reconocidos",
		unrecOne:     "Un correo en %s no se ha reconocido.",
		unrecMany:    "%[1]d correos en %[2]s no se han reconocido.",
	},
	"fr": {
		stoppedTitle: "E-mails de la banque arrêtés",
		stopped:      "CloudBank ne peut plus lire %s : reconnectez-vous.",
		unrecTitle:   "E-mails de la banque non reconnus",
		unrecOne:     "Un e-mail dans %s n’a pas été reconnu.",
		unrecMany:    "%[1]d e-mails dans %[2]s n’ont pas été reconnus.",
	},
	"de": {
		stoppedTitle: "Bank-E-Mails gestoppt",
		stopped:      "CloudBank kann %s nicht mehr lesen: Melde dich erneut an.",
		unrecTitle:   "Bank-E-Mails nicht erkannt",
		unrecOne:     "Eine E-Mail in %s wurde nicht erkannt.",
		unrecMany:    "%[1]d E-Mails in %[2]s wurden nicht erkannt.",
	},
	"pt-BR": {
		stoppedTitle: "E-mails do banco parados",
		stopped:      "O CloudBank não consegue mais ler %s: entre de novo.",
		unrecTitle:   "E-mails do banco não reconhecidos",
		unrecOne:     "Um e-mail em %s não foi reconhecido.",
		unrecMany:    "%[1]d e-mails em %[2]s não foram reconhecidos.",
	},
}

// alertStopped tells the person who connected the mailbox that its sign-in
// was refused. record calls it once per episode.
func (s *Service) alertStopped(ctx context.Context, mb db.Mailbox) {
	text, uid, ok := s.alertFor(ctx, mb)
	if !ok {
		return
	}
	// The episode is already one per flag change; the ref only has to differ
	// from the last one's.
	ref := "mail-stopped:" + strconv.FormatInt(mb.ID, 10) + ":" + strconv.FormatInt(s.now().UnixNano(), 10)
	_ = s.notify(ctx, uid, "mail_stopped", ref, text.stoppedTitle, fmt.Sprintf(text.stopped, mb.Address), alertsURL)
}

// alertUnrecognized announces mails CloudBank could not read, at most once a
// day for each mailbox.
func (s *Service) alertUnrecognized(ctx context.Context, mb db.Mailbox, n int) {
	text, uid, ok := s.alertFor(ctx, mb)
	if !ok {
		return
	}
	body := fmt.Sprintf(text.unrecOne, mb.Address)
	if n > 1 {
		body = fmt.Sprintf(text.unrecMany, n, mb.Address)
	}
	ref := "mail-unrecognized:" + strconv.FormatInt(mb.ID, 10) + ":" + s.now().Format("2006-01-02")
	_ = s.notify(ctx, uid, "mail_unrecognized", ref, text.unrecTitle, body, alertsURL)
}

// alertFor finds who to tell and in which language: the person who connected
// the mailbox. Nobody, when notifications are off or that person is gone.
func (s *Service) alertFor(ctx context.Context, mb db.Mailbox) (alertText, int64, bool) {
	if s.notify == nil || !mb.CreatedBy.Valid {
		return alertText{}, 0, false
	}
	u, err := s.rq.GetUserByID(ctx, mb.CreatedBy.Int64)
	if err != nil {
		return alertText{}, 0, false
	}
	return locale.Pick(alertTexts, u.Locale), u.ID, true
}
