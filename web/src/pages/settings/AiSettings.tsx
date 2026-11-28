import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  RingProgress,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AI_SENDS_KEY,
  AI_SETTINGS_KEY,
  getAISend,
  getAISettings,
  listAISends,
  type AIFeature,
  type AISend,
  type AISettingsInput,
} from "../../api/ai";
import { AiBox } from "../../components/AiBox";
import { notifyError } from "../../notifyError";
import { useWallet } from "../../wallet/WalletProvider";
import { AutoField } from "./AutoField";
import { AI_FEATURES } from "./sections";
import { useAiSave, type AIChange } from "./settingsSaves";
import { SettingRow, SettingsGroup, SettingState } from "./SettingRow";

// Settings › AI (#696): the provider, which jobs the AI does and on which
// wallets, how its box looks; then this month's count against the limit and
// the latest texts sent, word for word. Each row saves when it changes (#800).

/** The first of next month, UTC, when the count starts again. */
function resetDay(lang: string): string {
  const n = new Date();
  const next = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", timeZone: "UTC" }).format(
    next,
  );
}

const sentAt = (iso: string, lang: string) =>
  new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function AiSettings() {
  const { t, i18n } = useTranslation();
  const { wallets } = useWallet();
  const query = useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAISettings });
  const sends = useQuery({ queryKey: AI_SENDS_KEY, queryFn: () => listAISends(8) });
  const [shown, setShown] = useState<number | null>(null);

  const save = useAiSave();
  const set = (change: AIChange) => save.mutate(change, { onError: notifyError });
  const field = (patch: Partial<AISettingsInput>) => save.mutateAsync(() => patch);

  const data = query.data;
  if (!data) return <Loader size="sm" />;
  const used = data.used;
  const cap = data.monthlyLimit;
  const featureName = (f: AIFeature) => t(`ai.feature.${f}.name`);
  const walletsOn = wallets.filter((w) => !data.walletsOff.includes(w.id)).length;

  return (
    <>
      <SettingsGroup title={t("ai.provider")} hint={t("ai.hint")}>
        <SettingRow
          id="ai-enable"
          control={
            <Switch
              aria-label={t("ai.enable")}
              checked={data.enabled}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                set(() => ({ enabled: on }));
              }}
            />
          }
        />
        <SettingRow
          id="ai-base-url"
          control={
            <AutoField
              label={t("ai.baseUrl")}
              placeholder="https://api.openai.com/v1"
              value={data.baseUrl}
              onSave={(v) => field({ baseUrl: v.trim() })}
            />
          }
        />
        <SettingRow
          id="ai-model"
          control={
            <AutoField
              label={t("ai.model")}
              placeholder="gpt-4o-mini"
              value={data.model}
              onSave={(v) => field({ model: v.trim() })}
            />
          }
        />
        <SettingRow
          id="ai-key"
          description={data.hasKey ? t("ai.keySet") : t("ai.keyNotSet")}
          control={
            <AutoField
              kind="password"
              label={t("ai.apiKey")}
              placeholder={data.hasKey ? "••••••••" : t("ai.apiKeyPlaceholder")}
              value=""
              onSave={(v) => field({ apiKey: v })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("ai.features")} hint={t("ai.featuresHint")}>
        {AI_FEATURES.map((f) => {
          const toggle = (
            <Switch
              aria-label={featureName(f.key)}
              checked={data.features[f.key]}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                set((cur) => ({ features: { ...cur.features, [f.key]: on } }));
              }}
            />
          );
          // Reports also run on a schedule, chosen under their row.
          return f.key === "reports" ? (
            <SettingRow key={f.key} id={`ai-${f.key}`} control={toggle}>
              {data.features.reports && (
                <Stack gap={6}>
                  <Text fz="sm">{t("ai.schedule.lead")}</Text>
                  {(["weekly", "yearly"] as const).map((k) => (
                    <Checkbox
                      key={k}
                      label={t(`ai.schedule.${k}`)}
                      checked={data.schedule[k]}
                      onChange={(e) => {
                        const on = e.currentTarget.checked;
                        set((cur) => ({ schedule: { ...cur.schedule, [k]: on } }));
                      }}
                    />
                  ))}
                </Stack>
              )}
            </SettingRow>
          ) : (
            <SettingRow key={f.key} id={`ai-${f.key}`} control={toggle} />
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={t("ai.wallets")} hint={t("ai.walletsHint")}>
        <SettingRow
          id="ai-wallets"
          control={
            <SettingState tone={walletsOn > 0 ? "ok" : "off"}>
              {t("notif.ofTotal", { on: walletsOn, total: wallets.length })}
            </SettingState>
          }
        >
          {wallets.map((w) => (
            <Checkbox
              key={w.id}
              label={w.title}
              description={
                w.role === "member" ? t("ai.walletOf", { owner: w.ownerName }) : undefined
              }
              checked={!data.walletsOff.includes(w.id)}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                set((cur) => ({
                  walletsOff: on
                    ? cur.walletsOff.filter((id) => id !== w.id)
                    : [...cur.walletsOff.filter((id) => id !== w.id), w.id],
                }));
              }}
            />
          ))}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("ai.look")} hint={t("ai.lookHint")}>
        <SettingRow
          id="ai-motion"
          defaultOpen
          control={
            <Switch
              aria-label={t("ai.motion")}
              checked={data.motion}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                set(() => ({ motion: on }));
              }}
            />
          }
        >
          <AiBox label={t("ai.box.example")} basis={t("ai.box.exampleBasis")} motion={data.motion}>
            {t("ai.box.exampleText")}
          </AiBox>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("ai.thisMonth")}>
        <SettingRow
          title={t("ai.used", { count: used, limit: cap })}
          description={t("ai.resets", { date: resetDay(i18n.language) })}
          control={
            <RingProgress
              size={52}
              thickness={6}
              roundCaps
              sections={[
                {
                  value: Math.min(100, (used / Math.max(1, cap)) * 100),
                  color: used >= cap ? "orange" : "blue",
                },
              ]}
              label={
                <Text ta="center" ff="monospace" fw={650} fz={11}>
                  {used}
                </Text>
              }
            />
          }
        />
        <SettingRow
          id="ai-limit"
          control={
            <AutoField
              kind="number"
              label={t("ai.limit.label")}
              width={140}
              min={1}
              max={100000}
              value={String(cap)}
              onSave={(v) => field({ monthlyLimit: Number(v) })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("ai.sent")} hint={t("ai.sentHint")}>
        {sends.data?.sends.length === 0 && (
          <Text fz="sm" c="dimmed">
            {t("ai.sentNone")}
          </Text>
        )}
        {sends.data?.sends.map((s) => (
          <SettingRow
            key={s.id}
            title={featureName(s.feature)}
            description={
              s.walletName
                ? t("ai.sentWhere", {
                    when: sentAt(s.createdAt, i18n.language),
                    wallet: s.walletName,
                  })
                : sentAt(s.createdAt, i18n.language)
            }
            control={
              <Button variant="default" onClick={() => setShown(s.id)}>
                {t("ai.show")}
              </Button>
            }
          />
        ))}
      </SettingsGroup>
      <SentModal id={shown} onClose={() => setShown(null)} featureName={featureName} />
    </>
  );
}

