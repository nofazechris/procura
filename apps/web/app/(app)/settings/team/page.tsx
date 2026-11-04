"use client";

import { Icon } from "@/components/icon";
import { SettingsTabs } from "@/components/settings-tabs";
import { Async, Pill, PageHead } from "@/components/ui";
import { initials } from "@/lib/format";
import { useMembers } from "@/lib/queries";

const ROLE: Record<string, string> = {
  owner: "Owner", admin: "Admin", procurement_manager: "Procurement manager", finance_manager: "Finance manager", viewer: "Viewer",
};
const CAN: Record<string, string> = {
  owner: "Everything, including spending authority",
  admin: "Everything except the Passport connection",
  procurement_manager: "Create and run procurement. Cannot approve or pay",
  finance_manager: "Approve spending, set limits, manage Passport",
  viewer: "Read only",
};

export default function TeamPage() {
  const members = useMembers();
  return (
    <>
      <PageHead title="Team and access" sub="Who can do what. Roles are enforced on the server, not just hidden in the interface." />
      <SettingsTabs />
      <Async query={members}>
        {(rows) => (
          <>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Member</th><th>Role</th><th>Can</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} style={{ cursor: "default" }}>
                      <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="av" style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--forest-2)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12 }}>{initials(m.name)}</div>
                        <div><b>{m.name}</b><div className="mut3" style={{ fontSize: 11.5 }}>{m.email}</div></div></div></td>
                      <td>{ROLE[m.role] ?? m.role}</td>
                      <td className="mut" style={{ whiteSpace: "normal", maxWidth: 320 }}>{CAN[m.role]}</td>
                      <td><Pill tone={m.status === "active" ? "ok" : "mute"}>{m.status[0]!.toUpperCase() + m.status.slice(1)}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="callout info" style={{ marginTop: 16 }}>
              <Icon name="mail" />
              <div>Inviting teammates needs an email provider, which is not configured yet. Until then the business owner is the only member that can be added through sign-up.</div>
            </div>
          </>
        )}
      </Async>
    </>
  );
}
