import { ActionIcon, Menu, UnstyledButton } from "@mantine/core";
import { IconDots } from "@tabler/icons-react";
import { Fragment, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { Account } from "../../api/client";
import { attentionColor } from "../../amountTone";
import { formatMinor, type MoneyFormat } from "../../money";
import {
  accountFormat,
  belowMinimum,
  hasValuations,
  type AccountGroups,
  type Figures,
} from "./accountList";
import classes from "./accounts.module.css";

export interface AccountActions {
  onOpen: (a: Account) => void;
  onEdit: (a: Account) => void;
  onReconcile: (a: Account) => void;
  onValuations: (a: Account) => void;
  onDelete: (a: Account) => void;
}

export interface AccountTableProps {
  data: AccountGroups;
  /** The base currency's format, for subtotals and the total. */
  baseFormat: MoneyFormat;
  day: (date: string) => string;
  actions: AccountActions;
  /** What the goals still set aside keep in each account, in the base currency (#572). */
  aside?: ReadonlyMap<number, { amount: number }>;
  baseCurrencyId?: number;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** Today's balance in its colour: amber under a minimum, red below zero. */
const todayColor = (a: Account) =>
  belowMinimum(a) ? attentionColor : a.balance < 0 ? "var(--cb-negative)" : undefined;

/** The line under an account's name: its bank, when it was last reconciled, and what sets it apart. */
function useSubLine(day: (date: string) => string) {
  const { t } = useTranslation();
  return (a: Account) =>
    [
      a.institution,
      a.lastReconciled
        ? t("accounts.reconciledOn", { date: day(a.lastReconciled) })
        : t("accounts.neverReconciled"),
      a.value != null ? t("valuations.recorded") : null,
      a.closed ? t("accounts.closedLower") : null,
      a.noSummary && !a.closed ? t("accounts.leftOut") : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

/**
 * What the goals keep in an account, after its line (#572): amber when the
 * account holds less, which can only be told when it is in the base currency.
 */
function useAsideNote(
  aside: AccountTableProps["aside"],
  baseFormat: MoneyFormat,
  baseCurrencyId: number | undefined,
) {
  const { t } = useTranslation();
  return (a: Account) => {
    const amount = aside?.get(a.id)?.amount ?? 0;
    if (amount <= 0) return null;
    const short = a.currencyId === baseCurrencyId && a.balance < amount;
    return (
      <>
        {" · "}
        <span
          data-testid={`account-aside-${a.id}`}
          data-short={short || undefined}
          style={short ? { color: attentionColor } : undefined}
        >
          {t(short ? "accounts.setAsideShort" : "accounts.setAside", {
            amount: formatMinor(amount, baseFormat),
          })}
        </span>
      </>
    );
  };
}

export function AccountMenu({
  a,
  actions,
  size = 30,
}: {
  a: Account;
  actions: AccountActions;
  size?: number;
}) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={size}
          aria-label={t("accounts.actions", { name: a.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item onClick={() => actions.onOpen(a)}>{t("accounts.openRegister")}</Menu.Item>
        <Menu.Item onClick={() => actions.onEdit(a)}>{t("accounts.editAccount")}</Menu.Item>
        {!a.closed && (
          <Menu.Item onClick={() => actions.onReconcile(a)}>{t("reconcile.start")}</Menu.Item>
        )}
        {hasValuations(a) && (
          <Menu.Item onClick={() => actions.onValuations(a)}>{t("valuations.manage")}</Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item color="red" onClick={() => actions.onDelete(a)}>
          {t("accounts.confirmDeleteAction")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Every account in the register's card (#564): what the bank confirmed, today
 * and the future balance, a band per type with its subtotal, and the total
 * under them. A click opens the account's register; ⋯ edits it.
 */
export function AccountTable({
  data,
  baseFormat,
  day,
  actions,
  aside,
  baseCurrencyId,
}: AccountTableProps) {
  const { t } = useTranslation();
  const sub = useSubLine(day);
  const asideNote = useAsideNote(aside, baseFormat, baseCurrencyId);
  const base = (n: number) => formatMinor(n, baseFormat);
  const sums = (f: Figures) => (
    <>
      <span className={`${classes.r} ${classes.mono}`}>{base(f.reconciled)}</span>
      <span className={`${classes.r} ${classes.mono}`}>{base(f.today)}</span>
      <span className={`${classes.r} ${classes.mono}`}>{base(f.future)}</span>
      <span />
    </>
  );

  return (
    <div className={classes.card} data-testid="accounts-table" data-tour="accounts-table">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span>{t("accounts.col.account")}</span>
        <span className={classes.r}>{t("accounts.col.reconciled")}</span>
        <span className={classes.r}>{t("accounts.col.today")}</span>
        <span className={classes.r}>{t("accounts.col.future")}</span>
        <span />
      </div>
      {data.groups.map((g) => (
        <Fragment key={g.type}>
          <div
            className={`${classes.tr} ${classes.group}`}
            data-testid={`accounts-group-${g.type}`}
          >
            <span>{t(`accounts.types.${g.type}`)}</span>
            {sums(g.subtotal)}
          </div>
          {g.accounts.map((a) => {
            const fmt = accountFormat(a);
            return (
              <div
                key={a.id}
                className={`${classes.tr} ${a.closed ? classes.closed : ""}`}
                data-row
                data-testid={`account-row-${a.id}`}
                onClick={() => actions.onOpen(a)}
              >
                <span className={classes.nameCell}>
                  <UnstyledButton
                    className={classes.name}
                    aria-label={t("accounts.openRegisterOf", { name: a.name })}
                    onClick={stop(() => actions.onOpen(a))}
                  >
                    {a.name}
                  </UnstyledButton>
                  <span className={classes.sub}>
                    {sub(a)}
                    {asideNote(a)}
                  </span>
                </span>
                <span className={`${classes.r} ${classes.mono} ${classes.dim}`}>
                  {formatMinor(a.reconciledBalance, fmt)}
                </span>
                <span className={`${classes.r} ${classes.mono}`} style={{ color: todayColor(a) }}>
                  {formatMinor(a.balance, fmt)}
                  {belowMinimum(a) && (
                    <span className={classes.warn}>
                      {t("accounts.underMinimum", {
                        amount: formatMinor(a.minimumBalance, fmt),
                      })}
                    </span>
                  )}
                </span>
                <span
                  className={`${classes.r} ${classes.mono} ${
                    a.futureBalance === a.balance ? classes.dim : ""
                  }`}
                >
                  {formatMinor(a.futureBalance, fmt)}
                </span>
                <span>
                  <AccountMenu a={a} actions={actions} />
                </span>
              </div>
            );
          })}
        </Fragment>
      ))}
      <div className={`${classes.tr} ${classes.total}`} data-testid="accounts-total">
        <span>{t("accounts.total", { count: data.counted })}</span>
        {sums(data.total)}
      </div>
    </div>
  );
}

/** The phone: a heading per type with its subtotal, a row per account, the total at the foot. */
export function AccountPhoneList({
  data,
  baseFormat,
  day,
  actions,
  aside,
  baseCurrencyId,
}: AccountTableProps) {
  const { t } = useTranslation();
  const sub = useSubLine(day);
  const asideNote = useAsideNote(aside, baseFormat, baseCurrencyId);
  const base = (n: number) => formatMinor(n, baseFormat);
  return (
    <div data-tour="accounts-table" className={classes.phoneList}>
      {data.groups.map((g) => (
        <section key={g.type} className={classes.phoneGroup}>
          <h3 className={classes.h3}>
            {t(`accounts.types.${g.type}`)}
            <span className={classes.mono}>{base(g.subtotal.today)}</span>
          </h3>
          <div className={classes.card}>
            {g.accounts.map((a) => {
              const fmt = accountFormat(a);
              return (
                <div
                  key={a.id}
                  className={`${classes.prow} ${a.closed ? classes.closed : ""}`}
                  data-testid="account-row"
                >
                  <UnstyledButton
                    className={classes.pmain}
                    aria-label={t("accounts.openRegisterOf", { name: a.name })}
                    onClick={() => actions.onOpen(a)}
                  >
                    <span className={classes.pl}>
                      <span className={classes.pt}>{a.name}</span>
                      <span className={classes.pm}>
                        {sub(a) || t(`accounts.types.${a.type}`)}
                        {asideNote(a)}
                      </span>
                    </span>
                    <span className={classes.pa}>
                      <span className={classes.mono} style={{ color: todayColor(a) }}>
                        {formatMinor(a.balance, fmt)}
                      </span>
                      {a.futureBalance !== a.balance && (
                        <small>
                          {t("accounts.futureShort", {
                            amount: formatMinor(a.futureBalance, fmt),
                          })}
                        </small>
                      )}
                    </span>
                  </UnstyledButton>
                  <AccountMenu a={a} actions={actions} size={44} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div className={classes.card} data-testid="accounts-total">
        <div className={classes.prow}>
          <span className={classes.pl}>
            <span className={classes.pt}>{t("accounts.totalShort")}</span>
            <span className={classes.pm}>{t("accounts.counted", { count: data.counted })}</span>
          </span>
          <span className={classes.pa}>
            <b className={classes.mono}>{base(data.total.today)}</b>
            {data.total.future !== data.total.today && (
              <small>{t("accounts.futureShort", { amount: base(data.total.future) })}</small>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
