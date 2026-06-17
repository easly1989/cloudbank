package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/category"
	"github.com/easly1989/cloudbank/server/internal/currency"
	"github.com/easly1989/cloudbank/server/internal/dashboard"
	"github.com/easly1989/cloudbank/server/internal/payee"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
	"github.com/easly1989/cloudbank/server/internal/wallet"
)

const walletCtxKey ctxKey = iota + 1

// walletHandlers serves the wallet CRUD endpoints. They are mounted inside the
// authenticated API group, so the current user is always in context.
type walletHandlers struct {
	svc          *wallet.Service
	currencies   *currency.Service
	accounts     *account.Service
	categories   *category.Service
	payees       *payee.Service
	transactions *transaction.Service
	transfers    *transfer.Service
	dashboard    *dashboard.Service
}

type walletResponse struct {
	ID             int64  `json:"id"`
	Title          string `json:"title"`
	OwnerName      string `json:"ownerName"`
	BaseCurrencyID *int64 `json:"baseCurrencyId,omitempty"`
	Role           string `json:"role"`
	CreatedAt      string `json:"createdAt"`
}

func toWalletResponse(w wallet.Wallet) walletResponse {
	return walletResponse{
		ID: w.ID, Title: w.Title, OwnerName: w.OwnerName,
		BaseCurrencyID: w.BaseCurrencyID, Role: w.Role, CreatedAt: w.CreatedAt,
	}
}

func (h *walletHandlers) routes(r chi.Router) {
	r.Get("/wallets", h.list)
	r.Post("/wallets", h.create)
	r.Route("/wallets/{walletId}", func(r chi.Router) {
		r.Use(h.walletContext)
		r.Get("/", h.get)
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
		if h.currencies != nil {
			(&currencyHandlers{svc: h.currencies}).walletRoutes(r)
		}
		if h.accounts != nil {
			(&accountHandlers{svc: h.accounts}).walletRoutes(r)
		}
		if h.categories != nil {
			(&categoryHandlers{svc: h.categories}).walletRoutes(r)
		}
		if h.payees != nil {
			(&payeeHandlers{svc: h.payees}).walletRoutes(r)
		}
		if h.transactions != nil {
			(&transactionHandlers{svc: h.transactions}).walletRoutes(r)
		}
		if h.transfers != nil {
			(&transferHandlers{svc: h.transfers}).walletRoutes(r)
		}
		if h.dashboard != nil {
			(&dashboardHandlers{svc: h.dashboard}).walletRoutes(r)
		}
	})
}

func (h *walletHandlers) list(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	wallets, err := h.svc.List(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list wallets")
		return
	}
	out := make([]walletResponse, 0, len(wallets))
	for _, wl := range wallets {
		out = append(out, toWalletResponse(wl))
	}
	writeJSON(w, http.StatusOK, out)
}

type walletInput struct {
	Title        string `json:"title"`
	OwnerName    string `json:"ownerName"`
	BaseCurrency string `json:"baseCurrency"`
}

func (h *walletHandlers) create(w http.ResponseWriter, r *http.Request) {
	var in walletInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		writeError(w, http.StatusBadRequest, "invalid", "title is required")
		return
	}

	// Resolve the base currency (default EUR) up front so we never create a
	// wallet with an invalid currency code.
	baseCode := strings.TrimSpace(in.BaseCurrency)
	if baseCode == "" {
		baseCode = "EUR"
	}
	if h.currencies != nil {
		if _, ok := currency.Lookup(baseCode); !ok {
			writeError(w, http.StatusBadRequest, "unknown_code", "unknown base currency code")
			return
		}
	}

	user := userFromContext(r.Context())
	wl, err := h.svc.Create(r.Context(), user.ID, strings.TrimSpace(in.Title), strings.TrimSpace(in.OwnerName))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not create wallet")
		return
	}
	if h.currencies != nil {
		if _, err := h.currencies.AddCurrency(r.Context(), wl.ID, baseCode, true); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not set base currency")
			return
		}
	}
	writeJSON(w, http.StatusCreated, toWalletResponse(wl))
}

func (h *walletHandlers) get(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	writeJSON(w, http.StatusOK, toWalletResponse(wl))
}

func (h *walletHandlers) update(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	if wl.Role != wallet.RoleOwner {
		writeError(w, http.StatusForbidden, "forbidden", "only the wallet owner can change it")
		return
	}
	var in walletInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		writeError(w, http.StatusBadRequest, "invalid", "title is required")
		return
	}
	wl.Title = strings.TrimSpace(in.Title)
	wl.OwnerName = strings.TrimSpace(in.OwnerName)
	if err := h.svc.Update(r.Context(), wl.ID, wl.Title, wl.OwnerName); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not update wallet")
		return
	}
	writeJSON(w, http.StatusOK, toWalletResponse(wl))
}

func (h *walletHandlers) delete(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	if wl.Role != wallet.RoleOwner {
		writeError(w, http.StatusForbidden, "forbidden", "only the wallet owner can delete it")
		return
	}
	if err := h.svc.Delete(r.Context(), wl.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete wallet")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// walletContext resolves {walletId}, verifies the current user is a member, and
// stashes the wallet (with the user's role) in the request context. Non-members
// get 404 so wallet existence is not leaked across users.
func (h *walletHandlers) walletContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "walletId"), 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusNotFound, "not_found", "wallet not found")
			return
		}
		user := userFromContext(r.Context())
		role, ok, err := h.svc.Membership(r.Context(), id, user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not check access")
			return
		}
		if !ok {
			writeError(w, http.StatusNotFound, "not_found", "wallet not found")
			return
		}
		wl, err := h.svc.Get(r.Context(), id)
		if errors.Is(err, wallet.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "wallet not found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not load wallet")
			return
		}
		wl.Role = role
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), walletCtxKey, wl)))
	})
}

func walletFromContext(ctx context.Context) (wallet.Wallet, bool) {
	wl, ok := ctx.Value(walletCtxKey).(wallet.Wallet)
	return wl, ok
}
