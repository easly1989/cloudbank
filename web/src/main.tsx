import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

// Typefaces are bundled, never fetched: CloudBank is self-hosted and installs as
// an offline PWA, so a webfont CDN would be both a privacy leak and a blank page
// on a plane. Latin subsets only, at the weights the design actually uses.
import "@fontsource/public-sans/latin-400.css";
import "@fontsource/public-sans/latin-500.css";
import "@fontsource/public-sans/latin-600.css";
import "@fontsource/public-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";

import "./app.css";

import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { ThemedMantineProvider } from "./ThemedMantineProvider";
import { AuthProvider } from "./auth/AuthProvider";
import { ConfirmProvider } from "./components/confirm";
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
          <ConfirmProvider>
            <Notifications />
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ConfirmProvider>
        </ThemedMantineProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
