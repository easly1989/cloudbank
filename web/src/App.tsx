import { Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="accounts" element={<PlaceholderPage titleKey="nav.accounts" />} />
        <Route path="reports" element={<PlaceholderPage titleKey="nav.reports" />} />
        <Route path="settings" element={<PlaceholderPage titleKey="nav.settings" />} />
      </Route>
    </Routes>
  );
}
