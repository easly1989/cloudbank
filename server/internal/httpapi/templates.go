package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/template"
)

// templateHandlers serves wallet-scoped template endpoints (mounted inside the
// walletContext middleware).
type templateHandlers struct {
	svc *template.Service
}

func (h *templateHandlers) walletRoutes(r chi.Router) {
	r.Get("/templates", h.list)
	r.Post("/templates", h.create)
	r.Post("/templates/from-transaction/{transactionId}", h.fromTransaction)
	r.Route("/templates/{templateId}", func(r chi.Router) {
		r.Get("/", h.get)
		r.Patch("/", h.update)
		r.Delete("/", h.delete)
	})
}

type templateInput struct {
	Name        string           `json:"name"`
	AccountID   *int64           `json:"accountId"`
	Amount      int64            `json:"amount"`
	PaymentMode int              `json:"paymentMode"`
	Status      int              `json:"status"`
	Info        string           `json:"info"`
	PayeeID     *int64           `json:"payeeId"`
	CategoryID  *int64           `json:"categoryId"`
	Memo        string           `json:"memo"`
	Tags        []string         `json:"tags"`
	IsTransfer  bool             `json:"isTransfer"`
	ToAccountID *int64           `json:"toAccountId"`
	Splits      []template.Split `json:"splits"`
}

func (in templateInput) toServiceInput() template.Input {
	return template.Input{
		Name: in.Name, AccountID: in.AccountID, Amount: in.Amount, PaymentMode: in.PaymentMode,
		Status: in.Status, Info: in.Info, PayeeID: in.PayeeID, CategoryID: in.CategoryID,
		Memo: in.Memo, Tags: in.Tags, IsTransfer: in.IsTransfer, ToAccountID: in.ToAccountID,
		Splits: in.Splits,
	}
}

func (h *templateHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	templates, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list templates")
		return
	}
	writeJSON(w, http.StatusOK, templates)
}

func (h *templateHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in templateInput
	if !decodeJSON(w, r, &in) {
		return
	}
	tpl, err := h.svc.Create(r.Context(), wl.ID, in.toServiceInput())
	if !writeTemplateError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, tpl)
}

func (h *templateHandlers) fromTransaction(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	txnID, err := strconv.ParseInt(chi.URLParam(r, "transactionId"), 10, 64)
	if err != nil || txnID <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "transaction not found")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	tpl, err := h.svc.CreateFromTransaction(r.Context(), wl.ID, txnID, body.Name)
	if !writeTemplateError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, tpl)
}

func (h *templateHandlers) get(w http.ResponseWriter, r *http.Request) {
	tpl, ok := h.templateFromPath(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, tpl)
}

func (h *templateHandlers) update(w http.ResponseWriter, r *http.Request) {
	current, ok := h.templateFromPath(w, r)
	if !ok {
		return
	}
	wl, _ := walletFromContext(r.Context())
	var in templateInput
	if !decodeJSON(w, r, &in) {
		return
	}
	tpl, err := h.svc.Update(r.Context(), wl.ID, current.ID, in.toServiceInput())
	if !writeTemplateError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, tpl)
}

func (h *templateHandlers) delete(w http.ResponseWriter, r *http.Request) {
	tpl, ok := h.templateFromPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), tpl.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete template")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// templateFromPath loads {templateId} and verifies it belongs to the wallet in
// context (else 404).
func (h *templateHandlers) templateFromPath(w http.ResponseWriter, r *http.Request) (template.Template, bool) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "templateId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "template not found")
		return template.Template{}, false
	}
	walletID, err := h.svc.WalletOf(r.Context(), id)
	if errors.Is(err, template.ErrNotFound) || (err == nil && walletID != wl.ID) {
		writeError(w, http.StatusNotFound, "not_found", "template not found")
		return template.Template{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load template")
		return template.Template{}, false
	}
	tpl, err := h.svc.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load template")
		return template.Template{}, false
	}
	return tpl, true
}

func writeTemplateError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "could not save template",
		errCase{template.ErrNotFound, http.StatusNotFound, "not_found", "template not found"},
		errCase{template.ErrNameRequired, http.StatusBadRequest, "name_required", "name is required"},
		errCase{template.ErrInvalidAccount, http.StatusBadRequest, "invalid_account", "account does not belong to this wallet"},
	)
}
