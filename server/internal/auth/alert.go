package auth

import (
	"context"
	"fmt"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Notifier is the dispatcher (internal/notify): the security events (#690)
// go through it.
type Notifier interface {
	Notify(ctx context.Context, userID int64, e notify.Event) error
}

// SetNotify wires the notifications. Without it nothing is announced, though
// the devices are still remembered.
func (s *Service) SetNotify(n Notifier) { s.notify = n }

// securityURL is where a security notification leads.
const securityURL = "/settings/security"

// alertText is the wording of the security notifications, one per language
// (internal/locale's codes); a test asks every listed language for an entry.
type alertText struct {
	deviceTitle string
	device      string // %s: the device
	on          string // %[1]s: the browser, %[2]s: the system
	unknown     string // a device the user agent does not name
	twoFATitle  string
	twoFA       string
	tokenTitle  string
	token       string // %s: the token's name
	read, write string // the token's scope
}

var alertTexts = map[string]alertText{
	"en": {
		deviceTitle: "New sign-in",
		device:      "Someone signed in to your account from %s. If it wasn't you, change your password.",
		on:          "%[1]s on %[2]s",
		unknown:     "an unknown device",
		twoFATitle:  "Two-factor authentication turned off",
		twoFA:       "Your account now signs in with the password alone. If it wasn't you, change your password.",
		tokenTitle:  "New API token",
		token:       "The token “%s” (%s) was created on your account. If it wasn't you, revoke it.",
		read:        "read only",
		write:       "read and write",
	},
	"it": {
		deviceTitle: "Nuovo accesso",
		device:      "Qualcuno ha effettuato l’accesso al tuo account da %s. Se non sei stato tu, cambia la password.",
		on:          "%[1]s su %[2]s",
		unknown:     "un dispositivo sconosciuto",
		twoFATitle:  "Autenticazione a due fattori disattivata",
		twoFA:       "Ora il tuo account accede con la sola password. Se non sei stato tu, cambia la password.",
		tokenTitle:  "Nuovo token API",
		token:       "Sul tuo account è stato creato il token «%s» (%s). Se non sei stato tu, revocalo.",
		read:        "sola lettura",
		write:       "lettura e scrittura",
	},
	"es": {
		deviceTitle: "Nuevo inicio de sesión",
		device:      "Alguien ha iniciado sesión en tu cuenta desde %s. Si no has sido tú, cambia la contraseña.",
		on:          "%[1]s en %[2]s",
		unknown:     "un dispositivo desconocido",
		twoFATitle:  "Autenticación en dos pasos desactivada",
		twoFA:       "Tu cuenta ahora entra solo con la contraseña. Si no has sido tú, cambia la contraseña.",
		tokenTitle:  "Nuevo token de API",
		token:       "Se ha creado el token «%s» (%s) en tu cuenta. Si no has sido tú, revócalo.",
		read:        "solo lectura",
		write:       "lectura y escritura",
	},
	"fr": {
		deviceTitle: "Nouvelle connexion",
		device:      "Quelqu’un s’est connecté à votre compte depuis %s. Si ce n’était pas vous, changez votre mot de passe.",
		on:          "%[1]s sur %[2]s",
		unknown:     "un appareil inconnu",
		twoFATitle:  "Authentification à deux facteurs désactivée",
		twoFA:       "Votre compte se connecte désormais avec le seul mot de passe. Si ce n’était pas vous, changez votre mot de passe.",
		tokenTitle:  "Nouveau jeton d’API",
		token:       "Le jeton « %s » (%s) a été créé sur votre compte. Si ce n’était pas vous, révoquez-le.",
		read:        "lecture seule",
		write:       "lecture et écriture",
	},
	"de": {
		deviceTitle: "Neue Anmeldung",
		device:      "Jemand hat sich von %s bei deinem Konto angemeldet. Warst du es nicht, ändere dein Passwort.",
		on:          "%[1]s unter %[2]s",
		unknown:     "einem unbekannten Gerät",
		twoFATitle:  "Zwei-Faktor-Authentifizierung ausgeschaltet",
		twoFA:       "Dein Konto meldet sich jetzt nur mit dem Passwort an. Warst du es nicht, ändere dein Passwort.",
		tokenTitle:  "Neues API-Token",
		token:       "Für dein Konto wurde das Token „%s“ (%s) erstellt. Warst du es nicht, widerrufe es.",
		read:        "nur lesen",
		write:       "lesen und schreiben",
	},
	"pt-BR": {
		deviceTitle: "Novo acesso",
		device:      "Alguém entrou na sua conta a partir de %s. Se não foi você, troque a senha.",
		on:          "%[1]s no %[2]s",
		unknown:     "um dispositivo desconhecido",
		twoFATitle:  "Autenticação em dois fatores desativada",
		twoFA:       "Agora sua conta entra só com a senha. Se não foi você, troque a senha.",
		tokenTitle:  "Novo token de API",
		token:       "O token “%s” (%s) foi criado na sua conta. Se não foi você, revogue-o.",
		read:        "somente leitura",
		write:       "leitura e escrita",
	},
}

// tell sends one security notification to the user, in their language.
func (s *Service) tell(ctx context.Context, userID int64, kind notify.Kind, words func(alertText) (title, body string)) {
	if s.notify == nil {
		return
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return
	}
	title, body := words(locale.Pick(alertTexts, u.Locale))
	_ = s.notify.Notify(ctx, userID, notify.Event{Kind: kind, Title: title, Body: body, URL: securityURL})
}

// rememberDevice records the device a session was opened from, and announces
// one the account has not used before. The first device an account ever
// uses is its own, so it is not announced.
func (s *Service) rememberDevice(ctx context.Context, userID int64, userAgent string) {
	browser, system := deviceOf(userAgent)
	n, err := s.q.RememberDevice(ctx, db.RememberDeviceParams{UserID: userID, Device: browser + "|" + system})
	if err != nil || n == 0 {
		return
	}
	if known, err := s.q.CountKnownDevices(ctx, userID); err != nil || known < 2 {
		return
	}
	s.tell(ctx, userID, notify.KindNewDevice, func(t alertText) (string, string) {
		name := t.unknown
		switch {
		case browser != "" && system != "":
			name = fmt.Sprintf(t.on, browser, system)
		case browser != "":
			name = browser
		case system != "":
			name = system
		}
		return t.deviceTitle, fmt.Sprintf(t.device, name)
	})
}

type uaToken struct{ token, name string }

// The order matters: Edge and Opera also say Chrome, Chrome also says
// Safari, and Android also says Linux.
var (
	uaBrowsers = []uaToken{
		{"Edg/", "Edge"}, {"EdgA/", "Edge"}, {"EdgiOS/", "Edge"}, {"OPR/", "Opera"},
		{"SamsungBrowser/", "Samsung Internet"}, {"Firefox/", "Firefox"}, {"FxiOS/", "Firefox"},
		{"CriOS/", "Chrome"}, {"Chrome/", "Chrome"}, {"Safari/", "Safari"},
	}
	uaSystems = []uaToken{
		{"Windows", "Windows"}, {"Android", "Android"}, {"iPhone", "iOS"}, {"iPad", "iPadOS"},
		{"CrOS", "ChromeOS"}, {"Macintosh", "macOS"}, {"Linux", "Linux"},
	}
)

// deviceOf is the browser and the system a user agent names, empty for what
// it does not tell. A client that is no browser (curl, a script) is named by
// its own first word, cut to the characters a name needs.
func deviceOf(ua string) (browser, system string) {
	pick := func(list []uaToken) string {
		for _, t := range list {
			if strings.Contains(ua, t.token) {
				return t.name
			}
		}
		return ""
	}
	browser, system = pick(uaBrowsers), pick(uaSystems)
	if browser == "" && !strings.HasPrefix(ua, "Mozilla/") {
		first, _, _ := strings.Cut(ua, "/")
		browser = strings.Map(func(r rune) rune {
			if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' {
				return r
			}
			return -1
		}, first)
		if len(browser) > 32 {
			browser = browser[:32]
		}
	}
	return browser, system
}
