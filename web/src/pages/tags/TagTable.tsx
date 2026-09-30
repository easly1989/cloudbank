import { ActionIcon, Menu, UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconDots, IconTag } from "@tabler/icons-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { TagInfo } from "../../api/client";
import { amountColor } from "../../amountTone";
import { firstDirection, isUnused, type Sort, type SortKey, type TagRow } from "./tagList";
import classes from "./tags.module.css";

export interface TagActions {
  onOpen: (t: TagInfo) => void;
  onMerge: (t: TagInfo) => void;
  onDelete: (t: TagInfo) => void;
}

interface TableProps {
  rows: TagRow[];
  format: (amount: number) => string;
  day: (date: string) => string;
  actions: TagActions;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

function RowMenu({ tag, actions }: { tag: TagInfo; actions: TagActions }) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={30}
          aria-label={t("tags.actionsFor", { name: tag.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item onClick={() => actions.onOpen(tag)}>{t("tags.edit")}</Menu.Item>
        <Menu.Item onClick={() => actions.onMerge(tag)}>{t("tags.merge")}</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" onClick={() => actions.onDelete(tag)}>
          {t("tags.delete")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Every tag, one row each: the categories its transactions were mostly in, how
 * many there were, when it was last used, and their net amount over the
 * period. A header sorts by its column; a second click turns the order round.
 */
export function TagTable({
  rows,
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
            ? t(sort.desc ? "tags.sortedDesc" : "tags.sortedAsc", { column: label })
            : t("tags.sortBy", { column: label })
        }
        onClick={() => onSort(active ? { key, desc: !sort.desc } : firstDirection(key))}
      >
        {label}
        {active && <Arrow size={13} aria-hidden />}
      </UnstyledButton>
    );
  };

  return (
    <div className={classes.card} data-testid="tags-table">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span>{head("name", t("tags.col.tag"))}</span>
        <span>{t("tags.col.mostlyIn")}</span>
        <span className={classes.r}>{head("count", t("tags.col.transactions"))}</span>
        <span className={classes.r}>{head("last", t("tags.col.lastUsed"))}</span>
        <span className={classes.r}>{head("amount", t("tags.col.amount"))}</span>
        <span />
      </div>
      {rows.map((r) => (
        <div
          key={r.tag.id}
          className={`${classes.tr} ${isUnused(r) ? classes.unused : ""}`}
          data-row
          data-testid={`tag-row-${r.tag.id}`}
          onClick={() => actions.onOpen(r.tag)}
        >
          <UnstyledButton className={classes.name} onClick={stop(() => actions.onOpen(r.tag))}>
            <IconTag size={15} aria-hidden />
            <span>{r.tag.name}</span>
          </UnstyledButton>
          <span className={classes.mostly}>
            {r.categories.length === 0
              ? "—"
              : r.categories.map((c, i) => (
                  <span key={c.category.id}>
                    {i > 0 && ", "}
                    <b>{c.category.name}</b> {c.count}
                  </span>
                ))}
          </span>
          <span className={`${classes.r} ${classes.mono} ${classes.dim}`}>{r.count || ""}</span>
          <span className={`${classes.r} ${classes.dim} ${classes.last}`}>
            {r.lastDate ? day(r.lastDate) : t("tags.never")}
          </span>
          <span className={`${classes.r} ${classes.mono}`} style={{ color: amountColor(r.amount) }}>
            {r.count > 0 ? format(r.amount) : ""}
          </span>
          <span>
            <RowMenu tag={r.tag} actions={actions} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The phone: a row per tag, its transactions and main category under its name. */
export function TagPhoneList({ rows, format, day, actions }: TableProps) {
  const { t } = useTranslation();
  const meta = (r: TagRow) => {
    if (r.count === 0)
      return r.lastDate ? t("tags.notUsedSince", { date: day(r.lastDate) }) : t("tags.neverUsed");
    const use = t("tags.transactions", { count: r.count });
    const top = r.categories[0];
    return top ? `${use} · ${t("tags.mostly", { name: top.category.name })}` : use;
  };
  return (
    <div className={classes.card} data-testid="tags-phone">
      {rows.map((r) => (
        <UnstyledButton
          key={r.tag.id}
          className={`${classes.prow} ${isUnused(r) ? classes.unused : ""}`}
          onClick={() => actions.onOpen(r.tag)}
        >
          <span className={classes.pl}>
            <span className={classes.pt}>
              <IconTag size={15} aria-hidden />
              <span>{r.tag.name}</span>
            </span>
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
