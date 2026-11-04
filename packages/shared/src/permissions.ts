import type { MemberRole } from "./constants";

/**
 * Role permission matrix, enforced server-side (Technical PRD s5.3, s6.2, s18.2).
 * Approving spending is limited to roles with financial authority.
 */
export const PERMISSIONS = [
  "business:read",
  "business:update",
  "members:manage",
  "procurement:read",
  "procurement:create",
  "procurement:control",
  "suppliers:read",
  "suppliers:write",
  "orders:read",
  "orders:create",
  "approvals:read",
  "approvals:decide",
  "payments:read",
  "payments:execute",
  "policy:manage",
  "passport:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = [
  "business:read", "procurement:read", "suppliers:read", "orders:read", "approvals:read", "payments:read",
];

const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== "passport:manage"),
  procurement_manager: [
    ...READ, "procurement:create", "procurement:control", "suppliers:write", "orders:create",
  ],
  finance_manager: [...READ, "approvals:decide", "payments:execute", "policy:manage", "passport:manage"],
  viewer: READ,
};

export function roleHasPermission(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
