"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icon";

/* ---------- toasts ---------- */

interface ToastItem { id: number; message: string; kind: "ok" | "err"; on: boolean }
interface ToastApi { show: (message: string, kind?: "ok" | "err") => void }

const ToastCtx = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const show = useCallback((message: string, kind: "ok" | "err" = "ok") => {
    const id = next.current++;
    setItems((cur) => [...cur.slice(-3), { id, message, kind, on: false }]);
    requestAnimationFrame(() => requestAnimationFrame(() => setItems((cur) => cur.map((t) => (t.id === id ? { ...t, on: true } : t)))));
    window.setTimeout(() => setItems((cur) => cur.map((t) => (t.id === id ? { ...t, on: false } : t))), kind === "err" ? 5200 : 3400);
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), kind === "err" ? 5700 : 3900);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""} ${t.on ? "on" : ""}`} role={t.kind === "err" ? "alert" : "status"}>
            <span className="ti"><Icon name={t.kind === "err" ? "alert" : "check"} strokeWidth={t.kind === "err" ? 2.2 : 3} /></span>{t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- modal ---------- */

export function Modal({ open, onClose, label, children, wide }: { open: boolean; onClose: () => void; label: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus(), 60);
    return () => { document.removeEventListener("keydown", onKey); window.clearTimeout(t); prev?.focus?.(); };
  }, [open, onClose]);

  return (
    <div className={`overlay ${open ? "on" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-hidden={!open}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={label} style={wide ? { maxWidth: 520 } : undefined}>
        {open ? children : null}
      </div>
    </div>
  );
}

/* ---------- drawer ---------- */

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <>
      <div className={`drawer-ov ${open ? "on" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "on" : ""}`} aria-hidden={!open} aria-label="Details">{open ? children : null}</aside>
    </>
  );
}
