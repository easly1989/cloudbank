import { describe, expect, it } from "vitest";

import { packRows, placements } from "./entryFields";

describe("placements", () => {
  it("puts what a transaction needs in view, and the rest under More details", () => {
    const p = placements(undefined);
    expect(Object.keys(p).filter((k) => p[k as keyof typeof p] === "base")).toEqual([
      "date",
      "account",
      "memo",
      "paymentMode",
      "category",
      "status",
    ]);
  });

  it("keeps a saved choice and ignores values it does not know", () => {
    const p = placements({ payee: "base", date: "hidden" });
    expect(p.payee).toBe("base");
    expect(p.date).toBe("base");
  });
});

describe("packRows", () => {
  it("pairs narrow fields and gives wide ones a row, in the sheet's order", () => {
    expect(packRows(["status", "category", "memo", "account", "paymentMode", "date"])).toEqual([
      ["date", "account"],
      ["memo"],
      ["paymentMode", "category"],
      ["status"],
    ]);
  });

  it("gives a narrow field left without a partner the row to itself", () => {
    expect(packRows(["date", "memo", "payee", "info", "vehicle", "tags"])).toEqual([
      ["date"],
      ["memo"],
      ["payee", "info"],
      ["vehicle"],
      ["tags"],
    ]);
  });
});
