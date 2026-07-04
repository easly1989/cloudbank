// Free-form dashboard layout model (issue #199, phase 1). Each placed widget
// has an instance id, a type, and a 2D grid rectangle (x/y/w/h) in a 12-column
// grid. The previous model — { order, hidden, spans } with a coarse full/half/
// third column span — is migrated into this one so existing users keep their
// dashboard.

export const WIDGET_TYPES = [
  "totals",
  "quickAdd",
  "incomeExpense",
  "accounts",
  "spending",
  "budget",
  "upcoming",
  "accountBalance",
  "recentTransactions",
  "kpi",
  "notes",
  "currencyRates",
  "categoryBudget",
  "netWorthTrend",
  "balanceSparkline",
  "spendingHeatmap",
  "uncleared",
  "cashflow",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

// The widgets placed on a fresh dashboard (and back-filled when migrating an
// older layout). The remaining WIDGET_TYPES are opt-in from the "Add widget"
// palette, so new widget types don't clutter existing users' dashboards.
export const DEFAULT_WIDGET_TYPES: WidgetType[] = [
  "totals",
  "quickAdd",
  "incomeExpense",
  "accounts",
  "spending",
  "budget",
  "upcoming",
];

export const COLUMNS = 12;

export interface PlacedWidget {
  /**
   * Unique instance id. The first instance of a type uses the bare type name
   * (so phase-1 layouts stay valid); further instances get "type-2", "type-3", …
   */
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Opaque per-instance configuration, interpreted by the widget's renderer. */
  config?: Record<string, unknown>;
}

export interface DashboardLayoutV2 {
  version: 2;
  widgets: PlacedWidget[];
}

/** Default and minimum sizes per widget type (12-col grid; ~96px rows). */
export const WIDGET_SIZES: Record<
  WidgetType,
  { w: number; h: number; minW: number; minH: number }
> = {
  totals: { w: 12, h: 2, minW: 4, minH: 2 },
  quickAdd: { w: 12, h: 2, minW: 4, minH: 2 },
  incomeExpense: { w: 6, h: 4, minW: 3, minH: 3 },
  accounts: { w: 6, h: 4, minW: 3, minH: 2 },
  spending: { w: 6, h: 4, minW: 3, minH: 3 },
  budget: { w: 6, h: 3, minW: 3, minH: 2 },
  upcoming: { w: 12, h: 4, minW: 4, minH: 3 },
  accountBalance: { w: 4, h: 2, minW: 2, minH: 2 },
  recentTransactions: { w: 6, h: 4, minW: 3, minH: 3 },
  kpi: { w: 3, h: 2, minW: 2, minH: 2 },
  notes: { w: 4, h: 3, minW: 2, minH: 2 },
  currencyRates: { w: 4, h: 3, minW: 2, minH: 2 },
  categoryBudget: { w: 6, h: 3, minW: 3, minH: 2 },
  netWorthTrend: { w: 6, h: 3, minW: 3, minH: 3 },
  balanceSparkline: { w: 4, h: 2, minW: 2, minH: 2 },
  spendingHeatmap: { w: 5, h: 4, minW: 3, minH: 3 },
  uncleared: { w: 4, h: 3, minW: 2, minH: 2 },
  cashflow: { w: 6, h: 3, minW: 3, minH: 3 },
};

const isWidgetType = (t: string): t is WidgetType =>
  (WIDGET_TYPES as readonly string[]).includes(t);

function spanToWidth(span: string | undefined): number {
  return span === "half" ? 6 : span === "third" ? 4 : 12;
}

// pack lays out a list of widths/heights left-to-right, wrapping at COLUMNS,
// returning each item's x/y. Deterministic, so a given order always maps to the
// same grid.
function pack(sizes: { w: number; h: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const s of sizes) {
    if (x + s.w > COLUMNS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    out.push({ x, y });
    x += s.w;
    rowH = Math.max(rowH, s.h);
  }
  return out;
}

/** The default layout: the default widgets in their natural order and size. */
export function defaultLayout(order?: WidgetType[]): DashboardLayoutV2 {
  const types = order && order.length > 0 ? order : [...DEFAULT_WIDGET_TYPES];
  const sizes = types.map((t) => WIDGET_SIZES[t]);
  const pos = pack(sizes);
  return {
    version: 2,
    widgets: types.map((type, i) => ({
      id: type,
      type,
      w: sizes[i].w,
      h: sizes[i].h,
      x: pos[i].x,
      y: pos[i].y,
    })),
  };
}

type LegacyLayout = { order?: string[]; hidden?: string[]; spans?: Record<string, string> };

/**
 * Migrate any stored dashboardLayout into the v2 model. A v2 layout is returned
 * as-is (dropping unknown widget types); a legacy { order, hidden, spans } is
 * converted by dropping hidden widgets, mapping the span to a width and packing
 * the rest in order.
 */
export function migrateLayout(saved: unknown): DashboardLayoutV2 {
  if (
    saved &&
    typeof saved === "object" &&
    (saved as { version?: number }).version === 2 &&
    Array.isArray((saved as DashboardLayoutV2).widgets)
  ) {
    const widgets = (saved as DashboardLayoutV2).widgets.filter((w) => isWidgetType(w.type));
    return widgets.length > 0 ? { version: 2, widgets } : defaultLayout();
  }

  const legacy = (saved ?? {}) as LegacyLayout;
  const seen = new Set<string>();
  const order: WidgetType[] = [];
  for (const id of legacy.order ?? [])
    if (isWidgetType(id) && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  for (const t of DEFAULT_WIDGET_TYPES) if (!seen.has(t)) order.push(t);

  const hidden = new Set(legacy.hidden ?? []);
  const visible = order.filter((t) => !hidden.has(t));
  const sizes = visible.map((t) => ({
    w: legacy.spans ? spanToWidth(legacy.spans[t]) : WIDGET_SIZES[t].w,
    h: WIDGET_SIZES[t].h,
  }));
  const pos = pack(sizes);
  return {
    version: 2,
    widgets: visible.map((type, i) => ({
      id: type,
      type,
      w: sizes[i].w,
      h: sizes[i].h,
      x: pos[i].x,
      y: pos[i].y,
    })),
  };
}

/**
 * A fresh unique instance id for a new widget of the given type: the bare type
 * name if free, else "type-2", "type-3", … (so multiple instances of a type can
 * coexist).
 */
export function newInstanceId(type: WidgetType, existing: PlacedWidget[]): string {
  const ids = new Set(existing.map((w) => w.id));
  if (!ids.has(type)) return type;
  let n = 2;
  while (ids.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}
