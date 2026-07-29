import { Box, Collapse, Group, Text, UnstyledButton } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { useCallback, useState, type ReactNode } from "react";

// usePersistentBool keeps a boolean in localStorage so a section's open/closed
// state survives reloads (and is per-browser, like the register column choices).
function usePersistentBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [val, setVal] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : s === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setVal(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* storage unavailable (private mode) — keep in-memory only */
      }
    },
    [key],
  );
  return [val, set];
}

// CollapsibleSection is a bordered titled disclosure: a clickable header bar with
// a rotating chevron toggles the body. When collapsed it can show an optional
// inline `summary` so the key figures stay visible while the section is folded
// away to give the ledger more room. An optional `action` renders on the right of
// the header (outside the toggle button) and stays reachable open or closed.
export function CollapsibleSection({
  title,
  storageKey,
  defaultOpen = true,
  summary,
  action,
  children,
}: {
  title: ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  summary?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistentBool(storageKey, defaultOpen);
  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-default)",
        overflow: "hidden",
      }}
    >
      <Group
        gap="xs"
        wrap="nowrap"
        px="sm"
        py={6}
        justify="space-between"
        style={{
          background: "var(--mantine-color-default)",
          borderBottom: open ? "1px solid var(--mantine-color-default-border)" : "none",
        }}
      >
        <UnstyledButton
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Group gap="xs" wrap="nowrap" c="dimmed">
            <IconChevronRight
              size={16}
              style={{
                transform: open ? "rotate(90deg)" : "none",
                transition: "transform 150ms ease",
                flexShrink: 0,
              }}
            />
            <Text fw={600} size="sm" tt="uppercase" style={{ flexShrink: 0 }}>
              {title}
            </Text>
            {!open && summary != null && (
              <Box style={{ minWidth: 0, overflow: "hidden" }}>{summary}</Box>
            )}
          </Group>
        </UnstyledButton>
        {action != null && <Box style={{ flexShrink: 0 }}>{action}</Box>}
      </Group>
      <Collapse expanded={open}>
        <Box p="xs">{children}</Box>
      </Collapse>
    </Box>
  );
}
