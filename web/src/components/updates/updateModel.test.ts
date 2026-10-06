import type { UpdateStatus } from "../../api/client";
import { NIGHTLY_QUIET_MS, showUpdateCard } from "./updateModel";

const stable: UpdateStatus = {
  enabled: true,
  allowed: true,
  channel: "stable",
  current: "v3.6.1",
  latest: "v3.7.0",
  available: true,
};
const nightly: UpdateStatus = {
  ...stable,
  channel: "nightly",
  current: "nightly-1111111",
  latest: "nightly-33f8c80",
};
const now = Date.parse("2026-10-06T12:00:00Z");

describe("showUpdateCard", () => {
  it("shows a newer version while the check is on", () => {
    expect(showUpdateCard(stable, undefined, now)).toBe(true);
    expect(showUpdateCard({ ...stable, available: false }, undefined, now)).toBe(false);
    expect(showUpdateCard({ ...stable, enabled: false }, undefined, now)).toBe(false);
    expect(showUpdateCard({ ...stable, allowed: false }, undefined, now)).toBe(false);
    expect(showUpdateCard(undefined, undefined, now)).toBe(false);
  });

  it("keeps a closed stable release closed until the next one", () => {
    const closed = { version: "v3.7.0", at: "2026-01-01T00:00:00Z" };
    expect(showUpdateCard(stable, closed, now)).toBe(false);
    expect(showUpdateCard({ ...stable, latest: "v3.7.1" }, closed, now)).toBe(true);
  });

  it("brings a closed nightly back after a week, whatever the build", () => {
    const at = new Date(now - NIGHTLY_QUIET_MS + 60_000).toISOString();
    const closed = { version: "nightly-0000000", at };
    expect(showUpdateCard(nightly, closed, now)).toBe(false);
    expect(showUpdateCard(nightly, closed, now + 120_000)).toBe(true);
  });
});
