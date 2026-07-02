package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/account"
)

// accountHandlers serves the wallet-scoped account endpoints (mounted inside
// the walletContext middleware).
type accountHandlers struct {
	svc *account.Service
}

type accountResponse struct {
	ID                 int64  `json:"id"`
	Name               string `json:"name"`
	Type               string `json:"type"`
	CurrencyID         int64  `json:"currencyId"`
	Institution        string `json:"institution"`
	Number             string `json:"number"`
	InitialBalance     int64  `json:"initialBalance"`
	MinimumBalance     int64  `json:"minimumBalance"`
	Balance            int64  `json:"balance"`
	FutureBalance      int64  `json:"futureBalance"`
	Closed             bool   `json:"closed"`
	NoSummary          bool   `json:"noSummary"`
	NoBudget           bool   `json:"noBudget"`
	NoReport           bool   `json:"noReport"`
	Position           int64  `json:"position"`
	GroupName          string `json:"groupName"`
	Notes              string `json:"notes"`
	Website            string `json:"website"`
	DefaultPaymentMode int64  `json:"defaultPaymentMode"`
	CreatedAt          string `json:"createdAt"`

	CurrencyCode         string `json:"currencyCode"`
	CurrencySymbol       string `json:"currencySymbol"`
	CurrencySymbolPrefix bool   `json:"currencySymbolPrefix"`
	CurrencyDecimalChar  string `json:"currencyDecimalChar"`
	CurrencyGroupChar    string `json:"currencyGroupChar"`
	CurrencyFracDigits   int    `json:"currencyFracDigits"`
}

func toAccountResponse(a account.Account) accountResponse {
	return accountResponse{
		ID: a.ID, Name: a.Name, Type: a.Type, CurrencyID: a.CurrencyID,
		Institution: a.Institution, Number: a.Number,
		InitialBalance: a.InitialBalance, MinimumBalance: a.MinimumBalance, Balance: a.Balance,
		FutureBalance: a.FutureBalance,
		Closed:        a.Closed, NoSummary: a.NoSummary, NoBudget: a.NoBudget, NoReport: a.NoReport,
		Position: a.Position, GroupName: a.GroupName, Notes: a.Notes, Website: a.Website,
		DefaultPaymentMode: a.DefaultPaymentMode, CreatedAt: a.CreatedAt,
		CurrencyCode: a.CurrencyCode, CurrencySymbol: a.CurrencySymbol, CurrencySymbolPrefix: a.CurrencySymbolPrefix,
		CurrencyDecimalChar: a.CurrencyDecimalChar, CurrencyGroupChar: a.CurrencyGroupChar,
		CurrencyFracDigits: a.CurrencyFracDigits,
	}
}

func (h *accountHandlers) walletRoutes(r chi.Router) {
	r.Get("/accounts", h.list)
	r.Post("/accounts", h.create)
	r.Post("/accounts/reorder", h.reorder)
	r.Route("/accounts/{accountId}", func(r chi.Router) {
		r.Get("/", h.get)
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
	})
}

func (h *accountHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	accounts, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list accounts")
		return
	}
	out := make([]accountResponse, 0, len(accounts))
	for _, a := range accounts {
		out = append(out, toAccountResponse(a))
	}
	writeJSON(w, http.StatusOK, out)
}

type accountInput struct {
	Name               string `json:"name"`
	Type               string `json:"type"`
	CurrencyID         int64  `json:"currencyId"`
	Institution        string `json:"institution"`
	Number             string `json:"number"`
	InitialBalance     int64  `json:"initialBalance"`
	MinimumBalance     int64  `json:"minimumBalance"`
	Closed             bool   `json:"closed"`
	NoSummary          bool   `json:"noSummary"`
	NoBudget           bool   `json:"noBudget"`
	NoReport           bool   `json:"noReport"`
	GroupName          string `json:"groupName"`
	Notes              string `json:"notes"`
	Website            string `json:"website"`
	DefaultPaymentMode int64  `json:"defaultPaymentMode"`
}

