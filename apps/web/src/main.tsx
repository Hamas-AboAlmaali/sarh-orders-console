import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { endSession } from "./features/auth/session";
import { createQueryClient } from "./lib/query-client";
import "./styles.css";

const queryClient = createQueryClient({ onUnauthorized: () => endSession(queryClient) });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
