import { Button, Card, Center, Loader, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorColor } from "../amountTone";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError, completeEnableBankingAuth } from "../api/client";
import { useWallet } from "../wallet/WalletProvider";

// One in-flight completion per state, at module scope, so React StrictMode's
// double-mount (and any remount) reuses the single POST rather than firing a
// second one against an already-consumed state.
const inflight = new Map<string, ReturnType<typeof completeEnableBankingAuth>>();

// BankSyncCallback receives the Enable Banking redirect (?code&state), exchanges
// the code for a session (creating the connection), then returns to Bank sync.
export function BankSyncCallback() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { currentWallet } = useWallet();
  // A redirect that arrives without its code is broken before anything is
  // attempted, so that is the state this page opens in rather than a state an
  // effect puts it into after showing "working" for a frame.
  const code = params.get("code");
  const state = params.get("state");
  const malformed = !code || !state;
  const [status, setStatus] = useState<"working" | "done" | "error">(
    malformed ? "error" : "working",
  );
  const [message, setMessage] = useState(malformed ? t("banksync.eb.callback.error") : "");

  useEffect(() => {
    if (malformed) return;
    const walletId = currentWallet?.id ?? 0;
    if (walletId <= 0) return; // wait until the wallet is loaded
    let alive = true;
    let promise = inflight.get(state);
    if (!promise) {
      promise = completeEnableBankingAuth(walletId, { state, code });
      inflight.set(state, promise);
    }
    void promise
      .then(() => {
        if (!alive) return;
        setStatus("done");
        setTimeout(() => nav("/bank-sync"), 1200);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [code, state, malformed, currentWallet, nav, t]);

  return (
    <Center mih={400}>
      <Card withBorder w={440}>
        <Stack align="center" gap="sm">
          {status === "working" && (
            <>
              <Loader />
              <Text>{t("banksync.eb.callback.connecting")}</Text>
            </>
          )}
          {status === "done" && <Text c="teal">{t("banksync.eb.callback.success")}</Text>}
          {status === "error" && (
            <>
              <Text c={errorColor} ta="center">
                {message || t("banksync.eb.callback.error")}
              </Text>
              <Button onClick={() => nav("/bank-sync")}>{t("banksync.eb.callback.back")}</Button>
            </>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
