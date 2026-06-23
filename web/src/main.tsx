import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { ThemedMantineProvider } from "./ThemedMantineProvider";
import { AuthProvider } from "./auth/AuthProvider";
import "./i18n";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemedMantineProvider>
          <Notifications />
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemedMantineProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
