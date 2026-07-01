package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// transactionHandlers serves wallet-scoped transaction and tag endpoints
// (mounted inside the walletContext middleware).
type transactionHandlers struct {
	svc *transaction.Service
}

func (h *transactionHandlers) walletRoutes(r chi.Router) {
	r.Get("/tags", h.listTags)
	r.Get("/tags/manage", h.listTagsUsage)
	r.Patch("/tags/{tagId}", h.renameTag)
	r.Post("/tags/{tagId}/merge", h.mergeTag)
	r.Delete("/tags/{tagId}", h.deleteTag)
	r.Get("/vehicles", h.listVehicles)
	r.Post("/vehicles", h.createVehicle)
	r.Patch("/vehicles/{vehicleId}", h.updateVehicle)
	r.Delete("/vehicles/{vehicleId}", h.deleteVehicle)
	r.Get("/transactions", h.list)
	r.Post("/transactions", h.create)
	r.Post("/transactions/bulk", h.bulk)
	r.Get("/transactions/register", h.register)
	r.Get("/transactions/duplicates", h.duplicates)
	r.Route("/transactions/{transactionId}", func(r chi.Router) {
		r.Get("/", h.get)
		r.Patch("/", h.update)
		r.Patch("/status", h.setStatus)
		r.Delete("/", h.delete)
	})
}

