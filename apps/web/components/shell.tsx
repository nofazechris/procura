"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { useApp } from "@/lib/app-context";
import { describeActivity } from "@/lib/activity";
import { initials, relativeTime } from "@/lib/format";
import { leaveDemoMode } from "@/lib/mode";
import { useActivity, useApprovals } from "@/lib/queries";
import { toggleTheme } from "@/lib/theme";
import { Icon } from "./icon";
import { WalletChip } from "./wallet-chip";
import { activeHref, NAV, titleFor } from "./nav";
import { CommandPalette } from "./palette";

/** The persistent app frame: sidebar, top bar, command menu, notifications, demo banner. */
export function Shell({ children }: { children: ReactNode }) {
  const { mode, user, business } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [sideOpen, setSideOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [popup, setPopup] = useState<"notif" | "user" | null>(null);

  const approvals = useApprovals();
  const pending = (approvals.data ?? []).filter((a) => a.status === "pending").length;

  useEffect(() => { document.body.classList.toggle("demo", mode === "demo"); return () => document.body.classList.remove("demo"); }, [mode]);
  useEffect(() => { setSideOpen(false); setPopup(null); }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (e.key === "Escape") { setPopup(null); setSideOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!popup) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-popup]") && !t.closest("[data-popup-trigger]")) setPopup(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [popup]);

  const signOut = useCallback(async () => {
    if (mode === "demo") leaveDemoMode(); else await authClient.signOut();
    router.push("/");
    router.refresh();
  }, [mode, router]);

  const exitDemo = useCallback(() => {
    leaveDemoMode();
    router.push(mode === "demo" ? "/" : "/dashboard");
    router.refresh();
  }, [mode, router]);

  const paletteActions = useMemo(() => [
    { title: "New request", icon: "plus" as const, run: () => router.push("/requests/new") },
    { title: "Ask Procura", icon: "agent" as const, run: () => router.push("/assistant") },
    { title: "Toggle light / dark", icon: "moon" as const, run: () => toggleTheme() },
    { title: "Sign out", sub: "Back to the landing page", icon: "logout" as const, run: () => void signOut() },
  ], [router, signOut]);

  const active = activeHref(pathname);

  return (
    <>
      <div className={`scrim ${sideOpen ? "on" : ""}`} onClick={() => setSideOpen(false)} />
      <div className="shell">
        <aside className={`side ${sideOpen ? "open" : ""}`} aria-label="Primary">
          <div className="side-top">
            <Link href="/dashboard" className="wordmark" style={{ textDecoration: "none" }}><span className="mark"><Icon name="leaf" /></span>Procura</Link>
            <button className="icon-btn" aria-label="Toggle light or dark theme" onClick={toggleTheme}
              style={{ width: 28, height: 28, border: "none", background: "transparent", color: "var(--side-muted)" }}><Icon name="moon" /></button>
          </div>
          <div className="side-biz">
            <div className="av"><Icon name="agent" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">Your buyer</div>
              <div className="sb">{mode === "demo" ? "Demo" : `Budgets in ${business.defaultCurrency}`}</div>
            </div>
          </div>
          <nav className="side-nav">
            {NAV.map((g) => (
              <div className="nav-group" key={g.group}>
                <div className="lbl">{g.group}</div>
                {g.items.map((n) => (
                  <Link key={n.href} href={n.href} className={`nav-i ${active === n.href ? "on" : ""}`} aria-current={active === n.href ? "page" : undefined}>
                    <Icon name={n.icon} /><span>{n.label}</span>
                    {n.badge === "approvals" && pending > 0 ? <span className="badge num">{pending}</span> : null}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <div className="side-user" data-popup-trigger role="button" tabIndex={0} aria-label="Account menu"
              onClick={() => setPopup((p) => (p === "user" ? null : "user"))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setPopup((p) => (p === "user" ? null : "user")); }}>
              <div className="av">{initials(user.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div className="nm">{user.name}</div><div className="sb" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div></div>
              <Icon name="dots" />
            </div>
          </div>
        </aside>

        <main className="main">
          {mode === "demo" ? (
            <div className="demo-banner">
              <span className="tag">Demo</span>
              <span>Sample data for a fictional shopper. Nothing here is real, and no money moves.</span>
              <button className="x" style={{ marginLeft: "auto" }} onClick={exitDemo}>Exit demo</button>
            </div>
          ) : null}
          <header className="topbar">
            <button className="icon-btn mobile-side" aria-label="Open navigation" onClick={() => setSideOpen(true)}><Icon name="menu" /></button>
            <div className="crumb">Procura <span>›</span> <b>{titleFor(pathname)}</b></div>
            <div className="search" onClick={() => setPaletteOpen(true)}>
              <div style={{ position: "relative" }}>
                <Icon name="search" />
                <input readOnly placeholder="Search or jump to…" aria-label="Open command menu" style={{ cursor: "pointer" }}
                  onFocus={(e) => { e.currentTarget.blur(); setPaletteOpen(true); }} />
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 9, alignItems: "center" }}>
              <WalletChip />
              <NotificationsButton open={popup === "notif"} onToggle={() => setPopup((p) => (p === "notif" ? null : "notif"))} pendingApprovals={pending} />
              <Link href="/requests/new" className="btn btn-pri btn-sm top-new" aria-label="New request"><Icon name="plus" strokeWidth={2.2} /><span className="lbl">New request</span></Link>
            </div>
          </header>
          <div className="view" id="view">{children}</div>
        </main>
      </div>

      <div className={`menu ${popup === "user" ? "on" : ""}`} data-popup>
        <div className="menu-i" onClick={() => toggleTheme()}><Icon name="moon" /> Toggle light / dark</div>
        <div className="menu-i" onClick={() => { setPopup(null); setPaletteOpen(true); }}><Icon name="search" /> Command menu</div>
        <div className="menu-i" onClick={() => router.push("/settings/account")}><Icon name="cog" /> Account settings</div>
        <div className="menu-i" onClick={() => void signOut()}><Icon name="logout" /> Sign out</div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
    </>
  );
}

/** Notifications derived from real records: pending approvals and recent activity. Read state is per browser. */
function NotificationsButton({ open, onToggle, pendingApprovals }: { open: boolean; onToggle: () => void; pendingApprovals: number }) {
  const { business, mode } = useApp();
  const router = useRouter();
  const activity = useActivity();
  const approvals = useApprovals();
  const storeKey = `procura_notif_seen_${mode}_${business.id}`;
  const [seen, setSeen] = useState<number>(0);

  useEffect(() => {
    try { setSeen(Number(localStorage.getItem(storeKey) ?? 0)); } catch { /* ignore */ }
  }, [storeKey]);

  const items = useMemo(() => {
    const pend = (approvals.data ?? []).filter((a) => a.status === "pending").map((a) => ({
      key: `appr-${a.id}`, icon: "shield" as const, title: "Waiting for your OK", sub: `${a.orderNumber} · ${a.supplierName}`,
      at: a.createdAt, href: "/approvals", ok: false,
    }));
    const act = (activity.data ?? []).slice(0, 6).map((a) => {
      const v = describeActivity(a);
      return { key: `act-${a.id}`, icon: v.icon, title: v.title, sub: v.sub, at: a.createdAt, href: v.href, ok: v.ok };
    });
    return [...pend, ...act].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [approvals.data, activity.data]);

  const unread = items.filter((i) => new Date(i.at).getTime() > seen).length;
  const markAll = () => {
    const now = Date.now();
    setSeen(now);
    try { localStorage.setItem(storeKey, String(now)); } catch { /* ignore */ }
  };

  return (
    <>
      <button className="icon-btn" data-popup-trigger aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} onClick={onToggle}>
        <Icon name="bell" />{unread > 0 || pendingApprovals > 0 ? <span className="ndot" /> : null}
      </button>
      <div className={`notif ${open ? "on" : ""}`} data-popup>
        <div className="notif-h"><h3>Notifications</h3>{unread > 0 ? <a onClick={markAll}>Mark all read</a> : null}</div>
        <div className="notif-list">
          {items.length === 0 ? <div className="cmdk-empty">You are all caught up.</div> : items.map((i) => (
            <div key={i.key} className={`notif-i ${new Date(i.at).getTime() > seen ? "unread" : ""}`} onClick={() => { markAll(); router.push(i.href); }}>
              {new Date(i.at).getTime() > seen ? <span className="nd2" /> : null}
              <div className="feed-dot" style={i.ok ? { background: "var(--ok-bg)", color: "var(--ok)" } : undefined}><Icon name={i.icon} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.sub}</div>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{relativeTime(i.at).replace(" ago", "")}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
