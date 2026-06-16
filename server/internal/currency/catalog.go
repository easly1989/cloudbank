// Package currency manages per-wallet currencies, the ISO 4217 catalog, and
// manual/fetched exchange rates.
package currency

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed iso4217.json
var catalogJSON []byte

// CatalogEntry is a currency from the embedded ISO 4217 catalog.
type CatalogEntry struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Symbol       string `json:"symbol"`
	FracDigits   int    `json:"fracDigits"`
	SymbolPrefix bool   `json:"symbolPrefix"`
}

var (
	catalog       []CatalogEntry
	catalogByCode map[string]CatalogEntry
)

func init() {
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		panic("currency: invalid embedded catalog: " + err.Error())
	}
	catalogByCode = make(map[string]CatalogEntry, len(catalog))
	for _, e := range catalog {
		catalogByCode[e.Code] = e
	}
}

// Catalog returns the full embedded currency catalog.
func Catalog() []CatalogEntry { return catalog }

// Lookup returns the catalog entry for an ISO code (case-insensitive).
func Lookup(code string) (CatalogEntry, bool) {
	e, ok := catalogByCode[strings.ToUpper(strings.TrimSpace(code))]
	return e, ok
}
