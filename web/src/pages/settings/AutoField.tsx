import { NumberInput, PasswordInput, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorText } from "../../errorText";

/**
 * A field that saves itself (#800): when it loses focus or Enter is pressed,
 * if it changed. A short "Saved" says it worked; what the server refused stays
 * under the field until the next try. A password field is write-only: what is
 * typed is sent and cleared, and an empty one keeps what is stored.
 */
export function AutoField({
  kind = "text",
  value,
  onSave,
  label,
  placeholder,
  disabled,
  width = 280,
  required = false,
  min,
  max,
  showLabel = false,
}: {
  /** The label above the field, as in an expander; else it is only named. */
  showLabel?: boolean;
  kind?: "text" | "password" | "number";
  /** What is stored; empty for a password. */
  value: string;
  onSave: (value: string) => Promise<unknown>;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
  /** An empty value is refused here rather than sent. */
  required?: boolean;
  min?: number;
  max?: number;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new stored value (saved here or elsewhere) replaces the draft, but not
  // while a save is out or after one was refused: what was typed stays, to be
  // corrected and sent again.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!busy && error === null) setDraft(value);
  }

  const commit = async () => {
    if (busy || draft === value || (kind === "password" && draft === "")) return;
    // An empty or out-of-range number is not sent: the stored one comes back.
    if (kind === "number") {
      const n = Number(draft);
      if (
        draft.trim() === "" ||
        !Number.isFinite(n) ||
        n < (min ?? -Infinity) ||
        n > (max ?? Infinity)
      ) {
        setDraft(value);
        return;
      }
    }
    if (required && draft.trim() === "") {
      setError(t("settings.required"));
      return;
    }
    setBusy(true);
    try {
      await onSave(draft);
      setError(null);
      if (kind === "password") setDraft("");
      notifications.show({ color: "teal", message: t("settings.saved") });
    } catch (err) {
      setError(errorText(err, t).message);
    } finally {
      setBusy(false);
    }
  };

  const common = {
    ...(showLabel ? { label } : { "aria-label": label }),
    placeholder,
    disabled,
    w: width,
    maw: "100%",
    error,
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") void commit();
    },
  };
  if (kind === "number") {
    return (
      <NumberInput
        {...common}
        min={min}
        max={max}
        allowDecimal={false}
        allowNegative={false}
        value={draft}
        onChange={(v) => setDraft(String(v))}
      />
    );
  }
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.currentTarget.value);
  if (kind === "password") {
    // A key for another service: no password manager may fill CloudBank's own
    // password in here, nor offer to save this as one.
    return (
      <PasswordInput
        {...common}
        value={draft}
        onChange={onChange}
        autoComplete="new-password"
        data-1p-ignore
        data-lpignore="true"
      />
    );
  }
  return <TextInput {...common} value={draft} onChange={onChange} />;
}
