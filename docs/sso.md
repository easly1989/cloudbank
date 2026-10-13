# Signing in with OIDC (single sign-on)

CloudBank can hand sign-in to an OpenID Connect provider you already run:
Authelia, Authentik, Keycloak, Google, or any other that speaks OIDC. People
then sign in once, at the provider, with whatever it asks for (a password, a
passkey, a second factor), and CloudBank trusts its answer.

There are two ways to use it:

- **Next to passwords** (the default once OIDC is set). The sign-in page keeps
  the username and password form and adds a "Sign in with …" button.
- **SSO only**, with `CB_PASSWORD_LOGIN=false`. The form goes. The provider is
  the only way in, plus a recovery code for the day it does not answer (see
  [If the provider does not answer](#if-the-provider-does-not-answer)).

CloudBank uses the Authorization Code flow with PKCE (S256) and checks the ID
token's signature, issuer, audience, expiry and nonce. It needs a confidential
client, so the provider gives it a client secret.

## What to set in CloudBank

| Variable | What it is |
| --- | --- |
| `CB_OIDC_ISSUER` | The provider's issuer URL, exactly as its discovery document states it (trailing slash included, when there is one). |
| `CB_OIDC_CLIENT_ID` | The client id you registered at the provider. |
| `CB_OIDC_CLIENT_SECRET` | The client secret, in plain text. Keep it out of version control: an `.env` file next to your compose file, or a Docker secret. |
| `CB_OIDC_REDIRECT_URL` | `https://<your-cloudbank-host>/api/v1/auth/oidc/callback`. Register exactly the same URL at the provider. |
| `CB_OIDC_NAME` | The label on the button: "Sign in with _name_". Defaults to `SSO`. |
| `CB_OIDC_SCOPES` | Defaults to `openid profile email`. CloudBank needs `openid` and `email`. |
| `CB_OIDC_AUTO_PROVISION` | `true` makes an account for anyone the provider lets through. Defaults to `false`. |
| `CB_PASSWORD_LOGIN` | `false` signs in through SSO only. Defaults to `true`. |
| `CB_OIDC_ADMIN_EMAIL` | SSO only: reserves the first sign-in, which becomes the administrator, to this email. |

CloudBank must be served over HTTPS for the provider to send people back to
it; see [Reverse proxy and HTTPS](reverse-proxy.md).

## Authelia, step by step

This assumes Authelia 4.38 or later and CloudBank at
`https://finance.example.com`, Authelia at `https://auth.example.com`.

**1. Make a client secret.** Authelia stores only its hash, CloudBank needs the
plain text. Authelia makes both for you:

```bash
docker run --rm authelia/authelia:latest authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986
```

It prints a `Random Password` (for CloudBank) and a `Digest` (for Authelia).

**2. Register CloudBank as a client** in Authelia's `configuration.yml`:

```yaml
identity_providers:
  oidc:
    # ... your existing hmac_secret and jwks ...
    clients:
      - client_id: 'cloudbank'
        client_name: 'CloudBank'
        client_secret: '$pbkdf2-sha512$310000$...'   # the Digest from step 1
        public: false
        authorization_policy: 'two_factor'
        require_pkce: true
        pkce_challenge_method: 'S256'
        redirect_uris:
          - 'https://finance.example.com/api/v1/auth/oidc/callback'
        scopes:
          - 'openid'
          - 'profile'
          - 'email'
        response_types:
          - 'code'
        grant_types:
          - 'authorization_code'
        token_endpoint_auth_method: 'client_secret_basic'
```

Restart Authelia. Since 4.39 Authelia keeps the email out of the ID token and
gives it at its userinfo endpoint; CloudBank reads it there, so no claims
policy is needed.

**3. Tell CloudBank about it.** In your compose file:

```yaml
services:
  cloudbank:
    image: ghcr.io/easly1989/cloudbank:latest
    environment:
      CB_OIDC_ISSUER: "https://auth.example.com"
      CB_OIDC_CLIENT_ID: "cloudbank"
      CB_OIDC_CLIENT_SECRET: "${CLOUDBANK_OIDC_SECRET}"   # the Random Password, from .env
      CB_OIDC_REDIRECT_URL: "https://finance.example.com/api/v1/auth/oidc/callback"
      CB_OIDC_NAME: "Authelia"
      # For SSO only:
      CB_PASSWORD_LOGIN: "false"
      CB_OIDC_ADMIN_EMAIL: "you@example.com"
```

Restart CloudBank. Its log says `oidc: enabled`; if it also says the provider
is not reachable yet, check that the container can reach the issuer URL (it
fetches `https://auth.example.com/.well-known/openid-configuration`). CloudBank
starts anyway and tries again at the next sign-in.

## Other providers

The CloudBank side is the same everywhere; only the issuer and the client
registration change.

- **Authentik.** Create an *OAuth2/OpenID Provider* with client type
  *Confidential*, the redirect URI above, and a signing key selected (CloudBank
  needs signed tokens, RS256 or ES256). Then an *Application* that uses it. The
  issuer is `https://authentik.example.com/application/o/<application-slug>/`,
  with the trailing slash.
- **Keycloak.** In your realm, create an *OpenID Connect* client with *Client
  authentication* on and *Standard flow* checked, the redirect URI under *Valid
  redirect URIs*, and *PKCE Method* `S256` in its advanced settings. The secret
  is on the *Credentials* tab. The issuer is
  `https://keycloak.example.com/realms/<realm>`. Users need their email marked
  verified.
- **Google.** In the Google Cloud console, create an *OAuth client ID* of type
  *Web application* with the redirect URI under *Authorized redirect URIs*. The
  issuer is `https://accounts.google.com`. Anyone with a Google account can get
  through Google's side, so keep `CB_OIDC_AUTO_PROVISION` off and, for SSO only,
  set `CB_OIDC_ADMIN_EMAIL`.

## Who gets in

The provider says who someone is; CloudBank decides whether they have an
account. On a sign-in it looks, in this order, for:

1. **An account already linked** to that identity (the provider's issuer and
   subject). The link is made the first time and kept.
2. **An account with the same email**, when the provider says the email is
   verified and exactly one account has it. That account is linked.
3. **A new account**, only when `CB_OIDC_AUTO_PROVISION=true`. It is never an
   administrator, and its username comes from the email.

Anyone else is sent back to the sign-in page with an error, and a disabled
account stays out whatever the provider says.

So, without auto-provision, an administrator adds people first: **Settings ›
People › Create user**. On an SSO-only server that form asks for a username
and an email, no password; the person signs in with the provider and is matched
by that email.

### The first administrator, SSO only

A new SSO-only server has no setup form. Its setup page is the provider's
button, and **the first person to sign in becomes the administrator**.

Set `CB_OIDC_ADMIN_EMAIL` to your own email and only you can be that first
person; anyone else is refused until you have signed in. Without it, it is the
same race as the setup form of a password server: whoever gets there first.
With a provider open to anyone, such as Google, always set it.

With the password login on, an SSO sign-in before the setup form has made the
administrator is refused.

## If the provider does not answer

On an SSO-only server, every account can keep **ten one-time recovery codes**.
Make them as soon as you are in: **Settings › Security › Access recovery
codes**. They are shown once; download them as a file and keep them somewhere
safe, away from CloudBank. The card says how many are left, and making new ones
voids the old.

When the provider is down, the sign-in page says so. Choose **Use a recovery
code**, give your username and one code, and you are in. Each code works once,
and after you sign in CloudBank tells you how many remain. Wrong guesses run
into the same limit as wrong passwords.

The recovery codes are different from the ones two-factor authentication gives
on a password server; neither works in place of the other.

If the codes are gone too, whoever runs the server can make new ones for any
account from the container, without a restart:

```bash
docker exec cloudbank /cloudbank recovery-codes <username>
```

It prints ten fresh codes; the old ones stop working. (Replace `cloudbank` with
your container's name.)

Turning the password login back on with `CB_PASSWORD_LOGIN=true` and a restart
also works, but only for accounts that have a password someone knows: an
account made through SSO has a random one, never shown.
