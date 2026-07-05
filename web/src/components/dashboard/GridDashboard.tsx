import { GridStack, type GridStackWidget } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import "./dashboard.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { COLUMNS, type PlacedWidget } from "./layout";

// A small cell height keeps the row-rounding waste tiny: every widget's height
// is derived from its content (gridstack's resizeToContent, driven by the
// observer below) as ceil(contentPx / CELL_HEIGHT) rows, so a smaller cell means
// a tighter hug (≤ CELL_HEIGHT px of slack) with no dead band below the content.
const CELL_HEIGHT = 20;
const MOBILE_BREAKPOINT = 700;

/**
 * GridDashboard renders a free-form, drag-and-resize dashboard using gridstack.
 * gridstack owns the grid DOM (items are absolutely positioned and reparented
 * on drag); React renders each widget's content into the item's
 * `.grid-stack-item-content` element via a portal, so the widget's React tree
 * (and its queries/state) survives the moves.
 *
 * Widgets **hug their content**: a per-item ResizeObserver (below) calls
 * gridstack's `resizeToContent` to size each item to its content's natural
 * height — so there is no manual vertical resize (the handles only change
 * width) — and `float: false` compacts everything upward so there are no gaps.
 * (We drive this ourselves rather than the grid-level `sizeToContent` option,
 * whose auto-measure runs before the React portal has rendered any content.)
 *
 * The grid is rebuilt only when the set of widget ids changes (add/remove).
 * Position/size changes flow back through the `change` event to `onChange`. On
 * the mobile single-column reflow we do NOT emit, so a phone edit can't clobber
 * the saved desktop layout.
 */
export function GridDashboard({
  items,
  editing,
  onChange,
  render,
  sizes,
}: {
  items: PlacedWidget[];
  editing: boolean;
  onChange: (widgets: { id: string; x: number; y: number; w: number; h: number }[]) => void;
  render: (item: PlacedWidget) => ReactNode;
  sizes: Record<string, { minW: number; minH: number }>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridStack | null>(null);
  const [hosts, setHosts] = useState<Map<string, HTMLElement>>(new Map());

  // Keep the latest props reachable from stable gridstack callbacks.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  // True while we mutate the grid programmatically, to ignore the resulting events.
  const syncing = useRef(false);

  // The signature of the placed-widget id set: rebuild only when it changes.
  const idSig = items
    .map((i) => i.id)
    .sort()
    .join("|");

  // Init the grid once.
  useEffect(() => {
    if (!elRef.current) return;
    const grid = GridStack.init(
      {
        column: COLUMNS,
        cellHeight: CELL_HEIGHT,
        margin: 8,
        float: false, // compact upward — no vertical gaps
        staticGrid: true, // toggled by the editing effect
        // Height is content-driven (see the resize observer below), so only
        // allow horizontal resize — the corner/bottom handles are dropped.
        resizable: { handles: "e, w" },
        columnOpts: { breakpointForWindow: true, breakpoints: [{ w: MOBILE_BREAKPOINT, c: 1 }] },
      },
      elRef.current,
    );
    gridRef.current = grid;
    grid.on("change", () => {
      if (syncing.current) return;
      if (grid.getColumn() !== COLUMNS) return; // don't persist the mobile 1-col reflow
      const saved = grid.save(false) as GridStackWidget[];
      onChangeRef.current(
        saved.map((n) => ({
          id: String(n.id),
          x: n.x ?? 0,
          y: n.y ?? 0,
          w: n.w ?? 1,
          h: n.h ?? 1,
        })),
      );
    });
    return () => {
      grid.destroy(false);
      gridRef.current = null;
    };
  }, []);

  // (Re)build the grid items whenever the id set changes.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    syncing.current = true;
    grid.removeAll(true);
    const next = new Map<string, HTMLElement>();
    for (const it of itemsRef.current) {
      const min = sizesRef.current[it.type] ?? { minW: 1, minH: 1 };
      const el = grid.addWidget({
        id: it.id,
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        minW: min.minW,
        minH: min.minH,
      });
      const content = el.querySelector<HTMLElement>(".grid-stack-item-content");
      if (content) next.set(it.id, content);
    }
    syncing.current = false;
    setHosts(next);
  }, [idSig]);

  // Enable/disable drag+resize.
  useEffect(() => {
    gridRef.current?.setStatic(!editing);
  }, [editing]);

  // Content-driven heights. Each widget hugs its content: we observe every
  // item's natural-height content child and ask gridstack to recompute that
  // item's row-span (ceil(contentPx / CELL_HEIGHT)). This also covers content
  // that changes after mount — an async query resolving, a tab switch, the edit
  // header appearing — which gridstack's own grid-level observer would miss.
  //
  // The whole burst is coalesced into one rAF tick and committed inside a single
  // batchUpdate so the container height is recomputed once, from the final
  // layout (a bare resizeToContent leaves `.grid-stack`'s height stale, so a
  // grown widget would spill past the page). Vertical compaction never changes a
  // child's width, so its measured height is stable → no observer feedback loop.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || hosts.size === 0 || typeof ResizeObserver === "undefined") return;
    const pending = new Set<HTMLElement>();
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pending.size === 0) return;
      grid.batchUpdate();
      for (const item of pending) grid.resizeToContent(item);
      pending.clear();
      grid.batchUpdate(false); // commit → recompact + refresh container height
    };
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const item = (entry.target as HTMLElement).closest<HTMLElement>(".grid-stack-item");
        if (item) pending.add(item);
      }
      if (raf === 0) raf = requestAnimationFrame(flush);
    });
    for (const host of hosts.values()) {
      const child = host.firstElementChild;
      if (child) ro.observe(child);
    }
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [hosts]);

  return (
    <div ref={elRef} className={`grid-stack${editing ? " grid-stack--editing" : ""}`}>
      {[...hosts].map(([id, host]) => {
        const item = items.find((i) => i.id === id);
        return item ? createPortal(render(item), host, id) : null;
      })}
    </div>
  );
}
