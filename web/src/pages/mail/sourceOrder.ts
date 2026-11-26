/**
 * The ids in their new order once the one at `from` moves to `to`, or null
 * when nothing moves (#794: Move up / Move down in a source's menu).
 */
export function moveOrder(ids: number[], from: number, to: number): number[] | null {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return null;
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
