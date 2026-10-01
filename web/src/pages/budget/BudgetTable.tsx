import { ActionIcon, Button, Menu, SegmentedControl, UnstyledButton } from "@mantine/core";
import {
  IconChevronLeft,
  IconChevronRight,
  IconDots,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconTrash,
} from "@tabler/icons-react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  type BudgetLine,
  type BudgetView,
  isOver,
  leftOf,
  pathOf,
  type Period,
  type PeriodKind,
} from "./budgetList";
import classes from "./budget.module.css";

export interface BudgetActions {
  /** Open the sheet on a category: its budget, or a new one. */
  onEdit: (l: BudgetLine) => void;
  onTransactions: (l: BudgetLine) => void;
  onRemove: (l: BudgetLine) => void;
}

/** Money as the page shows it: a magnitude, in the wallet's base currency. */
export type Money = (minor: number) => string;

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/**
 * The bar: what has gone, what is coming lighter, amber past the plan. When
 * the spending runs past the plan the bar is scaled to it and a notch marks
 * where the plan ended; the tick is where today stands in the period.
 */
export function BudgetBar({
  line,
  pace,
  big = false,
}: {
  line: Pick<BudgetLine, "plan" | "spent" | "coming"> & { income?: boolean };
  pace: number | null;
  big?: boolean;
}) {
  const { plan, spent, coming } = line;
  const scale = Math.max(plan, spent + coming, 1);
  const gone = Math.min(Math.max(spent, 0), scale);
  const sp = (gone / scale) * 100;
  const co = (Math.min(Math.max(coming, 0), scale - gone) / scale) * 100;
  const over = !line.income && plan > 0 && spent + coming > plan;
  return (
    <span className={classes.bar} data-over={over || undefined} data-size={big ? "big" : undefined}>
      <span className={classes.fill} style={{ width: `${sp}%` }} />
      {co > 0 && <span className={classes.coming} style={{ left: `${sp}%`, width: `${co}%` }} />}
      {plan > 0 && plan < scale && (
        <i className={classes.planEnd} style={{ left: `${(plan / scale) * 100}%` }} />
      )}
      {pace != null && plan > 0 && (
        <i className={classes.pace} style={{ left: `${((pace * plan) / scale) * 100}%` }} />
      )}
    </span>
  );
}

