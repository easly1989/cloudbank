import { useTranslation } from "react-i18next";

import type { CurrencyRow } from "./currencyList";

/** Where a rate came from, in words: "ECB · 29 Sep", "Typed by you · 30 Sep". */
export function useOrigin(day: (date: string) => string) {
  const { t } = useTranslation();
  return (r: CurrencyRow): { text: string; warn: boolean } => {
    const date = r.currency.rateDate ? day(r.currency.rateDate) : "";
    switch (r.origin) {
      case "ecb":
        return { text: t("currencies.origin.ecb", { date }), warn: false };
      case "manual":
        return { text: t("currencies.origin.manual", { date }), warn: true };
      case "none":
        return { text: t("currencies.origin.none"), warn: true };
      default:
        return { text: "", warn: false };
    }
  };
}

/** "1 account", "2 accounts", or a dash. */
export function useUsedBy() {
  const { t } = useTranslation();
  return (n: number) => (n === 0 ? "—" : t("currencies.accounts", { count: n }));
}
