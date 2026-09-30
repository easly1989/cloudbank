import { ActionIcon, Menu, UnstyledButton } from "@mantine/core";
import { IconChevronRight, IconDots } from "@tabler/icons-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { Template } from "../../api/client";
import { amountColor } from "../../amountTone";
import { everyKey, usedKey, type TemplateGroups, type TemplateRow } from "./templateList";
import classes from "./templates.module.css";

export interface TemplateActions {
  onOpen: (tpl: Template) => void;
  onOpenSchedule: (r: TemplateRow) => void;
  onDelete: (tpl: Template) => void;
}

export interface TemplateTableProps {
  groups: TemplateGroups;
  /** The names a row shows for its account, payee and category. */
  names: {
    account: (id?: number | null) => string;
    payee: (id?: number | null) => string;
    category: (id?: number | null) => string;
  };
  format: (amount: number, accountId?: number | null) => string;
  day: (date: string) => string;
  actions: TemplateActions;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** The row's texts, shared by the table and the phone. */
function useTexts({ names, day }: Pick<TemplateTableProps, "names" | "day">) {
  const { t } = useTranslation();
  return {
    // What it fills in besides the amount: the payee, and the category — or
    // where a transfer goes, or that it is split.
    what: (tpl: Template) => {
      if (tpl.isTransfer)
        return { payee: t("templates.transferTo", { account: names.account(tpl.toAccountId) }) };
      const payee = names.payee(tpl.payeeId);
      const category = tpl.isSplit ? t("templates.split") : names.category(tpl.categoryId);
      return { payee, category };
    },
    used: (r: TemplateRow) => {
      const u = usedKey(r);
      return t(`templates.${u.key}`, { count: u.count, date: u.lastDate ? day(u.lastDate) : "" });
    },
    every: (r: TemplateRow) => {
      const s = r.schedule!;
      const e = everyKey(s);
      return t("templates.everyNext", { every: t(e.key, { n: e.n }), date: day(s.nextDue) });
    },
  };
}

function RowMenu({ tpl, actions }: { tpl: Template; actions: TemplateActions }) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={30}
          aria-label={t("templates.actionsFor", { name: tpl.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item onClick={() => actions.onOpen(tpl)}>{t("templates.edit")}</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" onClick={() => actions.onDelete(tpl)}>
          {t("templates.delete")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The templates in two cards (#560): the ones kept for quick entry, with how
 * often each was used, and the ones a schedule posts, with when it comes round.
 * A quick one opens in the sheet; a scheduled one opens its schedule.
 */
export function TemplateTable(props: TemplateTableProps) {
  const { groups, names, format, actions } = props;
  const { t } = useTranslation();
  const text = useTexts(props);

  const cells = (r: TemplateRow) => {
    const tpl = r.template;
    const w = text.what(tpl);
    return (
      <>
        <span className={classes.dim}>{names.account(tpl.accountId)}</span>
        <span className={classes.what}>
          {w.payee || w.category ? (
            <>
              <b>{w.payee}</b>
              {w.payee && w.category ? " · " : ""}
              {w.category}
            </>
          ) : (
            "—"
          )}
        </span>
        <span className={`${classes.r} ${classes.mono}`} style={{ color: amountColor(tpl.amount) }}>
          {format(tpl.amount, tpl.accountId)}
        </span>
      </>
    );
  };

  const head = (title: string, last: string) => (
    <div className={`${classes.tr} ${classes.head}`} role="presentation">
      <span className={classes.group}>{title}</span>
      <span>{t("transactions.account")}</span>
      <span>{t("templates.col.what")}</span>
      <span className={classes.r}>{t("transactions.amount")}</span>
      <span className={classes.r}>{last}</span>
      <span />
    </div>
  );

  return (
    <>
      {groups.quick.length > 0 && (
        <div className={classes.card} data-testid="templates-quick">
          {head(t("templates.quick"), t("templates.col.used"))}
          {groups.quick.map((r) => (
            <div
              key={r.template.id}
              className={classes.tr}
              data-row
              data-testid={`template-row-${r.template.id}`}
              onClick={() => actions.onOpen(r.template)}
            >
              <UnstyledButton
                className={classes.name}
                onClick={stop(() => actions.onOpen(r.template))}
              >
                {r.template.name}
              </UnstyledButton>
              {cells(r)}
              <span className={`${classes.r} ${classes.small}`}>{text.used(r)}</span>
              <span>
                <RowMenu tpl={r.template} actions={actions} />
              </span>
            </div>
          ))}
        </div>
      )}
      {groups.scheduled.length > 0 && (
        <div className={classes.card} data-testid="templates-scheduled">
          {head(t("templates.scheduled"), t("templates.col.schedule"))}
          {groups.scheduled.map((r) => (
            <div
              key={r.template.id}
              className={classes.tr}
              data-row
              data-testid={`template-row-${r.template.id}`}
              onClick={() => actions.onOpenSchedule(r)}
            >
              <UnstyledButton
                className={classes.name}
                aria-label={t("templates.openSchedule", { name: r.template.name })}
                onClick={stop(() => actions.onOpenSchedule(r))}
              >
                {r.template.name}
              </UnstyledButton>
              {cells(r)}
              <span className={`${classes.r} ${classes.small}`}>{text.every(r)}</span>
              <span className={classes.chevron} aria-hidden>
                <IconChevronRight size={16} />
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** The phone: the two groups under their headings, a row per template. */
export function TemplatePhoneList(props: TemplateTableProps) {
  const { groups, names, format, actions } = props;
  const { t } = useTranslation();
  const text = useTexts(props);

  const row = (r: TemplateRow, meta: string, onClick: () => void) => (
    <UnstyledButton key={r.template.id} className={classes.prow} onClick={onClick}>
      <span className={classes.pl}>
        <span className={classes.pt}>{r.template.name}</span>
        <span className={classes.pm}>{meta}</span>
      </span>
      <span
        className={`${classes.pa} ${classes.mono}`}
        style={{ color: amountColor(r.template.amount) }}
      >
        {format(r.template.amount, r.template.accountId)}
      </span>
    </UnstyledButton>
  );
  const quickMeta = (r: TemplateRow) => {
    const w = text.what(r.template);
    return [w.payee, w.category, names.account(r.template.accountId)].filter(Boolean).join(" · ");
  };

  return (
    <>
      {groups.quick.length > 0 && (
        <>
          <h3 className={classes.h3}>{t("templates.quick")}</h3>
          <div className={classes.card} data-testid="templates-quick">
            {groups.quick.map((r) => row(r, quickMeta(r), () => actions.onOpen(r.template)))}
          </div>
        </>
      )}
      {groups.scheduled.length > 0 && (
        <>
          <h3 className={classes.h3}>{t("templates.scheduled")}</h3>
          <div className={classes.card} data-testid="templates-scheduled">
            {groups.scheduled.map((r) => row(r, text.every(r), () => actions.onOpenSchedule(r)))}
          </div>
        </>
      )}
    </>
  );
}
