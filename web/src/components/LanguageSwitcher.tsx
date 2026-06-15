import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { supportedLanguages } from "../i18n";

const labels: Record<string, string> = {
  en: "English",
  it: "Italiano",
};

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
      data={supportedLanguages.map((lng) => ({ value: lng, label: labels[lng] ?? lng }))}
    />
  );
}
