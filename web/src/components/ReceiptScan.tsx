import {
  Box,
  Button,
  Checkbox,
  CloseButton,
  FileButton,
  Group,
  Image,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconCamera, IconSparkles } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AI_SENDS_KEY, parseReceipt, type ParsedEntry } from "../api/ai";
import { shrinkPhoto } from "../receiptPhoto";
import { useAskPastLimit } from "./aiLimit";

// A receipt read by the AI (#707): the photo, shrunk in the browser, shows in
// the entry sheet with what goes to the model; only "Read with AI" sends it.
// Once read, the fields are filled and the photo can be attached on Save;
// otherwise it is dropped when the sheet closes.
export function ReceiptScan({
  walletId,
  photo,
  onPhoto,
  attach,
  onAttach,
  onRead,
  onError,
}: {
  walletId: number;
  photo: Blob | null;
  onPhoto: (photo: Blob | null) => void;
  attach: boolean;
  onAttach: (attach: boolean) => void;
  onRead: (entry: ParsedEntry | null) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const askPastLimit = useAskPastLimit();
  const qc = useQueryClient();
  // The photo the AI has read: a new one has to be read again.
  const [readFor, setReadFor] = useState<Blob | null>(null);
  const url = useMemo(() => (photo ? URL.createObjectURL(photo) : ""), [photo]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  const read = useMutation({
    mutationFn: (p: Blob) => askPastLimit((confirm) => parseReceipt(walletId, p, confirm)),
    onSuccess: (res, p) => {
      void qc.invalidateQueries({ queryKey: AI_SENDS_KEY });
      if (!res) return; // the user kept to this month's limit
      setReadFor(p);
      onRead(res.entry);
    },
    onError,
  });

  const pick = (file: File | null) => {
    if (!file) return;
    shrinkPhoto(file).then(onPhoto, onError);
  };

  if (!photo) {
    return (
      <FileButton onChange={pick} accept="image/*" capture="environment">
        {(props) => (
          <UnstyledButton
            {...props}
            p={12}
            style={{
              border: "1px dashed var(--mantine-color-default-border)",
              borderRadius: 8,
              textAlign: "center",
            }}
          >
            <Group gap={8} justify="center">
              <IconCamera size={18} aria-hidden />
              <Text fz="sm" fw={500}>
                {t("ai.receipt.scan")}
              </Text>
            </Group>
          </UnstyledButton>
        )}
      </FileButton>
    );
  }

  const done = readFor === photo;
  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <Box pos="relative" bg="var(--mantine-color-default-hover)">
        <Image src={url} h={done ? 120 : 220} fit="contain" alt={t("ai.receipt.photo")} />
        <CloseButton
          pos="absolute"
          top={6}
          right={6}
          size="sm"
          variant="filled"
          aria-label={t("ai.receipt.remove")}
          onClick={() => {
            onPhoto(null);
            onAttach(false);
          }}
        />
      </Box>
      <Stack gap={8} p={10}>
        {done ? (
          <>
            <Text fz="xs" c="dimmed">
              {t("ai.receipt.done")}
            </Text>
            <Checkbox
              size="sm"
              label={t("ai.receipt.attach")}
              checked={attach}
              onChange={(e) => onAttach(e.currentTarget.checked)}
            />
          </>
        ) : (
          <>
            <Text fz="xs" c="dimmed">
              {t("ai.receipt.sends")}
            </Text>
            <Button
              fullWidth
              leftSection={<IconSparkles size={15} />}
              loading={read.isPending}
              onClick={() => read.mutate(photo)}
            >
              {t("ai.receipt.read")}
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
