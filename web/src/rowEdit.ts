import type { CSSProperties, MouseEvent } from "react";

// rowEditProps wires double-click-to-edit onto a table row: a double-click opens
// the row's edit action, and text selection is disabled so the double-click
// doesn't flash a text selection. Spread it onto a Mantine Table.Tr (or a row
// element): <Table.Tr {...rowEditProps(() => openEdit(x))}>.
export function rowEditProps(open: () => void): {
  onDoubleClick: () => void;
  style: CSSProperties;
} {
  return { onDoubleClick: open, style: { cursor: "pointer", userSelect: "none" } };
}

// rowFocusProps wires double-click-to-edit onto an INLINE-editable row (one that
// edits in place rather than opening a modal, e.g. Budget and Currencies): a
// double-click focuses and selects the row's first editable input. Radios and
// checkboxes (e.g. a mode SegmentedControl) are skipped. Spread onto the
// Table.Tr: <Table.Tr {...rowFocusProps()}>.
export function rowFocusProps(): {
  onDoubleClick: (e: MouseEvent<HTMLElement>) => void;
} {
  return {
    onDoubleClick: (e) => {
      const input = e.currentTarget.querySelector<HTMLInputElement>(
        "input:not([type='radio']):not([type='checkbox'])",
      );
      input?.focus();
      input?.select?.();
    },
  };
}

// stopRowEdit keeps an interactive cell (e.g. the actions column) from also
// triggering the row's double-click-to-edit. Spread onto that cell:
// <Table.Td {...stopRowEdit}>.
export const stopRowEdit = {
  onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
};
