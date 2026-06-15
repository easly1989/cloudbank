package auth

import "testing"

func TestHashVerifyRoundTrip(t *testing.T) {
	h, err := Hash("correct horse battery staple")
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}
	ok, err := Verify(h, "correct horse battery staple")
	if err != nil || !ok {
		t.Fatalf("Verify good password: ok=%v err=%v", ok, err)
	}
	ok, err = Verify(h, "wrong password")
	if err != nil {
		t.Fatalf("Verify wrong password err: %v", err)
	}
	if ok {
		t.Fatal("wrong password verified as correct")
	}
}

func TestHashIsSalted(t *testing.T) {
	a, _ := Hash("same")
	b, _ := Hash("same")
	if a == b {
		t.Fatal("two hashes of the same password are identical (missing salt)")
	}
}

func TestVerifyRejectsGarbage(t *testing.T) {
	if _, err := Verify("not-a-phc-hash", "x"); err == nil {
		t.Fatal("expected error for malformed hash")
	}
}

func TestNewTokenUniqueAndHashed(t *testing.T) {
	tok1, id1, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	tok2, id2, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	if tok1 == tok2 || id1 == id2 {
		t.Fatal("tokens/ids are not unique")
	}
	if hashToken(tok1) != id1 {
		t.Fatal("hashToken is not deterministic vs newToken")
	}
	if id1 == tok1 {
		t.Fatal("stored id equals the raw token")
	}
}
