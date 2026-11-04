import { describe, expect, it } from "vitest";
import { MEMBER_ROLES, PERMISSIONS, roleHasPermission } from "@procura/shared";

describe("role permissions", () => {
  it("only roles with financial authority can approve spending or execute payments", () => {
    const decide = MEMBER_ROLES.filter((r) => roleHasPermission(r, "approvals:decide"));
    expect(decide.sort()).toEqual(["admin", "finance_manager", "owner"]);
    const pay = MEMBER_ROLES.filter((r) => roleHasPermission(r, "payments:execute"));
    expect(pay.sort()).toEqual(["admin", "finance_manager", "owner"]);
  });

  it("a procurement manager can source and create orders but cannot approve or pay", () => {
    expect(roleHasPermission("procurement_manager", "procurement:create")).toBe(true);
    expect(roleHasPermission("procurement_manager", "orders:create")).toBe(true);
    expect(roleHasPermission("procurement_manager", "approvals:decide")).toBe(false);
    expect(roleHasPermission("procurement_manager", "payments:execute")).toBe(false);
  });

  it("a viewer is read-only", () => {
    for (const p of PERMISSIONS) {
      if (roleHasPermission("viewer", p)) expect(p.endsWith(":read")).toBe(true);
    }
    expect(roleHasPermission("viewer", "procurement:create")).toBe(false);
  });

  it("only the owner and finance manager can manage the Passport connection", () => {
    expect(MEMBER_ROLES.filter((r) => roleHasPermission(r, "passport:manage")).sort()).toEqual(["finance_manager", "owner"]);
  });

  it("only the owner and admin can manage members", () => {
    expect(MEMBER_ROLES.filter((r) => roleHasPermission(r, "members:manage")).sort()).toEqual(["admin", "owner"]);
  });
});
