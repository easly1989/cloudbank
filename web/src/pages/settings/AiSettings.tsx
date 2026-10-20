import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  PasswordInput,
  RingProgress,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconCalendarRepeat,
  IconCategory,
  IconChartDots,
  IconCoin,
  IconMail,
  IconPencilBolt,
  IconPigMoney,
  IconTarget,
  type Icon,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AI_SENDS_KEY,
  AI_SETTINGS_KEY,
  getAISend,
  getAISettings,
  listAISends,
  updateAISettings,
  type AIFeature,
  type AIFeatures,
  type AISchedule,
  type AISend,
} from "../../api/ai";
import { AiBox } from "../../components/AiBox";
import { notifyError } from "../../notifyError";
import { useWallet } from "../../wallet/WalletProvider";
import { SettingsGroup } from "./SettingsLayout";

// Settings › AI (#696): the provider, which jobs the AI does and on which
// wallets, how its box looks; beside them, this month's count against the
// limit and the latest texts sent, word for word.

const FEATURES: { key: AIFeature; icon: Icon }[] = [
  { key: "reports", icon: IconChartDots },
  { key: "budgets", icon: IconPigMoney },
  { key: "subscriptions", icon: IconCalendarRepeat },
  { key: "savings", icon: IconCoin },
  { key: "goals", icon: IconTarget },
  { key: "suggest", icon: IconCategory },
  { key: "entry", icon: IconPencilBolt },
  { key: "mail", icon: IconMail },
];

