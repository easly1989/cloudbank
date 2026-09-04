# Automatic bank sync

CloudBank can pull new transactions straight from your bank and import them —
de-duplicated and run through your [assignment rules](../README.md#features) —
through two providers. Both use a **bring-your-own-credentials** model: **you**
supply the provider credentials, CloudBank stores them **server-side** (never
returned to the browser) and signs the provider requests. CloudBank never sees
your bank username or password.

Bank sync lives at **Bank sync** in the sidebar. Each provider is configured
per **wallet**.

| Provider | Coverage | You bring | Cost to you |
| --- | --- | --- | --- |
| **SimpleFIN** | Worldwide (via SimpleFIN Bridge) | A SimpleFIN **setup token** | ~$15/year SimpleFIN Bridge subscription |
| **Enable Banking** | EU/EEA + UK (PSD2 open banking) | Your own **application** (app id + RSA key) | Free sandbox; production is your own agreement with Enable Banking |

The import itself reuses CloudBank's normal pipeline: transactions are
de-duplicated (by the provider's transaction id, or a stable hash when none is
given) and passed through your assignment rules, exactly like a file import.
Signed amounts follow CloudBank's convention (negative = money out).

---

## SimpleFIN

1. Create a **SimpleFIN Bridge** account at <https://beta-bridge.simplefin.org/>
   and connect your bank there. SimpleFIN Bridge is the paid piece (~$15/year).
2. Generate a **setup token** in SimpleFIN Bridge.
3. In CloudBank: **Bank sync → SimpleFIN → Connect a bank**, give it a name and
   paste the setup token. CloudBank claims the token once for a secret access URL
   (stored server-side) — a token can only be claimed once.
4. Under the new connection, **link** each provider account to a CloudBank
   account, then click **Sync now**. Re-syncing only imports new transactions.

---

## Enable Banking (EU)

Enable Banking is PSD2 open banking for the EEA + UK. You register your **own**
application; CloudBank uses it on your behalf.

### 1. Register an application

1. Sign in at <https://enablebanking.com/sign-in/> and open the **Control Panel →
   Applications → Add a new application**.
2. Choose an environment:
   - **Sandbox** — free, activated instantly, connects to mock/test banks (and
     some banks' sandboxes). Best for trying the whole flow.
   - **Production** — real banks. A new production app starts **inactive**. For
     **personal, non-commercial** use you can activate it with **"Activate by
     linking accounts"** in the Control Panel: link your own bank account(s) and
     authorize them — no commercial contract required (see Enable Banking's
     [Linked accounts](https://enablebanking.com/docs/api/linked-accounts/) docs;
     commercial / at-scale use needs an agreement, and their Terms of Service set
     the exact limits). The API flow is the same as sandbox, so nothing changes in
     CloudBank — just set the environment to **production**.

   > **Important — a personal (restricted) app can only read _linked_ accounts.**
   > When you activate "by linking accounts", the app stays **restricted**, and per
   > Enable Banking *"you can only fetch data from accounts linked to the
   > application."* The accounts you link are exactly the ones CloudBank can see, so
   > **keep them linked**. You still connect them through CloudBank's **Connect a
   > bank** (the normal PSD2 authorization, step 3) — that is the session CloudBank
   > actually uses. Common gotchas:
   >
   > - **"No accounts found" / "Imported 0"** after connecting almost always means
   >   **no accounts are linked** to the app. Open the application in the Control
   >   Panel, click **Link accounts**, authorize your account(s), then **Reconnect**
   >   the bank in CloudBank.
   > - **"Could not complete the connection" (a 502 on return)**: make sure your
   >   CloudBank is up to date — a card / non-IBAN linked account (e.g. a CPAN)
   >   previously broke the connect step. The callback page now shows the real
   >   Enable Banking error; a stale link from an earlier activation can also block
   >   a fresh authorization, so unlinking and re-linking the account can help.
   > - Link the **same** bank profile your accounts live under — e.g. *Intesa
   >   Sanpaolo Private Banking* vs *Intesa Sanpaolo* — otherwise the session comes
   >   back with no accounts.
3. Set the application's **redirect URL** to your CloudBank instance's callback,
   exactly:

   ```
   https://YOUR-CLOUDBANK-HOST/bank-sync/callback
   ```

   CloudBank shows this exact URL in the credentials dialog — copy it from there.
4. Provide the RSA key pair. The simplest option is **"Generate in the browser
   and export private key"** (no tooling needed) — it downloads a private key and
   registers the certificate for you. Or generate one yourself:

   ```bash
   openssl genrsa -out private.key 4096
   openssl req -new -x509 -days 365 -key private.key -out public.crt \
     -subj "/C=IT/ST=State/L=City/O=CloudBank/CN=YOUR-CLOUDBANK-HOST"
   ```

   Upload `public.crt`; keep `private.key`.
5. After registering, copy the **Application ID**.

Keep the private key secret — treat it like a password. If it is ever exposed,
rotate it in the Control Panel.

### 2. Configure CloudBank

**Bank sync → Enable Banking (EU) → Configure**, then paste:

- **Application ID**
- **RSA private key** (PEM — PKCS#1 from `openssl genrsa`, or PKCS#8 from the
  browser export; both are accepted)
- **Environment** (sandbox or production)

To later change only the environment or app id, open **Edit credentials** and
leave the private-key field blank to keep the stored key.

### 3. Connect a bank

1. **Connect a bank**, choose the country and bank, give it a name, and continue.
   You are redirected to the bank to authorize access.
2. On return, CloudBank exchanges the authorization for a session and creates the
   connection. **Link** each account to a CloudBank account and **Sync now**.

If the connection is created but shows **"No accounts found"** (and Sync now
imports 0), the bank returned an empty account list. On a **restricted**
production app that means the accounts are not linked to your Enable Banking
application — see the note in step 1: **Link accounts** in the Control Panel, then
**Reconnect** here.

A bank consent is time-limited (Enable Banking grants roughly 90 days). When it
expires, sync reports it and you reconnect the bank.

---

## Where credentials are stored

Bank-sync secrets — the SimpleFIN access URL and the Enable Banking application
private key — are stored **server-side** in the SQLite database and are **never
returned to the browser**.

Set **`CB_SECRET_KEY`** to encrypt them (and CloudBank's other reversible secrets
— AI API keys, 2FA secrets, the web-push signing key) **at rest** with AES-256-GCM.
It is optional and backward compatible: without it, secrets are stored in plaintext
(existing behaviour); set it and each secret is encrypted on its next write. Keep
the key **stable** — losing it makes the encrypted secrets unrecoverable.

Whether or not encryption is enabled, protect the database itself as you would the
rest of your financial data:

- keep the `/data` volume on trusted, access-controlled storage,
- store backups securely, and
- serve CloudBank over HTTPS (see [reverse-proxy.md](reverse-proxy.md)).

## Automatic (background) sync

Connections are refreshed automatically in the background, so you normally don't
need to click **Sync now**. Each connection has an **Automatic sync** toggle (on
by default); turn it off to sync that connection only on demand. The server
refreshes auto-sync connections that are older than `CB_BANK_SYNC_INTERVAL`
(default `12h`; set it to `0`/`off` to disable background sync entirely). An
Enable Banking connection whose consent has expired is skipped until you
**reconnect** it.

## How imported transactions are reconciled

Bank rows aren't just dumped into the register — they go through the same import
pipeline as a file import, with extra reconciliation:

- **No duplicates of what you already have.** A bank row that matches an existing
  **manual or scheduled** transaction (same amount, within a date window) is
  **merged** into that transaction rather than added again — it inherits the bank
  reference (so the next sync recognises it), its date is corrected to the bank's,
  and its status is upgraded. Your meaningful memo from a schedule is replaced by
  the bank's description on a reconciled row; category, tags and payee are kept.
- **Right status.** A **booked** bank transaction is imported as **reconciled**, a
  **pending** one as **cleared**; when a pending row later books, it is **settled
  up** to reconciled instead of duplicated.
- **A default payment mode** by account type: an **IBAN** account's rows default to
  **direct debit**, a **card** account's to **credit card** (your import rules still
  win when they match).
- **Assignment rules** run on every imported row, so categories/payees you've set
  up are applied automatically.

## Reviewing imports

Because imported rows arrive reconciled but the bank supplies no CloudBank
category, the **Review** page (in the sidebar) helps you finish the job:

- **Needs a category** lists imported transactions that still have none — pick one
  inline.
- **Possible duplicates** finds pairs that look like the same movement (same
  account and amount, close dates) that reconciliation didn't catch — for example a
  manual entry whose date was well off. For each pair you can **merge** (keep one,
  carrying the bank reference over), **edit** or **delete** a row, or mark it **"not
  a duplicate"** so it is never shown again.

## Current limitations

- The Enable Banking account list is **captured when you connect**; if the bank
  later exposes a new account, reconnect to pick it up.
- Balances shown for Enable Banking accounts are best-effort and may be omitted
  if the bank does not return one.
