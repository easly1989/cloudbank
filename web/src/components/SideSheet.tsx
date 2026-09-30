import { Drawer, Group, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ENTRY_SHEET } from "./entrySheetTheme";

/**
 * A sheet beside the page, built like the entry sheet: 396px on the right, from
 * the bottom on a phone, a title with a line under it, the fields, and a foot
 * that stays in view however long the sheet grows.
 *
 * The secondary pages open their forms in it rather than in a dialog (#546):
 * the page stays readable beside it, and the reader can check what they are
 * editing against it.
 */
export function SideSheet({
  opened,
  onClose,
  title,
  subtitle,
  headerActions,
  foot,
  children,
  testId,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One line under the title: what the sheet is about, or when. */
  subtitle?: ReactNode;
  /** Icon buttons beside the close button. */
  headerActions?: ReactNode;
  /** The sheet's actions, right-aligned at its foot. */
  foot?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  return (
    <Drawer.Root
      opened={opened}
      onClose={onClose}
      position={phone ? "bottom" : "right"}
      size={phone ? "92%" : ENTRY_SHEET.width}
      classNames={{ content: "txnFormContent cb-entry", body: "txnFormInner" }}
    >
      <Drawer.Overlay backgroundOpacity={ENTRY_SHEET.overlay} color="#12161d" />
      <Drawer.Content data-testid={testId}>
        <Drawer.Header>
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Drawer.Title>{title}</Drawer.Title>
            {subtitle && (
              <Text size="sm" c="dimmed" component="div">
                {subtitle}
              </Text>
            )}
          </Stack>
          <Group gap={4} wrap="nowrap" style={{ alignSelf: "flex-start" }}>
            {headerActions}
            <Drawer.CloseButton aria-label={t("common.close")} />
          </Group>
        </Drawer.Header>
        <Drawer.Body>
          <Stack gap={ENTRY_SHEET.gap} mih="100%">
            {children}
            {foot && (
              <Group
                justify="flex-end"
                gap={ENTRY_SHEET.footButtonsGap}
                mt="auto"
                pt={ENTRY_SHEET.footTop}
                className="cb-entry-foot"
                wrap="nowrap"
              >
                {foot}
              </Group>
            )}
          </Stack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
