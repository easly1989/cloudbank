import { Center, Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { getSetupStatus } from "./api/client";
import { useAuth } from "./auth/AuthProvider";
import { AppLayout } from "./components/AppLayout";
import { AccountsPage } from "./pages/AccountsPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { CreateWalletPage } from "./pages/CreateWalletPage";
import { CurrenciesPage } from "./pages/CurrenciesPage";
import { PayeesPage } from "./pages/PayeesPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { AssignmentsPage } from "./pages/AssignmentsPage";
import { BudgetPage } from "./pages/BudgetPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SetupPage } from "./pages/SetupPage";
import { WalletSettingsPage } from "./pages/WalletSettingsPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { WalletProvider, useWallet } from "./wallet/WalletProvider";

function FullScreenLoader() {
  return (
    <Center mih="100vh">
      <Loader />
    </Center>
  );
}

export function App() {
  const setupStatus = useQuery({
    queryKey: ["setup-status"],
    queryFn: getSetupStatus,
    retry: false,
    staleTime: 30_000,
  });
  const { user, isLoading } = useAuth();

  if (setupStatus.isLoading || isLoading) return <FullScreenLoader />;

  // First run: force the setup wizard.
  if (setupStatus.data?.needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  // Not logged in: only the login page is reachable.
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Authenticated: wallet context decides the rest.
  return (
    <WalletProvider>
      <AuthenticatedApp isAdmin={user.isAdmin} />
    </WalletProvider>
  );
}

function AuthenticatedApp({ isAdmin }: { isAdmin: boolean }) {
  const { wallets, isLoading } = useWallet();

  if (isLoading) return <FullScreenLoader />;

  // No wallets yet: first-wallet wizard.
  if (wallets.length === 0) return <CreateWalletPage firstRun />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="payees" element={<PayeesPage />} />
        <Route path="schedules" element={<SchedulesPage />} />
        <Route path="assignments" element={<AssignmentsPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<PlaceholderPage titleKey="nav.settings" />} />
        <Route path="wallet" element={<WalletSettingsPage />} />
        <Route path="wallet/new" element={<CreateWalletPage />} />
        <Route path="currencies" element={<CurrenciesPage />} />
        {isAdmin && <Route path="admin/users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
