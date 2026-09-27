import { describe, expect, it } from "vitest";

import { sinceNow } from "./bankSyncNotice";

describe("sinceNow", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");

  it("says now under a minute", () => {
    expect(sinceNow("2026-09-27T11:59:50Z", "en", now)).toBe("now");
    expect(sinceNow("2026-09-27T11:59:50Z", "it", now)).toBe("ora");
  });

  it("says minutes under an hour", () => {
    expect(sinceNow("2026-09-27T11:55:00Z", "en", now)).toBe("5 minutes ago");
  });

  it("says hours under a day", () => {
    expect(sinceNow("2026-09-27T10:00:00Z", "it", now)).toBe("2 ore fa");
  });

  it("says days after that", () => {
    expect(sinceNow("2026-09-26T11:00:00Z", "en", now)).toBe("yesterday");
    expect(sinceNow("2026-09-22T12:00:00Z", "en", now)).toBe("5 days ago");
  });
});
