// A pretend OpenID Connect provider for the SSO-only e2e (#620) and for
// looking at the SSO pages locally. Node only, no dependencies.
//
// It serves discovery, its signing key, an authorize page where you type the
// email to "sign in" as, and a token endpoint that checks PKCE and returns an
// RS256 ID token with that email marked verified. Every client id and secret
// is accepted: it is a test double, never a real provider.
//
//   FAKE_IDP_PORT=9000 node sso/fake-idp.mjs
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.FAKE_IDP_PORT ?? 9000);
const issuer = process.env.FAKE_IDP_ISSUER ?? `http://localhost:${port}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  use: "sig",
  kid: "fake-1",
};
// code → what the authorize step agreed, for the token step.
const grants = new Map();

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readForm(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(new URLSearchParams(raw)));
  });
}

function idToken(grant, clientId) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", kid: jwk.kid, typ: "JWT" }));
  const body = b64(
    JSON.stringify({
      iss: issuer,
      sub: `fake-${grant.email}`,
      aud: clientId,
      nonce: grant.nonce,
      iat: now,
      exp: now + 300,
      email: grant.email,
      email_verified: true,
      name: grant.email.split("@")[0],
    }),
  );
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${b64(sig)}`;
}

const page = (q) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fake IdP</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:16px system-ui,sans-serif;max-width:320px;margin:15vh auto;padding:0 16px}
input,button{font:inherit;width:100%;box-sizing:border-box;padding:8px;margin:6px 0}</style></head>
<body><h1>Fake IdP</h1><p>A test provider. Sign in as:</p>
<form method="post" action="/authorize">
${["redirect_uri", "state", "nonce", "code_challenge"]
  .map(
    (k) => `<input type="hidden" name="${k}" value="${esc(q.get(k) ?? "")}">`,
  )
  .join("\n")}
<label for="email">Email</label>
<input id="email" name="email" type="email" required autofocus>
<button type="submit">Sign in</button>
</form></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  if (url.pathname === "/.well-known/openid-configuration") {
    return json(res, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/keys`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "email"],
    });
  }
  if (url.pathname === "/keys") return json(res, 200, { keys: [jwk] });
  if (url.pathname === "/authorize" && req.method === "GET") {
    if (url.searchParams.get("code_challenge_method") !== "S256") {
      res.writeHead(400).end("PKCE S256 required");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(page(url.searchParams));
  }
  if (url.pathname === "/authorize" && req.method === "POST") {
    const f = await readForm(req);
    const code = b64(randomBytes(16));
    grants.set(code, {
      email: f.get("email"),
      nonce: f.get("nonce"),
      challenge: f.get("code_challenge"),
    });
    const back = new URL(f.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", f.get("state"));
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/token" && req.method === "POST") {
    const f = await readForm(req);
    const grant = grants.get(f.get("code"));
    grants.delete(f.get("code"));
    const verifier = f.get("code_verifier") ?? "";
    if (
      !grant ||
      b64(createHash("sha256").update(verifier).digest()) !== grant.challenge
    ) {
      return json(res, 400, { error: "invalid_grant" });
    }
    // The client id arrives in Basic auth or in the form, depending on the client.
    const basic = (req.headers.authorization ?? "").replace(/^Basic /, "");
    const clientId =
      f.get("client_id") ??
      decodeURIComponent(Buffer.from(basic, "base64").toString().split(":")[0]);
    return json(res, 200, {
      access_token: b64(randomBytes(16)),
      token_type: "Bearer",
      expires_in: 300,
      id_token: idToken(grant, clientId),
    });
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`fake IdP on ${issuer}`));
