import {
  Alert,
  Anchor,
  Button,
  Group,
  SegmentedControl,
  Select,
  Stack,
  TagsInput,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  type Account,
  type Mailbox,
  type MailboxAI,
  type MailPattern,
  updateMailboxAI,
} from "../../api/client";
import { notifyError } from "../../notifyError";

const MODES: MailboxAI["mode"][] = ["patterns", "patterns_ai", "ai_patterns", "ai"];

/**
 * How a mailbox's mails are read (#659): with its patterns, with the AI of
 * whoever connected it, or both in the order chosen. A mode with the AI says
 * what leaves the server, and asks where what it reads goes and which senders
 * it may read.
 */
export function MailAI({
  walletId,
  mailbox,
  accounts,
  patterns,
}: {
  walletId: number;
  mailbox: Mailbox;
  accounts: Account[];
  patterns: MailPattern[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saved = mailbox.ai;
  const [draft, setDraft] = useState<MailboxAI>(saved);
  const withAI = draft.mode !== "patterns";
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const chooseMode = (mode: MailboxAI["mode"]) =>
    setDraft((d) => ({
      ...d,
      mode,
      // The first time the AI is chosen, the patterns' senders are a start.
      senders:
        d.senders.length > 0 || mode === "patterns"
          ? d.senders
          : Array.from(new Set(patterns.map((p) => p.sender).filter(Boolean))),
    }));

  const save = useMutation({
    mutationFn: () => updateMailboxAI(walletId, mailbox.id, draft),
    onSuccess: (mb) => {
      setDraft(mb.ai);
      notifications.show({ color: "teal", message: t("mail.ai.saved") });
      void qc.invalidateQueries({ queryKey: ["mail", walletId] });
    },
    onError: notifyError,
  });

  const problems = withAI
    ? {
        account: draft.accountId == null ? t("mail.ai.errAccount") : null,
        senders: draft.senders.length === 0 ? t("mail.ai.errSenders") : null,
      }
    : { account: null, senders: null };
  const ready = !problems.account && !problems.senders;

  return (
    <Stack gap="sm" data-testid="mail-ai">
      <Select
        label={t("mail.ai.mode")}
        description={t("mail.ai.modeHint")}
        data={MODES.map((m) => ({
          value: m,
          label: t(`mail.ai.modes.${m}`),
          disabled: m !== "patterns" && !mailbox.aiReady,
        }))}
        value={draft.mode}
        allowDeselect={false}
        maw={360}
        onChange={(v) => v && chooseMode(v as MailboxAI["mode"])}
      />
      {!mailbox.aiReady && (
        <Text size="xs" c="dimmed">
          <Trans
            i18nKey="mail.ai.needAI"
            components={{ a: <Anchor component={Link} to="/settings/ai" size="xs" /> }}
          />
        </Text>
      )}

      {withAI && (
        <Stack gap="sm">
          <Alert color="yellow" variant="light" p="sm" icon={<IconAlertTriangle size={18} />}>
            <Text size="sm">
              <Trans i18nKey="mail.ai.warning" components={{ b: <b /> }} />
            </Text>
          </Alert>
          <Group gap="md" align="flex-start" wrap="wrap">
            <Select
              label={t("mail.ai.account")}
              description={t("mail.ai.accountHint")}
              data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
              value={draft.accountId == null ? null : String(draft.accountId)}
              onChange={(v) => setDraft((d) => ({ ...d, accountId: v ? Number(v) : null }))}
              error={problems.account}
              searchable
              w={{ base: "100%", sm: 280 }}
            />
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {t("mail.ai.field")}
              </Text>
              <SegmentedControl
                value={draft.field}
                onChange={(v) => setDraft((d) => ({ ...d, field: v as MailboxAI["field"] }))}
                data={[
                  { value: "memo", label: t("mail.field.memo") },
                  { value: "payee", label: t("mail.field.payee") },
                ]}
              />
            </Stack>
          </Group>
          <TagsInput
            label={t("mail.ai.senders")}
            description={t("mail.ai.sendersHint")}
            placeholder={draft.senders.length === 0 ? "banca.example" : undefined}
            value={draft.senders}
            onChange={(senders) =>
              setDraft((d) => ({ ...d, senders: senders.map((s) => s.trim().toLowerCase()) }))
            }
            splitChars={[",", " "]}
            error={problems.senders}
            maw={560}
            data-cb-sensitive
          />
        </Stack>
      )}

      {dirty && (
        <Group gap="sm">
          <Button
            size="xs"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!ready}
          >
            {t("mail.ai.save")}
          </Button>
          <Button size="xs" variant="default" onClick={() => setDraft(saved)}>
            {t("common.cancel")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
