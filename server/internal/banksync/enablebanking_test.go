package banksync

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// ebSessionJSON is the POST /sessions response — full account objects + access.
const ebSessionJSON = `{"session_id":"sess-1","access":{"valid_until":"2024-09-30T00:00:00.000000+00:00"},"accounts":[
  {"uid":"acc-uid-1","name":"Conto Corrente","currency":"EUR","account_id":{"iban":"IT60X0542811101000000123456"}},
  {"uid":"acc-uid-2","name":"Risparmio","currency":"EUR","account_id":{"iban":"IT99Y0000000000000000000000"}}
]}`

// ebSessionGetJSON is the GET /sessions/{id} response — uid strings only (the
// real Enable Banking shape). The code must not depend on this for account data.
const ebSessionGetJSON = `{"session_id":"sess-1","accounts":["acc-uid-1","acc-uid-2"],"accounts_data":[{"uid":"acc-uid-1"},{"uid":"acc-uid-2"}]}`

const ebTxnsJSON = `{"transactions":[
  {"entry_reference":"e1","transaction_amount":{"amount":"12.34","currency":"EUR"},"credit_debit_indicator":"DBIT","status":"BOOK","booking_date":"2024-06-10","remittance_information":["Grocery"]},
  {"entry_reference":"e2","transaction_amount":{"amount":"1000.00","currency":"EUR"},"credit_debit_indicator":"CRDT","status":"BOOK","booking_date":"2024-06-11","remittance_information":["Salary"]}
]}`

// genTestKey returns a fresh RSA key and its PKCS#8 PEM (never a real user key).
func genTestKey(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return key, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// verifyJWT checks the RS256 signature and the header claims the client sets.
func verifyJWT(pub *rsa.PublicKey, token string) error {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return fmt.Errorf("token has %d parts", len(parts))
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig); err != nil {
		return err
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return err
	}
	var hdr map[string]string
	if err := json.Unmarshal(hb, &hdr); err != nil {
		return err
	}
	if hdr["alg"] != "RS256" || hdr["kid"] == "" {
		return fmt.Errorf("bad header %v", hdr)
	}
	return nil
}

func jsonResp(code int, body string) *http.Response {
	return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

// ebMockDoer answers Enable Banking calls and verifies the JWT on every request.
type ebMockDoer struct {
	pub        *rsa.PublicKey
	t          *testing.T
	txnFetches int
}

func (m *ebMockDoer) Do(r *http.Request) (*http.Response, error) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return jsonResp(http.StatusUnauthorized, `{"error":"no token"}`), nil
	}
	if err := verifyJWT(m.pub, strings.TrimPrefix(auth, "Bearer ")); err != nil {
		m.t.Errorf("request %s %s: bad jwt: %v", r.Method, r.URL.Path, err)
		return jsonResp(http.StatusUnauthorized, `{"error":"bad token"}`), nil
	}
	p := r.URL.Path
	switch {
	case r.Method == http.MethodPost && strings.HasSuffix(p, "/auth"):
		return jsonResp(200, `{"url":"https://bank.example/authorize?x=1","authorization_id":"auth-1"}`), nil
	case r.Method == http.MethodPost && strings.HasSuffix(p, "/sessions"):
		return jsonResp(200, ebSessionJSON), nil
	case r.Method == http.MethodGet && strings.Contains(p, "/sessions/"):
		return jsonResp(200, ebSessionGetJSON), nil
	case r.Method == http.MethodDelete && strings.Contains(p, "/sessions/"):
		return jsonResp(200, `{}`), nil
	case strings.HasSuffix(p, "/transactions"):
		m.txnFetches++
		return jsonResp(200, ebTxnsJSON), nil
	case strings.HasSuffix(p, "/balances"):
		return jsonResp(200, `{"balances":[{"balance_amount":{"amount":"500.00","currency":"EUR"},"balance_type":"CLBD"}]}`), nil
	case r.Method == http.MethodGet && strings.HasSuffix(p, "/aspsps"):
		return jsonResp(200, `{"aspsps":[{"name":"IntesaSanpaolo","country":"IT"}]}`), nil
	}
	return jsonResp(http.StatusNotFound, `{"error":"not found"}`), nil
}