func (h *transactionHandlers) register(w http.ResponseWriter, r *http.Request) {
	accountID, ok := h.requireAccountInWallet(w, r)
	if !ok {
		return
	}
	rows, summary, err := h.svc.Register(r.Context(), accountID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load register")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows, "summary": summary})
}

func (h *transactionHandlers) bulk(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var body struct {
		IDs   []int64 `json:"ids"`
		Field string  `json:"field"`
		Value *int64  `json:"value"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if len(body.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "invalid", "ids is required")
		return
	}
	n, err := h.svc.BulkUpdate(r.Context(), wl.ID, body.IDs, body.Field, body.Value)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]int{"updated": n})
	case errors.Is(err, transaction.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "transaction, category or payee not found")
	case errors.Is(err, transaction.ErrInvalidBulkField):
		writeError(w, http.StatusBadRequest, "invalid_field", "invalid bulk field")
	case errors.Is(err, transaction.ErrInvalidStatus):
		writeError(w, http.StatusBadRequest, "invalid_status", "invalid status")
	case errors.Is(err, transaction.ErrInvalidPaymentMode):
		writeError(w, http.StatusBadRequest, "invalid_payment_mode", "invalid payment mode")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not apply bulk edit")
	}
}

func (h *transactionHandlers) setStatus(w http.ResponseWriter, r *http.Request) {
	t, ok := h.transactionFromPath(w, r)
	if !ok {
		return
	}
	var body struct {
		Status int `json:"status"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.svc.SetStatus(r.Context(), t.ID, body.Status); err != nil {
		if errors.Is(err, transaction.ErrInvalidStatus) {
			writeError(w, http.StatusBadRequest, "invalid_status", "invalid status")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not update status")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *transactionHandlers) listTags(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	tags, err := h.svc.ListTags(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list tags")
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (h *transactionHandlers) listTagsUsage(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	tags, err := h.svc.ListTagsWithCounts(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list tags")
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func tagIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "tagId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "tag not found")
		return 0, false
	}
	return id, true
}

func writeTagError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, transaction.ErrTagNotFound):
		writeError(w, http.StatusNotFound, "not_found", "tag not found")
	case errors.Is(err, transaction.ErrTagDuplicate):
		writeError(w, http.StatusConflict, "conflict", "a tag with that name already exists")
	case errors.Is(err, transaction.ErrTagInvalid):
		writeError(w, http.StatusBadRequest, "invalid", "invalid tag name or merge target")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not update tag")
	}
	return false
}

func (h *transactionHandlers) renameTag(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := tagIDParam(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !writeTagError(w, h.svc.RenameTag(r.Context(), wl.ID, id, in.Name)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *transactionHandlers) mergeTag(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := tagIDParam(w, r)
	if !ok {
		return
	}
	var in struct {
		TargetID int64 `json:"targetId"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !writeTagError(w, h.svc.MergeTags(r.Context(), wl.ID, id, in.TargetID)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *transactionHandlers) deleteTag(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := tagIDParam(w, r)
	if !ok {
		return
	}
	if !writeTagError(w, h.svc.DeleteTag(r.Context(), wl.ID, id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type vehicleInput struct {
	Name  string `json:"name"`
	Plate string `json:"plate"`
	Notes string `json:"notes"`
}

func writeVehicleError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, transaction.ErrVehicleNotFound):
		writeError(w, http.StatusNotFound, "not_found", "vehicle not found")
	case errors.Is(err, transaction.ErrVehicleDuplicate):
		writeError(w, http.StatusConflict, "conflict", "a vehicle with that name already exists")
	case errors.Is(err, transaction.ErrVehicleInvalid):
		writeError(w, http.StatusBadRequest, "invalid", "vehicle name is required")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not save vehicle")
	}
	return false
}

func vehicleIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "vehicleId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "vehicle not found")
		return 0, false
	}
	return id, true
}

func (h *transactionHandlers) listVehicles(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	out, err := h.svc.ListVehicles(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list vehicles")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *transactionHandlers) createVehicle(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in vehicleInput
	if !decodeJSON(w, r, &in) {
		return
	}
	v, err := h.svc.CreateVehicle(r.Context(), wl.ID, in.Name, in.Plate, in.Notes)
	if !writeVehicleError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (h *transactionHandlers) updateVehicle(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := vehicleIDParam(w, r)
	if !ok {
		return
	}
	var in vehicleInput
	if !decodeJSON(w, r, &in) {
		return
	}
	v, err := h.svc.UpdateVehicle(r.Context(), wl.ID, id, in.Name, in.Plate, in.Notes)
	if !writeVehicleError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (h *transactionHandlers) deleteVehicle(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := vehicleIDParam(w, r)
	if !ok {
		return
	}
	if !writeVehicleError(w, h.svc.DeleteVehicle(r.Context(), wl.ID, id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// requireAccountInWallet validates the accountId query param against the wallet.
func (h *transactionHandlers) requireAccountInWallet(w http.ResponseWriter, r *http.Request) (int64, bool) {
	wl, _ := walletFromContext(r.Context())
	accountID, err := strconv.ParseInt(r.URL.Query().Get("accountId"), 10, 64)
	if err != nil || accountID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid", "accountId is required")
		return 0, false
	}
	ok, err := h.svc.AccountInWallet(r.Context(), wl.ID, accountID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not check account")
		return 0, false
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "account not found")
		return 0, false
	}
	return accountID, true
}

func (h *transactionHandlers) list(w http.ResponseWriter, r *http.Request) {
	accountID, ok := h.requireAccountInWallet(w, r)
	if !ok {
		return
	}
	limit := queryInt(r, "limit", 100)
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	offset := queryInt(r, "offset", 0)
	txns, total, err := h.svc.List(r.Context(), accountID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list transactions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": txns, "total": total})
}

func (h *transactionHandlers) duplicates(w http.ResponseWriter, r *http.Request) {
	accountID, ok := h.requireAccountInWallet(w, r)
	if !ok {
		return
	}
	date := r.URL.Query().Get("date")
	amount, err := strconv.ParseInt(r.URL.Query().Get("amount"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid", "amount is required")
		return
	}
	dups, err := h.svc.FindDuplicates(r.Context(), accountID, date, amount, 3)
	if errors.Is(err, transaction.ErrInvalidDate) {
		writeError(w, http.StatusBadRequest, "invalid", "invalid date")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not check duplicates")
		return
	}
	writeJSON(w, http.StatusOK, dups)
}

type transactionInput struct {
	AccountID   int64               `json:"accountId"`
	Date        string              `json:"date"`
	Amount      int64               `json:"amount"`
	PaymentMode int                 `json:"paymentMode"`
	Status      int                 `json:"status"`
	Info        string              `json:"info"`
	PayeeID     *int64              `json:"payeeId"`
	CategoryID  *int64              `json:"categoryId"`
	VehicleID   *int64              `json:"vehicleId"`
	Memo        string              `json:"memo"`
	Tags        []string            `json:"tags"`
	Splits      []transaction.Split `json:"splits"`
}

func (in transactionInput) toServiceInput() transaction.Input {
	return transaction.Input{
		AccountID: in.AccountID, Date: in.Date, Amount: in.Amount, PaymentMode: in.PaymentMode,
		Status: in.Status, Info: in.Info, PayeeID: in.PayeeID, CategoryID: in.CategoryID,
		VehicleID: in.VehicleID, Memo: in.Memo, Tags: in.Tags, Splits: in.Splits,
	}
}

func (h *transactionHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in transactionInput
	if !decodeJSON(w, r, &in) {
		return
	}
	t, err := h.svc.Create(r.Context(), wl.ID, in.toServiceInput())
	if !writeTransactionError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (h *transactionHandlers) get(w http.ResponseWriter, r *http.Request) {
	t, ok := h.transactionFromPath(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *transactionHandlers) update(w http.ResponseWriter, r *http.Request) {
	current, ok := h.transactionFromPath(w, r)
	if !ok {
		return
	}
	wl, _ := walletFromContext(r.Context())
	var in transactionInput
	if !decodeJSON(w, r, &in) {
		return
	}
	t, err := h.svc.Update(r.Context(), wl.ID, current.ID, in.toServiceInput())
	if !writeTransactionError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *transactionHandlers) delete(w http.ResponseWriter, r *http.Request) {
	t, ok := h.transactionFromPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), t.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete transaction")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// transactionFromPath loads {transactionId} and verifies it belongs to the
// wallet in context (else 404).
func (h *transactionHandlers) transactionFromPath(w http.ResponseWriter, r *http.Request) (transaction.Transaction, bool) {
	wl, _ := walletFromContext(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "transactionId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "transaction not found")
		return transaction.Transaction{}, false
	}
	walletID, err := h.svc.WalletOf(r.Context(), id)
	if errors.Is(err, transaction.ErrNotFound) || (err == nil && walletID != wl.ID) {
		writeError(w, http.StatusNotFound, "not_found", "transaction not found")
		return transaction.Transaction{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load transaction")
		return transaction.Transaction{}, false
	}
	t, err := h.svc.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load transaction")
		return transaction.Transaction{}, false
	}
	return t, true
}

func queryInt(r *http.Request, name string, def int64) int64 {
	v := r.URL.Query().Get(name)
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

func writeTransactionError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, transaction.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "transaction not found")
	case errors.Is(err, transaction.ErrInvalidAccount):
		writeError(w, http.StatusBadRequest, "invalid_account", "account does not belong to this wallet")
	case errors.Is(err, transaction.ErrInvalidPaymentMode):
		writeError(w, http.StatusBadRequest, "invalid_payment_mode", "invalid payment mode")
	case errors.Is(err, transaction.ErrInvalidStatus):
		writeError(w, http.StatusBadRequest, "invalid_status", "invalid status")
	case errors.Is(err, transaction.ErrInvalidDate):
		writeError(w, http.StatusBadRequest, "invalid_date", "invalid date (want YYYY-MM-DD)")
	case errors.Is(err, transaction.ErrSplitMismatch):
		writeError(w, http.StatusBadRequest, "split_mismatch", "split amounts must sum to the transaction amount")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "could not save transaction")
	}
	return false
}
