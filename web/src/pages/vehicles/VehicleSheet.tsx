import { ActionIcon, Anchor, Button, Menu, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChartLine, IconDots, IconTrash } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ApiError, createVehicle, updateVehicle } from "../../api/client";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { sameName } from "../../sameName";
import { reportLink, type VehicleLine } from "./vehicleList";
import classes from "./vehicles.module.css";
import { code, useFigures, type VehicleFormat } from "./vehicleWords";

/**
 * A vehicle in the sheet beside the page (#574): new, or opened from the list.
 * Its name, plate and notes; under them what it cost to run over the last
 * twelve months and its latest fills, or, while nothing is linked to it, how
 * a fuel payment gets linked. Open the report and Delete wait in the header's
 * menu.
 */
export function VehicleSheet({
  opened,
  onClose,
  walletId,
  line,
  others,
  format,
  onSaved,
  onReport,
  onDelete,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  /** The vehicle opened; null for a new one. */
  line: VehicleLine | null;
  /** The other vehicles' names: a name may not repeat one, whatever its case. */
  others: string[];
  format: VehicleFormat;
  onSaved: () => void;
  onReport: (l: VehicleLine) => void;
  onDelete: (l: VehicleLine) => void;
}) {
  const { t } = useTranslation();
  const fig = useFigures(format);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [notes, setNotes] = useState("");
  const editing = line?.vehicle ?? null;

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // vehicle before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? String(editing?.id ?? "new") : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      setName(editing?.name ?? "");
      setPlate(editing?.plate ?? "");
      setNotes(editing?.notes ?? "");
    }
  }

  const duplicate = others.find((n) => sameName(n, name));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), plate: plate.trim(), notes };
      return editing ? updateVehicle(walletId, editing.id, body) : createVehicle(walletId, body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const subtitle =
    line &&
    (line.fills > 0
      ? t("vehicles.sheet.subtitle", { count: line.fills })
      : t(line.linked > 0 ? "vehicles.noneLately" : "vehicles.noFillsShort"));

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="vehicle-sheet"
      title={editing ? editing.name : t("vehicles.addTitle")}
      subtitle={subtitle}
      headerActions={
        line && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("vehicles.actionsFor", { name: line.vehicle.name })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconChartLine size={16} />}
                disabled={line.linked === 0}
                onClick={() => onReport(line)}
              >
                {t("vehicles.menu.report")}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={() => onDelete(line)}
              >
                {t("vehicles.menu.delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("vehicles.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || !!duplicate}
          >
            {t("vehicles.save")}
          </Button>
        </>
      }
    >
      <TextInput
        label={t("vehicles.name")}
        required
        value={name}
        error={duplicate ? t("vehicles.duplicate", { name: duplicate }) : undefined}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <TextInput
        label={t("vehicles.plate")}
        value={plate}
        onChange={(e) => setPlate(e.currentTarget.value)}
      />
      <Textarea
        label={t("vehicles.notes")}
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        autosize
        minRows={2}
      />

      {line && line.fills > 0 && (
        <>
          <div className={classes.sectionHead}>
            <span>{t("vehicles.sheet.lastTwelve")}</span>
            <Anchor
              component={Link}
              to={reportLink(line.vehicle.id)}
              className={classes.sectionLink}
            >
              <IconChartLine size={14} />
              {t("vehicles.menu.report")}
            </Anchor>
          </div>
          <div className={classes.figs} data-testid="vehicle-figures">
            <span>
              <span className={classes.figLabel}>{t("vehicles.col.fuel")}</span>
              <span className={classes.figValue}>{format.money(line.cost)}</span>
            </span>
            <span>
              <span className={classes.figLabel}>{t("vehicles.col.distance")}</span>
              <span className={classes.figValue}>{fig.distance(line)}</span>
            </span>
            <span>
              <span className={classes.figLabel}>{t("vehicles.col.perKm")}</span>
              <span className={classes.figValue}>{fig.perKm(line)}</span>
            </span>
            <span>
              <span className={classes.figLabel}>{t("vehicles.col.per100")}</span>
              <span className={classes.figValue}>{fig.per100(line)}</span>
            </span>
          </div>
        </>
      )}

      {line && line.recent.length > 0 && (
        <>
          <div className={classes.sectionHead}>{t("vehicles.sheet.recent")}</div>
          <div className={classes.fills} data-testid="vehicle-recent">
            {line.recent.map((e) => (
              <div key={e.transactionId} className={classes.fill}>
                <span className={classes.dim}>{format.day(e.date)}</span>
                <span>
                  {e.meter > 0 && `${format.num(e.meter, 0)} ${t("reports.unitDistance")}`}
                  <span className={classes.dim}>
                    {e.meter > 0 && " · "}
                    {e.partial
                      ? t("reports.partial")
                      : `${format.num(e.volume)} ${t("reports.unitVolume")}`}
                  </span>
                </span>
                <span className={classes.mono}>{format.money(e.cost)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {line && line.linked === 0 && (
        <span className={classes.note}>
          <Trans i18nKey="vehicles.sheet.howTo" components={{ code }} />
        </span>
      )}
    </SideSheet>
  );
}