func (in accountInput) toServiceInput() account.Input {
	return account.Input{
		Name: in.Name, Type: in.Type, CurrencyID: in.CurrencyID,
		Institution: in.Institution, Number: in.Number,
		InitialBalance: in.InitialBalance, MinimumBalance: in.MinimumBalance,
		Closed: in.Closed, NoSummary: in.NoSummary, NoBudget: in.NoBudget, NoReport: in.NoReport,
		GroupName: in.GroupName, Notes: in.Notes, Website: in.Website,
		DefaultPaymentMode: in.DefaultPaymentMode,
	}
}

func (h *accountHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in accountInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if !validateAccount(w, &in, wl.BaseCurrencyID) {
		return
	}
	a, err := h.svc.Create(r.Context(), wl.ID, in.toServiceInput())
	if !h.writeAccountError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, toAccountResponse(a))
}

func (h *accountHandlers) get(w http.ResponseWriter, r *http.Request) {
	a, ok := h.accountFromPath(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toAccountResponse(a))
}

func (h *accountHandlers) update(w http.ResponseWriter, r *http.Request) {
	current, ok := h.accountFromPath(w, r)
	if !ok {
		return
	}
	wl, _ := walletFromContext(r.Context())
	var in accountInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if !validateAccount(w, &in, wl.BaseCurrencyID) {
		return
	}
	a, err := h.svc.Update(r.Context(), wl.ID, current.ID, in.toServiceInput())
	if !h.writeAccountError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, toAccountResponse(a))
}

func (h *accountHandlers) delete(w http.ResponseWriter, r *http.Request) {
	a, ok := h.accountFromPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), a.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *accountHandlers) reorder(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in []struct {
		ID        int64  `json:"id"`
		Position  int64  `json:"position"`
		GroupName string `json:"groupName"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	// Verify every account belongs to this wallet before applying.
	updates := make([]account.PositionUpdate, 0, len(in))
	for _, u := range in {
		a, err := h.svc.Get(r.Context(), u.ID)
		if errors.Is(err, account.ErrNotFound) || (err == nil && a.WalletID != wl.ID) {
			writeError(w, http.StatusNotFound, "not_found", "account not found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not reorder accounts")
			return
		}
		updates = append(updates, account.PositionUpdate{ID: u.ID, Position: u.Position, GroupName: u.GroupName})
	}
	if err := h.svc.Reorder(r.Context(), updates); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not reorder accounts")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// accountFromPath loads {accountId} and verifies it belongs to the wallet in
// context (else 404).
func (h *accountHandlers) accountFromPath(w http.ResponseWriter, r *http.Request) (account.Account, bool) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "accountId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "account not found")
		return account.Account{}, false
	}
	a, err := h.svc.Get(r.Context(), id)
	if errors.Is(err, account.ErrNotFound) || (err == nil && a.WalletID != wl.ID) {
		writeError(w, http.StatusNotFound, "not_found", "account not found")
		return account.Account{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load account")
		return account.Account{}, false
	}
	return a, true
}

// validateAccount checks the type and fills a default currency (the wallet base)
// when none is given. Returns false (and writes an error) on invalid input.
func validateAccount(w http.ResponseWriter, in *accountInput, baseCurrencyID *int64) bool {
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid", "name is required")
		return false
	}
	if !account.ValidType(in.Type) {
		writeError(w, http.StatusBadRequest, "invalid_type", "invalid account type")
		return false
	}
	if in.DefaultPaymentMode < 0 || in.DefaultPaymentMode > 11 {
		writeError(w, http.StatusBadRequest, "invalid", "invalid default payment mode")
		return false
	}
	if in.CurrencyID == 0 {
		if baseCurrencyID == nil {
			writeError(w, http.StatusBadRequest, "invalid", "a currency is required")
			return false
		}
		in.CurrencyID = *baseCurrencyID
	}
	return true
}

// writeAccountError maps service errors to responses; returns true when there
// was no error.
func (h *accountHandlers) writeAccountError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, account.ErrCurrencyNotInWallet):
		writeError(w, http.StatusBadRequest, "invalid_currency", "currency does not belong to this wallet")
	case errors.Is(err, account.ErrDuplicateName):
		writeError(w, http.StatusConflict, "duplicate", "an account with that name already exists")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not save account")
	}
	return false
}