func newEBFixture(t *testing.T) (*Service, *db.Queries, int64, int64, string) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Checking", Type: "checking", CurrencyID: cur.ID, Position: 1,
	})
	imp := importio.NewService(st.Write(), transaction.NewService(st.Write()),
		assignment.NewService(st.Write()), account.NewServiceWithRead(st.Read(), st.Write()))
	svc := NewService(st.Read(), st.Write(), imp)
	key, pemStr := genTestKey(t)
	svc.hc = &ebMockDoer{pub: &key.PublicKey, t: t}
	svc.syncStagger = 0
	return svc, q, w.ID, acc.ID, pemStr
}

func TestEnableBankingJWT(t *testing.T) {
	key, pemStr := genTestKey(t)
	cl, err := newEnableBankingClient(nil, "app-xyz", pemStr)
	if err != nil {
		t.Fatalf("newEnableBankingClient: %v", err)
	}
	tok, err := cl.jwt(time.Now())
	if err != nil {
		t.Fatalf("jwt: %v", err)
	}
	if err := verifyJWT(&key.PublicKey, tok); err != nil {
		t.Fatalf("verify: %v", err)
	}
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	if err := verifyJWT(&other.PublicKey, tok); err == nil {
		t.Fatalf("verify with the wrong key should fail")
	}
	// A malformed key is rejected.
	if _, err := newEnableBankingClient(nil, "app", "not a key"); err == nil {
		t.Fatalf("expected error for malformed key")
	}
}

func TestEnableBankingAuthSyncDedup(t *testing.T) {
	svc, q, wid, acc, pemStr := newEBFixture(t)
	ctx := context.Background()

	if err := svc.SetEBankingConfig(ctx, wid, "app-123", pemStr, "sandbox"); err != nil {
		t.Fatalf("SetEBankingConfig: %v", err)
	}
	cfg, _ := svc.EBankingConfig(ctx, wid)
	if !cfg.Configured || cfg.AppID != "app-123" || cfg.Environment != "sandbox" {
		t.Fatalf("config view: %+v", cfg)
	}

	url, state, err := svc.EBankingStartAuth(ctx, wid, "IntesaSanpaolo", "IT", "My Intesa", "https://cb.example/bank-sync/callback")
	if err != nil {
		t.Fatalf("StartAuth: %v", err)
	}
	if url == "" || state == "" {
		t.Fatalf("start auth returned empty url/state")
	}

	conn, err := svc.EBankingCompleteAuth(ctx, wid, state, "the-code")
	if err != nil {
		t.Fatalf("CompleteAuth: %v", err)
	}
	if conn.Provider != providerEnableBanking || conn.Aspsp != "IntesaSanpaolo" || conn.Country != "IT" {
		t.Fatalf("connection: %+v", conn)
	}
	// The accounts and consent expiry from POST /sessions are persisted on the
	// connection (so listing/sync do not depend on GET /sessions/{id}).
	row, err := q.GetBankConnection(ctx, conn.ID)
	if err != nil || row.ValidUntil == "" || row.AccountsJson == "" || row.AccountsJson == "[]" {
		t.Fatalf("connection not fully persisted: validUntil=%q accounts=%q err=%v", row.ValidUntil, row.AccountsJson, err)
	}

	remotes, err := svc.RemoteAccounts(ctx, wid, conn.ID)
	if err != nil {
		t.Fatalf("RemoteAccounts: %v", err)
	}
	if len(remotes) != 2 || remotes[0].ExternalID != "acc-uid-1" || remotes[0].Balance != "500.00" {
		t.Fatalf("remotes: %+v", remotes)
	}

	if err := svc.Link(ctx, wid, conn.ID, "acc-uid-1", acc); err != nil {
		t.Fatalf("Link: %v", err)
	}

	res, err := svc.Sync(ctx, wid, conn.ID)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if res.Imported != 2 || res.Accounts != 1 {
		t.Fatalf("first sync = %+v, want imported 2 / accounts 1", res)
	}
	rows, _ := q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: acc, Limit: 100})
	if len(rows) != 2 {
		t.Fatalf("account has %d transactions, want 2", len(rows))
	}
	var sum int64
	for _, r := range rows {
		sum += r.Amount
	}
	if sum != -1234+100000 { // -12.34 (DBIT) + 1000.00 (CRDT) at 2 dp
		t.Fatalf("amount sum = %d, want %d", sum, -1234+100000)
	}

	res2, err := svc.Sync(ctx, wid, conn.ID)
	if err != nil {
		t.Fatalf("Sync 2: %v", err)
	}
	if res2.Imported != 0 {
		t.Fatalf("re-sync imported %d, want 0 (deduped)", res2.Imported)
	}
}

