import { Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { type Account, listCurrencies, listGoals } from "../../api/client";
import { baseFmt } from "../../components/reports/reportUtils";
import { formatMinor } from "../../money";
import { asideByAccount } from "./goalList";

/**
 * Beside the register's balances (#572): what the goals kept in this account
 * set aside, and what is left free, or by how much the account falls short,
 * in amber. Goals are in the base currency, so the comparison is only made
 * for an account in it. Nothing renders when no open goal is kept here.
 */
export function RegisterGoalsFigure({ walletId, account }: { walletId: number; account: Account }) {
  const { t } = useTranslation();
  const goals = useQuery({
    queryKey: ["goals", walletId],
    queryFn: () => listGoals(walletId),
    enabled: walletId > 0,
  });
  const currencies = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const here = asideByAccount(goals.data ?? []).get(account.id);
  if (!here || here.amount <= 0) return null;
  const base = currencies.data?.find((c) => c.isBase);
  const fmt = baseFmt(base);
  const comparable = base != null && base.id === account.currencyId;
  const free = account.balance - here.amount;
  const names = here.goals.map((g) => g.name).join(", ");
  return (
    <Stack gap={2} data-testid="register-goals">
      <Text size="xs" c="dimmed">
        {t("register.setAside")}
      </Text>
      <Text
        ff="monospace"
        fw={500}
        fz={17}
        c={comparable && free < 0 ? "var(--cb-attention)" : "dimmed"}
      >
        {formatMinor(here.amount, fmt)}
      </Text>
      <Text size="xs" c="dimmed">
        {names}
        {comparable && " · "}
        {comparable &&
          (free < 0 ? (
            <span style={{ color: "var(--cb-attention)" }}>
              {t("register.setAsideShort", { amount: formatMinor(-free, fmt) })}
            </span>
          ) : (
            t("register.setAsideFree", { amount: formatMinor(free, fmt) })
          ))}
      </Text>
    </Stack>
  );
}
