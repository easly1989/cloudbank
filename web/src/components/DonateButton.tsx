import { IconHeart } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import classes from "./DonateButton.module.css";

// Public donation page (lists every method).
const DONATE_URL = "https://easly1989.github.io/donate.html";

// The support pill. It lives at the foot of the sidebar rather than in the
// header: asking for money is not one of the app's controls, and next to the
// ledger a filled red pill reads as an alarm about your own finances.
//
// The heart is an outline, not a solid — it fills its shape on hover along with
// the pill, which is the whole of its flourish.
export function DonateButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const { t } = useTranslation();
  return (
    <a
      className={fullWidth ? `${classes.donate} ${classes.fullWidth}` : classes.donate}
      href={DONATE_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={t("app.support")}
    >
      <IconHeart size={15} className={classes.heart} aria-hidden />
      <span>{t("app.support")}</span>
    </a>
  );
}
