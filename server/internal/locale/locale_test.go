package locale

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// The list matches the translation files: a language added on one side only
// fails here (the web has the same test for languages.ts).
func TestSupportedMatchesTranslationFiles(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "web", "src", "i18n", "locales", "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no translation files found: %v", err)
	}
	var codes []string
	for _, f := range files {
		codes = append(codes, strings.TrimSuffix(filepath.Base(f), ".json"))
	}
	want := slices.Clone(Supported)
	slices.Sort(want)
	slices.Sort(codes)
	if !slices.Equal(want, codes) {
		t.Fatalf("Supported = %v, translation files = %v", want, codes)
	}
	if !slices.Contains(Supported, Default) {
		t.Fatalf("Default %q is not in Supported", Default)
	}
}

func TestNormalize(t *testing.T) {
	// The six languages of 3.8.0, so the variants are checked before they ship.
	six := []string{"en", "it", "es", "fr", "de", "pt-BR"}
	cases := map[string]string{
		"it":     "it",
		"it-CH":  "it",
		"IT_it":  "it",
		"en-GB":  "en",
		"EN":     "en",
		"es-MX":  "es",
		"fr-CA":  "fr",
		"de-AT":  "de",
		"pt-BR":  "pt-BR",
		"pt-br":  "pt-BR",
		"pt-PT":  "pt-BR",
		"pt":     "pt-BR",
		"xx":     "",
		"":       "",
		"italic": "",
	}
	for tag, want := range cases {
		got, ok := normalize(tag, six)
		if got != want || ok != (want != "") {
			t.Errorf("normalize(%q) = %q, %v; want %q", tag, got, ok, want)
		}
	}
	// Today's list: Portuguese is not there yet, so pt-PT is unknown.
	if code, ok := Normalize("pt-PT"); ok {
		t.Errorf("Normalize(pt-PT) = %q before pt-BR exists", code)
	}
}

func TestFromAcceptLanguage(t *testing.T) {
	cases := map[string]string{
		"":                           "en",
		"it":                         "it",
		"it-IT,it;q=0.9":             "it",
		"de-DE,it;q=0.8,en;q=0.7":    "de",
		"de-CH,en;q=0.5":             "de",
		"nl-NL,it;q=0.8,en;q=0.7":    "it",
		"fr-FR,en-GB;q=0.8,it;q=0.5": "en",
		"italic":                     "en",
		"pt-PT,pt;q=0.9":             "en",
	}
	for h, want := range cases {
		if got := FromAcceptLanguage(h); got != want {
			t.Errorf("FromAcceptLanguage(%q) = %q; want %q", h, got, want)
		}
	}
	if got := fromAcceptLanguage("pt-PT,en;q=0.5", []string{"en", "pt-BR"}); got != "pt-BR" {
		t.Errorf("pt-PT with pt-BR spoken = %q; want pt-BR", got)
	}
}

func TestPick(t *testing.T) {
	m := map[string]string{"en": "hello", "it": "ciao"}
	if Pick(m, "it") != "ciao" || Pick(m, "de") != "hello" {
		t.Fatal("Pick does not fall back to the default language")
	}
}
