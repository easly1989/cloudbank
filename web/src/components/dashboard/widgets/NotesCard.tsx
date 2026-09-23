import { Card, Textarea } from "@mantine/core";
import { useState } from "react";
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
  const saved = config.text ?? "";
  const [text, setText] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);

  // Reflect an externally-changed note (e.g. loaded from the server) without an
  // effect: React re-runs this render before painting, so what the reader sees
  // is the new note and not the old one for a frame. An effect here cost a
  // second render on every keystroke that reached the server.
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setText(saved);
  }
  return (
    <Card withBorder>
      <Textarea
        aria-label={t("dashboard.notes")}
        placeholder={t("dashboard.notesPlaceholder")}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => text !== saved && onConfig({ text })}
        autosize
        minRows={3}
        variant="unstyled"
      />
    </Card>
  );
}
