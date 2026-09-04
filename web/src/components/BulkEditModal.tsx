import { Button, Group, Modal, SegmentedControl, Select, Stack, TagsInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BulkField, Category, Payee } from "../api/client";
import { PAYMENT_MODES, STATUSES } from "../transactionEnums";

// EditField adds tags (list-valued, add/replace) to the single-value bulk fields.
type EditField = BulkField | "tags";

// BulkEditModal sets one field across every selected transaction. It is opened
// from both the multi-selection bar and the register's right-click menu, so the
// same editor serves both surfaces.
export function BulkEditModal({
  opened,
  onClose,
  count,
  payees,
  categories,
  tags,
  loading,
  onApply,
  onApplyTags,
}: {
  opened: boolean;
  onClose: () => void;
  count: number;
  payees: Payee[];
  categories: Category[];
  tags: string[];
  loading: boolean;
  onApply: (field: BulkField, value: number | null) => void;
  onApplyTags: (tags: string[], replace: boolean) => void;
}) {
  const { t } = useTranslation();
  const [field, setField] = useState<EditField>("category");
  const [value, setValue] = useState<string | null>(null);
  const [tagValues, setTagValues] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"add" | "replace">("add");
  useEffect(() => setValue(null), [field]);

  const categoryOptions = categories.map((c) => ({
    value: String(c.id),
    label: c.parentId
      ? `   ${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
      : c.name,
  }));
  const valueProps = { value, onChange: setValue, searchable: true } as const;
  let valueControl;
  if (field === "status") {
    valueControl = (
      <Select
        {...valueProps}
        label={t("transactions.status")}
        data={STATUSES.map((s) => ({ value: String(s), label: t(`status.${s}`) }))}
      />
    );
  } else if (field === "paymentMode") {
    valueControl = (
      <Select
        {...valueProps}
        label={t("transactions.paymentMode")}
        data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
      />
    );
  } else if (field === "category") {
    valueControl = (
      <Select {...valueProps} clearable label={t("transactions.category")} data={categoryOptions} />
    );
  } else if (field === "payee") {
    valueControl = (
      <Select
        {...valueProps}
        clearable
        label={t("transactions.payee")}
        data={payees.map((p) => ({ value: String(p.id), label: p.name }))}
      />
    );
  } else {
    valueControl = (
      <Stack gap="xs">
        <SegmentedControl
          value={tagMode}
          onChange={(v) => setTagMode(v as "add" | "replace")}
          data={[
            { value: "add", label: t("bulk.tagsAdd") },
            { value: "replace", label: t("bulk.tagsReplace") },
          ]}
        />
        <TagsInput
          label={t("transactions.tags")}
          placeholder={t("bulk.tagsPlaceholder")}
          data={tags}
          value={tagValues}
          onChange={setTagValues}
          clearable
        />
      </Stack>
    );
  }

  const canApply =
    field === "tags"
      ? tagMode === "replace" || tagValues.length > 0
      : field === "category" || field === "payee" || value !== null;

  const apply = () => {
    if (field === "tags") onApplyTags(tagValues, tagMode === "replace");
    else onApply(field, value === null ? null : Number(value));
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t("bulk.editTitle", { count })} centered>
      <Stack>
        <Select
          label={t("bulk.field")}
          data={(["category", "payee", "paymentMode", "status", "tags"] as EditField[]).map(
            (f) => ({ value: f, label: t(`bulk.fields.${f}`) }),
          )}
          value={field}
          onChange={(v) => setField((v as EditField) ?? "category")}
          allowDeselect={false}
        />
        {valueControl}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("bulk.cancel")}
          </Button>
          <Button onClick={apply} loading={loading} disabled={!canApply}>
            {t("bulk.apply")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
