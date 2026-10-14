// Package locale is the server's list of the languages CloudBank speaks, and
// the one place a language tag from a browser or a client becomes one of them.
//
// The web keeps the same list in web/src/i18n/languages.ts, with the native
// names and the beta marks; a test on each side checks both against the
// translation files in web/src/i18n/locales/, so a language cannot be half
// added. Adding one is: its translation file, a row there, a row here, the
// push phrases (internal/push) and the demo's words (internal/demo).
package locale

import "strings"

// Default is the language everything falls back to: the app's own, and the
// one every text exists in.
const Default = "en"

// Supported lists the languages, by the code users.locale stores.
var Supported = []string{"en", "it", "de", "fr"}

// families sends a whole language to the one variant CloudBank speaks:
// pt-PT, pt-AO and plain pt all read Brazilian Portuguese.
var families = map[string]string{"pt": "pt-BR"}

// Normalize turns a tag (it-CH, EN, pt_PT) into a supported code. ok is false
// when CloudBank does not speak the language.
func Normalize(tag string) (code string, ok bool) {
	return normalize(tag, Supported)
}

func normalize(tag string, supported []string) (string, bool) {
	tag = strings.ReplaceAll(strings.TrimSpace(tag), "_", "-")
	if tag == "" {
		return "", false
	}
	for _, s := range supported {
		if strings.EqualFold(s, tag) {
			return s, true
		}
	}
	primary := strings.ToLower(strings.SplitN(tag, "-", 2)[0])
	if code, ok := families[primary]; ok {
		primary = code
	}
	for _, s := range supported {
		if strings.EqualFold(s, primary) {
			return s, true
		}
	}
	return "", false
}

// FromAcceptLanguage picks the first language an Accept-Language header names
// that CloudBank speaks, or Default. The header's order is taken as the
// browser's preference; quality values are not weighed.
func FromAcceptLanguage(header string) string {
	return fromAcceptLanguage(header, Supported)
}

func fromAcceptLanguage(header string, supported []string) string {
	for _, part := range strings.Split(header, ",") {
		tag := strings.SplitN(part, ";", 2)[0]
		if code, ok := normalize(tag, supported); ok {
			return code
		}
	}
	return Default
}

// Pick returns m's entry for code, or its Default entry when the language
// has none: what the push and the demo use to find their texts.
func Pick[T any](m map[string]T, code string) T {
	if v, ok := m[code]; ok {
		return v
	}
	return m[Default]
}
