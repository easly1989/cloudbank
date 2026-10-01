import { ActionIcon, Button, Menu, UnstyledButton } from "@mantine/core";
import {
  IconBuildingBank,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconPlus,
} from "@tabler/icons-react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { GoalLine, GoalsView } from "./goalList";
import { type GoalActions, type Money, useGoalWords } from "./goalWords";
import classes from "./goals.module.css";

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** What is in, green once reached, grey once closed. */
export function GoalBar({ l, small = false }: { l: GoalLine; small?: boolean }) {
  const w = l.targetAmount > 0 ? Math.min(100, (Math.max(l.saved, 0) / l.targetAmount) * 100) : 0;
  return (
    <span
      className={classes.bar}
      data-size={small ? "small" : undefined}
      data-state={l.closed ? "closed" : l.reached ? "reached" : undefined}
      role="progressbar"
      aria-label={l.name}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(w)}
    >
      <span style={{ width: `${w}%` }} />
    </span>
  );
}

/** Saved, the month's share against the pace, and what is left free. */
export function Figures({
  view,
  wallet,
  money,
}: {
  view: GoalsView;
  /** Today's balance of the whole wallet, in the base currency. */
  wallet: number | null;
  money: Money;
}) {
  const { t } = useTranslation();
  const dated = view.open.some((l) => l.need != null);
  return (
    <div className={classes.top} data-tour="goals-figures">
      <div className={classes.fig}>
        <span className={classes.figLabel}>{t("goals.saved")}</span>
        <span className={classes.figValue} data-testid="goals-saved">
          {money(view.saved)}
        </span>
        <span className={classes.figSub}>
          {t("goals.savedOf", { target: money(view.target), count: view.count })}
        </span>
      </div>
      <div className={classes.fig}>
        <span className={classes.figLabel}>{t("goals.monthly")}</span>
        <span className={classes.figValue} data-small data-testid="goals-monthly">
          {money(view.need)}
        </span>
        <span className={classes.figSub}>
          {dated ? (
            <>
              {t("goals.monthlySub")} ·{" "}
              <span className={view.pace < view.need ? classes.amber : undefined}>
                {t("goals.lately", { amount: money(view.pace) })}
              </span>
            </>
          ) : (
            t("goals.monthlyNone")
          )}
        </span>
      </div>
      {wallet != null && (
        <div className={classes.fig}>
          <span className={classes.figLabel}>{t("goals.free")}</span>
          <span className={classes.figValue} data-small data-testid="goals-free">
            {money(wallet - view.saved)}
          </span>
          <span className={classes.figSub}>{t("goals.freeSub", { wallet: money(wallet) })}</span>
        </div>
      )}
    </div>
  );
}

