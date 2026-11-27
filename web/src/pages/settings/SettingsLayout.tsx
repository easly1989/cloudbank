import { Group, Loader, TextInput, UnstyledButton } from "@mantine/core";
import { IconArrowLeft, IconChevronDown, IconSearch, IconX } from "@tabler/icons-react";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";
import { NotificationBell } from "../../components/NotificationBell";
import { PageErrorBoundary } from "../../components/PageErrorBoundary";
import { DemoChrome } from "../../demo/DemoChrome";
import { TourButton } from "../../onboarding/TourButton";
import { usePageTour } from "../../onboarding/tourContext";
import type { TourId } from "../../onboarding/tours";
import { useWallet } from "../../wallet/WalletProvider";
import { HINT_VALUES, useRowContext } from "./rowContext";
import { SettingRow, SettingsGroup } from "./SettingRow";
import {
  SETTING_ROWS,
  SETTINGS_SECTIONS,
  rowHref,
  searchRows,
  visibleSections,
  type SettingsSection,
} from "./sections";
import classes from "./Settings.module.css";

// The pages with a tour of their own (#421), by their path under /settings/.
// The screen's own tour sits on Personalisation, the one page that has all
// three of its targets (the nav, the entry sheet's fields and the way back).
const PAGE_TOURS: Partial<Record<string, TourId>> = {
  personalization: "settings",
  wallet: "data",
  "connections/bank-sync": "bankSync",
  "connections/mail": "mail",
};

/**
 * Settings is its own screen, not a page inside the app (#800, after Windows
 * 11 Settings): the app's navigation is replaced by the settings nav, with
 * who you are, a search over every setting and the eight sections, and the
 * only way back is one link at its top. Settings is somewhere you go, do a
 * thing and leave.
 *
 * Sections and their sub-pages are routes, so each one is a link you can send
 * someone, and `#row` scrolls to a row and marks it.
 */
export function SettingsLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { currentWallet } = useWallet();
  const { pathname, hash, key } = useLocation();
  const ctx = useRowContext();
  const sections = visibleSections(ctx);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const path = pathname.replace(/^\/settings\/?/, "").replace(/\/$/, "");
  const current = sections.find((s) => path === s.id || path.startsWith(`${s.id}/`));
  const sub = current && path !== current.id ? SETTING_ROWS.find((r) => r.to === path) : undefined;
  const tour = PAGE_TOURS[path];
  usePageTour(tour);

  // A new page closes the phone's menu and the search.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setMenuOpen(false);
  }

  // `#row`: scroll to the row once its page has drawn it, and mark it.
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const find = () => {
      const el = document.getElementById(id);
      if (!el) {
        if (++tries < 60) timer = setTimeout(find, 50);
        return;
      }
      el.scrollIntoView({ block: "center" });
      el.classList.add(classes.flash);
      timer = setTimeout(() => el.classList.remove(classes.flash), 1600);
    };
    find();
    return () => clearTimeout(timer);
  }, [pathname, hash, key]);

  const label = (s: SettingsSection) => t(s.labelKey);
  const title = sub
    ? t(sub.titleKey)
    : current?.id === "wallet" && currentWallet
      ? `${label(current)} · ${currentWallet.title}`
      : current
        ? label(current)
        : "";
  const searching = query.trim() !== "";

  return (
    <div className={classes.screen}>
      <nav aria-label={t("settings.title")} className={classes.nav} data-tour="settings-rail">
        {/* One way out, and it says where it goes. */}
        <Link to="/" className={classes.back} data-tour="settings-back">
          <IconArrowLeft size={14} />
          {t("settings.back")}
        </Link>
        <div className={classes.me}>
          <span className={classes.avatar} aria-hidden>
            {(user?.username ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className={classes.meName}>{user?.username}</div>
            <div className={classes.meRole}>
              {[
                user?.isAdmin ? t("settings.roleAdmin") : t("settings.roleUser"),
                currentWallet?.title,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
        <TextInput
          className={classes.search}
          classNames={{ input: classes.searchInput }}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder={t("settings.search")}
          aria-label={t("settings.search")}
          rightSection={
            searching ? (
              <UnstyledButton
                aria-label={t("settings.searchClear")}
                onClick={() => setQuery("")}
                style={{ display: "flex" }}
              >
                <IconX size={16} />
              </UnstyledButton>
            ) : (
              <IconSearch size={16} />
            )
          }
        />
        {/* On a phone the list folds under the section you are in. */}
        {current && (
          <UnstyledButton
            hiddenFrom="sm"
            className={classes.navItem}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            data-current
            style={{ background: "var(--cb-ledger-surface)" }}
          >
            <current.icon size={18} />
            <span style={{ flex: 1, minWidth: 0, textAlign: "start" }}>{label(current)}</span>
            <IconChevronDown
              size={16}
              className={classes.chevron}
              data-open={menuOpen || undefined}
            />
          </UnstyledButton>
        )}
        <div className={classes.sections} data-open={menuOpen || !current || undefined}>
          {sections.map((s) => (
            <NavLink
              key={s.id}
              to={`/settings/${s.id}`}
              className={classes.navItem}
              aria-current={current?.id === s.id ? "page" : undefined}
              onClick={() => setQuery("")}
            >
              <s.icon size={18} />
              <span style={{ flex: 1, minWidth: 0 }}>{label(s)}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <main className={classes.main}>
        <div className={classes.inner}>
          {__DEMO__ && (
            <div style={{ marginBottom: 16 }}>
              <DemoChrome />
            </div>
          )}
          <div className={classes.head}>
            <h1 className={classes.h1}>
              {searching ? (
                t("settings.searchTitle")
              ) : sub && current ? (
                <>
                  <Link to={`/settings/${current.id}`} className={classes.crumb}>
                    {label(current)}
                  </Link>
                  <span className={classes.crumb} aria-hidden>
                    ›
                  </span>
                  {title}
                </>
              ) : (
                title
              )}
            </h1>
            {/* Settings has its own header, so the bell is here too (#685). */}
            <Group gap="xs" wrap="nowrap">
              <NotificationBell size={40} />
              {tour && !searching && <TourButton id={tour} size={40} />}
            </Group>
          </div>
          {searching ? (
            <SearchResults query={query} onPick={() => setQuery("")} />
          ) : (
            // A page that throws leaves the nav in place (#518).
            <PageErrorBoundary resetKey={key}>
              <Suspense fallback={<Loader />}>
                <Outlet />
              </Suspense>
            </PageErrorBoundary>
          )}
        </div>
      </main>
    </div>
  );
}

/** Every row whose name or description matches, by section. */
function SearchResults({ query, onPick }: { query: string; onPick: () => void }) {
  const { t } = useTranslation();
  const ctx = useRowContext();
  const found = searchRows(query, ctx, (r) => `${t(r.titleKey)} ${t(r.hintKey, HINT_VALUES)}`);
  if (found.length === 0) {
    return (
      <p className={classes.groupHint} style={{ fontSize: 14 }}>
        {t("settings.searchNone", { query: query.trim() })}
      </p>
    );
  }
  return (
    <>
      {SETTINGS_SECTIONS.map((s) => {
        const rows = found.filter((r) => r.section === s.id);
        if (rows.length === 0) return null;
        return (
          <SettingsGroup key={s.id} title={t(s.labelKey)}>
            {rows.map((r) => (
              <SettingRow
                key={r.id}
                icon={r.icon}
                title={t(r.titleKey)}
                description={t(r.hintKey, HINT_VALUES)}
                to={rowHref(r)}
                onClick={onPick}
              />
            ))}
          </SettingsGroup>
        );
      })}
    </>
  );
}
