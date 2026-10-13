package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func TestRecoveryCodesCommand(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CB_DATA_DIR", dir)
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	svc := auth.NewService(db.New(st.Write()))
	if _, err := svc.CreateSSOUser(context.Background(), "ann", "ann@example.com", true); err != nil {
		t.Fatal(err)
	}
	_ = st.Close()

	var out, errOut bytes.Buffer
	if code := recoveryCodes([]string{"ann"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	codes := strings.Fields(out.String())
	if len(codes) != 10 {
		t.Fatalf("printed %d codes; want 10: %q", len(codes), out.String())
	}

	st, err = store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = st.Close() }()
	svc = auth.NewService(db.New(st.Write()))
	if _, _, left, err := svc.LoginWithAccessCode(context.Background(), "127.0.0.1", "ann", codes[0], ""); err != nil || left != 9 {
		t.Fatalf("sign-in with a printed code = %d left, %v; want 9, nil", left, err)
	}

	out.Reset()
	errOut.Reset()
	if code := recoveryCodes([]string{"nobody"}, &out, &errOut); code != 1 || out.Len() != 0 {
		t.Fatalf("unknown user: exit %d, printed %q; want 1 and nothing", code, out.String())
	}
	if code := recoveryCodes(nil, &out, &errOut); code != 2 {
		t.Fatalf("no username: exit %d; want 2", code)
	}
}
