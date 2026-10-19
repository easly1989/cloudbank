package updates

import (
	"context"
	"fmt"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
)

// Notifier is the dispatcher (internal/notify): a newer build is announced to
// the administrators (#690).
type Notifier interface {
	NotifyAdmins(ctx context.Context, build func(locale string) notify.Event) error
}

// SetNotify wires the notifications. Without it nothing is announced.
func (s *Service) SetNotify(n Notifier) { s.notify = n }

// aboutURL is where the notification leads: the page that says how to update.
const aboutURL = "/settings/about"

// alertText is the wording of the notification, one per language
// (internal/locale's codes); a test asks every listed language for an entry.
type alertText struct {
	title   string // %s: the new version
	nightly string
	body    string // %s: the version running
}

var alertTexts = map[string]alertText{
	"en": {
		title:   "CloudBank %s is out",
		nightly: "A newer nightly is out",
		body:    "You're on %s. Open About to see what's new and how to update.",
	},
	"it": {
		title:   "È uscito CloudBank %s",
		nightly: "È uscita una nightly più recente",
		body:    "Stai usando %s. Apri Informazioni per vedere le novità e come aggiornare.",
	},
	"es": {
		title:   "Ya está aquí CloudBank %s",
		nightly: "Hay una nightly más reciente",
		body:    "Tienes la %s. Abre Acerca de para ver las novedades y cómo actualizar.",
	},
	"fr": {
		title:   "CloudBank %s est sorti",
		nightly: "Une nightly plus récente est sortie",
		body:    "Vous êtes en %s. Ouvrez À propos pour voir les nouveautés et comment mettre à jour.",
	},
	"de": {
		title:   "CloudBank %s ist da",
		nightly: "Ein neuerer Nightly-Build ist da",
		body:    "Du hast %s. Öffne Über, um die Neuerungen und das Update zu sehen.",
	},
	"pt-BR": {
		title:   "Saiu o CloudBank %s",
		nightly: "Saiu uma nightly mais recente",
		body:    "Você está na %s. Abra Sobre para ver as novidades e como atualizar.",
	},
}

// announce tells the administrators about the build st found, once per build.
func (s *Service) announce(ctx context.Context, st Status) {
	if s.notify == nil || !st.Available {
		return
	}
	s.mu.Lock()
	ref := "new-version:" + st.Latest
	if st.Channel == Nightly && s.last != nil {
		ref = "new-version:" + s.last.sha
	}
	s.mu.Unlock()
	_ = s.notify.NotifyAdmins(ctx, func(lang string) notify.Event {
		t := locale.Pick(alertTexts, lang)
		title := fmt.Sprintf(t.title, st.Latest)
		if st.Channel == Nightly {
			title = t.nightly
		}
		return notify.Event{Kind: notify.KindNewVersion, Ref: ref, Title: title, Body: fmt.Sprintf(t.body, st.Current), URL: aboutURL}
	})
}
