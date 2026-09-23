import { ActionIcon, Group, Menu, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconLayoutSidebarLeftExpand,
  IconPlus,
  IconSelector,
  IconWallet,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { getDashboard } from "../api/client";
import { formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";
import { GlobalSearch } from "./GlobalSearch";
import { Logo } from "./Logo";
import { BRAND, WALLET_CARD } from "./shellTheme";

// The head of the sidebar: the product, the wallet you are in, and the way to
// find something in it.
//
// These three used to sit in a bar across the top of the window. The style tile
// has no such bar — the sidebar is the whole of the chrome — and the mock makes
// the reason plain: the wallet is not a global control, it is the subject of
// every page listed underneath it, so it belongs at the head of that list
// rather than floating above it.
//
// The card carries the wallet's balance, because "which wallet am I in" and
// "how much is in it" are the same question asked twice.
export function SidebarHead({
  railMode,
  onToggleCollapse,
  onNavigate,
}: {
  railMode: boolean;
  onToggleCollapse: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { wallets, currentWallet, setCurrentWalletId } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  // The same query the overview runs, so on the overview this costs nothing and
  // elsewhere it is one cached request per wallet.
  const summary = useQuery({
    queryKey: ["dashboard", walletId, "0001-01-01", "9999-12-31", "category", 12],
    queryFn: () => getDashboard(walletId, "0001-01-01", "9999-12-31", "category", 12),
    enabled: walletId > 0,
  });
  const base = summary.data?.baseCurrency;
  const balance = summary.data?.totals.today;

  if (railMode) {
    return (
      <Stack gap="xs" align="center" mb="xs">
        <Logo size={26} />
        <Tooltip label={t("nav.toggleSidebar")} position="right" withinPortal>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onToggleCollapse}
            aria-label={t("nav.toggleSidebar")}
          >
            <IconLayoutSidebarLeftExpand size={20} />
          </ActionIcon>
        </Tooltip>
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      {/* Nothing shares this row. The tile gives the product a 22px mark, a
          16px/700 name and nine pixels between them, and it reads as roomy
          precisely because nothing else competes for the width — the collapse
          control lives at the foot of the sidebar with the other chrome. */}
      <Group gap={BRAND.gap} wrap="nowrap" h={BRAND.mark} px={BRAND.inset} style={{ minWidth: 0 }}>
        <Logo size={BRAND.mark} />
        <Text fz={BRAND.fz} fw={BRAND.fw} truncate>
          {t("app.name")}
        </Text>
      </Group>

      {currentWallet && (
        <Menu position="bottom-start" withinPortal width="target">
          <Menu.Target>
            <UnstyledButton
              aria-label={t("wallet.switch")}
              className="cb-wallet-card"
              data-tour="wallet"
              h={WALLET_CARD.height}
            >
              <Stack gap={WALLET_CARD.gap}>
                <Text fz={WALLET_CARD.label.fz} c="dimmed" lh={1.2}>
                  {t("wallet.label")}
                </Text>
                <Group justify="space-between" wrap="nowrap" gap="xs" align="baseline">
                  <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
                    <Text fz={WALLET_CARD.name.fz} fw={WALLET_CARD.name.fw} lh={1.2} truncate>
                      {currentWallet.title}
                    </Text>
                    <IconSelector size={14} opacity={0.6} />
                  </Group>
                  {base && balance != null && (
                    <Text
                      fz={WALLET_CARD.balance.fz}
                      c="dimmed"
                      lh={1.2}
                      ff="monospace"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {formatMinor(balance, base)}
                    </Text>
                  )}
                </Group>
              </Stack>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>{t("wallet.switch")}</Menu.Label>
            {wallets.map((w) => (
              <Menu.Item
                key={w.id}
                onClick={() => {
                  setCurrentWalletId(w.id);
                  onNavigate?.();
                }}
                leftSection={<IconWallet size={16} />}
                fw={w.id === currentWallet.id ? 700 : 400}
              >
                {w.title}
              </Menu.Item>
            ))}
            <Menu.Divider />
            <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => navigate("/wallet/new")}>
              {t("wallet.create")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}

      {currentWallet && <GlobalSearch walletId={currentWallet.id} variant="sidebar" />}
    </Stack>
  );
}
