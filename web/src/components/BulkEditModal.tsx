import { Button, Group, Modal, Select, Stack } from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BulkField, Category, Payee } from "../api/client";
import { PAYMENT_MODES, STATUSES } from "../transactionEnums";

// BulkEditModal sets one field across every selected transaction. It is opened
// from both the multi-selection bar and the register's right-click menu, so the
// same editor serves both surfaces.
export function BulkEditModal({
  opened,
  onClose,
  count,
  payees,
  categories,
  loading,
  onApply,
}: {
  opened: boolean;
  onClose: () => void;
  count: number;
  payees: Payee[];
  categories: Category[];
  loading: boolean;
  onApply: (field: BulkField, value: number | null) => void;
}) {
  const { t } = useTranslation();
  const [field, setField] = useState<BulkField>("category");
  const [value, setValue] = useState<string | null>(null);
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
  } else {
    valueControl = (
      <Select
        {...valueProps}
        clearable
        label={t("transactions.payee")}
        data={payees.map((p) => ({ value: String(p.id), label: p.name }))}
      />
    );
  }
  // status/paymentMode need a value; category/payee may be cleared (null).
  const canApply = field === "category" || field === "payee" || value !== null;

  return (
    <Modal opened={opened} onClose={onClose} title={t("bulk.editTitle", { count })} centered>
      <Stack>
        <Select
          label={t("bulk.field")}
          data={(["category", "payee", "paymentMode", "status"] as BulkField[]).map((f) => ({
            value: f,
            label: t(`bulk.fields.${f}`),
          }))}
          value={field}
          onChange={(v) => setField((v as BulkField) ?? "category")}
          allowDeselect={false}
        />
        {valueControl}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("bulk.cancel")}
          </Button>
          <Button
            onClick={() => onApply(field, value === null ? null : Number(value))}
            loading={loading}
            disabled={!canApply}
          >
            {t("bulk.apply")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
