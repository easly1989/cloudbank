package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// ParsedEntry is a natural-language description resolved into transaction fields.
// Category and payee are resolved to real wallet ids only when a name matched;
// an unmatched name is reported but never turned into an invented id.
type ParsedEntry struct {
	Amount       string `json:"amount"`    // decimal string, positive
	Direction    string `json:"direction"` // "expense" | "income"
	Date         string `json:"date"`      // YYYY-MM-DD
	Memo         string `json:"memo"`
	PayeeID      *int64 `json:"payeeId"`
	PayeeName    string `json:"payeeName"`
	CategoryID   *int64 `json:"categoryId"`
	CategoryName string `json:"categoryName"`
}

// rawEntry is the JSON shape requested from the model.
type rawEntry struct {
	Amount    any    `json:"amount"` // number or string
	Direction string `json:"direction"`
	Date      string `json:"date"`
	Payee     string `json:"payee"`
	Category  string `json:"category"`
	Memo      string `json:"memo"`
}

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ParseEntry turns a free-text description into transaction fields using the
// configured model. `today` (YYYY-MM-DD) grounds relative dates.
func (s *Service) ParseEntry(ctx context.Context, userID, walletID int64, text, today string) (*ParsedEntry, error) {
	cfg, err := s.load(ctx, userID)
	if err != nil {
		return nil, err
	}
	if cfg.Enabled == 0 || cfg.ApiKey == "" || cfg.BaseUrl == "" || cfg.Model == "" {
		return nil, ErrNotConfigured
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}

	cats, err := s.rq.ListCategoriesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	catNames, catByName := categoryIndex(cats)
	payees, err := s.rq.ListPayeesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	payeeNames, payeeByName := payeeIndex(payees)

	system := "You convert a short natural-language expense or income description into JSON. " +
		"Reply with ONLY a JSON object (no prose, no code fences) with keys: " +
		"amount (a positive number), direction (\"expense\" or \"income\"), date (\"YYYY-MM-DD\"), " +
		"payee (the merchant or person, or \"\"), category (the best match from the provided list, " +
		"copied verbatim, or \"\"), memo (a short note, or \"\"). Resolve relative dates using today's " +
		"date. If a field is unknown use \"\" (or 0 for amount)."
	reply, err := newClient(cfg.BaseUrl, cfg.ApiKey, cfg.Model, s.hc).chat(ctx, system, entryPrompt(text, today, catNames, payeeNames))
	if err != nil {
		return nil, err
	}
	raw, err := parseJSONObject(reply)
	if err != nil {
		return nil, err
	}

	out := &ParsedEntry{
		Amount:    amountString(raw.Amount),
		Direction: "expense",
		Date:      today,
		Memo:      strings.TrimSpace(raw.Memo),
	}
	if strings.EqualFold(strings.TrimSpace(raw.Direction), "income") {
		out.Direction = "income"
	}
	if d := strings.TrimSpace(raw.Date); dateRe.MatchString(d) {
		out.Date = d
	}
	if c, ok := catByName[normalize(raw.Category)]; ok {
		out.CategoryID, out.CategoryName = &c.ID, c.Name
	}
	if name := strings.TrimSpace(raw.Payee); name != "" {
		out.PayeeName = name
		if id, ok := payeeByName[normalize(name)]; ok {
			out.PayeeID = &id
		}
	}
	return out, nil
}

func payeeIndex(payees []db.Payee) ([]string, map[string]int64) {
	names := make([]string, 0, len(payees))
	byName := make(map[string]int64, len(payees))
	for _, p := range payees {
		names = append(names, p.Name)
		byName[normalize(p.Name)] = p.ID
	}
	return names, byName
}

func entryPrompt(text, today string, categories, payees []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Today: %s\n", today)
	if len(categories) > 0 {
		b.WriteString("Categories:\n")
		for _, n := range categories {
			fmt.Fprintf(&b, "- %s\n", n)
		}
	}
	if len(payees) > 0 {
		b.WriteString("Known payees:\n")
		for _, n := range payees {
			fmt.Fprintf(&b, "- %s\n", n)
		}
	}
	fmt.Fprintf(&b, "\nDescription: %s", text)
	return b.String()
}

// amountString normalizes the model's amount (a number or string) to a positive
// decimal string, or "" when absent.
func amountString(v any) string {
	switch x := v.(type) {
	case float64:
		if x < 0 {
			x = -x
		}
		if x == 0 {
			return ""
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case string:
		return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(x), "-"))
	}
	return ""
}

// parseJSONObject extracts and decodes the first JSON object in the reply,
// tolerating surrounding prose or code fences.
func parseJSONObject(reply string) (rawEntry, error) {
	var e rawEntry
	start := strings.Index(reply, "{")
	end := strings.LastIndex(reply, "}")
	if start < 0 || end <= start {
		return e, fmt.Errorf("ai: no JSON object in reply")
	}
	if err := json.Unmarshal([]byte(reply[start:end+1]), &e); err != nil {
		return e, fmt.Errorf("ai: could not parse reply: %w", err)
	}
	return e, nil
}
