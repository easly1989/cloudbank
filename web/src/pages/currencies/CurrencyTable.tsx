import { ActionIcon, Menu, UnstyledButton } from "@mantine/core";
import { IconDots } from "@tabler/icons-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { Currency } from "../../api/client";
import classes from "./currencies.module.css";
import { rateText, type CurrencyRow } from "./currencyList";
import { useOrigin, useUsedBy } from "./labels";

export interface CurrencyActions {
  onOpen: (c: Currency) => void;
  onMakeBase: (c: Currency) => void;
  onDelete: (c: Currency) => void;
}

interface TableProps {
  rows: CurrencyRow[];
  base: Currency;
  day: (date: string) => string;
  actions: CurrencyActions;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** The row's and the sheet's menu: make it the base, or delete it, when it can be. */
export function CurrencyMenuItems({
  row,
  actions,
  withEdit,
}: {
  row: CurrencyRow;
  actions: CurrencyActions;
  withEdit: boolean;
}) {
  const { t } = useTranslation();
  const c = row.currency;
  const blocked = c.isBase
    ? t("currencies.deleteBase")
    : row.accounts > 0
      ? t("currencies.deleteInUse", { count: row.accounts })
      : null;
  return (
    <>
      {withEdit && <Menu.Item onClick={() => actions.onOpen(c)}>{t("currencies.edit")}</Menu.Item>}
      {!c.isBase && (
        <Menu.Item onClick={() => actions.onMakeBase(c)}>{t("currencies.makeBase")}</Menu.Item>
      )}
      <Menu.Divider />
      <Menu.Item
        color={blocked ? undefined : "red"}
        disabled={!!blocked}
        onClick={() => actions.onDelete(c)}
      >
        {t("currencies.delete")}
        {blocked && <span className={classes.menuNote}>{blocked}</span>}
      </Menu.Item>
    </>
  );
}

function RowMenu({ row, actions }: { row: CurrencyRow; actions: CurrencyActions }) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" withinPortal width={240}>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={30}
          aria-label={t("currencies.actionsFor", { name: row.currency.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <CurrencyMenuItems row={row} actions={actions} withEdit />
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Every currency, one row each, the base first: its rate against the base,
 * where the rate came from and when, and how many accounts are kept in it.
 */
export function CurrencyTable({ rows, base, day, actions }: TableProps) {
  const { t } = useTranslation();
  const origin = useOrigin(day);
  const usedBy = useUsedBy();
  return (
    <div className={classes.card} data-testid="currencies-table">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span>{t("currencies.col.currency")}</span>
        <span>{t("currencies.col.rate")}</span>
        <span>{t("currencies.col.updated")}</span>
        <span className={classes.r}>{t("currencies.col.usedBy")}</span>
        <span />
      </div>
      {rows.map((r) => {
        const c = r.currency;
        const o = origin(r);
        return (
          <div
            key={c.id}
            className={classes.tr}
            data-row
            data-testid={`currency-row-${c.isoCode}`}
            onClick={() => actions.onOpen(c)}
          >
            <UnstyledButton className={classes.name} onClick={stop(() => actions.onOpen(c))}>
              <span className={classes.code}>{c.isoCode}</span>
              <span className={classes.title}>{c.name}</span>
              {c.isBase && <span className={classes.baseNote}>{t("currencies.baseNote")}</span>}
            </UnstyledButton>
            <span className={classes.mono}>
              {c.isBase ? (
                <span className={classes.dim}>—</span>
              ) : (
                <span dir="ltr">{rateText(c, base)}</span>
              )}
            </span>
            <span className={`${classes.origin} ${o.warn ? classes.warn : ""}`}>{o.text}</span>
            <span className={`${classes.r} ${classes.dim}`}>{usedBy(r.accounts)}</span>
            <span>
              <RowMenu row={r} actions={actions} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The phone: a row per currency, its rate and its source under its name. */
export function CurrencyPhoneList({ rows, base, day, actions }: TableProps) {
  const { t } = useTranslation();
  const origin = useOrigin(day);
  const usedBy = useUsedBy();
  return (
    <div className={classes.card} data-testid="currencies-phone">
      {rows.map((r) => {
        const c = r.currency;
        return (
          <UnstyledButton key={c.id} className={classes.prow} onClick={() => actions.onOpen(c)}>
            <span className={classes.pl}>
              <span className={classes.pt}>
                <span className={classes.code}>{c.isoCode}</span>
                <span>{c.name}</span>
              </span>
              <span className={classes.pm}>
                {c.isBase ? (
                  t("currencies.baseCurrency")
                ) : (
                  <>
                    <span dir="ltr">{rateText(c, base)}</span> · {origin(r).text}
                  </>
                )}
              </span>
            </span>
            <span className={classes.pa}>{usedBy(r.accounts)}</span>
          </UnstyledButton>
        );
      })}
    </div>
  );
}
