import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import { Shell } from "./Shell";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { SessionProvider } from "./lib/session";
import Architecture from "./routes/architecture";
import ReceivablesAll from "./routes/receivables.all";
import ReceivablesClients from "./routes/receivables.clients";
import ReceivablesPending from "./routes/receivables.pending";

/**
 * The composition root, minus the router and the DOM.
 *
 * `main.tsx` is a side-effecting entry — it picks a mount node and renders.
 * Anything that wants the same app without a browser (the agent-surface CLI in
 * jsdom, a test that mounts a whole screen) needs the tree without that
 * commitment, and must get it from HERE rather than restating the provider
 * stack. A surface snapshot is only worth committing if the app it describes is
 * the app that ships.
 */

export function createAppQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });
}

/** Everything above the router: theme, data layer, session, dialogs, toasts. */
export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      // No system default, and the storage key matches the inline script in
      // index.html — that script is what paints the first frame in the right
      // colour, and it can only do that if it reads the same key this writes.
      enableSystem={false}
      storageKey="dpas-theme"
      disableTransitionOnChange
    >
      <QueryClientProvider client={client}>
        <SessionProvider>
          <ConfirmProvider>
            <Toaster richColors position="bottom-right" />
            {children}
          </ConfirmProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/**
 * The route table. Router-agnostic on purpose — the browser entry wraps it in
 * `BrowserRouter`, a harness in `MemoryRouter` at a chosen path, and neither
 * one gets its own copy of the routes.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/receivables/pending" replace />} />
        <Route path="/receivables/pending" element={<ReceivablesPending />} />
        <Route path="/receivables/all" element={<ReceivablesAll />} />
        <Route path="/receivables/clients" element={<ReceivablesClients />} />
        <Route path="/architecture" element={<Architecture />} />
        <Route path="*" element={<Navigate to="/receivables/pending" replace />} />
      </Route>
    </Routes>
  );
}
