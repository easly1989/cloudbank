import { Center, Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { getSetupStatus } from "./api/client";
import { useAuth } from "./auth/AuthProvider";
import { AppLayout } from "./components/AppLayout";
// Setup and login are the entry screens (critical first paint), so they stay
// eager; every other page is code-split into its own chunk (loaded on demand)
// to keep the initial bundle small.
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { WalletProvider, useWallet } from "./wallet/WalletProvider";

// Each page is a named export, so map it to the default shape React.lazy wants.
// Inlining (rather than a generic helper) keeps each component's prop types.
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const AccountsPage = lazy(() =>
  import("./pages/AccountsPage").then((m) => ({ default: m.AccountsPage })),
);
const TransactionsPage = lazy(() =>
  import("./pages/TransactionsPage").then((m) => ({ default: m.TransactionsPage })),
);
const CategoriesPage = lazy(() =>
  import("./pages/CategoriesPage").then((m) => ({ default: m.CategoriesPage })),
);
const PayeesPage = lazy(() =>
  import("./pages/PayeesPage").then((m) => ({ default: m.PayeesPage })),
);
const SchedulesPage = lazy(() =>
  import("./pages/SchedulesPage").then((m) => ({ default: m.SchedulesPage })),
);
const TemplatesPage = lazy(() =>
  import("./pages/TemplatesPage").then((m) => ({ default: m.TemplatesPage })),
);
const TagsPage = lazy(() => import("./pages/TagsPage").then((m) => ({ default: m.TagsPage })));
const VehiclesPage = lazy(() =>
  import("./pages/VehiclesPage").then((m) => ({ default: m.VehiclesPage })),
);
const AssignmentsPage = lazy(() =>
  import("./pages/AssignmentsPage").then((m) => ({ default: m.AssignmentsPage })),
);
const BudgetPage = lazy(() =>
  import("./pages/BudgetPage").then((m) => ({ default: m.BudgetPage })),
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const CurrenciesPage = lazy(() =>
  import("./pages/CurrenciesPage").then((m) => ({ default: m.CurrenciesPage })),
);
const CreateWalletPage = lazy(() =>
  import("./pages/CreateWalletPage").then((m) => ({ default: m.CreateWalletPage })),
);
const UsersPage = lazy(() =>
  import("./pages/admin/UsersPage").then((m) => ({ default: m.UsersPage })),
);

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

  // No wallets yet: first-wallet wizard (lazy → needs its own Suspense).
  if (wallets.length === 0) {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <CreateWalletPage firstRun />
      </Suspense>
    );
  }

  // AppLayout wraps the routed pages in a <Suspense> around its <Outlet>, so the
  // shell (header/nav/footer) stays put while a lazy page chunk loads.
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="payees" element={<PayeesPage />} />
        <Route path="schedules" element={<SchedulesPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="tags" element={<TagsPage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="assignments" element={<AssignmentsPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="wallet" element={<Navigate to="/settings?tab=wallet" replace />} />
        <Route path="wallet/new" element={<CreateWalletPage />} />
        <Route
          path="import"
          element={<Navigate to="/settings?tab=wallet&section=import" replace />}
        />
        <Route path="currencies" element={<CurrenciesPage />} />
        {isAdmin && <Route path="admin/users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
