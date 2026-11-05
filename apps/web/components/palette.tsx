"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRequests, useSuppliers } from "@/lib/queries";
import { Icon, type IconName } from "./icon";
import { NAV } from "./nav";

interface Item { group: string; title: string; sub?: string; icon: IconName; run: () => void }

/** Cmd/Ctrl+K: jump to any page, start common actions, or find a seller or request. */
export function CommandPalette({ open, onClose, actions }: {
  open: boolean;
  onClose: () => void;
  actions: { title: string; sub?: string; icon: IconName; run: () => void }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const suppliers = useSuppliers();
  const requests = useRequests();

  useEffect(() => {
    if (open) { setQ(""); setSel(0); window.setTimeout(() => input.current?.focus(), 30); }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...NAV.flatMap((g) => g.items).map((n) => ({ group: "Navigate", title: n.label, icon: n.icon, run: () => router.push(n.href) })),
      ...actions.map((a) => ({ group: "Actions", ...a })),
      ...(requests.data ?? []).slice(0, 30).map((r) => ({
        group: "Requests", title: r.title, sub: r.requestNumber, icon: "pkg" as IconName, run: () => router.push(`/requests/${r.id}`),
      })),
      ...(suppliers.data ?? []).map((s) => ({
        group: "Sellers", title: s.name, sub: [s.city, s.sourceType === "demo" ? "Demo" : ""].filter(Boolean).join(" · "), icon: "users" as IconName,
        run: () => router.push(`/sellers/${s.id}`),
      })),
    ];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((i) => `${i.title} ${i.sub ?? ""} ${i.group}`.toLowerCase().includes(needle)) : all.filter((i) => i.group !== "Requests");
  }, [q, actions, requests.data, suppliers.data, router]);

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, items.length - 1))), [items.length]);

  const run = (i: Item | undefined) => { if (!i) return; onClose(); window.setTimeout(i.run, 120); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(items[sel]); }
    else if (e.key === "Escape") onClose();
  };

  useEffect(() => { document.querySelector(".cmdk-i.sel")?.scrollIntoView({ block: "nearest" }); }, [sel]);

  let lastGroup = "";
  return (
    <div className={`cmdk-ov ${open ? "on" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-hidden={!open}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="cmdk-in">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
            placeholder="Search actions, sellers, pages…" autoComplete="off" aria-label="Search" />
          <span className="kbd">ESC</span>
        </div>
        <div className="cmdk-list" role="listbox">
          {items.length === 0 ? <div className="cmdk-empty">No matches for “{q}”</div> : items.map((it, idx) => {
            const head = it.group !== lastGroup ? <div className="cmdk-grp">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={`${it.group}-${it.title}-${idx}`}>
                {head}
                <div role="option" aria-selected={idx === sel} className={`cmdk-i ${idx === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSel(idx)} onClick={() => run(it)}>
                  <div className="ci"><Icon name={it.icon} /></div>
                  <div><div>{it.title}</div>{it.sub ? <div className="sub">{it.sub}</div> : null}</div>
                  <span className="go-arr"><Icon name="arr" /></span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
          <span><span className="kbd">↵</span> select</span>
          <span><span className="kbd">esc</span> close</span>
        </div>
      </div>
    </div>
  );
}
