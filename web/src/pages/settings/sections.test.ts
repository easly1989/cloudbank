import { describe, expect, it } from "vitest";

import { legacyTarget } from "./legacy";
import { searchRows, visibleSections, type RowContext } from "./sections";

const user: RowContext = {
  isAdmin: false,
  demo: false,
  ssoOnly: false,
  passkeys: true,
  isOwner: true,
};
const ids = (c: RowContext) => visibleSections(c).map((s) => s.id);

describe("settings map", () => {
  it("shows Administration to an administrator only, and AI never in the demo", () => {
    expect(ids(user)).not.toContain("admin");
    expect(ids({ ...user, isAdmin: true })).toContain("admin");
    expect(ids({ ...user, demo: true })).not.toContain("ai");
  });

  it("finds rows by their words, accents and case aside, and only rows the reader has", () => {
    const words = (r: { id: string }) =>
      r.id === "integrity" ? "Controllo di integrità" : r.id === "sso" ? "Single sign-on" : "";
    expect(searchRows("INTEGRITA", user, words).map((r) => r.id)).toEqual(["integrity"]);
    expect(searchRows("sign-on", user, words)).toEqual([]);
    expect(searchRows("sign-on", { ...user, isAdmin: true }, words).map((r) => r.id)).toEqual([
      "sso",
    ]);
    expect(searchRows("  ", user, words)).toEqual([]);
  });

  it("lands old addresses where their content went, query and row kept", () => {
    expect(legacyTarget("general", "", "#entry-fields")).toEqual({
      pathname: "/settings/personalization",
      search: "",
      hash: "#entry-fields",
    });
    expect(legacyTarget("security", "?passkeys=add", "")).toEqual({
      pathname: "/settings/account",
      search: "?passkeys=add",
      hash: "",
    });
    expect(legacyTarget("security", "", "#sso").pathname).toBe("/settings/admin");
    expect(legacyTarget(undefined, "?tab=wallet&section=import", "").pathname).toBe(
      "/settings/wallet/import",
    );
    expect(legacyTarget(undefined, "?tab=nav", "").hash).toBe("#navigation");
    expect(legacyTarget(undefined, "", "").pathname).toBe("/settings/home");
  });
});
