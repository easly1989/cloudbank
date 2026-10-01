import { ActionIcon, Button, Menu, UnstyledButton } from "@mantine/core";
import { IconChartLine, IconDots, IconPencil, IconTrash } from "@tabler/icons-react";
import { useState, type MouseEvent } from "react";
import { Trans, useTranslation } from "react-i18next";

import { daysBetween, lastFill, type VehicleLine } from "./vehicleList";
import classes from "./vehicles.module.css";
import { code, useFigures, type VehicleActions, type VehicleFormat } from "./vehicleWords";

interface ListProps {
  lines: VehicleLine[];
  format: VehicleFormat;
  actions: VehicleActions;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** The ⋯ menu's items, shared by the button and the right-click menu. */
function VehicleMenuItems({ l, actions }: { l: VehicleLine; actions: VehicleActions }) {
  const { t } = useTranslation();
  return (
    <>
      <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => actions.onOpen(l)}>
        {t("vehicles.menu.edit")}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconChartLine size={16} />}
        disabled={l.linked === 0}
        onClick={() => actions.onReport(l)}
      >
        {t("vehicles.menu.report")}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item
        color="red"
        leftSection={<IconTrash size={16} />}
        onClick={() => actions.onDelete(l)}
      >
        {t("vehicles.menu.delete")}
      </Menu.Item>
    </>
  );
}

function VehicleMenu({ l, actions }: { l: VehicleLine; actions: VehicleActions }) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={30}
          aria-label={t("vehicles.actionsFor", { name: l.vehicle.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <VehicleMenuItems l={l} actions={actions} />
      </Menu.Dropdown>
    </Menu>
  );
}

function Plate({ plate }: { plate: string }) {
  return plate ? <span className={classes.plate}>{plate}</span> : null;
}

/**
 * A row per vehicle in the register's card (#574): what its fuel cost over the
 * last twelve months, the kilometres, the cost of one, the litres per 100 km
 * and the last fill. Report opens the Reports page on it; so do ⋯ and a right
 * click, which keep it when the page is too narrow for the button.
 */
export function VehicleTable({ lines, format, actions }: ListProps) {
  const { t } = useTranslation();
  const fig = useFigures(format);
  const [menu, setMenu] = useState<{ x: number; y: number; l: VehicleLine } | null>(null);
  const ago = (date: string) => {
    const n = daysBetween(date, format.today);
    return n <= 0 ? t("vehicles.today") : t("vehicles.daysAgo", { count: n });
  };

  return (
    <div className={classes.card} data-testid="vehicles-table" data-tour="vehicles-table">
      <div className={`${classes.tr} ${classes.head}`} role="presentation">
        <span>{t("vehicles.col.vehicle")}</span>
        <span className={classes.r}>{t("vehicles.col.fuel")}</span>
        <span className={classes.r}>{t("vehicles.col.distance")}</span>
        <span className={classes.r}>{t("vehicles.col.perKm")}</span>
        <span className={classes.r}>{t("vehicles.col.per100")}</span>
        <span className={classes.last}>{t("vehicles.col.lastFill")}</span>
        <span className={classes.report} />
        <span />
      </div>
      {lines.map((l) => {
        const last = lastFill(l);
        return (
          <div
            key={l.vehicle.id}
            className={classes.tr}
            data-row
            data-testid={`vehicle-row-${l.vehicle.id}`}
            onClick={() => actions.onOpen(l)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, l });
            }}
          >
            <span className={classes.name}>
              <span className={classes.nameTop}>
                <UnstyledButton
                  className={classes.nameText}
                  onClick={stop(() => actions.onOpen(l))}
                >
                  {l.vehicle.name}
                </UnstyledButton>
                <Plate plate={l.vehicle.plate} />
              </span>
              {l.vehicle.notes && <span className={classes.sub}>{l.vehicle.notes}</span>}
            </span>
            {l.fills > 0 ? (
              <>
                <span className={`${classes.r} ${classes.two}`}>
                  <span className={classes.mono}>{format.money(l.cost)}</span>
                  <span className={classes.sub}>{t("vehicles.fills", { count: l.fills })}</span>
                </span>
                <span className={`${classes.r} ${classes.mono}`}>{fig.distance(l)}</span>
                <span className={`${classes.r} ${classes.mono}`}>{fig.perKm(l)}</span>
                <span className={`${classes.r} ${classes.mono}`}>{fig.per100(l)}</span>
              </>
            ) : (
              <span className={classes.none} data-wide={!last || undefined}>
                {l.linked > 0
                  ? t("vehicles.noneLately")
                  : t("vehicles.noFills", { name: l.vehicle.name })}
              </span>
            )}
            {/* Without a fill the message above takes this cell too. */}
            {last && (
              <span className={`${classes.two} ${classes.last}`}>
                <span>
                  {format.day(last.date)}
                  <span className={classes.dim}> · {ago(last.date)}</span>
                </span>
                {last.meter > 0 && (
                  <span className={classes.sub}>
                    {t("vehicles.onTheClock", {
                      distance: `${format.num(last.meter, 0)} ${t("reports.unitDistance")}`,
                    })}
                  </span>
                )}
              </span>
            )}
            <span className={classes.report}>
              {l.linked > 0 && (
                <Button
                  variant="default"
                  size="compact-sm"
                  className={classes.rowButton}
                  leftSection={<IconChartLine size={14} />}
                  aria-label={t("vehicles.reportFor", { name: l.vehicle.name })}
                  onClick={stop(() => actions.onReport(l))}
                >
                  {t("vehicles.report")}
                </Button>
              )}
            </span>
            <span>
              <VehicleMenu l={l} actions={actions} />
            </span>
          </div>
        );
      })}

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
        <Menu.Dropdown>{menu && <VehicleMenuItems l={menu.l} actions={actions} />}</Menu.Dropdown>
      </Menu>
    </div>
  );
}

