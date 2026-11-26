import { describe, expect, it } from "vitest";
import type { Transaction } from "../api/client";
import { bankFirst, defaultPicks, mergeBlock, mergedRow, takeFromOther } from "./mergeRows";

const row = (over: Partial<Transaction>): Transaction => ({
  id: 1,
  accountId: 1,
  date: "2026-11-26",
  amount: -1299,
  paymentMode: 0,
  status: 0,
  info: "",
  memo: "",
  isSplit: false,
  tags: [],
  createdAt: "",
  updatedAt: "",
  ...over,
});

// The bank's row and the one typed by hand for the same spending (#786).
const bank = row({
  id: 7,
  importRef: "eb:1",
  status: 1,
  payeeId: 3,
  memo: "PAG SU POS ESTERO EFFETTUATO IL 22/11/2026 PP*HUMBLEBUNDL 35314369001",
});
const hand = row({
  id: 9,
  date: "2026-11-29",
  payeeId: 4,
  categoryId: 5,
  memo: "Humble Choice",
  tags: ["subscriptions"],
});

describe("merging two rows", () => {
  it("puts the bank's row first: a bank ref, then a mail's, then the older row", () => {
    expect(bankFirst(hand, bank)).toEqual([bank, hand]);
    const mail = row({ id: 2, importRef: "mail:x" });
    expect(bankFirst(mail, bank)).toEqual([bank, mail]);
    expect(bankFirst(hand, mail)).toEqual([mail, hand]);
    expect(bankFirst(hand, row({ id: 3 }))[0].id).toBe(3);
  });

  it("takes date, amount and status from the bank, the words from the more complete row", () => {
    // The hand row has all four words, the bank two: the hand memo wins even
    // though the bank's is longer.
    expect(defaultPicks([bank, hand])).toEqual({
      date: 0,
      amount: 0,
      status: 0,
      payee: 1,
      category: 1,
      memo: 1,
      tags: 1,
    });
  });

  it("fills a word the more complete row lacks from the other, and breaks a tie towards the other row", () => {
    const sparse = row({ id: 9, categoryId: 5, tags: ["a"], memo: "" });
    // Two words each: a tie goes to the other row, but its memo is empty.
    expect(defaultPicks([bank, sparse])).toMatchObject({ payee: 0, category: 1, memo: 0, tags: 1 });
  });

  it("sends only the fields that differ and come from the other row", () => {
    const picks = defaultPicks([bank, hand]);
    expect(takeFromOther([bank, hand], picks)).toEqual(["payee", "category", "memo", "tags"]);
    const same = { ...hand, payeeId: 3 };
    expect(takeFromOther([bank, same], picks)).not.toContain("payee");
    expect(mergedRow([bank, hand], picks)).toMatchObject({
      id: 7,
      date: "2026-11-26",
      importRef: "eb:1",
      memo: "Humble Choice",
      categoryId: 5,
    });
  });

  it("says why a pair cannot be merged", () => {
    expect(mergeBlock([bank, hand])).toBeNull();
    expect(mergeBlock([bank, { ...hand, transferId: 1 }])).toBe("transfer");
    expect(mergeBlock([bank, { ...hand, isSplit: true }])).toBe("split");
    expect(mergeBlock([bank, { ...hand, accountId: 2 }])).toBe("accounts");
  });
});
