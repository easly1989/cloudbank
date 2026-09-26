import { describe, expect, it } from "vitest";
import { compareRows, type Described } from "./reviewCompare";

const blank: Described = {
  amount: "",
  account: "",
  transfer: "",
  payee: "",
  category: "",
  memo: "",
  info: "",
  paymentMode: "",
  status: "",
  tags: "",
};

describe("compareRows", () => {
  const manual: Described = {
    ...blank,
    amount: "-39,00 €",
    account: "Checking",
    payee: "Gym",
    category: "Sport",
    memo: "Gym",
    status: "Cleared",
  };
  const bank: Described = {
    ...blank,
    amount: "-39,00 €",
    account: "Checking",
    memo: "CARD PAYMENT 4000 XXXX XXXX XX02 MADE ON 2026-09-03 AT 18:42 CITY GYM",
    info: "POS 0042",
    paymentMode: "Debit card",
    status: "Cleared",
  };

  it("lists the fields in order, and marks what the two share", () => {
    expect(compareRows(manual, bank)).toEqual([
      { field: "amount", a: "-39,00 €", b: "-39,00 €", same: true },
      { field: "account", a: "Checking", b: "Checking", same: true },
      { field: "payee", a: "Gym", b: "", same: false },
      { field: "category", a: "Sport", b: "", same: false },
      { field: "memo", a: "Gym", b: bank.memo, same: false },
      { field: "info", a: "", b: "POS 0042", same: false },
      { field: "paymentMode", a: "", b: "Debit card", same: false },
      { field: "status", a: "Cleared", b: "Cleared", same: true },
    ]);
  });

  it("leaves out a field empty on both sides", () => {
    const rows = compareRows(manual, bank).map((r) => r.field);
    expect(rows).not.toContain("tags");
    expect(rows).not.toContain("transfer");
  });

  it("keeps the whole memo, however long", () => {
    const long = "X".repeat(500);
    const row = compareRows({ ...blank, memo: long }, blank).find((r) => r.field === "memo");
    expect(row?.a).toBe(long);
  });
});
