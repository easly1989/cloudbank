import type { Schedule, Template, TemplateUsage } from "../../api/client";

/** A template with how often it was used, and the schedule that posts it, if one does. */
export interface TemplateRow {
  template: Template;
  schedule: Schedule | null;
  /** Transactions made from it in the last twelve months. */
  count: number;
  /** The latest transaction made from it, whenever that was. */
  lastDate: string | null;
}

export interface TemplateGroups {
  /** Picked from the entry sheet: the most used first. */
  quick: TemplateRow[];
  /** What a schedule posts: the next due first. */
  scheduled: TemplateRow[];
}

/**
 * The page's two groups (#560). A template a schedule posts is edited and
 * deleted with its schedule, so it sits apart from the ones kept for quick
 * entry.
 */
export function buildGroups(
  templates: Template[],
  schedules: Schedule[],
  usage: TemplateUsage[],
): TemplateGroups {
  const scheduleOf = new Map(schedules.map((s) => [s.templateId, s]));
  const usageOf = new Map(usage.map((u) => [u.templateId, u]));
  const rows = templates.map<TemplateRow>((template) => {
    const u = usageOf.get(template.id);
    return {
      template,
      schedule: scheduleOf.get(template.id) ?? null,
      count: u?.count ?? 0,
      lastDate: u?.lastDate || null,
    };
  });
  const byName = (a: TemplateRow, b: TemplateRow) => a.template.name.localeCompare(b.template.name);
  return {
    quick: rows.filter((r) => !r.schedule).sort((a, b) => b.count - a.count || byName(a, b)),
    scheduled: rows
      .filter((r) => r.schedule)
      .sort((a, b) => a.schedule!.nextDue.localeCompare(b.schedule!.nextDue) || byName(a, b)),
  };
}

/** How often a schedule comes round, as an i18n key and its count: "Every month", "Every 2 weeks". */
export function everyKey(s: Pick<Schedule, "unit" | "everyN">): { key: string; n: number } {
  const n = Math.max(1, s.everyN);
  return { key: `templates.every.${s.unit}${n > 1 ? "N" : ""}`, n };
}

/**
 * How a template's use reads, as the last part of an i18n key — the row and
 * the sheet each word it their own way — and its values.
 */
export function usedKey(r: Pick<TemplateRow, "count" | "lastDate">): {
  key: "usedTimes" | "lastUsed" | "neverUsed";
  count: number;
  lastDate: string | null;
} {
  if (r.count > 0) return { key: "usedTimes", count: r.count, lastDate: r.lastDate };
  if (r.lastDate) return { key: "lastUsed", count: 0, lastDate: r.lastDate };
  return { key: "neverUsed", count: 0, lastDate: null };
}
