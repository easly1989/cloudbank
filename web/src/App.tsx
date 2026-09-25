import { Center, Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { getSetupStatus } from "./api/client";
import { useAuth } from "./auth/AuthProvider";
import { AppLayout } from "./components/AppLayout";
import { DemoLoginPage } from "./demo/DemoLoginPage";
import { OnboardingTourProvider } from "./onboarding/TourProvider";
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
const GoalsPage = lazy(() => import("./pages/GoalsPage").then((m) => ({ default: m.GoalsPage })));
const BillsPage = lazy(() => import("./pages/BillsPage").then((m) => ({ default: m.BillsPage })));
const ReviewPage = lazy(() =>
  import("./pages/ReviewPage").then((m) => ({ default: m.ReviewPage })),
);
const BankSyncPage = lazy(() =>
  import("./pages/BankSyncPage").then((m) => ({ default: m.BankSyncPage })),
);
const BankSyncCallback = lazy(() =>
  import("./pages/BankSyncCallback").then((m) => ({ default: m.BankSyncCallback })),
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
// Settings is its own screen with its own shell, so it sits outside AppLayout
// and loads as one chunk: its sections are small and always visited together.
const SettingsLayout = lazy(() =>
  import("./pages/settings/SettingsLayout").then((m) => ({ default: m.SettingsLayout })),
);
const settingsSection = (name: keyof typeof import("./pages/settings/SettingsSections")) =>
  lazy(() => import("./pages/settings/SettingsSections").then((m) => ({ default: m[name] })));
const LegacySettingsRedirect = lazy(() =>
  import("./pages/settings/LegacySettingsRedirect").then((m) => ({
    default: m.LegacySettingsRedirect,
  })),
);
const GeneralSection = settingsSection("GeneralSection");
const AppearanceSection = settingsSection("AppearanceSection");
const WalletSection = settingsSection("WalletSection");
const SecuritySection = settingsSection("SecuritySection");
const IntegrationsSection = settingsSection("IntegrationsSection");
const DataSection = settingsSection("DataSection");
const PeopleSection = settingsSection("PeopleSection");
const CurrenciesPage = lazy(() =>
  import("./pages/CurrenciesPage").then((m) => ({ default: m.CurrenciesPage })),
);
const CreateWalletPage = lazy(() =>
  import("./pages/CreateWalletPage").then((m) => ({ default: m.CreateWalletPage })),
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

  // Not logged in: only the login page is reachable. The demo build's login
  // page is one button that makes an account.
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={__DEMO__ ? <DemoLoginPage /> : <LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Authenticated: wallet context decides the rest.
  return (
    <WalletProvider>
      <AuthenticatedApp />
    </WalletProvider>
  );
}

function AuthenticatedApp() {
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
  // shell (header/nav/footer) stays put while a lazy page chunk loads. The tours
  // sit above both screens: settings has tours of its own (#421).
  return (
    <OnboardingTourProvider>
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
          <Route path="goals" element={<GoalsPage />} />
          <Route path="bills" element={<BillsPage />} />
          <Route path="bank-sync" element={<BankSyncPage />} />
          <Route path="bank-sync/callback" element={<BankSyncCallback />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="wallet" element={<Navigate to="/settings/wallet" replace />} />
          <Route path="admin/users" element={<Navigate to="/settings/people" replace />} />
          <Route path="wallet/new" element={<CreateWalletPage />} />
          <Route path="import" element={<Navigate to="/settings/data" replace />} />
          <Route path="currencies" element={<CurrenciesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        {/* Outside AppLayout, so it needs its own Suspense: the layout chunk and
          each section chunk both load behind this one boundary. */}
        <Route
          path="/settings"
          element={
            <Suspense fallback={<FullScreenLoader />}>
              <SettingsLayout />
            </Suspense>
          }
        >
          <Route index element={<LegacySettingsRedirect />} />
          <Route path="general" element={<GeneralSection />} />
          <Route path="appearance" element={<AppearanceSection />} />
          <Route path="wallet" element={<WalletSection />} />
          <Route path="security" element={<SecuritySection />} />
          <Route path="integrations" element={<IntegrationsSection />} />
          <Route path="data" element={<DataSection />} />
          <Route path="people" element={<PeopleSection />} />
          <Route path="*" element={<Navigate to="/settings/general" replace />} />
        </Route>
      </Routes>
    </OnboardingTourProvider>
  );
}
