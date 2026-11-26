import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";

// Ctrl/Cmd+click toggles a row and makes it the anchor; Shift+click adds every
// row from the anchor to the one clicked, as the register's checkbox always
// did. Rows are addressed by their index in the list as shown.
export type RowSelection =
  { mode: "toggle"; index: number } | { mode: "range"; from: number; to: number };

// The press must not start a text selection, but only when it is going to
// select rows: ordinary text selection elsewhere stays.
const SKIP = "a,button,input,select,textarea,label,[role=menu],[role=menuitem],[role=option]";

// A click on a control inside the row belongs to that control. A target outside
// the row's own DOM is a portal (a dropdown) whose events bubble through React.
function ownClick(e: ReactMouseEvent<HTMLElement>): boolean {
  const target = e.target as HTMLElement;
  return e.currentTarget.contains(target) && !target.closest(SKIP);
}

const multi = (e: ReactMouseEvent) => e.shiftKey || e.ctrlKey || e.metaKey;

export function rowMouseDown(e: ReactMouseEvent<HTMLElement>) {
  if (multi(e) && ownClick(e)) e.preventDefault();
}

// The pure part: what a modified click on `index` selects. The anchor is a row
// id, found again in `ids` at click time, so a sort, a filter or a deleted row
// cannot leave it pointing at the wrong place. When it is gone, `fallback` (the
// cursor row) stands in, then the clicked row. `can` rules out rows that
// cannot be selected: they neither select nor become the anchor.
export function selectionFor<K>(
  mods: { shift: boolean; toggle: boolean },
  ids: K[],
  index: number,
  anchor: MutableRefObject<K | null>,
  fallback: K | null = null,
  can: (index: number) => boolean = () => true,
): RowSelection | null {
  if (!can(index) || !(mods.toggle || mods.shift)) return null;
  if (mods.toggle) {
    anchor.current = ids[index];
    return { mode: "toggle", index };
  }
  let from = anchor.current == null ? -1 : ids.indexOf(anchor.current);
  if (from < 0) from = fallback == null ? -1 : ids.indexOf(fallback);
  if (from < 0) from = index;
  anchor.current = ids[from];
  return { mode: "range", from: Math.min(from, index), to: Math.max(from, index) };
}

// A click on a row: the selection it makes, or null when it is a plain click
// (or a click on a control) and the caller does what it always did. The second
// click of a double-click selects nothing: the double-click opens the row.
export function rowClick<K>(
  e: ReactMouseEvent<HTMLElement>,
  ids: K[],
  index: number,
  anchor: MutableRefObject<K | null>,
  fallback: K | null = null,
  can?: (index: number) => boolean,
): RowSelection | null {
  if (!ownClick(e) || e.detail > 1) return null;
  return selectionFor(
    { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey },
    ids,
    index,
    anchor,
    fallback,
    can,
  );
}

// A double-click with a modifier held is part of a selection, not an edit.
export const isMultiClick = multi;