export function GoalMenu({
  l,
  actions,
  size = 30,
}: {
  l: GoalLine;
  actions: GoalActions;
  size?: number;
}) {
  const { t } = useTranslation();
  const takeOut = (
    <Menu.Item disabled={l.saved <= 0} onClick={() => actions.onTakeOut(l)}>
      {t("goals.menu.takeOut")}
    </Menu.Item>
  );
  const remove = (
    <Menu.Item color="red" onClick={() => actions.onDelete(l)}>
      {t("goals.menu.delete")}
    </Menu.Item>
  );
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={size}
          aria-label={t("goals.actionsFor", { name: l.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        {l.closed ? (
          <>
            <Menu.Item onClick={() => actions.onReopen(l)}>{t("goals.menu.reopen")}</Menu.Item>
            <Menu.Divider />
            {remove}
          </>
        ) : l.reached ? (
          <>
            <Menu.Item onClick={() => actions.onClose(l)}>{t("goals.menu.close")}</Menu.Item>
            {takeOut}
            <Menu.Item onClick={() => actions.onOpen(l)}>{t("goals.menu.edit")}</Menu.Item>
            <Menu.Divider />
            {remove}
          </>
        ) : (
          <>
            <Menu.Item onClick={() => actions.onPutIn(l)}>{t("goals.menu.putIn")}</Menu.Item>
            {takeOut}
            <Menu.Item onClick={() => actions.onOpen(l)}>{t("goals.menu.edit")}</Menu.Item>
            <Menu.Divider />
            <Menu.Item onClick={() => actions.onGiveUp(l)}>{t("goals.menu.giveUp")}</Menu.Item>
            {remove}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Put in on an open goal, Close on a reached one, nothing once closed. */
function RowButton({ l, actions }: { l: GoalLine; actions: GoalActions }) {
  const { t } = useTranslation();
  if (l.closed) return null;
  return l.reached ? (
    <Button
      size="compact-sm"
      variant="default"
      className={classes.rowButton}
      data-close
      leftSection={<IconCheck size={14} />}
      onClick={stop(() => actions.onClose(l))}
    >
      {t("goals.close")}
    </Button>
  ) : (
    <Button
      size="compact-sm"
      variant="default"
      className={classes.rowButton}
      leftSection={<IconPlus size={14} />}
      onClick={stop(() => actions.onPutIn(l))}
    >
      {t("goals.putIn")}
    </Button>
  );
}

/** The fold over the history: a band that opens and closes it. */
function HistoryFold({
  count,
  open,
  onToggle,
  className,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  className: string;
}) {
  const { t } = useTranslation();
  return (
    <UnstyledButton
      className={`${className} ${classes.foldRow}`}
      aria-expanded={open}
      onClick={onToggle}
      data-testid="goals-history-fold"
    >
      <span className={classes.fold}>
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        {t("goals.history")}
        <span className={classes.foldCount}>{t("goals.historyCount", { count })}</span>
      </span>
    </UnstyledButton>
  );
}

export interface GoalListProps {
  view: GoalsView;
  money: Money;
  today: string;
  /** The account names, for the goals kept in one. */
  accountName: (id: number) => string | undefined;
  historyOpen: boolean;
  onToggleHistory: () => void;
  actions: GoalActions;
}

/**
 * Every goal in the register's card (#572): those under way, soonest date
 * first; those reached and waiting to be closed; and the history, folded.
 */
export function GoalsTable({
  view,
  money,
  today,
  accountName,
  historyOpen,
  onToggleHistory,
  actions,
}: GoalListProps) {
  const { t } = useTranslation();
  const { when, status } = useGoalWords(today, money);
  const row = (l: GoalLine) => {
    const s = status(l);
    const account = !l.closed && l.accountId != null ? accountName(l.accountId) : undefined;
    return (
      <div
        key={l.id}
        className={`${classes.tr} ${l.closed ? classes.closed : ""}`}
        data-row
        data-testid={`goal-row-${l.id}`}
        onClick={() => actions.onOpen(l)}
      >
        <span className={classes.name}>
          <span className={classes.nameText}>{l.name}</span>
          <span className={classes.sub}>
            {when(l)}
            {account && (
              <>
                {" · "}
                <span className={classes.acc}>
                  <IconBuildingBank size={12} /> {account}
                </span>
              </>
            )}
          </span>
        </span>
        <span className={`${classes.r} ${classes.mono}`}>{money(l.saved)}</span>
        <span className={`${classes.r} ${classes.mono} ${classes.dim}`}>
          {money(l.targetAmount)}
        </span>
        <span>
          <GoalBar l={l} />
        </span>
        <span className={classes.status}>
          <span>{s.main}</span>
          {s.sub && <span className={classes.sub}>{s.sub}</span>}
        </span>
        <span>
          <RowButton l={l} actions={actions} />
        </span>
        <span>
          <GoalMenu l={l} actions={actions} />
        </span>
      </div>
    );
  };
  const band = (label: ReactNode) => (
    <div className={`${classes.tr} ${classes.group}`}>
      <span>{label}</span>
    </div>
  );
  return (
    <div className={classes.card} data-testid="goals-table" data-tour="goals-table">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span>{t("goals.col.goal")}</span>
        <span className={classes.r}>{t("goals.col.saved")}</span>
        <span className={classes.r}>{t("goals.col.target")}</span>
        <span />
        <span>{t("goals.col.gettingThere")}</span>
        <span />
        <span />
      </div>
      {view.open.map(row)}
      {view.reached.length > 0 && (
        <>
          {band(t("goals.groupReached"))}
          {view.reached.map(row)}
        </>
      )}
      {view.history.length > 0 && (
        <>
          <HistoryFold
            count={view.history.length}
            open={historyOpen}
            onToggle={onToggleHistory}
            className={`${classes.tr} ${classes.group}`}
          />
          {historyOpen && view.history.map(row)}
        </>
      )}
    </div>
  );
}

/** The phone: a row per goal, its bar under it, the bands as headings. */
export function GoalsPhoneList({
  view,
  money,
  today,
  historyOpen,
  onToggleHistory,
  actions,
}: GoalListProps) {
  const { t } = useTranslation();
  const { when } = useGoalWords(today, money);
  const right = (l: GoalLine): ReactNode => {
    if (l.closed) return null;
    if (l.reached) return <RowButton l={l} actions={actions} />;
    if (l.pastDate)
      return (
        <span className={classes.amber}>{t("goals.stillToGo", { amount: money(l.left) })}</span>
      );
    if (l.need != null)
      return (
        <span className={l.late ? classes.amber : undefined}>
          {t("goals.aMonth", { amount: money(l.need) })}
        </span>
      );
    return t("goals.ofTarget", { amount: money(l.targetAmount) });
  };
  const row = (l: GoalLine) => (
    <div
      key={l.id}
      className={`${classes.prow} ${l.closed ? classes.closed : ""}`}
      data-testid={`goal-row-${l.id}`}
      role="button"
      tabIndex={0}
      onClick={() => actions.onOpen(l)}
      onKeyDown={(e) => {
        if (e.key === "Enter") actions.onOpen(l);
      }}
    >
      <span className={classes.prowTop}>
        <b className={l.closed ? classes.dim : undefined}>{l.name}</b>
        <span className={`${classes.mono} ${l.closed ? classes.dim : ""}`}>{money(l.saved)}</span>
      </span>
      <GoalBar l={l} small />
      <span className={classes.prowMeta}>
        <span>{when(l)}</span>
        <span>{right(l)}</span>
      </span>
    </div>
  );
  return (
    <div className={classes.card} data-testid="goals-table" data-tour="goals-table">
      {view.open.map(row)}
      {view.reached.length > 0 && (
        <>
          <div className={classes.pband}>{t("goals.groupReached")}</div>
          {view.reached.map(row)}
        </>
      )}
      {view.history.length > 0 && (
        <>
          <HistoryFold
            count={view.history.length}
            open={historyOpen}
            onToggle={onToggleHistory}
            className={classes.pband}
          />
          {historyOpen && view.history.map(row)}
        </>
      )}
    </div>
  );
}

export interface GoalExample {
  key: "trip" | "fund" | "bike";
  sub: string;
  onUse: () => void;
}

/** Empty is an invitation: what a goal is, three to start from, the button. */
export function GoalsEmpty({ examples, onAdd }: { examples: GoalExample[]; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={classes.empty} data-testid="goals-empty">
      <h3 className={classes.emptyTitle}>{t("goals.empty.title")}</h3>
      <p className={classes.emptyBody}>{t("goals.empty.body")}</p>
      <div className={classes.examples}>
        {examples.map((e) => (
          <div key={e.key} className={classes.example}>
            <span>
              {t(`goals.empty.${e.key}`)}
              <span className={classes.exampleSub}>{e.sub}</span>
            </span>
            <Button
              size="compact-sm"
              variant="default"
              className={classes.rowButton}
              leftSection={<IconPlus size={14} />}
              onClick={e.onUse}
            >
              {t("goals.empty.use")}
            </Button>
          </div>
        ))}
      </div>
      <Button onClick={onAdd} data-tour="goals-add">
        {t("goals.add")}
      </Button>
    </div>
  );
}
