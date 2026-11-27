import { UnstyledButton } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  type Icon,
} from "@tabler/icons-react";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { HINT_VALUES, useRowContext } from "./rowContext";
import { ROW_BY_ID, rowHref, rowVisible } from "./sections";
import classes from "./Settings.module.css";

/**
 * One setting (#800): an icon, its name and what it does, and its control on
 * the right. Three kinds:
 *
 * - a link to a page of its own (`to`, or the row's `to` in the map): a chevron;
 * - an expander (`children`): a chevron that opens the card below the row;
 * - a plain row, the control and nothing else.
 *
 * `id` is the row's id in the map (sections.ts), which gives its icon, name and
 * description; anything passed here wins. It is also the element's id, so
 * `#id` scrolls to it and opens it.
 */
export function SettingRow({
  id,
  icon,
  title,
  description,
  control,
  to,
  href,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  onClick,
  tour,
  testId,
}: {
  id?: string;
  icon?: Icon;
  title?: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  to?: string;
  /** An address outside the app, opened in a new tab. */
  href?: string;
  /** What the expander opens. */
  children?: ReactNode;
  defaultOpen?: boolean;
  /** Opened by the control itself (a "Change" button): no chevron then. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClick?: () => void;
  tour?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const subId = useId();
  const def = id ? ROW_BY_ID.get(id) : undefined;
  const RowIcon = icon ?? def?.icon;
  const name = title ?? (def ? t(def.titleKey) : undefined);
  const hint = description !== undefined ? description : def && t(def.hintKey, HINT_VALUES);
  const link = to ?? (def?.to ? `/settings/${def.to}` : undefined);
  const expander = children != null && children !== false;

  // A link to the row opens it, then and later.
  const linked = !!id && hash === `#${id}`;
  const [own, setOwn] = useState(defaultOpen || linked);
  const [seen, setSeen] = useState(hash);
  if (hash !== seen) {
    setSeen(hash);
    if (linked) setOwn(true);
  }
  const controlled = openProp !== undefined;
  const open = expander && (controlled ? openProp : own);
  const setOpen = (v: boolean) => (controlled ? onOpenChange?.(v) : setOwn(v));

  const chevron = expander && !controlled && (
    <UnstyledButton
      aria-expanded={open}
      aria-controls={open ? subId : undefined}
      aria-label={typeof name === "string" ? name : undefined}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(!open);
      }}
      className={classes.chevron}
      data-open={open || undefined}
      style={{ display: "flex", borderRadius: 4 }}
    >
      <IconChevronDown size={16} />
    </UnstyledButton>
  );

  const head = (
    <>
      {RowIcon && (
        <span className={classes.icon} aria-hidden>
          <RowIcon size={20} stroke={1.6} />
        </span>
      )}
      <div className={classes.text}>
        <div className={classes.title}>{name}</div>
        {hint ? <div className={classes.desc}>{hint}</div> : null}
      </div>
      {(control != null || link || href || chevron) && (
        <div className={classes.control}>
          {control}
          {link && <IconChevronRight size={16} className={classes.chevron} />}
          {href && <IconExternalLink size={16} className={classes.chevron} />}
          {chevron}
        </div>
      )}
    </>
  );

  return (
    <div id={id} data-tour={tour} data-testid={testId}>
      {link ? (
        <Link to={link} className={classes.row} onClick={onClick}>
          {head}
        </Link>
      ) : href ? (
        <a href={href} target="_blank" rel="noreferrer" className={classes.row}>
          {head}
        </a>
      ) : (
        <div
          className={classes.row}
          data-open={open || undefined}
          data-toggle={(expander && !controlled) || undefined}
          // The words open it too, for a mouse; the chevron is the button.
          onClick={
            expander && !controlled
              ? (e) => {
                  if (!(e.target as HTMLElement).closest(`.${classes.control}`)) setOpen(!open);
                }
              : undefined
          }
        >
          {head}
        </div>
      )}
      {open && (
        <div id={subId} className={classes.sub}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A heading over a run of rows. */
export function SettingsGroup({
  title,
  hint,
  badge,
  action,
  children,
}: {
  /** None for a page with one run of rows under its title. */
  title?: string;
  hint?: string;
  /** A state beside the name. */
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={classes.group}>
      {title && (
        <div
          className={classes.groupHead}
          style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}
        >
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 className={classes.groupTitle}>{title}</h2>
              {badge}
            </div>
            {hint && <div className={classes.groupHint}>{hint}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** "Related settings" at the foot of a page: links to rows elsewhere. */
export function RelatedSettings({ ids }: { ids: string[] }) {
  const { t } = useTranslation();
  const ctx = useRowContext();
  const rows = ids.flatMap((id) => {
    const r = ROW_BY_ID.get(id);
    return r && rowVisible(r, ctx) ? [r] : [];
  });
  if (rows.length === 0) return null;
  return (
    <div className={classes.related}>
      <SettingsGroup title={t("settings.related")}>
        {rows.map((r) => (
          <SettingRow
            key={r.id}
            icon={r.icon}
            title={t(r.titleKey)}
            description=""
            to={rowHref(r)}
          />
        ))}
      </SettingsGroup>
    </div>
  );
}

/** A dot and a word: how something stands. */
export function SettingState({
  tone = "ok",
  children,
}: {
  tone?: "ok" | "warn" | "off" | "error";
  children: ReactNode;
}) {
  return (
    <span className={classes.state}>
      <span className={classes.dot} data-tone={tone} aria-hidden />
      {children}
    </span>
  );
}
