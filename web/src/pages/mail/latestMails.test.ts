import { describe, expect, it } from "vitest";

import { countMails, filterMails } from "./latestMails";

describe("latest mails", () => {
  const list = (["created", "duplicate", "unrecognized", "unverified", "failed"] as const).map(
    (outcome, id) => ({ id, outcome }),
  );

  it("counts a mail with a transaction as read, every other as to review", () => {
    expect(countMails(list)).toEqual({ read: 2, review: 3, all: 5 });
    expect(countMails([])).toEqual({ read: 0, review: 0, all: 0 });
  });

  it("filters on each group, and all keeps them all", () => {
    expect(filterMails(list, "read").map((m) => m.id)).toEqual([0, 1]);
    expect(filterMails(list, "review").map((m) => m.id)).toEqual([2, 3, 4]);
    expect(filterMails(list, "all")).toBe(list);
  });
});
