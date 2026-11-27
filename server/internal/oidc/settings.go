package oidc

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// Settings is a provider as Settings › Security saves it (#796): the
// connection, and who may sign in through it.
type Settings struct {
	Config
	// AutoProvision creates an account at an unknown identity's first sign-in.
	AutoProvision bool
	// AdminEmail reserves an empty installation's first SSO sign-in.
	AdminEmail string
}

// ErrNoKey refuses a save: without CB_SECRET_KEY the client secret could only
// be stored in plain text.
var ErrNoKey = errors.New("oidc: storing the client secret needs CB_SECRET_KEY")

// Store keeps the Settings in the database, with the client secret sealed.
type Store struct {
	db *sql.DB
}

// NewStore returns a Store on the write pool.
func NewStore(write *sql.DB) *Store { return &Store{db: write} }

// Load returns the saved settings; ok is false when there are none. A client
// secret this server cannot open (CB_SECRET_KEY missing or changed) comes back
// empty.
func (s *Store) Load(ctx context.Context) (Settings, bool, error) {
	row, err := db.New(s.db).GetOIDCSettings(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{}, false, nil
	}
	if err != nil {
		return Settings{}, false, fmt.Errorf("oidc: load settings: %w", err)
	}
	secret := secrets.Open(row.ClientSecret)
	if secrets.Sealed(secret) {
		secret = ""
	}
	return Settings{
		Config: Config{
			Issuer: row.Issuer, ClientID: row.ClientID, ClientSecret: secret,
			RedirectURL: row.RedirectUrl, Scopes: row.Scopes, Name: row.Name,
		},
		AutoProvision: row.AutoProvision != 0,
		AdminEmail:    row.AdminEmail,
	}, true, nil
}

// Save replaces the settings. Moving to another issuer drops the links of the
// previous one in the same write: an identity there means nothing to the new
// provider, and its users link again by verified email at their next sign-in.
func (s *Store) Save(ctx context.Context, v Settings) error {
	if !secrets.Enabled() {
		return ErrNoKey
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	q := db.New(tx)
	old, err := q.GetOIDCSettings(ctx)
	switch {
	case err == nil && old.Issuer != v.Issuer:
		if err := q.DeleteOIDCIdentitiesForIssuer(ctx, old.Issuer); err != nil {
			return err
		}
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return err
	}
	var auto int64
	if v.AutoProvision {
		auto = 1
	}
	if err := q.UpsertOIDCSettings(ctx, db.UpsertOIDCSettingsParams{
		Issuer: v.Issuer, ClientID: v.ClientID, ClientSecret: secrets.Seal(v.ClientSecret),
		RedirectUrl: v.RedirectURL, Scopes: v.Scopes, Name: v.Name,
		AutoProvision: auto, AdminEmail: v.AdminEmail,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// Delete forgets the settings. The users' links stay, for the day the same
// provider is set again.
func (s *Store) Delete(ctx context.Context) error {
	return db.New(s.db).DeleteOIDCSettings(ctx)
}

// Linked counts the users who signed in through issuer.
func (s *Store) Linked(ctx context.Context, issuer string) (int64, error) {
	return db.New(s.db).CountOIDCIdentitiesForIssuer(ctx, issuer)
}
