// Package provenance carries who or what is writing, through a request or a
// background job, down to where a transaction is inserted (#691): a large
// expense is announced only when someone other than its reader put it there.
package provenance

import (
	"context"
	"database/sql"
)

// The origins of what CloudBank writes without a person typing it.
const (
	Bank     = "bank"
	Mail     = "mail"
	Schedule = "schedule"
	Import   = "import"
)

type userKey struct{}
type originKey struct{}

// WithUser marks ctx as acting for this person: the API sets it on every
// signed-in request.
func WithUser(ctx context.Context, userID int64) context.Context {
	return context.WithValue(ctx, userKey{}, userID)
}

// WithOrigin marks ctx as writing on its own behalf, as a sync or an import.
func WithOrigin(ctx context.Context, origin string) context.Context {
	return context.WithValue(ctx, originKey{}, origin)
}

// Origin is what ctx says is writing, "" for a person.
func Origin(ctx context.Context) string {
	o, _ := ctx.Value(originKey{}).(string)
	return o
}

// User is who ctx acts for, as a column value: NULL for nobody.
func User(ctx context.Context) sql.NullInt64 {
	id, ok := ctx.Value(userKey{}).(int64)
	return sql.NullInt64{Int64: id, Valid: ok && id != 0}
}