/**
 * The explanation under the list: the period, and what the memo carries. The
 * phone has room for the period only.
 */
export function VehiclesLine({ short = false }: { short?: boolean }) {
  return (
    <span className={classes.line} data-tour="vehicles-memo">
      <Trans i18nKey={short ? "vehicles.phoneLine" : "vehicles.line"} components={{ code }} />
    </span>
  );
}

/** The phone: a row per vehicle, its figures in one line under its name. */
export function VehiclePhoneList({ lines, format, actions }: ListProps) {
  const { t } = useTranslation();
  const fig = useFigures(format);
  return (
    <div className={classes.card} data-testid="vehicles-table" data-tour="vehicles-table">
      {lines.map((l) => {
        const last = lastFill(l);
        return (
          <UnstyledButton
            key={l.vehicle.id}
            className={classes.prow}
            data-testid={`vehicle-row-${l.vehicle.id}`}
            onClick={() => actions.onOpen(l)}
          >
            <span className={classes.prowTop}>
              <span className={classes.nameTop}>
                <span className={classes.nameText}>{l.vehicle.name}</span>
                <Plate plate={l.vehicle.plate} />
              </span>
              {l.fills > 0 && <span className={classes.mono}>{format.money(l.cost)}</span>}
            </span>
            <span className={classes.prowMeta}>
              {l.fills > 0 ? (
                <span>
                  {[
                    fig.distance(l),
                    l.perKm == null
                      ? null
                      : `${format.money(l.perKm)}/${t("reports.unitDistance")}`,
                    l.consumption > 0
                      ? `${format.num(l.consumption)} ${t("reports.unitConsumption")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : (
                <span>{t(l.linked > 0 ? "vehicles.noneLately" : "vehicles.noFillsShort")}</span>
              )}
              {last && <span>{format.day(last.date)}</span>}
            </span>
          </UnstyledButton>
        );
      })}
    </div>
  );
}

/**
 * Empty is an invitation: what the page works out, and the three steps that
 * get a vehicle's fuel onto it — the memo's tokens being the one nobody
 * guesses.
 */
export function VehiclesEmpty({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={classes.empty} data-testid="vehicles-empty">
      <h3 className={classes.emptyTitle}>{t("vehicles.empty.title")}</h3>
      <p className={classes.emptyBody}>{t("vehicles.empty.body")}</p>
      <ol className={classes.steps}>
        {[1, 2, 3].map((n) => (
          <li key={n} className={classes.step}>
            <span className={classes.stepNumber}>{n}</span>
            <span>
              {t(`vehicles.empty.step${n}`)}
              <span className={classes.stepSub}>
                <Trans i18nKey={`vehicles.empty.step${n}Sub`} components={{ code }} />
              </span>
            </span>
          </li>
        ))}
      </ol>
      <Button onClick={onAdd} data-tour="vehicles-add">
        {t("vehicles.add")}
      </Button>
    </div>
  );
}
