import { ActionIcon, Menu, UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconCheck, IconDots } from "@tabler/icons-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { Category, Payee } from "../../api/client";
import { amountColor } from "../../amountTone";
import {
  categoryLabel,
  firstDirection,
  isUnused,
  type PayeeRow,
  type Sort,
  type SortKey,
} from "./payeeList";
import classes from "./payees.module.css";

export interface PayeeActions {
  onOpen: (p: Payee) => void;
  onUseSuggestion: (r: PayeeRow) => void;
  onMerge: (p: Payee) => void;
  onDelete: (p: Payee) => void;
}

interface TableProps {
  rows: PayeeRow[];
  categories: Category[];
  format: (amount: number) => string;
  day: (date: string) => string;
  actions: PayeeActions;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

function RowMenu({ p, actions }: { p: Payee; actions: PayeeActions }) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={30}
          aria-label={t("payees.actionsFor", { name: p.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item onClick={() => actions.onOpen(p)}>{t("payees.edit")}</Menu.Item>
        <Menu.Item onClick={() => actions.onMerge(p)}>{t("payees.merge")}</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" onClick={() => actions.onDelete(p)}>
          {t("payees.delete")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Every payee, one row each: its default category — or, while it has none, the
 * one it usually gets, with "Use it" under the pointer — its transactions, when
 * it was last used, and its amount over the period. A header sorts by its
 * column; a second click turns the order round.
 */
export function PayeeTable({
  rows,
  categories,
  format,
  day,
  actions,
  sort,
  onSort,
}: TableProps & { sort: Sort; onSort: (s: Sort) => void }) {
  const { t } = useTranslation();

  const head = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Arrow = sort.desc ? IconArrowDown : IconArrowUp;
    return (
      <UnstyledButton
        className={classes.sortButton}
        data-active={active || undefined}
        aria-label={
          active
            ? t(sort.desc ? "payees.sortedDesc" : "payees.sortedAsc", { column: label })
            : t("payees.sortBy", { column: label })
        }
        onClick={() => onSort(active ? { key, desc: !sort.desc } : firstDirection(key))}
      >
        {label}
        {active && <Arrow size={13} aria-hidden />}
      </UnstyledButton>
    );
  };

  return (
    <div className={classes.card} data-testid="payees-table">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span>{head("name", t("payees.col.payee"))}</span>
        <span>{t("payees.defaultCategory")}</span>
        <span className={classes.r}>{head("count", t("payees.col.transactions"))}</span>
        <span className={classes.r}>{head("last", t("payees.col.lastUsed"))}</span>
        <span className={classes.r}>{head("amount", t("payees.col.amount"))}</span>
        <span />
      </div>
      {rows.map((r) => (
        <div
          key={r.payee.id}
          className={`${classes.tr} ${isUnused(r) ? classes.unused : ""}`}
          data-row
          data-testid={`payee-row-${r.payee.id}`}
          onClick={() => actions.onOpen(r.payee)}
        >
          <UnstyledButton className={classes.name} onClick={stop(() => actions.onOpen(r.payee))}>
            {r.payee.name}
          </UnstyledButton>
          <span className={classes.cat}>
            {r.defaultCategory ? (
              <span>{categoryLabel(r.defaultCategory, categories)}</span>
            ) : r.suggested ? (
              <>
                <span className={classes.usual}>
                  {t("payees.usually", { name: r.suggested.name })}
                </span>
                <UnstyledButton
                  className={classes.useIt}
                  aria-label={t("payees.useFor", {
                    category: r.suggested.name,
                    name: r.payee.name,
                  })}
                  onClick={stop(() => actions.onUseSuggestion(r))}
                >
                  <IconCheck size={13} />
                  {t("payees.useIt")}
                </UnstyledButton>
              </>
            ) : (
              <span className={classes.usual}>—</span>
            )}
          </span>
          <span className={`${classes.r} ${classes.mono} ${classes.dim}`}>{r.count || ""}</span>
          <span className={`${classes.r} ${classes.dim} ${classes.last}`}>
            {r.lastDate ? day(r.lastDate) : t("payees.never")}
          </span>
          <span className={`${classes.r} ${classes.mono}`} style={{ color: amountColor(r.amount) }}>
            {r.count > 0 ? format(r.amount) : ""}
          </span>
          <span>
            <RowMenu p={r.payee} actions={actions} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The phone: a row per payee, its category and transactions under its name. */
export function PayeePhoneList({ rows, format, day, actions }: TableProps) {
  const { t } = useTranslation();
  const meta = (r: PayeeRow) => {
    const cat = r.defaultCategory
      ? r.defaultCategory.name
      : r.suggested
        ? t("payees.usually", { name: r.suggested.name })
        : t("payees.noCategory");
    const use =
      r.count > 0
        ? t("payees.transactions", { count: r.count })
        : r.lastDate
          ? t("payees.notUsedSince", { date: day(r.lastDate) })
          : t("payees.neverUsed");
    return `${cat} · ${use}`;
  };
  return (
    <div className={classes.card} data-testid="payees-phone">
      {rows.map((r) => (
        <UnstyledButton
          key={r.payee.id}
          className={`${classes.prow} ${isUnused(r) ? classes.unused : ""}`}
          onClick={() => actions.onOpen(r.payee)}
        >
          <span className={classes.pl}>
            <span className={classes.pt}>{r.payee.name}</span>
            <span className={classes.pm}>{meta(r)}</span>
          </span>
          <span
            className={`${classes.pa} ${classes.mono}`}
            style={{ color: amountColor(r.amount) }}
          >
            {r.count > 0 ? format(r.amount) : ""}
          </span>
        </UnstyledButton>
      ))}
    </div>
  );
}
