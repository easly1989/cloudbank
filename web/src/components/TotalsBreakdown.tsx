import { Anchor, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { CurrencyInfo, DashboardAccount } from "../api/client";
import { formatMinor } from "../money";
import type { BalanceKey } from "./dashboard/overviewFigureModel";
import classes from "./TotalsBreakdown.module.css";
import { countedAccounts } from "./totalsCount";

/**
 * What a wallet's total is made of, account by account (#579): the figure
 * beside the wallet and the overview's headline are a sum, and an account out
 * of sight made the sum look wrong. Each account shows in its own currency;
 * the total is in the wallet's, as the server converts it.
 */
export function TotalsBreakdown({
  accounts,
  balance,
  total,
  base,
  withLink = false,
  onNavigate,
}: {
  accounts: readonly DashboardAccount[];
  balance: BalanceKey;
  total: number;
  base: CurrencyInfo;
  /** A link to the Accounts page, where the popover has no other way there. */
  withLink?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const counted = countedAccounts(accounts);
  return (
    <div className={classes.breakdown}>
      <Text className={classes.heading}>
        {t(`totals.across.${balance}`, { count: counted.length })}
      </Text>
      <div className={classes.rows}>
        {counted.map((a) => (
          <div key={a.id} className={classes.row}>
            <span className={classes.name}>{a.name}</span>
            <span className={classes.amount} data-negative={a[balance] < 0 || undefined}>
              {formatMinor(a[balance], a.currency)}
            </span>
          </div>
        ))}
      </div>
      <div className={`${classes.row} ${classes.total}`}>
        <span>{t("totals.total")}</span>
        <span className={classes.amount} data-negative={total < 0 || undefined}>
          {formatMinor(total, base)}
        </span>
      </div>
      <Text className={classes.note}>{t("totals.note")}</Text>
      {withLink && (
        <Anchor component={Link} to="/accounts" className={classes.link} onClick={onNavigate}>
          {t("totals.seeAccounts")}
        </Anchor>
      )}
    </div>
  );
}