const NO_FEATURES: AIFeatures = {
  suggest: false,
  entry: false,
  mail: false,
  reports: false,
  budgets: false,
  subscriptions: false,
  savings: false,
  goals: false,
};

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
  const qc = useQueryClient();
  const { wallets } = useWallet();
  const wide = useMediaQuery("(min-width: 75em)") ?? true;
  const query = useQuery({ queryKey: AI_SETTINGS_KEY, queryFn: getAISettings });
  const sends = useQuery({ queryKey: AI_SENDS_KEY, queryFn: () => listAISends(8) });

  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [features, setFeatures] = useState<AIFeatures>(NO_FEATURES);
  const [walletsOff, setWalletsOff] = useState<number[]>([]);
  const [limit, setLimit] = useState<number | string>(200);
  const [motion, setMotion] = useState(true);
  const [schedule, setSchedule] = useState<AISchedule>({ weekly: false, yearly: true });
  const [shown, setShown] = useState<number | null>(null);
  const data = query.data;
  const hasKey = data?.hasKey ?? false;

  // Adopt the stored settings when they arrive, during render rather than in an
  // effect, so the page never paints its blank defaults over them for a frame.
  const [seen, setSeen] = useState(data);
  if (data !== seen) {
    setSeen(data);
    if (data) {
      setEnabled(data.enabled);
      setBaseUrl(data.baseUrl);
      setModel(data.model);
      setFeatures(data.features);
      setWalletsOff(data.walletsOff);
      setLimit(data.monthlyLimit);
      setMotion(data.motion);
      setSchedule(data.schedule);
    }
  }

  const save = useMutation({
    // Send apiKey only when the user typed a new one, so a blank field keeps
    // the stored key rather than clearing it.
    mutationFn: () =>
      updateAISettings({
        enabled,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey ? { apiKey } : {}),
        features,
        walletsOff,
        monthlyLimit: typeof limit === "number" ? limit : undefined,
        motion,
        schedule,
      }),
    onSuccess: (s) => {
      qc.setQueryData(AI_SETTINGS_KEY, s);
      setApiKey("");
      notifications.show({ color: "teal", message: t("ai.saved") });
    },
    onError: (err: unknown) => notifyError(err),
  });

  const used = data?.used ?? 0;
  const cap = data?.monthlyLimit ?? 200;
  const featureName = (f: AIFeature) => t(`ai.feature.${f}.name`);

  const settings = (
    <Stack gap="xl">
      <SettingsGroup title={t("ai.provider")} hint={t("ai.hint")}>
        <Card withBorder>
          <Stack gap="sm">
            <Switch
              label={t("ai.enable")}
              description={t("ai.enableHint")}
              checked={enabled}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label={t("ai.baseUrl")}
                placeholder="https://api.openai.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.currentTarget.value)}
              />
              <TextInput
                label={t("ai.model")}
                placeholder="gpt-4o-mini"
                value={model}
                onChange={(e) => setModel(e.currentTarget.value)}
              />
            </SimpleGrid>
            <PasswordInput
              label={t("ai.apiKey")}
              description={hasKey ? t("ai.keySet") : t("ai.keyNotSet")}
              placeholder={hasKey ? "••••••••" : t("ai.apiKeyPlaceholder")}
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
            />
          </Stack>
        </Card>
      </SettingsGroup>

      <SettingsGroup title={t("ai.features")} hint={t("ai.featuresHint")}>
        <Card withBorder p={0}>
          {FEATURES.map((f, i) => (
            <Fragment key={f.key}>
              {i > 0 && <Divider />}
              <Group wrap="nowrap" align="flex-start" gap="md" p="md">
                <f.icon size={20} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden />
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={600} fz="sm">
                    {featureName(f.key)}
                  </Text>
                  <Text c="dimmed" fz="sm">
                    {t(`ai.feature.${f.key}.sends`)}
                  </Text>
                  {f.key === "reports" && features.reports && (
                    <Stack gap={6} mt={8}>
                      <Text fz="sm">{t("ai.schedule.lead")}</Text>
                      {(["weekly", "yearly"] as const).map((k) => (
                        <Checkbox
                          key={k}
                          label={t(`ai.schedule.${k}`)}
                          checked={schedule[k]}
                          onChange={(e) => {
                            const on = e.currentTarget.checked;
                            setSchedule((cur) => ({ ...cur, [k]: on }));
                          }}
                        />
                      ))}
                    </Stack>
                  )}
                </Stack>
                <Switch
                  aria-label={featureName(f.key)}
                  checked={features[f.key]}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setFeatures((cur) => ({ ...cur, [f.key]: on }));
                  }}
                />
              </Group>
            </Fragment>
          ))}
        </Card>
      </SettingsGroup>

      <SettingsGroup title={t("ai.wallets")} hint={t("ai.walletsHint")}>
        <Card withBorder>
          <Stack gap="xs">
            {wallets.map((w) => (
              <Checkbox
                key={w.id}
                label={w.title}
                description={
                  w.role === "member" ? t("ai.walletOf", { owner: w.ownerName }) : undefined
                }
                checked={!walletsOff.includes(w.id)}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setWalletsOff((cur) => (on ? cur.filter((id) => id !== w.id) : [...cur, w.id]));
                }}
              />
            ))}
          </Stack>
        </Card>
      </SettingsGroup>

      <SettingsGroup title={t("ai.look")} hint={t("ai.lookHint")}>
        <Card withBorder>
          <Stack gap="md">
            <Switch
              label={t("ai.motion")}
              description={t("ai.motionHint")}
              checked={motion}
              onChange={(e) => setMotion(e.currentTarget.checked)}
            />
            <AiBox label={t("ai.box.example")} basis={t("ai.box.exampleBasis")} motion={motion}>
              {t("ai.box.exampleText")}
            </AiBox>
          </Stack>
        </Card>
      </SettingsGroup>

      <Group justify="flex-end">
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          {t("ai.save")}
        </Button>
      </Group>
    </Stack>
  );

  const month = (
    <Stack gap="md" style={wide ? { position: "sticky", top: 0 } : undefined}>
      <Card withBorder>
        <Stack gap="sm">
          <Text fw={650}>{t("ai.thisMonth")}</Text>
          <Group gap="md" wrap="nowrap">
            <RingProgress
              size={84}
              thickness={8}
              roundCaps
              sections={[
                {
                  value: Math.min(100, (used / Math.max(1, cap)) * 100),
                  color: used >= cap ? "orange" : "blue",
                },
              ]}
              label={
                <Text ta="center" ff="monospace" fw={650} fz="sm">
                  {used}
                </Text>
              }
            />
            <Stack gap={2}>
              <Text fz="sm">{t("ai.used", { count: used, limit: cap })}</Text>
              <Text fz="xs" c="dimmed">
                {t("ai.resets", { date: resetDay(i18n.language) })}
              </Text>
            </Stack>
          </Group>
          <NumberInput
            label={t("ai.limit.label")}
            min={1}
            max={100000}
            allowDecimal={false}
            allowNegative={false}
            w={160}
            value={limit}
            onChange={setLimit}
          />
          <Text c="dimmed" fz="xs">
            {t("ai.limit.note")}
          </Text>
        </Stack>
      </Card>
      <Card withBorder>
        <Stack gap="xs">
          <Text fw={650}>{t("ai.sent")}</Text>
          <Text fz="xs" c="dimmed">
            {t("ai.sentHint")}
          </Text>
          {sends.data?.sends.length === 0 && (
            <Text fz="sm" c="dimmed">
              {t("ai.sentNone")}
            </Text>
          )}
          {sends.data?.sends.map((s) => (
            <Group key={s.id} justify="space-between" wrap="nowrap" gap="xs">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fz="sm" truncate>
                  {featureName(s.feature)}
                </Text>
                <Text fz="xs" c="dimmed" truncate>
                  {s.walletName
                    ? t("ai.sentWhere", {
                        when: sentAt(s.createdAt, i18n.language),
                        wallet: s.walletName,
                      })
                    : sentAt(s.createdAt, i18n.language)}
                </Text>
              </Stack>
              <Anchor component="button" type="button" fz="sm" onClick={() => setShown(s.id)}>
                {t("ai.show")}
              </Anchor>
            </Group>
          ))}
        </Stack>
      </Card>
    </Stack>
  );

  return (
    <>
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: wide ? "minmax(0, 1fr) 340px" : "minmax(0, 1fr)",
          gap: 32,
          alignItems: "start",
        }}
      >
        {settings}
        {month}
      </Box>
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
