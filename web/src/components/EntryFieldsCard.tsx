import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconInfoCircle } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { ApiError, updateMe, type Preferences, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { ENTRY_FIELDS, placements, type EntryField, type Placement } from "./entryFields";
import { StatusPicker } from "./StatusPicker";

/**
 * Which of the entry sheet's fields are in view and which wait under More
 * details, and what a new entry starts from.
 *
 * Nothing here hides a field outright, so no field can become unreachable. The
 * date and the account are the two a save needs; moved out of view, the sheet
 * still fills them, and this card says with what — the default is part of the
 * choice, not something to discover when a save comes out wrong.
 *
 * Each change saves at once, as the register's columns do: there is no draft
 * state here worth a Save button.
 */
export function EntryFieldsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const prefs = user?.preferences ?? {};
  const place = placements(prefs.entryFields);
  const defaults = prefs.entryDefaults ?? {};

  // The sheet's ⋯ menu links here; the settings body scrolls on its own, so
  // the browser's jump to an anchor does not reach it.
  const ref = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === "#entry-fields") ref.current?.scrollIntoView({ block: "start" });
  }, [hash]);

  const persist = useMutation({
    mutationFn: (patch: Partial<Preferences>) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), ...patch } }),
    // Shown at once; the server's answer then replaces it.
    onMutate: (patch) => {
      if (user) qc.setQueryData(["me"], { ...user, preferences: { ...prefs, ...patch } });
    },
    onSuccess: (updated: User) => qc.setQueryData(["me"], updated),
    onError: (err: unknown) => {
      if (user) qc.setQueryData(["me"], user);
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      });
    },
  });

  const move = (id: EntryField, to: Placement) =>
    persist.mutate({ entryFields: { ...place, [id]: to } });
  const dateDefault = defaults.date ?? "today";
  const statusDefault = String(defaults.status ?? 0);

  // What a field starts as on a new entry, where that is worth saying.
  const startsAs: Partial<Record<EntryField, ReactNode>> = {
    date: (
      <Select
        size="xs"
        w={220}
        aria-label={t("entryFields.startsAs")}
        data={[
          { value: "today", label: t("entryFields.dateToday") },
          { value: "last", label: t("entryFields.dateLast") },
        ]}
        value={dateDefault}
        onChange={(v) =>
          v && persist.mutate({ entryDefaults: { ...defaults, date: v as "today" | "last" } })
        }
        allowDeselect={false}
      />
    ),
    account: <Text fz="sm">{t("entryFields.accountDefault")}</Text>,
    paymentMode: <Text fz="sm">{t("entryFields.paymentDefault")}</Text>,
    status: (
      <div style={{ width: 240 }}>
        <StatusPicker
          label={t("entryFields.statusDefault")}
          value={statusDefault}
          onChange={(v) => persist.mutate({ entryDefaults: { ...defaults, status: Number(v) } })}
        />
      </div>
    ),
  };
  const defaultText: Partial<Record<EntryField, string>> = {
    date: t(dateDefault === "last" ? "entryFields.dateLast" : "entryFields.dateToday"),
    account: t("entryFields.accountDefault"),
  };

  return (
    <Card withBorder ref={ref} id="entry-fields">
      <Stack gap="sm">
        {ENTRY_FIELDS.map((f, i) => {
          const label = t(f.labelKey);
          return (
            <Fragment key={f.id}>
              {i > 0 && <Divider />}
              <Group justify="space-between" wrap="wrap" gap="sm">
                <Text fw={500} fz="sm">
                  {label}
                </Text>
                <SegmentedControl
                  className="cb-choice"
                  aria-label={label}
                  value={place[f.id]}
                  onChange={(v) => move(f.id, v as Placement)}
                  data={[
                    { value: "base", label: t("entryFields.inView") },
                    { value: "more", label: t("transactions.moreDetails") },
                  ]}
                />
              </Group>
              {startsAs[f.id] && (
                <Group justify="space-between" wrap="wrap" gap="sm">
                  <Text c="dimmed" fz="sm">
                    {t("entryFields.startsAs")}
                  </Text>
                  {startsAs[f.id]}
                </Group>
              )}
              {f.required && place[f.id] === "more" && (
                <Alert color="yellow" icon={<IconInfoCircle size={16} />} p="xs">
                  {t("entryFields.requiredMoved", {
                    field: label,
                    value: defaultText[f.id],
                  })}
                </Alert>
              )}
            </Fragment>
          );
        })}
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={() => persist.mutate({ entryFields: undefined, entryDefaults: undefined })}
            disabled={!prefs.entryFields && !prefs.entryDefaults}
          >
            {t("entryFields.reset")}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
