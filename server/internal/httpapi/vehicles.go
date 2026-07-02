package httpapi

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/easly1989/cloudbank/server/internal/vehicle"
)

// vehicleHandlers serve wallet-scoped vehicle endpoints (mounted inside the
// walletContext middleware).
type vehicleHandlers struct {
	svc *vehicle.Service
}

func (h *vehicleHandlers) walletRoutes(r chi.Router) {
	r.Get("/vehicles", h.list)
	r.Post("/vehicles", h.create)
	r.Patch("/vehicles/{vehicleId}", h.update)
	r.Delete("/vehicles/{vehicleId}", h.delete)
}

type vehicleInput struct {
	Name  string `json:"name"`
	Plate string `json:"plate"`
	Notes string `json:"notes"`
}

func writeVehicleError(w http.ResponseWriter, err error) bool {
	return mapError(w, err, "could not save vehicle",
		errCase{vehicle.ErrNotFound, http.StatusNotFound, "not_found", "vehicle not found"},
		errCase{vehicle.ErrDuplicate, http.StatusConflict, "conflict", "a vehicle with that name already exists"},
		errCase{vehicle.ErrInvalid, http.StatusBadRequest, "invalid", "vehicle name is required"},
	)
}

func vehicleIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "vehicleId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "vehicle not found")
		return 0, false
	}
	return id, true
}

func (h *vehicleHandlers) list(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	out, err := h.svc.List(r.Context(), wl.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list vehicles")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *vehicleHandlers) create(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	var in vehicleInput
	if !decodeJSON(w, r, &in) {
		return
	}
	v, err := h.svc.Create(r.Context(), wl.ID, in.Name, in.Plate, in.Notes)
	if !writeVehicleError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (h *vehicleHandlers) update(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := vehicleIDParam(w, r)
	if !ok {
		return
	}
	var in vehicleInput
	if !decodeJSON(w, r, &in) {
		return
	}
	v, err := h.svc.Update(r.Context(), wl.ID, id, in.Name, in.Plate, in.Notes)
	if !writeVehicleError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (h *vehicleHandlers) delete(w http.ResponseWriter, r *http.Request) {
	wl, _ := walletFromContext(r.Context())
	id, ok := vehicleIDParam(w, r)
	if !ok {
		return
	}
	if !writeVehicleError(w, h.svc.Delete(r.Context(), wl.ID, id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
