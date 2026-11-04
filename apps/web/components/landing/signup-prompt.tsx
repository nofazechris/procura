"use client";

import Link from "next/link";
import { useEffect } from "react";

/** "See it run" asks for an account first: a real run needs a real request, so there is no fake dashboard to drop into. */
export function SignupPrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={`lx-modal-ov ${open ? "on" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-hidden={!open}>
      <div className="lx-modal" role="dialog" aria-modal="true" aria-label="Create an account to run Procura">
        <div className="lx-kicker">See it run</div>
        <h2 className="lx-h" style={{ fontSize: "clamp(30px,4vw,44px)" }}>Run it on your own request.</h2>
        <p className="lx-body" style={{ marginTop: 14 }}>
          Create a free account and Procura sources, proves and compares real quotes for a purchase you describe. It takes a couple of minutes to set up.
        </p>
        <div className="lx-cta" style={{ marginTop: 26 }}>
          <Link href="/signup" className="lx-btn pri">Create your account</Link>
          <Link href="/login" className="lx-btn">I already have one</Link>
        </div>
        <button className="lx-modal-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
    </div>
  );
}
