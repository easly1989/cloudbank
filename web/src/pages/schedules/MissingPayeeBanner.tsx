import { Button, Text } from "@mantine/core";
import { IconUserQuestion } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

/**
 * The schedules that still have no payee (#723), saved before it was
 * required: how many, and the way through them, one sheet at a time.
 */
export function MissingPayeeBanner({
  count,
  phone,
  onStart,
}: {
  count: number;
  phone: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="cb-attention"
      data-testid="missing-payee-banner"
      style={{
        display: "flex",
        gap: 14,
        alignItems: phone ? "stretch" : "center",
        flexDirection: phone ? "column" : "row",
        padding: phone ? "14px 16px" : "14px 20px",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
        <IconUserQuestion
          size={20}
          color="var(--cb-attention)"
          style={{ flexShrink: 0, marginTop: 1 }}
          aria-hidden
        />
        <div style={{ minWidth: 0 }}>
          <Text fw={600} fz={14}>
            {t("schedules.missingPayee.title", { count })}
          </Text>
          <Text fz={13} c="dimmed">
            {t("schedules.missingPayee.body")}
          </Text>
        </div>
      </div>
      <Button variant="default" onClick={onStart} style={{ flexShrink: 0 }}>
        {t("schedules.missingPayee.start")}
      </Button>
    </div>
  );
}
