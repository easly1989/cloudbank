import { ActionIcon, Menu, UnstyledButton } from "@mantine/core";
import { IconBell, IconDots, IconRepeat } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type { Schedule, ScheduleOccurrence } from "../../api/client";
import { amountColor, attentionColor } from "../../amountTone";
import { useOccurrenceLabel, useShortDate } from "./labels";
import { OccurrenceIcon } from "./OccurrenceIcon";
import { cadence, isPaid } from "./scheduleCalendar";
import classes from "./schedules.module.css";

export interface ScheduleActions {
  onEdit: (s: Schedule) => void;
  onRegister: (s: Schedule) => void;
  onSkip: (s: Schedule) => void;
  onDelete: (s: Schedule) => void;
}

/**
 * Every schedule, one row each: what it is, how often it comes round, when it
 * is next due — and, when it has registered ahead, how far — how it registers,
 * and where this month's occurrence stands. A click opens it in the sheet.
 */
export function ScheduleList({
  schedules,
  thisMonth,
  today,
  accountOf,
  format,
  phone,
  actions,
}: {
  schedules: Schedule[];
  /** Each schedule's occurrence this month, by schedule id. */
  thisMonth: Map<number, ScheduleOccurrence>;
  today: string;
  accountOf: (s: Schedule) => { id?: number; name: string };
  format: (amount: number, accountId?: number) => string;
  phone: boolean;
  actions: ScheduleActions;
}) {
  const { t, i18n } = useTranslation();
  const short = useShortDate();
  const label = useOccurrenceLabel();

  const repeats = (s: Schedule) => {
    const c = cadence(s, i18n.language);
    return t(c.key, c.values);
  };
  // Registered ahead: the last posting is still to come.
  const ahead = (s: Schedule) =>
    s.lastPosted && s.lastPosted > today
      ? t("schedules.list.aheadTo", { date: short(s.lastPosted) })
      : null;
  const late = (s: Schedule) => s.nextDue < today;
  const menu = (s: Schedule) => (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="default"
          size={30}
          aria-label={t("schedules.more")}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={15} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item onClick={() => actions.onRegister(s)}>{t("schedules.postNow")}</Menu.Item>
        <Menu.Item onClick={() => actions.onSkip(s)}>{t("schedules.skip")}</Menu.Item>
        <Menu.Item onClick={() => actions.onEdit(s)}>{t("schedules.edit")}</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" onClick={() => actions.onDelete(s)}>
          {t("schedules.delete")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
  const mode = (s: Schedule) => (
    <span className={classes.rowIcon} style={{ color: "var(--mantine-color-dimmed)" }}>
      {s.autoPost ? <IconRepeat size={14} aria-hidden /> : <IconBell size={14} aria-hidden />}
      {s.autoPost ? t("schedules.autoLabel") : t("schedules.remindLabel")}
    </span>
  );
  const month = (s: Schedule) => {
    const o = thisMonth.get(s.id);
    if (!o) return <span className={classes.rowSub}>—</span>;
    return (
      <span
        className={classes.rowIcon}
        style={{
          color:
            o.state === "overdue"
              ? attentionColor
              : isPaid(o)
                ? "var(--mantine-color-dimmed)"
                : undefined,
        }}
      >
        <OccurrenceIcon o={o} size={14} />
        {label(o)}
      </span>
    );
  };

  if (phone) {
    return (
      <div className={classes.card} data-testid="schedules-list">
        {schedules.map((s) => {
          const acc = accountOf(s);
          return (
            <div key={s.id} className={classes.item}>
              {s.autoPost ? (
                <IconRepeat size={16} aria-hidden />
              ) : (
                <IconBell size={16} aria-hidden />
              )}
              <UnstyledButton onClick={() => actions.onEdit(s)} style={{ minWidth: 0 }}>
                <div className={classes.itemName}>{s.templateName}</div>
                <div className={classes.itemMeta}>{repeats(s)}</div>
                <div
                  className={classes.itemMeta}
                  style={{ color: late(s) ? attentionColor : undefined }}
                >
                  {t("schedules.list.next", { date: short(s.nextDue) })}
                  {ahead(s) ? ` · ${ahead(s)}` : ""}
                </div>
              </UnstyledButton>
              <div
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}
              >
                <div
                  className={classes.itemAmount}
                  style={{ color: amountColor(s.templateAmount) }}
                >
                  {format(s.templateAmount, acc.id)}
                </div>
                {menu(s)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`${classes.card} ${classes.scroll}`} data-testid="schedules-list">
      <div className={`${classes.row} ${classes.rowHead}`} role="presentation">
        <div>{t("schedules.list.schedule")}</div>
        <div style={{ textAlign: "end" }}>{t("transactions.amount")}</div>
        <div>{t("schedules.cadenceLabel")}</div>
        <div>{t("schedules.list.nextHead")}</div>
        <div>{t("schedules.mode")}</div>
        <div>{t("schedules.list.thisMonth")}</div>
        <div />
      </div>
      {schedules.map((s) => {
        const acc = accountOf(s);
        return (
          // The whole row opens the schedule for a pointer; for the keyboard
          // and a screen reader, its name is the button, so the row's own ⋯
          // is not a control inside another.
          <div key={s.id} className={classes.row} onClick={() => actions.onEdit(s)}>
            <UnstyledButton
              onClick={(e) => {
                e.stopPropagation();
                actions.onEdit(s);
              }}
              style={{ minWidth: 0 }}
            >
              <div style={{ fontWeight: 500 }}>{s.templateName}</div>
              <div className={classes.rowSub}>{acc.name}</div>
            </UnstyledButton>
            <div className={classes.rowAmount} style={{ color: amountColor(s.templateAmount) }}>
              {format(s.templateAmount, acc.id)}
            </div>
            <div>{repeats(s)}</div>
            <div>
              <div style={{ color: late(s) ? attentionColor : undefined }}>{short(s.nextDue)}</div>
              {(ahead(s) || late(s)) && (
                <div className={classes.rowSub}>
                  {ahead(s) ?? t("schedules.list.notRegistered")}
                </div>
              )}
            </div>
            <div>{mode(s)}</div>
            <div>{month(s)}</div>
            <div>{menu(s)}</div>
          </div>
        );
      })}
    </div>
  );
}
