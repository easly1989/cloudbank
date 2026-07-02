// Package dbconv holds the tiny conversion helpers shared between the storage
// layer and the service packages: SQLite stores booleans as 0/1 integers and
// nullable foreign keys as sql.NullInt64, while the domain uses Go bool and
// *int64. These were previously copy-pasted (as b2i/np/nn) into nearly every
// service package.
package dbconv

import "database/sql"

// B2i maps a bool to the 0/1 integer SQLite uses for boolean columns.
func B2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// NullToPtr converts a nullable integer column to *int64 (nil when NULL).
func NullToPtr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

// PtrToNull converts *int64 to a nullable integer column (NULL when nil).
func PtrToNull(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}
