import { Center, Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { takeAfterLogin } from "./afterLogin";
import { getSetupStatus } from "./api/client";
import { useAuth } from "./auth/AuthProvider";
import { AppLayout } from "./components/AppLayout";
import { DemoLoginPage } from "./demo/DemoLoginPage";
import { OnboardingTourProvider } from "./onboarding/TourProvider";
// Setup and login are the entry screens (critical first paint), so they stay
// eager; every other page is code-split into its own chunk (loaded on demand)
// to keep the initial bundle small.
import { LoginPage } from "./pages/LoginPage";
import { MOVED_SECTIONS } from "./pages/settings/legacy";
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
const ReviewPage = lazy(() =>
  import("./pages/ReviewPage").then((m) => ({ default: m.ReviewPage })),
);
const BankSyncCallback = lazy(() =>
  import("./pages/BankSyncCallback").then((m) => ({ default: m.BankSyncCallback })),
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const InsightsPage = lazy(() =>
  import("./pages/InsightsPage").then((m) => ({ default: m.InsightsPage })),
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
const HomeSection = settingsSection("HomeSection");
const AccountSection = settingsSection("AccountSection");
const ApiTokensSection = settingsSection("ApiTokensSection");
const PersonalizationSection = settingsSection("PersonalizationSection");
const WalletSection = settingsSection("WalletSection");
const WalletImportSection = settingsSection("WalletImportSection");
const WalletExportSection = settingsSection("WalletExportSection");
const WalletBackupSection = settingsSection("WalletBackupSection");
const ConnectionsSection = settingsSection("ConnectionsSection");
const BankSyncSection = settingsSection("BankSyncSection");
const MailSection = settingsSection("MailSection");
const NotificationsSection = settingsSection("NotificationsSection");
const NotificationChannelSection = settingsSection("NotificationChannelSection");
const NotificationMoneySection = settingsSection("NotificationMoneySection");
const NotificationTimingSection = settingsSection("NotificationTimingSection");
const AiSection = settingsSection("AiSection");
const AdminSection = settingsSection("AdminSection");
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

// ToSetup sends every path to the setup page, keeping the query: a refused
// first SSO sign-in comes back as /login?sso_error=… and the setup page says why.
function ToSetup() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/setup", search }} replace />;
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
        <Route path="*" element={<ToSetup />} />
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
  const navigate = useNavigate();
  // Signed in again on a card's request (#798): back to that card.
  useEffect(() => {
    const next = takeAfterLogin();
    if (next) navigate(next, { replace: true });
  }, [navigate]);

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
          {/* Bills became the Schedules page's calendar (#546); saved links still land. */}
          <Route path="bills" element={<Navigate to="/schedules" replace />} />
          {/* The bank connections live in Settings now (#504); the old address
              still leads there. The callback keeps its path: it is the
              redirect URL people registered with Enable Banking. */}
          <Route
            path="bank-sync"
            element={<Navigate to="/settings/connections/bank-sync" replace />}
          />
          <Route path="bank-sync/callback" element={<BankSyncCallback />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="wallet" element={<Navigate to="/settings/wallet" replace />} />
          <Route path="admin/users" element={<Navigate to="/settings/admin/people" replace />} />
          <Route path="wallet/new" element={<CreateWalletPage />} />
          <Route path="import" element={<Navigate to="/settings/wallet/import" replace />} />
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
          {/* /settings itself, and the oldest bookmarks' ?tab=. */}
          <Route index element={<LegacySettingsRedirect />} />
          <Route path="home" element={<HomeSection />} />
          <Route path="account" element={<AccountSection />} />
          {!__DEMO__ && <Route path="account/tokens" element={<ApiTokensSection />} />}
          <Route path="personalization" element={<PersonalizationSection />} />
          <Route path="wallet" element={<WalletSection />} />
          <Route path="wallet/import" element={<WalletImportSection />} />
          <Route path="wallet/export" element={<WalletExportSection />} />
          <Route path="wallet/backup" element={<WalletBackupSection />} />
          <Route path="connections" element={<ConnectionsSection />} />
          <Route path="connections/bank-sync" element={<BankSyncSection />} />
          {!__DEMO__ && <Route path="connections/mail" element={<MailSection />} />}
          <Route path="notifications" element={<NotificationsSection />} />
          <Route path="notifications/money" element={<NotificationMoneySection />} />
          {/* The demo has only the bell: no timing, no other channel. */}
          {!__DEMO__ && (
            <Route path="notifications/timing" element={<NotificationTimingSection />} />
          )}
          <Route
            path={__DEMO__ ? "notifications/inapp" : "notifications/:channel"}
            element={<NotificationChannelSection />}
          />
          {!__DEMO__ && <Route path="ai" element={<AiSection />} />}
          <Route path="admin" element={<AdminSection />} />
          <Route path="admin/people" element={<PeopleSection />} />
          {/* The eleven sections before #800: each lands where its content went. */}
          {Object.keys(MOVED_SECTIONS).map((from) => (
            <Route key={from} path={from} element={<LegacySettingsRedirect from={from} />} />
          ))}
          <Route path="*" element={<Navigate to="/settings/home" replace />} />
        </Route>
      </Routes>
    </OnboardingTourProvider>
  );
}
