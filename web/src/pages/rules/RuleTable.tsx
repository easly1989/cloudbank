import { ActionIcon, Menu, Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconDots,
  IconGripVertical,
  IconPencil,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Account, Assignment, Category, Payee } from "../../api/client";
import { categoryLabel } from "../payees/payeeList";
import { categoryTone, shadowed, usedOn } from "./ruleList";
import classes from "./rules.module.css";

export interface RuleActions {
  onEdit: (r: Assignment) => void;
  /** Apply the rule to the transactions it matches first. */
  onApply: (r: Assignment) => void;
  onMove: (r: Assignment, delta: number) => void;
  /** Drop the dragged rule where the target is. */
  onDrop: (id: number, targetId: number) => void;
  onDelete: (r: Assignment) => void;
}

export interface Lookups {
  accounts: Account[];
  categories: Category[];
  payees: Payee[];
}

/** What a rule reads and what it sets; a new rule has no counts yet. */
export type RuleLike = Pick<
  Assignment,
  | "matchField"
  | "matchType"
  | "pattern"
  | "caseSensitive"
  | "setPayeeId"
  | "setCategoryId"
  | "setPaymentMode"
  | "setInfo"
  | "setTags"
> &
  Partial<Pick<Assignment, "matches" | "reach">>;

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/**
 * A rule as the sentence it is (#566): "When the payee contains Supermarket",
 * then "● file it under Food › Groceries · add the tag car". When a rule
 * above takes every match first, the first line says so.
 */
export function Sentence({ rule, lookups }: { rule: RuleLike; lookups: Lookups }) {
  const { t } = useTranslation();
  const { categories, payees } = lookups;
  const parts: ReactNode[] = [];
  const category = categories.find((c) => c.id === rule.setCategoryId);
  if (category)
    parts.push(
      <span key="c">
        <span className={classes.dot} data-tone={categoryTone(category.id, categories)} />
        {t("assignments.does.category", { name: categoryLabel(category, categories) })}
      </span>,
    );
  const payee = payees.find((p) => p.id === rule.setPayeeId);
  if (payee)
    parts.push(
      <span key="p">
        {t(parts.length ? "assignments.does.payee" : "assignments.does.payeeFirst", {
          name: payee.name,
        })}
      </span>,
    );
  if (rule.setPaymentMode != null)
    parts.push(
      <span key="m">
        {t("assignments.does.mode", { mode: t(`paymentModes.${rule.setPaymentMode}`) })}
      </span>,
    );
  if (rule.setInfo)
    parts.push(<span key="i">{t("assignments.does.info", { info: rule.setInfo })}</span>);
  if (rule.setTags.length > 0)
    parts.push(
      <span key="t">
        {t("assignments.does.tags", { count: rule.setTags.length, tags: rule.setTags.join(", ") })}
      </span>,
    );

  return (
    <span className={classes.sentence}>
      <span className={classes.when}>
        {/* One phrase per field and kind: the verb agrees with its subject. */}
        {t(`assignments.when.${rule.matchField}.${rule.matchType}`)}{" "}
        <span className={classes.pattern}>{rule.pattern}</span>
        {rule.caseSensitive && ` ${t("assignments.sameCase")}`}
        {shadowed(rule) && (
          <span className={classes.shadow}>
            {" · "}
            {t("assignments.shadowed", { count: rule.reach })}
          </span>
        )}
      </span>
      <span className={classes.does}>
        {parts.length === 0 ? (
          <span className={classes.dim}>{t("assignments.does.nothing")}</span>
        ) : (
          parts.flatMap((p, i) =>
            i === 0
              ? [p]
              : [
                  <span key={`s${i}`} className={classes.sep}>
                    ·
                  </span>,
                  p,
                ],
          )
        )}
      </span>
    </span>
  );
}

/** The ⋯ menu's items, shared by the button and the right-click menu. */
function RuleMenuItems({
  r,
  index,
  count,
  actions,
}: {
  r: Assignment;
  index: number;
  count: number;
  actions: RuleActions;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => actions.onEdit(r)}>
        {t("assignments.menu.edit")}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconPlayerPlay size={16} />}
        disabled={!r.matches}
        onClick={() => actions.onApply(r)}
      >
        {t("assignments.menu.apply")}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconArrowUp size={16} />}
        disabled={index === 0}
        onClick={() => actions.onMove(r, -1)}
      >
        {t("assignments.menu.up")}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconArrowDown size={16} />}
        disabled={index === count - 1}
        onClick={() => actions.onMove(r, 1)}
      >
        {t("assignments.menu.down")}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item
        color="red"
        leftSection={<IconTrash size={16} />}
        onClick={() => actions.onDelete(r)}
      >
        {t("assignments.menu.delete")}
      </Menu.Item>
    </>
  );
}

