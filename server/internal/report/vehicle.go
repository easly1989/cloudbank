package report

import (
	"context"
	"database/sql"
	"regexp"
	"strconv"
	"strings"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// fuelToken matches a HomeBank fuel memo token: d=<odometer>, v=<volume>,
// p=<unit price>. Numbers may use a dot or comma decimal separator.
var fuelToken = regexp.MustCompile(`(?i)\b([dvp])\s*=\s*([0-9]+(?:[.,][0-9]+)?)`)

type fuel struct {
	meter     float64
	volume    float64
	price     float64
	hasMeter  bool
	hasVolume bool
}

// parseFuelMemo extracts d/v/p tokens from a transaction memo. A missing volume
// token marks a partial fill.
func parseFuelMemo(memo string) fuel {
	var f fuel
	for _, m := range fuelToken.FindAllStringSubmatch(memo, -1) {
		val, err := strconv.ParseFloat(strings.Replace(m[2], ",", ".", 1), 64)
		if err != nil {
			continue
		}
		switch strings.ToLower(m[1]) {
		case "d":
			f.meter, f.hasMeter = val, true
		case "v":
			f.volume, f.hasVolume = val, true
		case "p":
			f.price = val
		}
	}
	return f
}

// VehicleEntry is one fuel transaction in the vehicle report.
type VehicleEntry struct {
	TransactionID int64   `json:"transactionId"`
	Date          string  `json:"date"`
	Meter         float64 `json:"meter"`
	Distance      float64 `json:"distance"` // since the previous entry
	Volume        float64 `json:"volume"`
	Price         float64 `json:"price"`
	Cost          int64   `json:"cost"` // base currency minor units, positive
	Partial       bool    `json:"partial"`
	Consumption   float64 `json:"consumption"` // volume per 100 distance, for a closed full-fill segment
}

// VehicleReport is the fuel-consumption report for one vehicle category.
type VehicleReport struct {
	Entries        []VehicleEntry `json:"entries"`
	TotalDistance  float64        `json:"totalDistance"`
	TotalVolume    float64        `json:"totalVolume"`
	TotalCost      int64          `json:"totalCost"`
	AvgConsumption float64        `json:"avgConsumption"` // between full fills only
	Currency       *CurrencyInfo  `json:"currency"`
}

// Vehicle computes the fuel-consumption report for a vehicle. Consumption is
// only computed between full fills (HomeBank's algorithm): the refill volume at
// a full fill is the fuel consumed over the distance since the previous full
// fill; partial fills (no volume) contribute distance that carries forward.
func (s *Service) Vehicle(ctx context.Context, walletID, vehicleID int64, from, to string) (VehicleReport, error) {
	base, curByID, err := s.baseAndCurrencies(ctx, walletID)
	if err != nil {
		return VehicleReport{}, err
	}
	rows, err := s.q.ListVehicleTransactions(ctx, db.ListVehicleTransactionsParams{
		WalletID: walletID, VehicleID: sql.NullInt64{Int64: vehicleID, Valid: true}, Date: from, Date_2: to,
	})
	if err != nil {
		return VehicleReport{}, err
	}

	out := VehicleReport{Entries: []VehicleEntry{}, Currency: currencyInfo(base)}
	var prevMeter, firstMeter, lastMeter float64
	haveMeter := false
	var prevFullMeter float64
	haveFull := false
	var segVol, segDistTotal, segVolTotal float64

	for _, r := range rows {
		f := parseFuelMemo(r.Memo)
		cost := -r.Amount
		if base != nil {
			cost = convertToBase(cost, curByID[r.CurrencyID], *base)
		}
		e := VehicleEntry{
			TransactionID: r.ID, Date: r.Date, Cost: cost, Volume: f.volume, Price: f.price,
			Partial: !f.hasVolume,
		}
		out.TotalCost += cost
		out.TotalVolume += f.volume
		segVol += f.volume

		if f.hasMeter {
			e.Meter = f.meter
			if haveMeter {
				e.Distance = f.meter - prevMeter
			} else {
				firstMeter, haveMeter = f.meter, true
			}
			prevMeter, lastMeter = f.meter, f.meter
		}

		// A full fill (with a meter) closes the segment since the last full fill.
		if f.hasVolume && f.hasMeter {
			if haveFull {
				if segDist := f.meter - prevFullMeter; segDist > 0 {
					e.Consumption = segVol / segDist * 100
					segDistTotal += segDist
					segVolTotal += segVol
				}
			}
			prevFullMeter, haveFull = f.meter, true
			segVol = 0
		}
		out.Entries = append(out.Entries, e)
	}

	if haveMeter {
		out.TotalDistance = lastMeter - firstMeter
	}
	if segDistTotal > 0 {
		out.AvgConsumption = segVolTotal / segDistTotal * 100
	}
	return out, nil
}
