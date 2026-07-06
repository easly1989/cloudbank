import { IconHeartFilled } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import classes from "./DonateButton.module.css";

// Public donation page (the site's Donate page listing every method).
const DONATE_URL = "https://easly1989.github.io/cloudbank/donate/";

// A distinctive, animated donate pill for the app header — links out to the
// project's donation page (PayPal / Liberapay / GitHub Sponsors / …).
export function DonateButton() {
  const { t } = useTranslation();
  return (
    <a
      className={classes.donate}
      href={DONATE_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={t("app.donate")}
    >
      <IconHeartFilled size={16} className={classes.heart} aria-hidden />
      <span className={classes.label}>{t("app.donate")}</span>
    </a>
  );
}
