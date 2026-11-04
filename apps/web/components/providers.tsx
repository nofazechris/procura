"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiClientError } from "@/lib/api-client";
import { AppProvider, type AppContextValue } from "@/lib/app-context";
import { ToastProvider } from "./overlays";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx is an answer, not an outage: retrying it only delays the message.
        retry: (count, err) => count < 1 && !(err instanceof ApiClientError && err.status > 0 && err.status < 500),
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppProviders({ value, children }: { value: AppContextValue; children: ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AppProvider value={value}>
          {children}
        </AppProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