function RuleMenu({
  r,
  index,
  count,
  actions,
  size = 30,
}: {
  r: Assignment;
  index: number;
  count: number;
  actions: RuleActions;
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
          aria-label={t("assignments.actions", { n: index + 1 })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <RuleMenuItems r={r} index={index} count={count} actions={actions} />
      </Menu.Dropdown>
    </Menu>
  );
}

const Count = ({ r }: { r: Assignment }) => {
  const { t } = useTranslation();
  const n = r.matches ?? 0;
  return (
    <span
      className={classes.count}
      data-zero={n === 0 || undefined}
      title={t("assignments.matchesTitle", { count: n })}
    >
      {n}×
    </span>
  );
};

/**
 * Every rule in the register's card (#566), in the order they are tried: the
 * sentence, the account it is limited to, when it runs and how many of the
 * wallet's transactions it decides. Drag by the grip, or Move up / down from
 * ⋯ or a right click; ▶ applies the rule to its transactions.
 */
export function RuleTable({
  rules,
  lookups,
  actions,
}: {
  rules: Assignment[];
  lookups: Lookups;
  actions: RuleActions;
}) {
  const { t } = useTranslation();
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; r: Assignment; i: number } | null>(null);
  const accountName = (id?: number | null) => lookups.accounts.find((a) => a.id === id)?.name;
  const end = () => {
    setDragId(null);
    setOverId(null);
  };

  return (
    <div className={classes.card} data-testid="rules-table">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span />
        <span>{t("assignments.col.rule")}</span>
        <span>{t("assignments.col.account")}</span>
        <span>{t("assignments.col.usedOn")}</span>
        <span className={classes.r}>{t("assignments.col.matches")}</span>
        <span />
        <span />
      </div>
      {rules.map((r, i) => (
        <div
          key={r.id}
          className={`${classes.tr} ${r.matches ? "" : classes.zero}`}
          data-row
          data-testid={`rule-row-${r.id}`}
          data-dragging={dragId === r.id || undefined}
          data-drop={(overId === r.id && dragId !== r.id) || undefined}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            setDragId(r.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOverId(r.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId != null) actions.onDrop(dragId, r.id);
            end();
          }}
          onDragEnd={end}
          onClick={() => actions.onEdit(r)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, r, i });
          }}
        >
          <span className={classes.grip} title={t("assignments.drag")}>
            <IconGripVertical size={16} />
          </span>
          <Sentence rule={r} lookups={lookups} />
          <span className={r.matchAccountId ? undefined : classes.dim}>
            {accountName(r.matchAccountId) ?? t("assignments.anyAccount")}
          </span>
          <span className={classes.dim}>{t(`assignments.usedOn.${usedOn(r)}`)}</span>
          <span className={classes.r}>
            <Count r={r} />
          </span>
          <span>
            <Tooltip label={t("assignments.menu.apply")} withinPortal>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={30}
                className={classes.play}
                aria-label={t("assignments.applyRule", { n: i + 1 })}
                disabled={!r.matches}
                onClick={stop(() => actions.onApply(r))}
              >
                <IconPlayerPlay size={16} />
              </ActionIcon>
            </Tooltip>
          </span>
          <span>
            <RuleMenu r={r} index={i} count={rules.length} actions={actions} />
          </span>
        </div>
      ))}

      {/* The right-click menu, at the pointer. */}
      <Menu
        opened={menu != null}
        onClose={() => setMenu(null)}
        position="bottom-start"
        withinPortal
        shadow="md"
      >
        <Menu.Target>
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: menu?.x ?? 0,
              top: menu?.y ?? 0,
              width: 0,
              height: 0,
            }}
          />
        </Menu.Target>
        <Menu.Dropdown>
          {menu && (
            <RuleMenuItems r={menu.r} index={menu.i} count={rules.length} actions={actions} />
          )}
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

/** The phone: a row per rule, its sentence wrapping, the count and ⋯. */
export function RulePhoneList({
  rules,
  lookups,
  actions,
}: {
  rules: Assignment[];
  lookups: Lookups;
  actions: RuleActions;
}) {
  return (
    <div className={classes.card} data-testid="rules-table">
      {rules.map((r, i) => (
        <div
          key={r.id}
          className={`${classes.prow} ${r.matches ? "" : classes.zero}`}
          data-testid="rule-row"
        >
          <UnstyledButton className={classes.pmain} onClick={() => actions.onEdit(r)}>
            <Sentence rule={r} lookups={lookups} />
            <Count r={r} />
          </UnstyledButton>
          <RuleMenu r={r} index={i} count={rules.length} actions={actions} size={44} />
        </div>
      ))}
    </div>
  );
}
