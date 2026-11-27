import { describe, expect, it } from "vitest";

import type { OidcSettings } from "../api/client";
import { draftFrom, issuerHost, saveAction } from "./oidcForm";

const on: OidcSettings = {
  source: "settings",
  enabled: true,
  reachable: true,
  secretKey: true,
  ssoOnly: false,
  linkedUsers: 2,
  issuer: "https://auth.casa.lan",
  clientId: "cloudbank",
  hasSecret: true,
  redirectUrl: "https://cloudbank.casa.lan/api/v1/auth/oidc/callback",
  scopes: "openid profile email",
  name: "Authelia",
  autoProvision: false,
  adminEmail: "",
};
const off: OidcSettings = {
  ...on,
  source: "none",
  enabled: false,
  hasSecret: false,
  issuer: "",
  clientId: "",
  linkedUsers: 0,
};

describe("saveAction", () => {
  it("turns SSO on once the provider, the client and its secret are there", () => {
    const d = { ...draftFrom(off), issuer: "https://auth.casa.lan", clientId: "cloudbank" };
    expect(saveAction(off, d)).toEqual({
      kind: "turnOn",
      ready: false,
      keepsSecret: false,
      warnLinks: false,
    });
    expect(saveAction(off, { ...d, clientSecret: "s" }).ready).toBe(true);
  });

  it("saves with the stored secret, and warns only when another issuer drops links", () => {
    expect(saveAction(on, draftFrom(on))).toEqual({
      kind: "save",
      ready: true,
      keepsSecret: true,
      warnLinks: false,
    });
    const moved = { ...draftFrom(on), issuer: "https://id.esempio.it", clientSecret: "s" };
    expect(saveAction(on, moved)).toEqual({
      kind: "changeProvider",
      ready: true,
      keepsSecret: false,
      warnLinks: true,
    });
    expect(saveAction({ ...on, linkedUsers: 0 }, moved).warnLinks).toBe(false);
  });

  it("needs the secret again for another issuer or client", () => {
    const moved = { ...draftFrom(on), issuer: "https://id.esempio.it" };
    expect(saveAction(on, moved).ready).toBe(false);
    expect(saveAction(on, { ...draftFrom(on), clientId: "other" }).ready).toBe(false);
  });

  it("cannot save without CB_SECRET_KEY, nor what the variables set", () => {
    const d = { ...draftFrom(off), issuer: "https://a.b", clientId: "c", clientSecret: "s" };
    expect(saveAction({ ...off, secretKey: false }, d).ready).toBe(false);
    expect(saveAction({ ...on, source: "env" }, draftFrom(on)).ready).toBe(false);
  });
});

it("issuerHost keeps what is not an address", () => {
  expect(issuerHost("https://auth.casa.lan/oidc")).toBe("auth.casa.lan");
  expect(issuerHost("auth")).toBe("auth");
});
