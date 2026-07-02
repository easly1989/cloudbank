// Package vehicle implements CRUD for the managed vehicles used by the car-cost
// report. Transactions reference a vehicle by id (vehicle_id, ON DELETE SET
// NULL); this package owns the vehicles themselves, split out of the
// transaction service for single responsibility.
package vehicle

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Sentinel errors.
var (
	ErrNotFound  = errors.New("vehicle: not found")
	ErrDuplicate = errors.New("vehicle: a vehicle with that name already exists")
	ErrInvalid   = errors.New("vehicle: name is required")
)

// Vehicle is a managed vehicle for the car-cost report.
type Vehicle struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Plate string `json:"plate"`
	Notes string `json:"notes"`
}

func toVehicle(v db.Vehicle) Vehicle {
	return Vehicle{ID: v.ID, Name: v.Name, Plate: v.Plate, Notes: v.Notes}
}

// Service implements vehicle CRUD.
type Service struct {
	q  *db.Queries // write pool (mutations)
	rq *db.Queries // read pool (read-only methods)
}

// NewService builds a Service backed by the write connection pool for both
// reads and writes.
func NewService(write *sql.DB) *Service {
	return &Service{q: db.New(write), rq: db.New(write)}
}

// NewServiceWithRead builds a Service whose read-only methods run on the read
// pool while mutations use the single write connection.
func NewServiceWithRead(read, write *sql.DB) *Service {
	return &Service{q: db.New(write), rq: db.New(read)}
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}

// List returns the wallet's vehicles by name.
func (s *Service) List(ctx context.Context, walletID int64) ([]Vehicle, error) {
	rows, err := s.rq.ListVehiclesForWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	out := make([]Vehicle, 0, len(rows))
	for _, v := range rows {
		out = append(out, toVehicle(v))
	}
	return out, nil
}

func (s *Service) inWallet(ctx context.Context, walletID, id int64) (db.Vehicle, error) {
	v, err := s.q.GetVehicle(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && v.WalletID != walletID) {
		return db.Vehicle{}, ErrNotFound
	}
	return v, err
}

// Create adds a vehicle.
func (s *Service) Create(ctx context.Context, walletID int64, name, plate, notes string) (Vehicle, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Vehicle{}, ErrInvalid
	}
	v, err := s.q.InsertVehicle(ctx, db.InsertVehicleParams{WalletID: walletID, Name: name, Plate: plate, Notes: notes})
	if err != nil {
		if isUniqueViolation(err) {
			return Vehicle{}, ErrDuplicate
		}
		return Vehicle{}, err
	}
	return toVehicle(v), nil
}

// Update renames/edits a vehicle.
func (s *Service) Update(ctx context.Context, walletID, id int64, name, plate, notes string) (Vehicle, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Vehicle{}, ErrInvalid
	}
	if _, err := s.inWallet(ctx, walletID, id); err != nil {
		return Vehicle{}, err
	}
	if err := s.q.UpdateVehicle(ctx, db.UpdateVehicleParams{Name: name, Plate: plate, Notes: notes, ID: id}); err != nil {
		if isUniqueViolation(err) {
			return Vehicle{}, ErrDuplicate
		}
		return Vehicle{}, err
	}
	return s.get(ctx, id)
}

func (s *Service) get(ctx context.Context, id int64) (Vehicle, error) {
	v, err := s.q.GetVehicle(ctx, id)
	if err != nil {
		return Vehicle{}, err
	}
	return toVehicle(v), nil
}

// Delete removes a vehicle; its transactions keep their data but are unlinked
// (vehicle_id → NULL via ON DELETE SET NULL).
func (s *Service) Delete(ctx context.Context, walletID, id int64) error {
	if _, err := s.inWallet(ctx, walletID, id); err != nil {
		return err
	}
	return s.q.DeleteVehicle(ctx, id)
}
