package main

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/config"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// recoveryCodes is `cloudbank recovery-codes <username>`: it makes a fresh set
// of access recovery codes for one account and prints them (#620). It is the
// last way in on a server that signs in through SSO only, for a user who has
// lost both the provider and their codes; whoever can run a command in the
// container can already read the database, so it hands out nothing new.
// The old codes stop working. It can run while the server does.
func recoveryCodes(args []string, stdout, stderr io.Writer) int {
	if len(args) != 1 || args[0] == "" {
		_, _ = fmt.Fprintln(stderr, "usage: cloudbank recovery-codes <username>")
		return 2
	}
	cfg := config.Load()
	st, err := store.Open(cfg.DataDir)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "recovery-codes:", err)
		return 1
	}
	defer func() { _ = st.Close() }()
	codes, err := auth.NewService(db.New(st.Write())).NewAccessCodesByUsername(context.Background(), args[0])
	if errors.Is(err, auth.ErrNotFound) {
		_, _ = fmt.Fprintf(stderr, "recovery-codes: no account named %q\n", args[0])
		return 1
	}
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "recovery-codes:", err)
		return 1
	}
	_, _ = fmt.Fprintf(stderr, "New recovery codes for %s. Each signs in once; the old ones no longer work.\n", args[0])
	for _, c := range codes {
		_, _ = fmt.Fprintln(stdout, c)
	}
	return 0
}