/** Month | Year, ‹ the period ›, and ⋯ with the export. */
export function PeriodBar({
  period,
  name,
  onKind,
  onShift,
  onExport,
  phone = false,
}: {
  period: Period;
  name: string;
  onKind: (k: PeriodKind) => void;
  onShift: (delta: number) => void;
  onExport: () => void;
  phone?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={phone ? classes.phonePeriod : classes.period} data-tour="budget-period">
      <SegmentedControl
        size="sm"
        value={period.kind}
        onChange={(v) => onKind(v as PeriodKind)}
        data={[
          { value: "month", label: t("budget.month") },
          { value: "year", label: t("budget.year") },
        ]}
        aria-label={t("budget.periodKind")}
      />
      <div className={classes.nav}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={phone ? 40 : 30}
          aria-label={t("budget.previous")}
          onClick={() => onShift(-1)}
        >
          <IconChevronLeft size={16} />
        </ActionIcon>
        <span className={classes.navName} data-testid="budget-period-name">
          {name}
        </span>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={phone ? 40 : 30}
          aria-label={t("budget.next")}
          onClick={() => onShift(1)}
        >
          <IconChevronRight size={16} />
        </ActionIcon>
      </div>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="default" size={phone ? 40 : 36} aria-label={t("budget.more")}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={onExport}>{t("budget.exportCsv")}</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

/** Spent, left, and the one bar over the whole budget. */
export function Figures({
  view,
  pace,
  days,
  money,
  period,
}: {
  view: BudgetView;
  pace: number | null;
  days: number | null;
  money: Money;
  period?: ReactNode;
}) {
  const { t } = useTranslation();
  const { total, over } = view;
  const left = leftOf(total);
  const sub = [
    days == null ? null : days === 0 ? t("budget.lastDay") : t("budget.daysToGo", { count: days }),
    over > 0 ? (
      <span key="o" className={classes.amber}>
        {t("budget.overCount", { count: over })}
      </span>
    ) : (
      t("budget.noneOver")
    ),
  ].filter((x) => x != null);
  return (
    <>
      <div className={classes.top} data-tour="budget-figures">
        <div className={classes.fig}>
          <span className={classes.figLabel}>{t("budget.spent")}</span>
          <span className={classes.figValue} data-testid="budget-spent">
            {money(total.spent)}
          </span>
          <span className={classes.figSub}>
            {t("budget.ofPlanned", { amount: money(total.plan) })}
            {total.coming > 0 && ` · ${t("budget.stillToCome", { amount: money(total.coming) })}`}
          </span>
        </div>
        <div className={classes.fig}>
          <span className={classes.figLabel}>
            {left >= 0 ? t("budget.left") : t("budget.overLabel")}
          </span>
          <span
            className={`${classes.figValue} ${left < 0 ? classes.amber : ""}`}
            data-small
            data-testid="budget-left"
          >
            {money(Math.abs(left))}
          </span>
          <span className={classes.figSub}>
            {sub.flatMap((s, i) => (i === 0 ? [s] : [" · ", s]))}
          </span>
        </div>
        {period}
      </div>
      <div className={classes.totalBar}>
        <BudgetBar line={total} pace={pace} big />
      </div>
    </>
  );
}

function Name({ l, sub }: { l: BudgetLine; sub?: string }) {
  return (
    <span className={classes.name}>
      <span className={classes.nameText}>
        {l.parent && <span className={classes.parent}>{l.parent} › </span>}
        {l.name}
      </span>
      {sub && <span className={classes.nameSub}>{sub}</span>}
    </span>
  );
}

/** Left of the plan, or past it in amber; income reads as still to come. */
function LeftCell({ l, money }: { l: BudgetLine; money: Money }) {
  const { t } = useTranslation();
  const left = leftOf(l);
  if (l.income)
    return (
      <span className={`${classes.mono} ${classes.dim}`}>
        {left > 0
          ? t("budget.toGo", { amount: money(left) })
          : left === 0
            ? t("budget.allIn")
            : t("budget.above", { amount: money(-left) })}
      </span>
    );
  return left >= 0 ? (
    <span className={classes.mono}>{money(left)}</span>
  ) : (
    <span className={`${classes.mono} ${classes.amber}`}>
      {t("budget.over", { amount: money(-left) })}
    </span>
  );
}

function Spent({ l, money, dim = false }: { l: BudgetLine; money: Money; dim?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <span className={`${classes.mono} ${dim ? classes.dim : ""}`}>{money(l.spent)}</span>
      {l.coming > 0 && (
        <span className={classes.sub}>{t("budget.toCome", { amount: money(l.coming) })}</span>
      )}
    </>
  );
}

function LineMenu({
  l,
  actions,
  size = 30,
}: {
  l: BudgetLine;
  actions: BudgetActions;
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
          aria-label={t("budget.actionsFor", { name: l.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => actions.onEdit(l)}>
          {t("budget.menu.edit")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconReceipt size={16} />}
          onClick={() => actions.onTransactions(l)}
        >
          {t("budget.menu.transactions")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={<IconTrash size={16} />}
          onClick={() => actions.onRemove(l)}
        >
          {t("budget.menu.remove")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Every budget line in the register's card (#568): the budgeted spending,
 * largest plan first, then the spending with no budget (not over anything),
 * then the income expected, when there is any.
 */
export function BudgetTable({
  view,
  pace,
  money,
  monthly,
  actions,
}: {
  view: BudgetView;
  pace: number | null;
  money: Money;
  /** The categories whose plan changes month by month. */
  monthly: Set<number>;
  actions: BudgetActions;
}) {
  const { t } = useTranslation();
  const { spending, loose, income, total, looseTotal, incomeTotal } = view;
  const left = leftOf(total);
  const row = (l: BudgetLine) => (
    <div
      key={l.id}
      className={classes.tr}
      data-row
      data-testid={`budget-row-${l.id}`}
      data-over={isOver(l) || undefined}
      onClick={() => actions.onEdit(l)}
    >
      <Name l={l} sub={monthly.has(l.id) ? t("budget.monthByMonth") : undefined} />
      <span className={`${classes.r} ${classes.mono} ${classes.dim}`}>{money(l.plan)}</span>
      <span className={classes.r}>
        <Spent l={l} money={money} />
      </span>
      <span className={classes.r}>
        <LeftCell l={l} money={money} />
      </span>
      <span>
        <BudgetBar line={l} pace={pace} />
      </span>
      <span>
        <LineMenu l={l} actions={actions} />
      </span>
    </div>
  );
  return (
    <div className={classes.card} data-testid="budget-table" data-tour="budget-table">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span>{t("budget.col.category")}</span>
        <span className={classes.r}>{t("budget.col.planned")}</span>
        <span className={classes.r}>{t("budget.col.spent")}</span>
        <span className={classes.r}>{t("budget.col.left")}</span>
        <span />
        <span />
      </div>
      {spending.length > 0 && (
        <>
          <div className={`${classes.tr} ${classes.group}`}>
            <span>{t("budget.inBudget")}</span>
            <span className={`${classes.r} ${classes.mono}`}>{money(total.plan)}</span>
            <span className={`${classes.r} ${classes.mono}`}>{money(total.spent)}</span>
            <span className={`${classes.r} ${classes.mono}`}>
              {left >= 0 ? money(left) : t("budget.over", { amount: money(-left) })}
            </span>
            <span />
            <span />
          </div>
          {spending.map(row)}
        </>
      )}
      {loose.length > 0 && (
        <>
          <div className={`${classes.tr} ${classes.group}`}>
            <span>{t("budget.notInBudget")}</span>
            <span />
            <span className={`${classes.r} ${classes.mono}`}>{money(looseTotal)}</span>
            <span />
            <span />
            <span />
          </div>
          {loose.map((l) => (
            <div
              key={l.id}
              className={`${classes.tr} ${classes.loose}`}
              data-row
              data-testid={`budget-loose-${l.id}`}
              onClick={() => actions.onEdit(l)}
            >
              <Name l={l} />
              <span className={`${classes.r} ${classes.dim}`}>—</span>
              <span className={classes.r}>
                <Spent l={l} money={money} dim />
              </span>
              <span />
              <span>
                <Button
                  size="compact-sm"
                  variant="default"
                  className={classes.addLine}
                  leftSection={<IconPlus size={14} />}
                  onClick={stop(() => actions.onEdit(l))}
                >
                  {t("budget.add")}
                </Button>
              </span>
              <span />
            </div>
          ))}
        </>
      )}
      {income.length > 0 && (
        <>
          <div className={`${classes.tr} ${classes.group}`}>
            <span>{t("budget.expectedIncome")}</span>
            <span className={`${classes.r} ${classes.mono}`}>{money(incomeTotal.plan)}</span>
            <span className={`${classes.r} ${classes.mono}`}>{money(incomeTotal.spent)}</span>
            <span />
            <span />
            <span />
          </div>
          {income.map(row)}
        </>
      )}
    </div>
  );
}

/** The phone: a row per line, "X left of Y" and the bar under it. */
export function BudgetPhoneList({
  view,
  pace,
  money,
  actions,
}: {
  view: BudgetView;
  pace: number | null;
  money: Money;
  actions: BudgetActions;
}) {
  const { t } = useTranslation();
  const meta = (l: BudgetLine) => {
    const left = leftOf(l);
    if (l.income)
      return left > 0
        ? t("budget.toGoOf", { left: money(left), plan: money(l.plan) })
        : left === 0
          ? t("budget.allIn")
          : t("budget.above", { amount: money(-left) });
    return left >= 0 ? (
      t("budget.leftOf", { left: money(left), plan: money(l.plan) })
    ) : (
      <>
        <span className={classes.amber}>{t("budget.over", { amount: money(-left) })}</span>{" "}
        {money(l.plan)}
      </>
    );
  };
  const card = (lines: BudgetLine[], loose = false) => (
    <div className={classes.card}>
      {lines.map((l) => (
        <UnstyledButton
          key={l.id}
          className={classes.prow}
          data-testid={loose ? `budget-loose-${l.id}` : `budget-row-${l.id}`}
          onClick={() => actions.onEdit(l)}
        >
          <span className={classes.prowTop}>
            <b className={loose ? classes.dim : undefined}>{loose ? pathOf(l) : l.name}</b>
            <span className={classes.prowMeta}>
              {loose ? <span className={classes.mono}>{money(l.spent + l.coming)}</span> : meta(l)}
            </span>
          </span>
          {!loose && <BudgetBar line={l} pace={pace} />}
        </UnstyledButton>
      ))}
    </div>
  );
  return (
    <>
      {view.spending.length > 0 && (
        <>
          <div className={classes.h3}>
            {t("budget.inBudget")}
            <span className={classes.mono}>{money(view.total.plan)}</span>
          </div>
          <div data-testid="budget-table" data-tour="budget-table">
            {card(view.spending)}
          </div>
        </>
      )}
      {view.loose.length > 0 && (
        <>
          <div className={classes.h3}>
            {t("budget.notInBudget")}
            <span className={classes.mono}>{money(view.looseTotal)}</span>
          </div>
          {card(view.loose, true)}
        </>
      )}
      {view.income.length > 0 && (
        <>
          <div className={classes.h3}>
            {t("budget.expectedIncome")}
            <span className={classes.mono}>{money(view.incomeTotal.plan)}</span>
          </div>
          {card(view.income)}
        </>
      )}
    </>
  );
}

/** Empty is an invitation: what a budget does, where the money went, the button. */
export function BudgetEmpty({
  suggestions,
  money,
  onAdd,
}: {
  suggestions: { line: BudgetLine; monthly: number }[];
  money: Money;
  onAdd: (l?: BudgetLine, amount?: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={classes.empty} data-testid="budget-empty">
      <h3 className={classes.emptyTitle}>{t("budget.emptyTitle")}</h3>
      <p className={classes.emptyBody}>
        {suggestions.length ? t("budget.emptyBody") : t("budget.emptyBodyNone")}
      </p>
      {suggestions.length > 0 && (
        <div className={classes.suggestions}>
          {suggestions.map(({ line, monthly }) => (
            <div key={line.id} className={classes.suggestion}>
              <span>{pathOf(line)}</span>
              <span className={`${classes.mono} ${classes.dim}`}>
                {t("budget.aMonth", { amount: money(monthly) })}
              </span>
              <Button
                size="compact-sm"
                variant="default"
                className={classes.addLine}
                leftSection={<IconPlus size={14} />}
                onClick={() => onAdd(line, monthly)}
              >
                {t("budget.addOne")}
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button onClick={() => onAdd()}>{t("budget.add")}</Button>
    </div>
  );
}
