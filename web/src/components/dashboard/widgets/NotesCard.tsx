import { Card, Textarea } from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// NotesCard is a free-text note stored in the widget's config (persisted on blur).
export function NotesCard({
  config,
  onConfig,
}: {
  config: { text?: string };
  onConfig: (c: { text?: string }) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(config.text ?? "");
  // Reflect an externally-changed note (e.g. loaded from the server).
  useEffect(() => setText(config.text ?? ""), [config.text]);
  return (
    <Card withBorder h="100%">
      <Textarea
        aria-label={t("dashboard.notes")}
        placeholder={t("dashboard.notesPlaceholder")}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => text !== (config.text ?? "") && onConfig({ text })}
        autosize
        minRows={3}
        variant="unstyled"
      />
    </Card>
  );
}
