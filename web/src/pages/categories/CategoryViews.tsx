import { ActionIcon, Menu, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconDots, IconPlus } from "@tabler/icons-react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Category } from "../../api/client";
import { amountColor } from "../../amountTone";
import classes from "./categories.module.css";
import { barScale, isUnused, share, type CategoryNode, type Section } from "./categoryTree";

export interface CategoryActions {
  onOpen: (c: Category) => void;
  onAddSub: (group: Category) => void;
  onMerge: (c: Category) => void;
  onDelete: (c: Category) => void;
}

interface ViewProps {
  sections: Section[];
  format: (amount: number) => string;
  /** "Not used since 3 Mar", for a row that held nothing in the period. */
  since: (lastDate: string | null) => string;
  actions: CategoryActions;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

function useSectionLabel() {
  const { t } = useTranslation();
  return (sec: Section) =>
    sec.kind === "income" ? t("categories.section.income") : t("categories.section.expense");
}

function RowMenu({ c, actions }: { c: Category; actions: CategoryActions }) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={30}
          aria-label={t("categories.actionsFor", { name: c.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item onClick={() => actions.onOpen(c)}>{t("categories.edit")}</Menu.Item>
        {!c.parentId && (
          <Menu.Item onClick={() => actions.onAddSub(c)}>{t("categories.addSub")}</Menu.Item>
        )}
        <Menu.Item onClick={() => actions.onMerge(c)}>{t("categories.merge")}</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" onClick={() => actions.onDelete(c)}>
          {t("categories.delete")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * A: the categories as rows, in the register's card: a band per section with
 * its total, a row per group with its subcategories under it, and for each its
 * share of the section, its transactions and its amount over the period.
 */
export function CategoryRows({
  sections,
  format,
  since,
  actions,
  collapsed,
  onToggle,
}: ViewProps & { collapsed: Set<number>; onToggle: (id: number) => void }) {
  const { t } = useTranslation();
  const sectionLabel = useSectionLabel();

  const cells = (n: CategoryNode, scale: number, sec: Section) => {
    const count = n.category.parentId ? n.count : n.totalCount;
    const amount = n.category.parentId ? n.amount : n.total;
    return (
      <>
        <span className={classes.share}>
          <span className={classes.track}>
            <span
              className={classes.fill}
              style={{ width: `${Math.round((Math.abs(amount) / scale) * 100)}%` }}
            />
          </span>
          <span className={`${classes.pct} ${classes.mono}`}>{share(amount, sec.total)}%</span>
        </span>
        <span className={`${classes.r} ${classes.mono} ${classes.dim}`}>{count || ""}</span>
        {count > 0 ? (
          <span className={`${classes.r} ${classes.mono}`} style={{ color: amountColor(amount) }}>
            {format(amount)}
          </span>
        ) : (
          <span className={classes.last}>
            {since(n.category.parentId ? n.lastDate : n.lastAny)}
          </span>
        )}
        <span>
          <RowMenu c={n.category} actions={actions} />
        </span>
      </>
    );
  };

  return (
    <div className={classes.card} data-testid="categories-rows">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span>{t("categories.col.category")}</span>
        <span>{t("categories.col.share")}</span>
        <span className={classes.r}>{t("categories.col.transactions")}</span>
        <span className={classes.r}>{t("categories.col.amount")}</span>
        <span />
      </div>
      {sections.map((sec) => {
        const scale = barScale(sec);
        return (
          <div key={sec.kind} role="rowgroup" aria-label={sectionLabel(sec)}>
            <div className={`${classes.tr} ${classes.section}`}>
              <span>{sectionLabel(sec)}</span>
              <span />
              <span
                className={`${classes.r} ${classes.mono} ${classes.dim}`}
                style={{ fontWeight: 400 }}
              >
                {sec.count}
              </span>
              <span
                className={`${classes.r} ${classes.mono}`}
                style={{ color: amountColor(sec.total) }}
              >
                {format(sec.total)}
              </span>
              <span />
            </div>
            {sec.groups.map((g) => {
              const open = !collapsed.has(g.category.id);
              const hasSubs = g.subs.length > 0;
              return (
                <div key={g.category.id} data-testid={`category-group-${g.category.id}`}>
                  <div
                    className={`${classes.tr} ${classes.group} ${g.totalCount === 0 ? classes.unused : ""}`}
                    data-row
                    onClick={() => actions.onOpen(g.category)}
                  >
                    <span className={classes.name}>
                      {hasSubs ? (
                        <UnstyledButton
                          className={classes.chev}
                          aria-expanded={open}
                          aria-label={t(open ? "categories.collapse" : "categories.expand", {
                            name: g.category.name,
                          })}
                          onClick={stop(() => onToggle(g.category.id))}
                        >
                          <IconChevronDown size={14} />
                        </UnstyledButton>
                      ) : (
                        <span className={classes.chev} />
                      )}
                      <UnstyledButton
                        className={classes.nameButton}
                        onClick={stop(() => actions.onOpen(g.category))}
                      >
                        {g.category.name}
                      </UnstyledButton>
                      {hasSubs && <span className={classes.subCount}>{g.subs.length}</span>}
                      <UnstyledButton
                        className={classes.addSub}
                        aria-label={t("categories.addSubTo", { name: g.category.name })}
                        onClick={stop(() => actions.onAddSub(g.category))}
                      >
                        <IconPlus size={13} />
                        {t("categories.subcategory")}
                      </UnstyledButton>
                    </span>
                    {cells(g, scale, sec)}
                  </div>
                  {open &&
                    g.subs.map((s) => (
                      <div
                        key={s.category.id}
                        className={`${classes.tr} ${classes.sub} ${isUnused(s) ? classes.unused : ""}`}
                        data-row
                        onClick={() => actions.onOpen(s.category)}
                      >
                        <span className={classes.name}>
                          <span className={classes.chev} />
                          <UnstyledButton
                            className={classes.nameButton}
                            onClick={stop(() => actions.onOpen(s.category))}
                          >
                            {s.category.name}
                          </UnstyledButton>
                        </span>
                        {cells(s, scale, sec)}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * B: an index. Each section under a heading with its total, and its groups in
 * columns, each with its share, a bar and its subcategories under it.
 */
export function CategoryIndex({ sections, format, since, actions }: ViewProps) {
  const { t } = useTranslation();
  const sectionLabel = useSectionLabel();
  const lastOr = (count: number, amount: number, last: string | null): ReactNode =>
    count > 0 ? format(amount) : <span className={classes.lastInline}>{since(last)}</span>;

  return (
    <div className={classes.index} data-testid="categories-index">
      {sections.map((sec) => {
        const scale = barScale(sec);
        return (
          <section key={sec.kind} aria-label={sectionLabel(sec)}>
            <div className={classes.secHead}>
              <h3>{sectionLabel(sec)}</h3>
              <span className={classes.secMeta}>
                {t("categories.index.meta", {
                  transactions: t("categories.index.transactions", { count: sec.count }),
                  groups: t("categories.index.groups", { count: sec.groups.length }),
                })}
              </span>
              <span
                className={`${classes.secTotal} ${classes.mono}`}
                style={{ color: amountColor(sec.total) }}
              >
                {format(sec.total)}
              </span>
            </div>
            <div className={classes.columns}>
              {sec.groups.map((g) => (
                <div key={g.category.id} className={classes.g}>
                  <UnstyledButton
                    className={`${classes.gHead} ${g.totalCount === 0 ? classes.unused : ""}`}
                    onClick={() => actions.onOpen(g.category)}
                  >
                    <span className={classes.gName}>{g.category.name}</span>
                    <span className={classes.gPct}>{share(g.total, sec.total)}%</span>
                    <span
                      className={`${classes.gTotal} ${classes.mono}`}
                      style={{ color: amountColor(g.total) }}
                    >
                      {lastOr(g.totalCount, g.total, g.lastAny)}
                    </span>
                  </UnstyledButton>
                  <div className={classes.gBar}>
                    <span style={{ width: `${Math.round((Math.abs(g.total) / scale) * 100)}%` }} />
                  </div>
                  {g.subs.map((s) => (
                    <UnstyledButton
                      key={s.category.id}
                      className={`${classes.row} ${isUnused(s) ? classes.unused : ""}`}
                      onClick={() => actions.onOpen(s.category)}
                    >
                      <span>{s.category.name}</span>
                      <span className={`${classes.rowCount} ${classes.mono}`}>{s.count || ""}</span>
                      <span
                        className={`${classes.rowAmount} ${classes.mono}`}
                        style={{ color: amountColor(s.amount) }}
                      >
                        {lastOr(s.count, s.amount, s.lastDate)}
                      </span>
                    </UnstyledButton>
                  ))}
                  <UnstyledButton
                    className={classes.gAdd}
                    aria-label={t("categories.addSubTo", { name: g.category.name })}
                    onClick={() => actions.onAddSub(g.category)}
                  >
                    <IconPlus size={14} />
                    {t("categories.addSub")}
                  </UnstyledButton>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The phone: a card per section, a band per group with its total, and a row
 * per subcategory with its transactions under its name. A group with no
 * subcategories is a row of its own.
 */
export function CategoryPhoneList({ sections, format, since, actions }: ViewProps) {
  const { t } = useTranslation();
  const sectionLabel = useSectionLabel();
  const meta = (count: number, last: string | null) =>
    count > 0 ? t("categories.transactions", { count }) : since(last);

  const row = (n: CategoryNode, kind: "group" | "leaf" | "sub") => {
    const count = kind === "group" ? n.totalCount : n.count;
    const amount = kind === "group" ? n.total : n.amount;
    const unused = kind === "group" ? n.totalCount === 0 : isUnused(n);
    return (
      <UnstyledButton
        key={n.category.id}
        className={`${classes.prow} ${unused ? classes.unused : ""}`}
        data-group={kind === "group" || undefined}
        data-leaf={kind === "leaf" || undefined}
        data-sub={kind === "sub" || undefined}
        onClick={() => actions.onOpen(n.category)}
      >
        <span className={classes.pl}>
          <span className={classes.pt} style={{ display: "block" }}>
            {n.category.name}
          </span>
          {kind !== "group" && (
            <span className={classes.pm} style={{ display: "block" }}>
              {meta(n.count, n.lastDate)}
            </span>
          )}
        </span>
        <span className={`${classes.pa} ${classes.mono}`} style={{ color: amountColor(amount) }}>
          {count > 0 ? format(amount) : ""}
        </span>
      </UnstyledButton>
    );
  };

  return (
    <>
      {sections.map((sec) => (
        <div
          key={sec.kind}
          className={classes.card}
          role="group"
          aria-label={sectionLabel(sec)}
          data-testid={`categories-phone-${sec.kind}`}
        >
          {sec.groups.flatMap((g) =>
            g.subs.length > 0
              ? [row(g, "group"), ...g.subs.map((s) => row(s, "sub"))]
              : [row(g, "leaf")],
          )}
        </div>
      ))}
    </>
  );
}