/** One text sent, word for word, fetched when it is asked for. */
function SentModal({
  id,
  onClose,
  featureName,
}: {
  id: number | null;
  onClose: () => void;
  featureName: (f: AIFeature) => string;
}) {
  const { t, i18n } = useTranslation();
  const one = useQuery({
    queryKey: [...AI_SENDS_KEY, id],
    queryFn: () => getAISend(id as number),
    enabled: id !== null,
  });
  const s: AISend | undefined = one.data;
  return (
    <Modal
      opened={id !== null}
      onClose={onClose}
      size="lg"
      title={s ? t("ai.sentOn", { when: sentAt(s.createdAt, i18n.language) }) : t("ai.sent")}
    >
      {!s ? (
        <Loader size="sm" />
      ) : (
        <Stack gap="xs">
          <Group gap="xs">
            <Badge variant="default">{featureName(s.feature)}</Badge>
            {s.walletName && <Badge variant="default">{s.walletName}</Badge>}
            <Badge variant="default">{s.model}</Badge>
          </Group>
          <Box
            component="pre"
            m={0}
            p="sm"
            ff="monospace"
            fz={12}
            lh={1.5}
            bg="var(--mantine-color-default-hover)"
            style={{ whiteSpace: "pre-wrap", borderRadius: 8 }}
          >
            {s.sent}
          </Box>
        </Stack>
      )}
    </Modal>
  );
}
