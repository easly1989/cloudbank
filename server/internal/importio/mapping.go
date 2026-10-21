package importio

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// A wallet remembers the column mapping of a generic CSV by its header row
// (#709): the next file with the same column names, in the same order, comes
// mapped. A file without a header row cannot be told apart, so it is never
// remembered.

// ErrBadMapping is a mapping that does not fit its columns.
var ErrBadMapping = errors.New("importio: the mapping does not fit the columns")

// MappingFields are the fields a generic CSV column can fill.
var MappingFields = []string{
	FieldDate, FieldAmount, FieldDebit, FieldCredit, FieldPayee, FieldMemo,
	FieldCategory, FieldInfo, FieldPaymode, FieldTags,
}

// CSVMapping is how a generic CSV is read: its columns, date order, decimal
// mark and sign.
type CSVMapping struct {
	ID           int64          `json:"id,omitempty"`
	Mapping      map[string]int `json:"mapping"`
	DateFormat   string         `json:"dateFormat"`
	DecimalChar  string         `json:"decimalChar"`
	InvertAmount bool           `json:"invertAmount"`
	CreatedAt    string         `json:"createdAt,omitempty"`
}

// Valid reports whether the mapping fits a file of n columns: known fields,
// columns in range and each filling one field, a known date order and mark.
func (m CSVMapping) Valid(n int) bool {
	switch m.DateFormat {
	case "", "iso", "dmy", "mdy":
	default:
		return false
	}
	if m.DecimalChar != "." && m.DecimalChar != "," {
		return false
	}
	used := map[int]bool{}
	for f, i := range m.Mapping {
		if !known(f) || i < 0 || i >= n || used[i] {
			return false
		}
		used[i] = true
	}
	return true
}

func known(field string) bool {
	for _, f := range MappingFields {
		if f == field {
			return true
		}
	}
	return false
}

// Sample is the file's columns and its first n data rows, for the mapping.
func Sample(content, delimiter string, hasHeader bool, n int) ([]string, [][]string, error) {
	if delimiter == "" {
		delimiter = ","
	}
	columns, err := detectColumns(content, delimiter, hasHeader)
	if err != nil {
		return nil, nil, err
	}
	records, err := readAll(content, delimiter)
	if err != nil {
		return nil, nil, err
	}
	if hasHeader && len(records) > 0 {
		records = records[1:]
	}
	var rows [][]string
	for _, r := range records {
		if len(rows) == n {
			break
		}
		if !isBlank(r) {
			rows = append(rows, r)
		}
	}
	return columns, rows, nil
}

func headerKey(columns []string) string {
	raw, _ := json.Marshal(columns)
	return string(raw)
}

func fromRow(r db.CsvMapping) (CSVMapping, error) {
	m := CSVMapping{
		ID: r.ID, DateFormat: r.DateFormat, DecimalChar: r.DecimalChar,
		InvertAmount: r.InvertAmount != 0, CreatedAt: r.CreatedAt,
	}
	return m, json.Unmarshal([]byte(r.Mapping), &m.Mapping)
}

// RememberedMapping is the wallet's mapping for files with these columns, or
// nil when there is none.
func (s *Service) RememberedMapping(ctx context.Context, walletID int64, columns []string) (*CSVMapping, error) {
	r, err := s.q.GetCSVMapping(ctx, db.GetCSVMappingParams{WalletID: walletID, Header: headerKey(columns)})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m, err := fromRow(r)
	if err != nil || !m.Valid(len(columns)) {
		return nil, err // a mapping that no longer fits is as good as none
	}
	return &m, nil
}

// RememberMapping keeps the mapping for files with these columns, replacing
// the one kept before.
func (s *Service) RememberMapping(ctx context.Context, walletID int64, columns []string, m CSVMapping) (CSVMapping, error) {
	if len(columns) == 0 || len(columns) > 200 || !m.Valid(len(columns)) {
		return CSVMapping{}, ErrBadMapping
	}
	for _, c := range columns {
		if len(c) > 200 {
			return CSVMapping{}, ErrBadMapping
		}
	}
	raw, _ := json.Marshal(m.Mapping)
	r, err := s.q.UpsertCSVMapping(ctx, db.UpsertCSVMappingParams{
		WalletID: walletID, Header: headerKey(columns), Mapping: string(raw),
		DateFormat: m.DateFormat, DecimalChar: m.DecimalChar, InvertAmount: flag(m.InvertAmount),
	})
	if err != nil {
		return CSVMapping{}, err
	}
	return fromRow(r)
}

// ForgetMapping drops a remembered mapping of the wallet.
func (s *Service) ForgetMapping(ctx context.Context, walletID, id int64) error {
	n, err := s.q.DeleteCSVMapping(ctx, db.DeleteCSVMappingParams{WalletID: walletID, ID: id})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func flag(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
