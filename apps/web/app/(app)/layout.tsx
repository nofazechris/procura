import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers";
import { SetupShell } from "@/components/setup-shell";
import { Shell } from "@/components/shell";
import { loadAppContext } from "@/lib/server/app-context";

export const dynamic = "force-dynamic";

/** Every screen inside the product. Requires a session (or demo mode) and a business. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await loadAppContext();
  if (ctx.kind === "redirect") redirect(ctx.to);
  if (ctx.kind === "setup") return <SetupShell userName={ctx.user.name} userEmail={ctx.user.email} />;
  return (
    <AppProviders value={ctx.value}>
      <Shell>{children}</Shell>
    </AppProviders>
  );
}
