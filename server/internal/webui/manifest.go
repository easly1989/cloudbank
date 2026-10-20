package webui

import (
	"encoding/json"
	"strings"
)

// shortcutNames are the home-screen shortcuts' names (#702) in the languages
// the app speaks, keyed by the shortcut's kind; the manifest file carries the
// English ones.
var shortcutNames = map[string]map[string]string{
	"it":    {"expense": "Nuova spesa", "income": "Nuova entrata"},
	"es":    {"expense": "Nuevo gasto", "income": "Nuevo ingreso"},
	"fr":    {"expense": "Nouvelle dépense", "income": "Nouveau revenu"},
	"de":    {"expense": "Neue Ausgabe", "income": "Neue Einnahme"},
	"pt-BR": {"expense": "Nova despesa", "income": "Nova receita"},
}

// manifestLang picks the first language of an Accept-Language header that the
// app speaks: "it-IT" is Italian, "pt" Brazilian Portuguese. "" is English.
func manifestLang(header string) string {
	for _, part := range strings.Split(header, ",") {
		tag := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		base := strings.ToLower(strings.SplitN(tag, "-", 2)[0])
		switch {
		case base == "en":
			return ""
		case base == "pt":
			return "pt-BR"
		case shortcutNames[base] != nil:
			return base
		}
	}
	return ""
}

// localizeManifest names the shortcuts in the reader's language. A manifest it
// cannot read goes out as it is.
func localizeManifest(data []byte, acceptLanguage string) []byte {
	lang := manifestLang(acceptLanguage)
	if lang == "" {
		return data
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return data
	}
	shortcuts, _ := m["shortcuts"].([]any)
	for _, s := range shortcuts {
		sc, _ := s.(map[string]any)
		url, _ := sc["url"].(string)
		_, kind, _ := strings.Cut(url, "kind=")
		if name, ok := shortcutNames[lang][kind]; ok {
			sc["name"] = name
		}
	}
	m["lang"] = lang
	out, err := json.Marshal(m)
	if err != nil {
		return data
	}
	return out
}
