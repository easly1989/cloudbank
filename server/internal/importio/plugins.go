package importio

// ImportPlugin describes a bank-specific statement importer. Each plugin parses
// an uploaded file into normalized Rows; the shared preview/commit pipeline
// (PreviewParsed/Commit) then handles duplicate flagging, import rules and
// persistence — so a plugin only needs a parser, and need not be Excel-based.
type ImportPlugin struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Country string   `json:"country"`
	Bank    string   `json:"bank"`
	Accept  []string `json:"accept"` // file extensions for the picker, e.g. [".xlsx"]

	// Parse turns the uploaded file bytes into normalized rows. Not serialized.
	Parse func([]byte) ([]Row, error) `json:"-"`
}

// plugins is the registry of available import plugins. Add an entry here (and a
// Parse function) to support another bank/format.
var plugins = []ImportPlugin{
	{
		ID:      "intesa-sanpaolo-xlsx",
		Label:   "Intesa Sanpaolo — Excel (Movimenti Conto)",
		Country: "IT",
		Bank:    "Intesa Sanpaolo",
		Accept:  []string{".xlsx"},
		Parse:   ParseIntesaXLSX,
	},
}

// Plugins returns the registered import plugins.
func Plugins() []ImportPlugin { return plugins }

// PluginByID returns the plugin with the given id, if registered.
func PluginByID(id string) (ImportPlugin, bool) {
	for _, p := range plugins {
		if p.ID == id {
			return p, true
		}
	}
	return ImportPlugin{}, false
}
