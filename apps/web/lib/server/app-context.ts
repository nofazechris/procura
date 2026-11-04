import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { businessMembers, businesses, withTenant } from "@procura/database";
import type { AppContextValue } from "../app-context";
import { getAuth } from "../auth";
import { DEMO_BUSINESS, DEMO_USER } from "../demo/store";
import { MODE_COOKIE } from "../mode";

export type AppContextResult =
  | { kind: "ok"; value: AppContextValue }
  /** Signed in but no business yet: the dashboard opens with the setup wizard. */
  | { kind: "setup"; user: { name: string; email: string } }
  | { kind: "redirect"; to: string };

export const BUSINESS_COOKIE = "procura_business";

/**
 * Who is using the app, resolved on the server for every protected page.
 * Demo mode (a cookie) shows only fictional sample data and needs no account.
 * Otherwise a valid session and at least one business are required.
 */
export async function loadAppContext(): Promise<AppContextResult> {
  const jar = await cookies();

  if (jar.get(MODE_COOKIE)?.value === "demo") {
    return {
      kind: "ok",
      value: {
        mode: "demo",
        user: { id: DEMO_USER.userId, name: DEMO_USER.name, email: DEMO_USER.email },
        business: DEMO_BUSINESS,
        businesses: [DEMO_BUSINESS],
      },
    };
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return { kind: "redirect", to: "/login" };

  const memberships = await withTenant({ userId: session.user.id }, (tx) =>
    tx
      .select({
        id: businesses.id, name: businesses.name, slug: businesses.slug,
        defaultCurrency: businesses.defaultCurrency, role: businessMembers.role,
      })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(and(eq(businessMembers.userId, session.user.id), eq(businessMembers.status, "active"))),
  );
  if (memberships.length === 0) return { kind: "setup", user: { name: session.user.name, email: session.user.email } };

  const preferred = jar.get(BUSINESS_COOKIE)?.value;
  const business = memberships.find((m) => m.id === preferred) ?? memberships[0]!;
  return {
    kind: "ok",
    value: {
      mode: "live",
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
      business,
      businesses: memberships,
    },
  };
}
