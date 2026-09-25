import { describe, expect, it } from "vitest";

import type { Category, RegisterRow } from "../api/client";
import {
  activeFilterCount,
  applyFilters,
  dateBounds,
  emptyFilters,
  hiddenNewerCount,
  hiddenReconciled,
  reconciledMarks,
  isSortable,
  sortRegisterRows,
  filtersToParams,
  isActive,
  parseFilters,
  type Filters,
} from "./registerFilterModel";

function row(p: Partial<RegisterRow>): RegisterRow {
  return {
    id: 1,
    accountId: 1,
    date: "2026-03-15",
    amount: -1000,
    paymentMode: 0,
    status: 0,
    info: "",
    memo: "",
    isSplit: false,
    tags: [],
    runningBalance: 0,
    createdAt: "",
    updatedAt: "",
    ...p,
  };
}

const categories: Category[] = [
  { id: 10, name: "Food", isIncome: false, noBudget: false, noReport: false },
  { id: 11, parentId: 10, name: "Groceries", isIncome: false, noBudget: false, noReport: false },
  { id: 20, name: "Car", isIncome: false, noBudget: false, noReport: false },
];

describe("applyFilters", () => {
  const rows = [
    row({ id: 1, date: "2026-03-15", amount: -1000, categoryId: 11, payeeId: 5, tags: ["a"] }),
    row({ id: 2, date: "2026-03-20", amount: -5000, categoryId: 20, memo: "tyres" }),
    row({ id: 3, date: "2026-01-01", amount: 9000, status: 2, tags: ["b"] }),
  ];

  it("filters by category including children", () => {
    const f: Filters = { ...emptyFilters, categoryId: 10 };
    expect(applyFilters(rows, f, categories).map((r) => r.id)).toEqual([1]);
  });

  it("combines filters with AND", () => {
    const f: Filters = {
      ...emptyFilters,
      preset: "custom",
      from: "2026-03-01",
      to: "2026-03-31",
      amountMax: -2000,
    };
    expect(applyFilters(rows, f, categories).map((r) => r.id)).toEqual([2]);
  });

  it("matches text across memo/payee/category", () => {
    expect(
      applyFilters(rows, { ...emptyFilters, text: "tyres" }, categories).map((r) => r.id),
    ).toEqual([2]);
  });

  it("matches any selected tag", () => {
    expect(
      applyFilters(rows, { ...emptyFilters, tags: ["b"] }, categories).map((r) => r.id),
    ).toEqual([3]);
  });

  it("filters by status", () => {
    expect(applyFilters(rows, { ...emptyFilters, status: 2 }, categories).map((r) => r.id)).toEqual(
      [3],
    );
  });

  it("hides future-dated rows when hideFuture is on", () => {
    const now = new Date("2026-03-16T00:00:00Z");
    const f: Filters = { ...emptyFilters, hideFuture: true };
    // id 2 (2026-03-20) is in the future relative to now and is dropped.
    expect(applyFilters(rows, f, categories, now).map((r) => r.id)).toEqual([1, 3]);
  });

  it("keeps only transfers when transfers=only", () => {
    const xfer = row({ id: 4, transferId: 99 });
    expect(
      applyFilters([...rows, xfer], { ...emptyFilters, transfers: "only" }, categories).map(
        (r) => r.id,
      ),
    ).toEqual([4]);
  });

  it("excludes transfers when transfers=none", () => {
    const xfer = row({ id: 4, transferId: 99 });
    expect(
      applyFilters([...rows, xfer], { ...emptyFilters, transfers: "none" }, categories).map(
        (r) => r.id,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("keeps only unflagged rows when noFlags is on", () => {
    // id 3 has status 2 (reconciled); ids 1 and 2 have status 0.
    expect(
      applyFilters(rows, { ...emptyFilters, noFlags: true }, categories).map((r) => r.id),
    ).toEqual([1, 2]);
  });
});

describe("dateBounds", () => {
  it("computes this-month bounds", () => {
    const b = dateBounds(
      { ...emptyFilters, preset: "thisMonth" },
      new Date("2026-03-15T12:00:00Z"),
    );
    expect(b).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });
  it("computes this-quarter bounds", () => {
    const b = dateBounds(
      { ...emptyFilters, preset: "thisQuarter" },
      new Date("2026-03-15T12:00:00Z"),
    );
    expect(b).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  // These pin the timezone contract: bounds follow the user's *local* calendar
  // day. The instants below fall on a different date in UTC than they do
  // locally in most zones, which is where the old toISOString() path broke.
  it("resolves month bounds from the local day, just after local midnight", () => {
    const b = dateBounds({ ...emptyFilters, preset: "thisMonth" }, new Date(2026, 2, 1, 0, 30));
    expect(b).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("resolves month bounds from the local day, just before local midnight", () => {
    const b = dateBounds({ ...emptyFilters, preset: "thisMonth" }, new Date(2026, 2, 31, 23, 30));
    expect(b).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("splits the year into calendar halves", () => {
    const first = dateBounds({ ...emptyFilters, preset: "thisHalf" }, new Date(2026, 2, 15));
    expect(first).toEqual({ from: "2026-01-01", to: "2026-06-30" });
    const second = dateBounds({ ...emptyFilters, preset: "thisHalf" }, new Date(2026, 8, 15));
    expect(second).toEqual({ from: "2026-07-01", to: "2026-12-31" });
  });

  it("puts the turn of the half on the right side of the line", () => {
    // 30 June is the last day of the first half; 1 July the first of the second.
    expect(dateBounds({ ...emptyFilters, preset: "thisHalf" }, new Date(2026, 5, 30)).to).toBe(
      "2026-06-30",
    );
    expect(dateBounds({ ...emptyFilters, preset: "thisHalf" }, new Date(2026, 6, 1)).from).toBe(
      "2026-07-01",
    );
  });

  it("resolves year bounds across the new-year boundary", () => {
    const b = dateBounds({ ...emptyFilters, preset: "thisYear" }, new Date(2026, 0, 1, 0, 30));
    expect(b).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("ends a rolling window on the local today", () => {
    const b = dateBounds({ ...emptyFilters, preset: "last30" }, new Date(2026, 2, 31, 23, 30));
    expect(b).toEqual({ from: "2026-03-02", to: "2026-03-31" });
  });
});

describe("URL round-trip", () => {
  it("serializes and parses back to the same filters", () => {
    const f: Filters = {
      preset: "custom",
      from: "2026-01-01",
      to: "2026-02-01",
      status: 1,
      payeeId: 7,
      categoryId: 10,
      tags: ["x", "y"],
      amountMin: -5000,
      amountMax: 5000,
      text: "rent",
      hideFuture: true,
      transfers: "none",
      noFlags: true,
      uncategorised: true,
    };
    const round = parseFilters(new URLSearchParams(filtersToParams(f)));
    expect(round).toEqual(f);
  });

  it("omits default keys", () => {
    expect(filtersToParams(emptyFilters)).toEqual({});
  });
});

describe("activeFilterCount / isActive", () => {
  it("is zero (inactive) for empty filters", () => {
    expect(activeFilterCount(emptyFilters)).toBe(0);
    expect(isActive(emptyFilters)).toBe(false);
  });

  it("counts each set facet once", () => {
    const f: Filters = {
      ...emptyFilters,
      preset: "thisMonth",
      status: 1,
      tags: ["a", "b"], // still one facet
      hideFuture: true,
      uncategorised: true,
    };
    expect(activeFilterCount(f)).toBe(5);
    expect(isActive(f)).toBe(true);
  });

  it("ignores whitespace-only search text", () => {
    expect(activeFilterCount({ ...emptyFilters, text: "   " })).toBe(0);
    expect(activeFilterCount({ ...emptyFilters, text: "rent" })).toBe(1);
  });
});

describe("hiddenNewerCount", () => {
  const at = (id: number, date: string) => ({ id, date }) as RegisterRow;
  const all = [at(4, "2026-03-20"), at(3, "2026-03-15"), at(2, "2026-03-10"), at(1, "2026-03-01")];

  it("counts what the filter hides above the top visible line", () => {
    // Filtered to the two older rows: two newer ones are hidden.
    expect(hiddenNewerCount(all, [at(2, "2026-03-10"), at(1, "2026-03-01")])).toBe(2);
  });

  it("is zero when the newest row is on screen", () => {
    expect(hiddenNewerCount(all, all)).toBe(0);
    expect(hiddenNewerCount(all, [at(4, "2026-03-20"), at(1, "2026-03-01")])).toBe(0);
  });

  it("says nothing when there is nothing to show: an empty result speaks for itself", () => {
    expect(hiddenNewerCount(all, [])).toBe(0);
    expect(hiddenNewerCount([], [])).toBe(0);
  });

  it("does not count a hidden row that is older than the top line", () => {
    // Row 2 is missing from the visible set but sits below the newest shown.
    expect(hiddenNewerCount(all, [at(4, "2026-03-20"), at(1, "2026-03-01")])).toBe(0);
  });

  it("counts a same-day row as newer only when it is strictly later", () => {
    const sameDay = [at(9, "2026-03-10"), at(2, "2026-03-10")];
    expect(hiddenNewerCount(sameDay, [at(2, "2026-03-10")])).toBe(0);
  });
});

describe("hiddenReconciled", () => {
  const rows = [
    row({ id: 1, date: "2026-03-01", status: 2, payeeName: "Rent" }),
    row({ id: 2, date: "2026-03-05", status: 2, payeeName: "Cinema" }),
    row({ id: 3, date: "2026-03-10", status: 1, payeeName: "Cinema" }),
    row({ id: 4, date: "2026-03-12", status: 0, payeeName: "Rent" }),
  ];
  const f = (p: Partial<Filters>): Filters => ({ ...emptyFilters, ...p });
  const ids = (rs: RegisterRow[]) => rs.map((r) => r.id);

  it("is nothing unless the status filter leaves reconciled rows out", () => {
    expect(hiddenReconciled(rows, emptyFilters, [])).toEqual([]);
    // A date or text filter hides rows, but the reconciled ones it keeps show their status.
    expect(hiddenReconciled(rows, f({ text: "cinema" }), [])).toEqual([]);
    expect(hiddenReconciled(rows, f({ status: 2 }), [])).toEqual([]);
  });

  it("is the reconciled rows a status filter hides", () => {
    expect(ids(hiddenReconciled(rows, f({ status: 1 }), []))).toEqual([1, 2]);
    expect(ids(hiddenReconciled(rows, f({ status: 0 }), []))).toEqual([1, 2]);
    expect(ids(hiddenReconciled(rows, f({ noFlags: true }), []))).toEqual([1, 2]);
  });

  it("counts only the reconciled rows every other filter would keep", () => {
    expect(ids(hiddenReconciled(rows, f({ status: 1, text: "cinema" }), []))).toEqual([2]);
  });
});

describe("reconciledMarks", () => {
  // Newest first, as the register shows it.
  const ledger = [
    row({ id: 9, date: "2026-03-25", status: 1 }),
    row({ id: 8, date: "2026-03-25", status: 2 }),
    row({ id: 7, date: "2026-03-24", status: 1 }),
    row({ id: 6, date: "2026-03-24", status: 2 }),
    row({ id: 5, date: "2026-03-23", status: 2 }),
    row({ id: 4, date: "2026-03-20", status: 1 }),
    row({ id: 3, date: "2026-03-15", status: 2 }),
    row({ id: 2, date: "2026-03-10", status: 2 }),
    row({ id: 1, date: "2026-03-01", status: 2 }),
  ];
  const cleared = ledger.filter((r) => r.status === 1);
  const reconciled = ledger.filter((r) => r.status === 2);

  it("puts one line where each run of hidden reconciled rows sits", () => {
    expect(reconciledMarks(ledger, cleared, reconciled)).toEqual([
      // Below the first 25th: the reconciled one of that day.
      { before: 1, count: 1, from: "2026-03-25", to: "2026-03-25", closesLedger: false },
      // Two days in one run: no visible row between them.
      { before: 2, count: 2, from: "2026-03-23", to: "2026-03-24", closesLedger: false },
      // After the last visible row, and everything older is reconciled.
      { before: 3, count: 3, from: "2026-03-01", to: "2026-03-15", closesLedger: true },
    ]);
  });

  it("only closes the ledger when every older row is reconciled", () => {
    // "Not reconciled" also hides the cleared rows, which are not reconciled.
    const older = [...ledger, row({ id: 0, date: "2026-02-20", status: 1 })];
    const marks = reconciledMarks(older, cleared, reconciled);
    expect(marks[marks.length - 1]).toMatchObject({ before: 3, count: 3, closesLedger: false });
  });

  it("marks a run above the first visible row", () => {
    const visible = [ledger[2]];
    expect(reconciledMarks(ledger, visible, [ledger[1]])).toEqual([
      { before: 0, count: 1, from: "2026-03-25", to: "2026-03-25", closesLedger: false },
    ]);
  });

  it("is nothing when nothing is visible, or nothing reconciled is hidden", () => {
    expect(reconciledMarks(ledger, [], reconciled)).toEqual([]);
    expect(reconciledMarks(ledger, cleared, [])).toEqual([]);
  });
});

describe("sortRegisterRows", () => {
  const r = (id: number, over: Partial<RegisterRow>) => row({ id, ...over });
  const rows = [
    r(1, { date: "2026-03-01", amount: -500, payeeName: "Zeta" }),
    r(2, { date: "2026-03-03", amount: 1200, payeeName: "alfa" }),
    r(3, { date: "2026-03-02", amount: -50, payeeName: undefined }),
  ];

  it("leaves the ledger alone when nothing is sorted", () => {
    expect(sortRegisterRows(rows, null)).toBe(rows);
    expect(sortRegisterRows(rows, { id: "nonsense", desc: false })).toBe(rows);
  });

  it("sorts numerically, not as text", () => {
    // As strings "-500" would come before "-50"; as numbers it is the other way.
    expect(sortRegisterRows(rows, { id: "amount", desc: false }).map((x) => x.amount)).toEqual([
      -500, -50, 1200,
    ]);
    expect(sortRegisterRows(rows, { id: "amount", desc: true }).map((x) => x.amount)).toEqual([
      1200, -50, -500,
    ]);
  });

  it("compares names the way a reader expects, not by character code", () => {
    // A plain sort would put "Zeta" before "alfa" because of the capital.
    expect(sortRegisterRows(rows, { id: "payee", desc: false }).map((x) => x.payeeName)).toEqual([
      "alfa",
      "Zeta",
      undefined,
    ]);
  });

  it("keeps blanks at the bottom whichever way the column points", () => {
    for (const desc of [false, true]) {
      const last = sortRegisterRows(rows, { id: "payee", desc }).at(-1);
      expect(last?.payeeName, `desc=${desc}`).toBeUndefined();
    }
  });

  it("is stable, so rows with the same value stay in date order", () => {
    const tied = [
      r(1, { date: "2026-03-01", amount: 100 }),
      r(2, { date: "2026-03-02", amount: 100 }),
    ];
    expect(sortRegisterRows(tied, { id: "amount", desc: false }).map((x) => x.id)).toEqual([1, 2]);
  });

  it("does not mutate the rows it was given", () => {
    const before = rows.map((x) => x.id);
    sortRegisterRows(rows, { id: "amount", desc: true });
    expect(rows.map((x) => x.id)).toEqual(before);
  });

  it("knows which columns can be sorted", () => {
    expect(isSortable("amount")).toBe(true);
    expect(isSortable("actions")).toBe(false);
  });
});
