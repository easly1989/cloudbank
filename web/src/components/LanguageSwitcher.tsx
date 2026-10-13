import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { languages } from "../i18n/languages";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? "en";

  return (
    <Select
      aria-label={t("actions.language")}
      size="sm"
      w={130}
      allowDeselect={false}
      value={current}
      onChange={(value) => value && void i18n.changeLanguage(value)}
      data={languages.map((l) => ({ value: l.code, label: l.name }))}
    />
  );
}
