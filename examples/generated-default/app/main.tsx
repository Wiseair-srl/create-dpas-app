import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { AppProviders, AppRoutes, createAppQueryClient } from "./AppRoot";
import "./global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders client={createAppQueryClient()}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
