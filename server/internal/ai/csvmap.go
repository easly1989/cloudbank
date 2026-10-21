package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

// The CSV column mapping (#709): the model reads an unknown bank export's
// column names and three of its rows, and says which column fills which
// field, how its dates and decimals are written and whether expenses are
// positive. A row's text never goes: a cell of words is sent as its shape
// ("text, 3 words"); dates and numbers go as they are, and the gateway hides
// IBANs and card numbers in them like everywhere else.

const (
	csvColumnsMax = 60
	csvRowsMax    = 3
	csvNameMax    = 60
)

// csvFields are the fields a column can fill, as the model is told them.
var csvFields = []string{"date", "amount", "debit", "credit", "payee", "memo", "category", "info", "paymode", "tags"}

// CSVProposal is the model's reading of a file: field → column, the date
// order (iso, dmy, mdy or "" when unsure), the decimal mark and the sign.
type CSVProposal struct {
	Mapping      map[string]int `json:"mapping"`
	DateFormat   string         `json:"dateFormat"`
	DecimalChar  string         `json:"decimalChar"`
	InvertAmount bool           `json:"invertAmount"`
}

// ProposeCSVMapping asks the model to map a file's columns; rows are its
// first data rows. confirm is the user's yes to a call past this month's limit.
func (s *Service) ProposeCSVMapping(ctx context.Context, userID, walletID int64, columns []string, rows [][]string, confirm bool) (CSVProposal, error) {
	if _, err := s.allowed(ctx, userID, walletID, FeatureImport); err != nil {
		return CSVProposal{}, err
	}
	columns = columns[:min(len(columns), csvColumnsMax)]
	reply, err := s.Ask(ctx, Call{
		UserID: userID, WalletID: walletID, Feature: FeatureImport, Confirm: confirm,
		System: csvSystem, User: csvPrompt(columns, rows), MaxTokens: 200,
	})
	if err != nil {
		return CSVProposal{}, err
	}
	return parseCSVReply(reply.Text, len(columns)), nil
}

var csvSystem = "You map the columns of a bank's CSV export to the fields of a personal-finance app: " +
	"date (when the money moved), amount (one signed amount), debit and credit (money out and money in, " +
	"when the file has two columns instead of one amount), payee (who was paid, or paid you), memo (the " +
	"bank's description), category, info (a reference or cheque number), paymode (a payment-mode number) " +
	"and tags. Words in the rows are shown only by their shape, such as \"text, 3 words\". Reply with one " +
	"JSON object and nothing else, such as {\"date\":0,\"amount\":4,\"payee\":3,\"memo\":2," +
	"\"dateFormat\":\"dmy\",\"decimalChar\":\",\",\"invertAmount\":false}: the column number of each field " +
	"you can tell, leaving the others out and using a column once; dateFormat is iso, dmy or mdy; " +
	"decimalChar is . or ,; invertAmount is true when the file writes expenses as positive amounts. " +
	"A running balance is no amount."

var (
	csvDateRe   = regexp.MustCompile(`^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$`)
	csvNumberRe = regexp.MustCompile(`^[-+(]?\s?[€$£]?\s?\d[\d.,' ]*\)?\s?[€$£]?$`)
)

// csvShape is what a cell is sent as: a date or a number as written, words as
// their shape.
func csvShape(cell string) string {
	cell = strings.TrimSpace(cell)
	switch {
	case cell == "":
		return "(empty)"
	case csvDateRe.MatchString(cell), csvNumberRe.MatchString(cell):
		return cell
	}
	n := len(strings.Fields(cell))
	if n == 1 {
		return "text, 1 word"
	}
	return fmt.Sprintf("text, %d words", n)
}

func csvPrompt(columns []string, rows [][]string) string {
	var b strings.Builder
	b.WriteString("Columns:\n")
	for i, c := range columns {
		name := strings.TrimSpace(c)
		if utf8.RuneCountInString(name) > csvNameMax {
			name = string([]rune(name)[:csvNameMax])
		}
		fmt.Fprintf(&b, "%d. %s:", i, name)
		for j, r := range rows {
			if j == csvRowsMax {
				break
			}
			cell := ""
			if i < len(r) {
				cell = r[i]
			}
			if j > 0 {
				b.WriteString(" |")
			}
			b.WriteString(" " + csvShape(cell))
		}
		b.WriteString("\n")
	}
	return b.String()
}

// parseCSVReply reads the model's object; a field on a column out of range or
// already taken, an unknown date order or mark are left out. One amount wins
// over debit and credit.
func parseCSVReply(reply string, n int) CSVProposal {
	out := CSVProposal{Mapping: map[string]int{}}
	start, end := strings.Index(reply, "{"), strings.LastIndex(reply, "}")
	if start < 0 || end <= start {
		return out
	}
	var raw map[string]any
	if json.Unmarshal([]byte(reply[start:end+1]), &raw) != nil {
		return out
	}
	used := map[int]bool{}
	for _, f := range csvFields {
		v, ok := raw[f].(float64)
		if !ok || v != math.Trunc(v) || v < 0 || int(v) >= n || used[int(v)] {
			continue
		}
		used[int(v)] = true
		out.Mapping[f] = int(v)
	}
	if _, ok := out.Mapping["amount"]; ok {
		delete(out.Mapping, "debit")
		delete(out.Mapping, "credit")
	}
	if d, _ := raw["dateFormat"].(string); d == "iso" || d == "dmy" || d == "mdy" {
		out.DateFormat = d
	}
	out.DecimalChar = "."
	if d, _ := raw["decimalChar"].(string); d == "," {
		out.DecimalChar = d
	}
	out.InvertAmount, _ = raw["invertAmount"].(bool)
	return out
}
