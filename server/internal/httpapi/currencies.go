package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/currency"
)

// currencyHandlers serves the currency catalog and per-wallet currency
// management. Wallet-scoped routes run inside the walletContext middleware.
type currencyHandlers struct {
	svc      *currency.Service
	provider currency.RateProvider
}

type currencyResponse struct {
	ID            int64   `json:"id"`
	IsoCode       string  `json:"isoCode"`
	Name          string  `json:"name"`
	Symbol        string  `json:"symbol"`
	SymbolPrefix  bool    `json:"symbolPrefix"`
	DecimalChar   string  `json:"decimalChar"`
	GroupChar     string  `json:"groupChar"`
	FracDigits    int     `json:"fracDigits"`
	IsBase        bool    `json:"isBase"`
	Rate          float64 `json:"rate"`
	RateUpdatedAt string  `json:"rateUpdatedAt,omitempty"`
}

func toCurrencyResponse(c currency.Currency) currencyResponse {
	return currencyResponse{
		ID: c.ID, IsoCode: c.IsoCode, Name: c.Name, Symbol: c.Symbol,
		SymbolPrefix: c.SymbolPrefix, DecimalChar: c.DecimalChar, GroupChar: c.GroupChar,
		FracDigits: c.FracDigits, IsBase: c.IsBase, Rate: c.Rate, RateUpdatedAt: c.RateUpdatedAt,
	}
}

// catalog returns the embedded ISO 4217 catalog. It is not wallet-scoped.
func (h *currencyHandlers) catalog(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, currency.Catalog())
}

// walletRoutes registers the wallet-scoped currency endpoints; the wallet is
// already resolved/authorized by walletContext.
func (h *currencyHandlers) walletRoutes(r chi.Router) {
	r.Get("/currencies", h.list)
	r.Post("/currencies", h.add)
	r.Post("/currencies/refresh", h.refresh)
	r.Route("/currencies/{currencyId}", func(r chi.Router) {
		r.Patch("/", h.update)
		r.Post("/base", h.setBase)
		r.Delete("/", h.delete)
		r.Get("/rates", h.rates)
	})
}

func (h *currencyHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	list, err := h.svc.ListForWallet(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list currencies")
		return
	}
	out := make([]currencyResponse, 0, len(list))
	for _, c := range list {
		out = append(out, toCurrencyResponse(c))
	}
	writeJSON(w, http.StatusOK, out)
}

// refresh fetches the latest online rates for the wallet's currencies. It always
// returns 200 with a result; provider failures are reported in the body
// (manual rates are kept) so the UI can surface staleness.
func (h *currencyHandlers) refresh(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	res, err := h.svc.RefreshRates(r.Context(), wl.ID, h.provider)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not refresh rates")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *currencyHandlers) add(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in struct {
		IsoCode  string `json:"isoCode"`
		MakeBase bool   `json:"makeBase"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	c, err := h.svc.AddCurrency(r.Context(), wl.ID, in.IsoCode, in.MakeBase)
	switch {
	case errors.Is(err, currency.ErrUnknownCode):
		writeError(w, http.StatusBadRequest, "unknown_code", "unknown currency code")
		return
	case errors.Is(err, currency.ErrDuplicate):
		writeError(w, http.StatusConflict, "duplicate", "currency already added")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", "could not add currency")
		return
	}
	writeJSON(w, http.StatusCreated, toCurrencyResponse(c))
}

// currencyFromPath loads the {currencyId} and verifies it belongs to the
// wallet in context (else 404).
func (h *currencyHandlers) currencyFromPath(w http.ResponseWriter, r *http.Request) (currency.Currency, bool) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "currencyId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "currency not found")
		return currency.Currency{}, false
	}
	c, err := h.svc.Get(r.Context(), id)
	if errors.Is(err, currency.ErrNotFound) || (err == nil && c.WalletID != wl.ID) {
		writeError(w, http.StatusNotFound, "not_found", "currency not found")
		return currency.Currency{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load currency")
		return currency.Currency{}, false
	}
	return c, true
}

func (h *currencyHandlers) update(w http.ResponseWriter, r *http.Request) {
	c, ok := h.currencyFromPath(w, r)
	if !ok {
		return
	}
	var in struct {
		Rate         *float64 `json:"rate"`
		Symbol       *string  `json:"symbol"`
		SymbolPrefix *bool    `json:"symbolPrefix"`
		DecimalChar  *string  `json:"decimalChar"`
		GroupChar    *string  `json:"groupChar"`
		FracDigits   *int     `json:"fracDigits"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}

	// Format fields are merged with the current values.
	if in.Symbol != nil || in.SymbolPrefix != nil || in.DecimalChar != nil || in.GroupChar != nil || in.FracDigits != nil {
		sym, pre, dec, grp, frac := c.Symbol, c.SymbolPrefix, c.DecimalChar, c.GroupChar, c.FracDigits
		if in.Symbol != nil {
			sym = *in.Symbol
		}
		if in.SymbolPrefix != nil {
			pre = *in.SymbolPrefix
		}
		if in.DecimalChar != nil {
			dec = *in.DecimalChar
		}
		if in.GroupChar != nil {
			grp = *in.GroupChar
		}
		if in.FracDigits != nil {
			frac = *in.FracDigits
		}
		if err := h.svc.UpdateFormat(r.Context(), c.ID, sym, pre, dec, grp, frac); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not update currency")
			return
		}
	}
	if in.Rate != nil {
		if err := h.svc.UpdateRate(r.Context(), c.ID, *in.Rate); err != nil {
			if errors.Is(err, currency.ErrBaseCurrency) {
				writeError(w, http.StatusBadRequest, "base_currency", "the base currency rate is always 1")
				return
			}
			writeError(w, http.StatusInternalServerError, "internal", "could not update rate")
			return
		}
	}
	updated, err := h.svc.Get(r.Context(), c.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load currency")
		return
	}
	writeJSON(w, http.StatusOK, toCurrencyResponse(updated))
}

func (h *currencyHandlers) setBase(w http.ResponseWriter, r *http.Request) {
	c, ok := h.currencyFromPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.SetBase(r.Context(), c.WalletID, c.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not set base currency")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *currencyHandlers) delete(w http.ResponseWriter, r *http.Request) {
	c, ok := h.currencyFromPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), c.ID); err != nil {
		if errors.Is(err, currency.ErrBaseCurrency) {
			writeError(w, http.StatusBadRequest, "base_currency", "the base currency cannot be deleted")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not delete currency")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *currencyHandlers) rates(w http.ResponseWriter, r *http.Request) {
	c, ok := h.currencyFromPath(w, r)
	if !ok {
		return
	}
	history, err := h.svc.RateHistory(r.Context(), c.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load rate history")
		return
	}
	writeJSON(w, http.StatusOK, history)
}
