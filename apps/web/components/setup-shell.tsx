"use client";

import { Icon } from "./icon";
import { NAV } from "./nav";
import { SetupWizard } from "./setup-wizard";
import { initials, greeting, firstName } from "@/lib/format";

/**
 * The dashboard frame shown behind the first-run wizard: the real navigation and layout, with
 * placeholder content. It makes no API calls, because there is no business to ask about yet.
 */
export function SetupShell({ userName, userEmail }: { userName: string; userEmail: string }) {
  return (
    <>
      <div className="shell" aria-hidden="true">
        <aside className="side">
          <div className="side-top"><div className="wordmark"><span className="mark"><Icon name="leaf" /></span>Procura</div></div>
          <div className="side-biz"><div className="av">?</div><div style={{ flex: 1 }}><div className="nm">Your business</div><div className="sb">Setting up</div></div></div>
          <nav className="side-nav">
            {NAV.map((g) => (
              <div className="nav-group" key={g.group}>
                <div className="lbl">{g.group}</div>
                {g.items.map((n) => <div key={n.href} className={`nav-i ${n.href === "/dashboard" ? "on" : ""}`}><Icon name={n.icon} /><span>{n.label}</span></div>)}
              </div>
            ))}
          </nav>
          <div className="side-foot"><div className="side-user"><div className="av">{initials(userName)}</div><div style={{ flex: 1, minWidth: 0 }}><div className="nm">{userName}</div><div className="sb">{userEmail}</div></div></div></div>
        </aside>
        <main className="main">
          <header className="topbar"><div className="crumb">Procura <span>›</span> <b>Overview</b></div></header>
          <div className="view skel-view">
            <div className="phead"><div><h1>{greeting()}, {firstName(userName)}.</h1><p>Your workspace is almost ready.</p></div></div>
            <div className="kpis">
              {["Procurement spend", "Active procurement", "Potential savings", "Pending approvals"].map((l) => (
                <div key={l} className="kpi card"><div className="k-top"><span className="k-lbl">{l}</span></div><div className="skel" style={{ height: 30, width: 90 }} /></div>
              ))}
            </div>
            <div className="card" style={{ padding: 20 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 16, marginBottom: 16 }} />)}</div>
          </div>
        </main>
      </div>
      <SetupWizard userName={userName} />
    </>
  );
}
