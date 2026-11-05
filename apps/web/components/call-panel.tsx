"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { useApp } from "@/lib/app-context";
import type { CallScriptDTO } from "@/lib/dto";
import { errorMessage, useCallScript, useRequests } from "@/lib/queries";

/**
 * The Call lane, as far as it honestly goes today: the agent drafts what it would say, and a person
 * reads it. Nothing is dialled. A real call is not switched on.
 */
export function CallPanel({ supplierId }: { supplierId: string }) {
  const { mode } = useApp();
  const draft = useCallScript(supplierId);
  const requests = useRequests();
  const { show } = useToast();
  const [requestId, setRequestId] = useState("");
  const [script, setScript] = useState<CallScriptDTO | null>(null);
  if (mode === "demo") return null;

  const open = (requests.data ?? []).filter((r) => r.status !== "cancelled" && r.status !== "completed");

  async function go() {
    try { setScript(await draft.mutateAsync(requestId ? { requestId } : {})); }
    catch (e) { show(errorMessage(e), "err"); }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="sec-head"><h2>Call this seller</h2></div>
      <p className="mut" style={{ fontSize: 12.5, marginBottom: 12 }}>
        For sellers with no website. The agent drafts what it would ask. You read it first. It says it is an AI, it only asks questions, and it never agrees to buy.
      </p>
      {open.length ? (
        <div className="fld"><label htmlFor="call-req">About</label>
          <select id="call-req" className="input" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
            <option value="">A general enquiry</option>
            {open.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select></div>
      ) : null}
      <button className="btn btn-sec" style={{ width: "100%", justifyContent: "center" }} disabled={draft.isPending} onClick={() => void go()}>
        <Icon name="agent" /> {draft.isPending ? "Drafting…" : script ? "Draft again" : "Draft the call"}
      </button>

      {script ? (
        <div style={{ marginTop: 14, display: "grid", gap: 12, fontSize: 13 }} aria-live="polite">
          <div><div className="eyebrow" style={{ marginBottom: 4 }}>It opens with</div>{script.opening}</div>
          <div><div className="eyebrow" style={{ marginBottom: 4 }}>It asks</div>
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>{script.questions.map((q) => <li key={q}>{q}</li>)}</ol></div>
          {script.mustConfirm.length ? <div><div className="eyebrow" style={{ marginBottom: 4 }}>Before hanging up it repeats back</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>{script.mustConfirm.map((q) => <li key={q}>{q}</li>)}</ul></div> : null}
          <div><div className="eyebrow" style={{ marginBottom: 4 }}>It closes with</div>{script.closing}</div>
          {script.notes.map((n) => <p key={n} className="mut3" style={{ fontSize: 12, margin: 0 }}>{n}</p>)}
          <div className="callout info"><Icon name="alert" /><div>
            <b>Rehearsal only. Nobody was called and nothing was spent.</b> A real call costs about ${script.price} through Kite Passport and is not switched on yet.
          </div></div>
        </div>
      ) : null}
    </div>
  );
}
