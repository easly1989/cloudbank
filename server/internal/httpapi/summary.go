package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/bills"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/dashboard"
	"github.com/easly1989/cloudbank/server/internal/money"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// summaryHandlers serves the wallet summary for Home Assistant's REST sensors
// (#701): a few numbers read with an API token, balances only when asked for.
type summaryHandlers struct {
	bills        *bills.Service
	budgets      *budget.Service
	transactions *transaction.Service
	dashboard    *dashboard.Service
}

func (h *summaryHandlers) walletRoutes(r chi.Router) {
	r.Get("/summary", h.get)
}

type summaryBill struct {
	Name   string      `json:"name"`
	Date   string      `json:"date"`
	Amount json.Number `json:"amount"`
}

type summaryAccount struct {
	Name     string      `json:"name"`
	Balance  json.Number `json:"balance"`
	Currency string      `json:"currency"`
}

type summaryResponse struct {
	Wallet   string `json:"wallet"`
	Currency string `json:"currency"`
	Today    string `json:"today"`
	Bills    struct {
		Overdue      int          `json:"overdue"`
		DueNext7Days int          `json:"dueNext7Days"`
		Next         *summaryBill `json:"next"`
		TotalDue     json.Number  `json:"totalDue"`
	} `json:"bills"`
	Budget struct {
		Month       string      `json:"month"`
		Budgeted    json.Number `json:"budgeted"`
		Spent       json.Number `json:"spent"`
		Left        json.Number `json:"left"`
		UsedPercent int64       `json:"usedPercent"`
		Over        int         `json:"over"`
	} `json:"budget"`
	Review struct {
		NeedsCategory int `json:"needsCategory"`
		Duplicates    int `json:"duplicates"`
		Unconfirmed   int `json:"unconfirmed"`
	} `json:"review"`
	Balances *struct {
		Total    json.Number      `json:"total"`
		Accounts []summaryAccount `json:"accounts"`
	} `json:"balances,omitempty"`
}

// decimal writes minor units as an exact JSON number ("830.12"), so a sensor
// needs no template to divide; no float is involved.
func decimal(amount int64, fracDigits int) json.Number {
	return json.Number(money.Format(amount, fracDigits, ".", "", "", false))
}

func (h *summaryHandlers) get(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	week := now.AddDate(0, 0, 7).Format("2006-01-02")
	from, to := currentMonth(now)

	bs, err := h.bills.Bills(r.Context(), wl.ID, today)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load bills")
		return
	}
	rep, err := h.budgets.Report(r.Context(), wl.ID, from, to, today)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build budget report")
		return
	}
	rev, err := h.transactions.Review(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not build the review")
		return
	}

	var out summaryResponse
	out.Wallet, out.Today = wl.Title, today
	frac := 2
	if bs.BaseCurrency != nil {
		out.Currency, frac = bs.BaseCurrency.Code, bs.BaseCurrency.FracDigits
	}

	out.Bills.Overdue = bs.Overdue
	out.Bills.TotalDue = decimal(bs.TotalDue, frac)
	for _, b := range bs.Bills {
		if b.State != bills.StateDue {
			continue
		}
		if out.Bills.Next == nil { // due bills come soonest first
			out.Bills.Next = &summaryBill{Name: b.Name, Date: b.DueDate, Amount: decimal(-b.BaseAmount, frac)}
		}
		if b.DueDate <= week {
			out.Bills.DueNext7Days++
		}
	}

	// Spending is negative in the report: shown here as positive amounts.
	budgeted, spent := -rep.TotalBudget, -rep.TotalActual
	out.Budget.Month = from[:7]
	out.Budget.Budgeted = decimal(budgeted, frac)
	out.Budget.Spent = decimal(spent, frac)
	out.Budget.Left = decimal(budgeted-spent, frac)
	if budgeted > 0 {
		out.Budget.UsedPercent = (spent*100 + budgeted/2) / budgeted
	}
	for _, row := range rep.Rows {
		if !row.IsIncome && row.Budgeted && row.Budget < 0 && row.Actual < row.Budget {
			out.Budget.Over++
		}
	}

	out.Review.NeedsCategory = len(rev.NeedsCategory)
	out.Review.Duplicates = len(rev.Duplicates)
	out.Review.Unconfirmed = len(rev.Unconfirmed)

	// Balances say the most about a household, so they leave only when the
	// sensor's URL asks for them.
	if r.URL.Query().Get("balances") == "true" {
		d, err := h.dashboard.Build(r.Context(), wl.ID, from, to, dashboard.GroupByCategory, 1)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not load balances")
			return
		}
		out.Balances = &struct {
			Total    json.Number      `json:"total"`
			Accounts []summaryAccount `json:"accounts"`
		}{Total: decimal(d.Totals.Today, frac), Accounts: []summaryAccount{}}
		// The same accounts the total counts.
		for _, a := range d.Accounts {
			if a.Closed || a.NoSummary {
				continue
			}
			out.Balances.Accounts = append(out.Balances.Accounts, summaryAccount{
				Name: a.Name, Balance: decimal(a.Today, a.Currency.FracDigits), Currency: a.Currency.Code,
			})
		}
	}
	writeJSON(w, http.StatusOK, out)
}
