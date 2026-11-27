import { Button, Group, SimpleGrid, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getAccessCodes, newAccessCodes } from "../api/client";
import { useAuth, useAuthConfig } from "../auth/AuthProvider";
import { notifyError } from "../notifyError";
import { SettingRow, SettingState } from "../pages/settings/SettingRow";

/** How many codes a set holds; the server makes ten. */
const TOTAL = 10;

// AccessCodesCard keeps the user's access recovery codes (#620): on a server
// that signs in through SSO only, they are the way in while the provider is
// down. New codes are shown once, with a file to keep them in; making new
// ones voids the old.
export function AccessCodesCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const provider = useAuthConfig().data?.oidc.name ?? "SSO";
  const status = useQuery({ queryKey: ["accessCodes"], queryFn: getAccessCodes });
  const [codes, setCodes] = useState<string[] | null>(null);

  const make = useMutation({
    mutationFn: newAccessCodes,
    onSuccess: (res) => {
      setCodes(res.codes);
      qc.setQueryData(["accessCodes"], { remaining: res.codes.length });
    },
    onError: (err: unknown) => notifyError(err),
  });

  const download = () => {
    if (!codes) return;
    const text = [
      t("accessCodes.fileTitle", { user: user?.username ?? "" }),
      t("accessCodes.fileHint"),
      "",
      ...codes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "cloudbank-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const remaining = status.data?.remaining ?? 0;
  const none = status.isSuccess && remaining === 0 && !codes;

  return (
    <SettingRow
      id="recovery-codes"
      testId="access-codes"
      description={`${t("accessCodes.hint", { provider })}${codes ? ` ${t("accessCodes.shownOnce")}` : ""}`}
      defaultOpen
      control={
        status.isSuccess && (
          <SettingState tone={none ? "warn" : "ok"}>
            {none
              ? t("accessCodes.none")
              : t("accessCodes.remaining", { count: remaining, total: TOTAL })}
          </SettingState>
        )
      }
    >
      {codes && (
        <SimpleGrid
          cols={{ base: 1, xs: 2 }}
          spacing="md"
          verticalSpacing={6}
          p="sm"
          maw={560}
          style={{
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: "var(--mantine-radius-md)",
          }}
        >
          {codes.map((c) => (
            <Text key={c} ff="monospace" size="sm">
              {c}
            </Text>
          ))}
        </SimpleGrid>
      )}
      <Group gap="xs">
        {codes && <Button onClick={download}>{t("accessCodes.download")}</Button>}
        <Button
          variant={none ? "filled" : "default"}
          loading={make.isPending}
          onClick={() => make.mutate()}
        >
          {none ? t("accessCodes.generate") : t("accessCodes.regenerate")}
        </Button>
      </Group>
    </SettingRow>
  );
}
