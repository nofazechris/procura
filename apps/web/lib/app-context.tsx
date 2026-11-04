"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { roleHasPermission, type Permission } from "@procura/shared";
import { setActiveBusiness } from "./api-client";
import type { BusinessSummaryDTO } from "./dto";

export interface AppContextValue {
  /** "demo" runs on fictional in-browser sample data. "live" talks to the API. */
  mode: "live" | "demo";
  user: { id: string; name: string; email: string };
  business: BusinessSummaryDTO;
  businesses: BusinessSummaryDTO[];
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ value, children }: { value: AppContextValue; children: ReactNode }) {
  useEffect(() => setActiveBusiness(value.business.id), [value.business.id]);
  const memo = useMemo(() => value, [value]);
  return <Ctx.Provider value={memo}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside the app shell");
  return v;
}

/** UI hint only. The server enforces every permission; this just hides controls that would be refused. */
export function useCan(permission: Permission): boolean {
  return roleHasPermission(useApp().business.role, permission);
}