func TestEnableBankingConfigKeepKey(t *testing.T) {
	svc, _, wid, _, pemStr := newEBFixture(t)
	ctx := context.Background()
	if err := svc.SetEBankingConfig(ctx, wid, "app-1", pemStr, "sandbox"); err != nil {
		t.Fatalf("initial config: %v", err)
	}
	// An empty private key keeps the stored one; app id / environment still change.
	if err := svc.SetEBankingConfig(ctx, wid, "app-2", "", "production"); err != nil {
		t.Fatalf("keep-key update: %v", err)
	}
	cfg, _ := svc.EBankingConfig(ctx, wid)
	if cfg.AppID != "app-2" || cfg.Environment != "production" {
		t.Fatalf("config after keep-key update: %+v", cfg)
	}
	// The kept key still authenticates (client builds and signs a valid JWT).
	if _, err := svc.EBankingBanks(ctx, wid, "IT"); err != nil {
		t.Fatalf("banks with kept key: %v", err)
	}
	// An empty key with no existing config is rejected.
	svc2, _, wid2, _, _ := newEBFixture(t)
	if err := svc2.SetEBankingConfig(ctx, wid2, "app", "", "sandbox"); err != ErrInvalid {
		t.Fatalf("empty key without config: err = %v, want ErrInvalid", err)
	}
}

func TestEnableBankingSecretsEncryptedAtRest(t *testing.T) {
	c, err := secrets.New("test-encryption-key")
	if err != nil {
		t.Fatalf("secrets.New: %v", err)
	}
	secrets.Configure(c)
	t.Cleanup(func() { secrets.Configure(nil) })

	svc, q, wid, _, pemStr := newEBFixture(t)
	ctx := context.Background()
	if err := svc.SetEBankingConfig(ctx, wid, "app-1", pemStr, "sandbox"); err != nil {
		t.Fatalf("SetEBankingConfig: %v", err)
	}
	// The stored private key is ciphertext, not the PEM.
	raw, err := q.GetEBankingConfig(ctx, wid)
	if err != nil {
		t.Fatalf("GetEBankingConfig: %v", err)
	}
	if raw.PrivateKey == pemStr || strings.Contains(raw.PrivateKey, "PRIVATE KEY") {
		t.Fatalf("private key stored in plaintext at rest: %.24q", raw.PrivateKey)
	}
	// It is still usable: the client decrypts it and authenticates.
	if _, err := svc.EBankingBanks(ctx, wid, "IT"); err != nil {
		t.Fatalf("EBankingBanks with encrypted key: %v", err)
	}

	// Connecting a bank stores the session id (access_url) encrypted too.
	_, state, err := svc.EBankingStartAuth(ctx, wid, "IntesaSanpaolo", "IT", "x", "https://cb.example/bank-sync/callback")
	if err != nil {
		t.Fatalf("StartAuth: %v", err)
	}
	conn, err := svc.EBankingCompleteAuth(ctx, wid, state, "code")
	if err != nil {
		t.Fatalf("CompleteAuth: %v", err)
	}
	crow, err := q.GetBankConnection(ctx, conn.ID)
	if err != nil || crow.AccessUrl == "sess-1" || strings.Contains(crow.AccessUrl, "sess-1") {
		t.Fatalf("session id (access_url) not encrypted at rest: %q err=%v", crow.AccessUrl, err)
	}
	// Remote accounts still resolve (they read the persisted account list).
	if rem, err := svc.RemoteAccounts(ctx, wid, conn.ID); err != nil || len(rem) != 2 {
		t.Fatalf("RemoteAccounts after encrypted connect: n=%d err=%v", len(rem), err)
	}
}

