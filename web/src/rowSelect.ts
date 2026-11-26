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

// The pure part: what a modified click on `index` selects. `fallback` is the
// anchor when none was set yet (the cursor row). Updates the anchor.
export function selectionFor(
  mods: { shift: boolean; toggle: boolean },
  index: number,
  anchor: MutableRefObject<number | null>,
  fallback: number | null = null,
): RowSelection | null {
  if (mods.toggle) {
    anchor.current = index;
    return { mode: "toggle", index };
  }
  if (!mods.shift) return null;
  const from = anchor.current ?? fallback ?? index;
  anchor.current = from;
  return { mode: "range", from: Math.min(from, index), to: Math.max(from, index) };
}

// A click on a row: the selection it makes, or null when it is a plain click
// (or a click on a control) and the caller does what it always did.
export function rowClick(
  e: ReactMouseEvent<HTMLElement>,
  index: number,
  anchor: MutableRefObject<number | null>,
  fallback: number | null = null,
): RowSelection | null {
  if (!ownClick(e)) return null;
  return selectionFor(
    { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey },
    index,
    anchor,
    fallback,
  );
}
