import { IconCheck } from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useDayMonth } from "../categories/labels";
import { type GoalLine, percentOf } from "./goalList";
import classes from "./goals.module.css";

/** Money as the page shows it, in the wallet's base currency. */
export type Money = (minor: number) => string;

export interface GoalActions {
  /** Open the goal in the sheet beside the page. */
  onOpen: (l: GoalLine) => void;
  onPutIn: (l: GoalLine) => void;
  onTakeOut: (l: GoalLine) => void;
  /** Close a reached goal into the history. */
  onClose: (l: GoalLine) => void;
  /** Close an open goal into the history before it is reached. */
  onGiveUp: (l: GoalLine) => void;
  onReopen: (l: GoalLine) => void;
  onDelete: (l: GoalLine) => void;
}

/** A month number as its name and year: "March 2027". */
export function useMonthName() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return (i: number) => f.format(new Date(Date.UTC(Math.floor(i / 12), i % 12, 1)));
  }, [i18n.language]);
}

/** What the page says about a goal: when it is for, and how it is getting there. */
export function useGoalWords(today: string, money: Money) {
  const { t } = useTranslation();
  const day = useDayMonth(today);
  const month = useMonthName();
  const monthOfDate = (d: string) => month(Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1);

  const when = (l: GoalLine) => {
    if (l.closed)
      return l.reached
        ? t("goals.closedReached", { date: day(l.closedOn!) })
        : t("goals.closedGivenUp", { date: day(l.closedOn!), percent: percentOf(l) });
    if (l.reached)
      return l.lastIn ? t("goals.reachedOn", { date: day(l.lastIn) }) : t("goals.reached");
    if (l.pastDate) return t("goals.wasDue", { month: monthOfDate(l.targetDate!) });
    if (l.targetDate)
      return `${t("goals.by", { month: monthOfDate(l.targetDate) })} · ${t("goals.monthsToGo", { count: l.monthsLeft ?? 1 })}`;
    return t("goals.noDate");
  };

  const paceLine = (l: GoalLine) =>
    l.pace > 0 && l.eta != null
      ? t("goals.atYourPace", { amount: money(l.pace), month: month(l.eta) })
      : t("goals.nothingLately");

  /** The status column: a main line and, under it, the reason. */
  const status = (l: GoalLine): { main: ReactNode; sub?: string } => {
    if (l.closed)
      return {
        main: l.reached ? (
          <span className={classes.ok}>
            <IconCheck size={14} /> {t("goals.reached")}
          </span>
        ) : (
          <span className={classes.dim}>{t("goals.givenUp")}</span>
        ),
      };
    if (l.reached)
      return {
        main: (
          <span className={classes.ok}>
            <IconCheck size={14} /> {t("goals.reached")}
          </span>
        ),
        sub: t("goals.closeWhenDone"),
      };
    if (l.pastDate)
      return {
        main: (
          <span className={classes.amber}>{t("goals.stillToGo", { amount: money(l.left) })}</span>
        ),
        sub: paceLine(l),
      };
    if (l.need != null)
      return l.late
        ? {
            main: (
              <span className={classes.amber}>{t("goals.needed", { amount: money(l.need) })}</span>
            ),
            sub: paceLine(l),
          }
        : {
            main: t("goals.aMonth", { amount: money(l.need) }),
            sub: t("goals.onTrack", { amount: money(l.pace) }),
          };
    return l.eta != null
      ? { main: month(l.eta), sub: t("goals.atPace", { amount: money(l.pace) }) }
      : { main: <span className={classes.dim}>{t("goals.nothingLately")}</span> };
  };

  return { when, status, month, day };
}
