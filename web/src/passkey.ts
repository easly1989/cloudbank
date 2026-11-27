// Passkeys (#798) through the browser's own WebAuthn API. The server sends the
// options as JSON with base64url bytes; the browser wants ArrayBuffers, and
// answers with a credential that goes back as JSON.

import {
  beginPasskeyAdd,
  beginPasskeyLogin,
  finishPasskeyAdd,
  finishPasskeyLogin,
  type Passkey,
  type User,
} from "./api/client";

type Json = Record<string, unknown>;

function fromB64url(s: string): ArrayBuffer {
  const b64 = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function toB64url(buf: ArrayBuffer | null | undefined): string | undefined {
  if (!buf) return undefined;
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const withIds = (list: unknown): PublicKeyCredentialDescriptor[] =>
  ((list as Json[] | undefined) ?? []).map((d) => ({
    ...(d as unknown as PublicKeyCredentialDescriptor),
    id: fromB64url(d.id as string),
  }));

/** The browser can make and use passkeys here: a secure page with WebAuthn,
 *  reached by name. A passkey belongs to a host name, never to an IP. */
export function passkeysSupported(): boolean {
  const ip = /^[\d.]+$/.test(location.hostname) || location.hostname.includes(":");
  return window.isSecureContext && typeof window.PublicKeyCredential === "function" && !ip;
}

/** The browser offers saved passkeys in the username field (conditional UI). */
export async function conditionalPasskeys(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const pkc = window.PublicKeyCredential as unknown as {
    isConditionalMediationAvailable?: () => Promise<boolean>;
  };
  return (await pkc.isConditionalMediationAvailable?.()) ?? false;
}

function credentialJSON(cred: PublicKeyCredential): Json {
  const r = cred.response;
  const response: Json = { clientDataJSON: toB64url(r.clientDataJSON) };
  if ("attestationObject" in r) {
    const a = r as AuthenticatorAttestationResponse;
    response.attestationObject = toB64url(a.attestationObject);
    response.transports = a.getTransports?.() ?? [];
  } else {
    const a = r as AuthenticatorAssertionResponse;
    response.authenticatorData = toB64url(a.authenticatorData);
    response.signature = toB64url(a.signature);
    response.userHandle = toB64url(a.userHandle);
  }
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response,
  };
}

/**
 * Signs in with a passkey. With mediation "conditional" the browser waits
 * and offers the passkey in the username field; abort the signal to stop it.
 */
export async function signInWithPasskey(
  mediation?: "conditional",
  signal?: AbortSignal,
): Promise<User> {
  const { publicKey: pk } = (await beginPasskeyLogin()) as { publicKey: Json };
  const cred = (await navigator.credentials.get({
    mediation,
    signal,
    publicKey: {
      ...(pk as unknown as PublicKeyCredentialRequestOptions),
      challenge: fromB64url(pk.challenge as string),
      allowCredentials: withIds(pk.allowCredentials),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException("No passkey", "NotAllowedError");
  return finishPasskeyLogin(credentialJSON(cred));
}

/** Makes a passkey on this device and stores it under name. */
export async function addPasskey(name: string): Promise<Passkey> {
  const { publicKey: pk } = (await beginPasskeyAdd()) as { publicKey: Json };
  const user = pk.user as Json;
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...(pk as unknown as PublicKeyCredentialCreationOptions),
      challenge: fromB64url(pk.challenge as string),
      user: {
        ...(user as unknown as PublicKeyCredentialUserEntity),
        id: fromB64url(user.id as string),
      },
      excludeCredentials: withIds(pk.excludeCredentials),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException("No passkey", "NotAllowedError");
  return finishPasskeyAdd(name, credentialJSON(cred));
}

/** The person closed the browser's dialog or it timed out: nothing to report. */
export const passkeyCancelled = (err: unknown) =>
  err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");

/** A name for a new passkey from the browser and the system, "Chrome" and "Windows". */
export function deviceParts(ua = navigator.userAgent): { browser: string; os: string } {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { browser, os };
}
