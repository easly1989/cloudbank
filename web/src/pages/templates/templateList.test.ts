import { describe, expect, it } from "vitest";

import type { Schedule, Template } from "../../api/client";
import { buildGroups, everyKey, usedKey } from "./templateList";

const tpl = (id: number, name: string): Template => ({
  id,
  name,
  accountId: 1,
  amount: -100,
  paymentMode: 0,
  status: 0,
  info: "",
  memo: "",
  tags: [],
  isSplit: false,
  isTransfer: false,
  createdAt: "2026-01-01T00:00:00Z",
});

const schedule = (id: number, templateId: number, nextDue: string): Schedule => ({
  id,
  templateId,
  templateName: "",
  templateAmount: 0,
  templateIsTransfer: false,
  unit: "month",
  everyN: 1,
  nextDue,
  weekendMode: 0,
  postAdvance: 0,
  autoPost: true,
});

describe("buildGroups", () => {
  const templates = [
    tpl(1, "Rent"),
    tpl(2, "Coffee"),
    tpl(3, "Salary"),
    tpl(4, "Weekly shop"),
    tpl(5, "Fuel"),
    tpl(6, "Bakery"),
  ];
  const schedules = [schedule(10, 1, "2026-10-01"), schedule(11, 3, "2026-09-27")];
  const usage = [
    { templateId: 1, count: 12, lastDate: "2026-09-01" },
    { templateId: 2, count: 41, lastDate: "2026-09-29" },
    { templateId: 4, count: 22, lastDate: "2026-09-26" },
    { templateId: 5, count: 0, lastDate: "2025-06-02" },
  ];
  const { quick, scheduled } = buildGroups(templates, schedules, usage);

  it("keeps a template a schedule posts apart, the next due first", () => {
    expect(scheduled.map((r) => r.template.name)).toEqual(["Salary", "Rent"]);
    expect(scheduled[1].schedule?.id).toBe(10);
  });

  it("puts the most used quick template first, then by name", () => {
    expect(quick.map((r) => r.template.name)).toEqual(["Coffee", "Weekly shop", "Bakery", "Fuel"]);
    expect(quick[0]).toMatchObject({ count: 41, lastDate: "2026-09-29" });
    expect(quick[2]).toMatchObject({ count: 0, lastDate: null });
  });
});

describe("everyKey", () => {
  it("names the unit, and the count when it is more than one", () => {
    expect(everyKey({ unit: "month", everyN: 1 })).toEqual({ key: "templates.every.month", n: 1 });
    expect(everyKey({ unit: "week", everyN: 2 })).toEqual({ key: "templates.every.weekN", n: 2 });
    expect(everyKey({ unit: "day", everyN: 0 })).toEqual({ key: "templates.every.day", n: 1 });
  });
});

describe("usedKey", () => {
  it("counts the year's uses, or says when it was last used", () => {
    expect(usedKey({ count: 3, lastDate: "2026-09-02" }).key).toBe("usedTimes");
    expect(usedKey({ count: 0, lastDate: "2025-01-02" })).toEqual({
      key: "lastUsed",
      count: 0,
      lastDate: "2025-01-02",
    });
    expect(usedKey({ count: 0, lastDate: null }).key).toBe("neverUsed");
  });
});
