import type { Assignment, Category } from "../../api/client";

export type UsedOn = "both" | "import" | "manual" | "off";

/** When a rule runs: on entry, on import (and bank sync), both or neither. */
export const usedOn = (r: Pick<Assignment, "applyOnManual" | "applyOnImport">): UsedOn =>
  r.applyOnManual && r.applyOnImport
    ? "both"
    : r.applyOnImport
      ? "import"
      : r.applyOnManual
        ? "manual"
        : "off";

/**
 * Whether every transaction the rule matches is taken first by a rule above
 * it: it never fills anything in, and the order is to blame.
 */
export const shadowed = (r: Pick<Assignment, "matches" | "reach">) =>
  (r.matches ?? 0) === 0 && (r.reach ?? 0) > 0;

/** The rules with a rule moved by delta places (-1 up, +1 down); unchanged at an end. */
export function moveBy<T extends { id: number }>(rules: T[], id: number, delta: number): T[] {
  const from = rules.findIndex((r) => r.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= rules.length) return rules;
  return moveTo(rules, id, rules[to].id);
}

/** The rules with the dragged one put where the target is. */
export function moveTo<T extends { id: number }>(rules: T[], id: number, targetId: number): T[] {
  const from = rules.findIndex((r) => r.id === id);
  const to = rules.findIndex((r) => r.id === targetId);
  if (from < 0 || to < 0 || from === to) return rules;
  const next = [...rules];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The dot beside "file it under": expense or income, as the design draws it. */
export const categoryTone = (id: number | null | undefined, categories: Category[]) =>
  categories.find((c) => c.id === id)?.isIncome ? "income" : "expense";