func TestEnableBankingReauthKeepsLinks(t *testing.T) {
	svc, q, wid, acc, pemStr := newEBFixture(t)
	ctx := context.Background()
	if err := svc.SetEBankingConfig(ctx, wid, "app-1", pemStr, "sandbox"); err != nil {
		t.Fatalf("config: %v", err)
	}
	_, state, err := svc.EBankingStartAuth(ctx, wid, "IntesaSanpaolo", "IT", "Intesa", "https://cb.example/bank-sync/callback")
	if err != nil {
		t.Fatalf("StartAuth: %v", err)
	}
	conn, err := svc.EBankingCompleteAuth(ctx, wid, state, "code")
	if err != nil {
		t.Fatalf("CompleteAuth: %v", err)
	}
	if err := svc.Link(ctx, wid, conn.ID, "acc-uid-1", acc); err != nil {
		t.Fatalf("Link: %v", err)
	}

	// Reauthorize the same connection.
	_, state2, err := svc.EBankingStartReauth(ctx, wid, conn.ID, "https://cb.example/bank-sync/callback")
	if err != nil {
		t.Fatalf("StartReauth: %v", err)
	}
	conn2, err := svc.EBankingCompleteAuth(ctx, wid, state2, "code2")
	if err != nil {
		t.Fatalf("CompleteAuth (reauth): %v", err)
	}
	// The connection is refreshed in place, not duplicated.
	if conn2.ID != conn.ID {
		t.Fatalf("reauth created a new connection %d (want %d)", conn2.ID, conn.ID)
	}
	if conns, _ := svc.ListConnections(ctx, wid); len(conns) != 1 {
		t.Fatalf("want 1 connection after reauth, got %d", len(conns))
	}
	// The account link survived, and the consent expiry is set.
	links, _ := q.ListBankLinks(ctx, conn.ID)
	if len(links) != 1 || links[0].ExternalID != "acc-uid-1" {
		t.Fatalf("link lost after reauth: %+v", links)
	}
	if conn2.ValidUntil == "" {
		t.Fatalf("validUntil not populated after reauth")
	}

	// Another wallet cannot reauthorize this connection.
	other, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	if _, _, err := svc.EBankingStartReauth(ctx, other.ID, conn.ID, "https://cb.example/bank-sync/callback"); err != ErrNotFound {
		t.Fatalf("cross-wallet reauth err = %v, want ErrNotFound", err)
	}
}

func TestEnableBankingWalletIsolation(t *testing.T) {
	svc, q, wid, _, pemStr := newEBFixture(t)
	ctx := context.Background()
	if err := svc.SetEBankingConfig(ctx, wid, "app-1", pemStr, "sandbox"); err != nil {
		t.Fatalf("SetEBankingConfig: %v", err)
	}
	_, state, err := svc.EBankingStartAuth(ctx, wid, "IntesaSanpaolo", "IT", "x", "https://cb.example/bank-sync/callback")
	if err != nil {
		t.Fatalf("StartAuth: %v", err)
	}
	other, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	// Another wallet cannot complete this authorization (state is wallet-scoped).
	if _, err := svc.EBankingCompleteAuth(ctx, other.ID, state, "code"); err != ErrNotFound {
		t.Fatalf("cross-wallet CompleteAuth err = %v, want ErrNotFound", err)
	}
	// And it has no credentials of its own.
	cfg, _ := svc.EBankingConfig(ctx, other.ID)
	if cfg.Configured {
		t.Fatalf("other wallet should not be configured")
	}
	if _, err := svc.EBankingBanks(ctx, other.ID, "IT"); err != ErrEBNotConfigured {
		t.Fatalf("unconfigured EBankingBanks err = %v, want ErrEBNotConfigured", err)
	}
}

// TestEBSessionDecodesOtherAccountID guards the POST /sessions decode against
// non-IBAN accounts. Enable Banking returns account_id.other as an OBJECT (e.g. a
// card CPAN), which previously crashed the decode — the field was typed as a
// string — and surfaced to the user as a 502 "Could not complete the connection"
// whenever a linked account was a card rather than an IBAN account.
func TestEBSessionDecodesOtherAccountID(t *testing.T) {
	const body = `{"session_id":"s1","access":{"valid_until":"2024-09-30T00:00:00+00:00"},"accounts":[
	  {"uid":"acc-iban","name":"Conto","currency":"EUR","account_id":{"iban":"IT60X0542811101000000123456"}},
	  {"uid":"acc-card","currency":"EUR","product":"Carta","account_id":{"other":{"identification":"5398********7465","scheme_name":"CPAN"}}}
	]}`
	var s ebSession
	if err := json.Unmarshal([]byte(body), &s); err != nil {
		t.Fatalf("decode /sessions with an 'other' (CPAN) account: %v", err)
	}
	if len(s.Accounts) != 2 {
		t.Fatalf("accounts = %d, want 2", len(s.Accounts))
	}
	if got := s.Accounts[0].identifier(); got != "IT60X0542811101000000123456" {
		t.Errorf("iban account identifier = %q", got)
	}
	card := s.Accounts[1]
	if got := card.identifier(); got != "5398********7465" {
		t.Errorf("card identifier = %q, want the CPAN", got)
	}
	if got := card.label(); got != "5398********7465" {
		t.Errorf("card label = %q, want the CPAN (it has no name/iban)", got)
	}
}
