import { and, eq } from "drizzle-orm";
import { businessMembers, withTenant, type Tx } from "@procura/database";
import type { ServiceContext } from "@procura/procurement";
import { roleHasPermission, type MemberRole, type Permission } from "@procura/shared";
import { badRequest, forbidden, unauthorized } from "./api";
import { getAuth } from "./auth";

export interface AuthedUser {
  userId: string;
  email: string;
  name: string;
}

export interface TenantAccess extends AuthedUser {
  businessId: string;
  role: MemberRole;
}

/** Run work inside the caller's tenant: one transaction with Row Level Security context set. */
export function inTenant<T>(access: TenantAccess, fn: (tx: Tx, ctx: ServiceContext) => Promise<T>): Promise<T> {
  return withTenant({ userId: access.userId, businessId: access.businessId }, (tx) =>
    fn(tx, { businessId: access.businessId, userId: access.userId, now: new Date() }),
  );
}

/** 1. Authentication: a valid Better Auth session. */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) throw unauthorized();
  return { userId: session.user.id, email: session.user.email, name: session.user.name };
}

/**
 * 2 + 3. Business membership and role permission, resolved on the server (Technical PRD s6.2).
 *
 * The business comes from the `x-business-id` header. If it is absent and the user belongs to
 * exactly one business, that one is used. The membership lookup itself runs through RLS, which
 * only reveals the caller's own memberships, so a guessed business id returns nothing.
 */
export async function requireAccess(req: Request, permission: Permission): Promise<TenantAccess> {
  const user = await requireUser(req);
  const requested = req.headers.get("x-business-id");

  const memberships = await withTenant({ userId: user.userId }, (tx) =>
    tx
      .select({ businessId: businessMembers.businessId, role: businessMembers.role })
      .from(businessMembers)
      .where(
        requested
          ? and(eq(businessMembers.userId, user.userId), eq(businessMembers.businessId, requested), eq(businessMembers.status, "active"))
          : and(eq(businessMembers.userId, user.userId), eq(businessMembers.status, "active")),
      ),
  );

  if (memberships.length === 0) throw forbidden("You are not a member of that business.");
  if (memberships.length > 1) {
    throw badRequest("BUSINESS_REQUIRED", "You belong to several businesses. Send an x-business-id header.");
  }
  const [m] = memberships;
  if (!m) throw forbidden();
  if (!roleHasPermission(m.role, permission)) throw forbidden();

  return { ...user, businessId: m.businessId, role: m.role };
}
