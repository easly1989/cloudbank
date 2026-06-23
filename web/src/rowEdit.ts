import type { CSSProperties } from "react";

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

// stopRowEdit keeps an interactive cell (e.g. the actions column) from also
// triggering the row's double-click-to-edit. Spread onto that cell:
// <Table.Td {...stopRowEdit}>.
export const stopRowEdit = {
  onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
};
