"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { Modal, useToast } from "@/components/overlays";
import { openBuyerPanel } from "@/lib/buyer-panels";
import { useApp } from "@/lib/app-context";
import type { CallScriptDTO } from "@/lib/dto";
import { errorMessage, useCallInfo, useCallScript, useCallStatus, usePlaceCall, useRequests, useVerifyPlan } from "@/lib/queries";

/**
 * The Call lane. The agent drafts what it would say, you read it, and only then can you phone the
 * seller for real: the AI says it is an AI, only asks questions, and never agrees to buy. Calls cost a
 * few cents each, are paid from an approved session, and are not recorded.
 */
export function CallPanel({ supplierId, sellerName }: { supplierId: string; sellerName: string }) {
  const { mode } = useApp();
  const draft = useCallScript(supplierId);
  const requests = useRequests();
  const info = useCallInfo(supplierId);
  const plan = useVerifyPlan(supplierId);
  const place = usePlaceCall(supplierId);
  const { show } = useToast();
  const [requestId, setRequestId] = useState("");
  const [script, setScript] = useState<CallScriptDTO | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [sure, setSure] = useState(false);
  const [placed, setPlaced] = useState<{ callId: string; sessionId: string } | null>(null);

  const price = info.data?.price ?? "0.54";
  const sessions = (plan.data?.sessions ?? []).filter((s) => Number(s.maxPerTx) >= Number(price) && Number(s.maxTotal) >= Number(price));
  const [sessionId, setSessionId] = useState("");
  useEffect(() => { setSessionId((s) => (s && sessions.some((x) => x.id === s) ? s : sessions[0]?.id ?? "")); }, [plan.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastId = placed?.callId ?? info.data?.calls[0]?.callId ?? null;
  const status = useCallStatus(supplierId, lastId, placed?.sessionId ?? sessionId ?? null);
  if (mode === "demo") return null;

  const open = (requests.data ?? []).filter((r) => r.status !== "cancelled" && r.status !== "completed");
  const live = info.data?.enabled === true && info.data.callable;

  async function go() {
    try { setScript(await draft.mutateAsync(requestId ? { requestId } : {})); }
    catch (e) { show(errorMessage(e), "err"); }
  }

  async function call() {
    if (!script || !sessionId) return;
    try {
      const r = await place.mutateAsync({ sessionId, confirmed: true, script: { opening: script.opening, questions: script.questions, mustConfirm: script.mustConfirm, closing: script.closing } });
      setPlaced({ callId: r.callId, sessionId });
      setConfirm(false); setSure(false);
      show("Call placed. It can take a minute to connect.");
    } catch (e) { show(errorMessage(e), "err"); }
  }

  const st = status.data?.status ?? null;
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="sec-head"><h2>Call this seller</h2></div>
      <p className="mut" style={{ fontSize: 12.5, marginBottom: 12 }}>
        For sellers with no website. The agent drafts what it would ask and you read it first. It says it is an AI, only asks questions, and never agrees to buy.
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
          <div><div className="eyebrow" style={{ marginBottom: 4 }}>It opens with</div>Hello, I am an AI assistant calling on behalf of a customer.</div>
          <div><div className="eyebrow" style={{ marginBottom: 4 }}>It asks</div>
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>{script.questions.map((q) => <li key={q}>{q}</li>)}</ol></div>
          {script.mustConfirm.length ? <div><div className="eyebrow" style={{ marginBottom: 4 }}>Before hanging up it repeats back</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>{script.mustConfirm.map((q) => <li key={q}>{q}</li>)}</ul></div> : null}
          <div><div className="eyebrow" style={{ marginBottom: 4 }}>It closes with</div>{script.closing}</div>
          {script.notes.map((n) => <p key={n} className="mut3" style={{ fontSize: 12, margin: 0 }}>{n}</p>)}

          {!live ? (
            <div className="callout info"><Icon name="alert" /><div><b>Rehearsal.</b> Real calls open once Kite Passport is switched on for this account. Nobody was called.</div></div>
          ) : !info.data?.hasPhone ? (
            <div className="callout warn"><Icon name="alert" /><div>This seller has no phone number saved in international format (such as +2348012345678), so it cannot be called.</div></div>
          ) : (
            <div className="callout info" style={{ alignItems: "flex-start" }}><Icon name="shield" /><div>
              <b>Call {sellerName} for real.</b> A real person at the number {info.data.phoneHint} will be phoned. A call costs about ${price} from a spending session you approved, lasts up to {info.data.maxMinutes} minutes and is not recorded.
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {sessions.length ? (
                  <button className="btn btn-pri btn-sm" onClick={() => setConfirm(true)}><Icon name="agent" /> Place the call</button>
                ) : (
                  <button className="btn btn-sec btn-sm" onClick={() => openBuyerPanel("session", { amount: "5" })}>Approve a spending session first</button>
                )}
              </div>
            </div></div>
          )}
        </div>
      ) : null}

      {lastId ? (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12, fontSize: 13 }} aria-live="polite">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Latest call</div>
          {status.isLoading ? <span className="mut3">Asking for the call&apos;s progress…</span>
            : st ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div><b>{st.completed ? "Finished" : st.status}</b>{st.answeredBy ? ` · answered by ${st.answeredBy}` : ""}{st.seconds !== null ? ` · ${st.seconds}s` : ""}</div>
                {st.summary ? <div><span className="mut3">Summary: </span>{st.summary}</div> : null}
                {st.transcript ? <details><summary style={{ cursor: "pointer" }}>Transcript</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "6px 0 0" }}>{st.transcript}</pre></details> : null}
                {st.error ? <div style={{ color: "var(--err)" }}>{st.error}</div> : null}
                {!st.completed ? <span className="mut3" style={{ fontSize: 12 }}>Checking again every few seconds.</span> : null}
              </div>
            ) : <span className="mut3">No progress yet. {sessions.length ? "Try again in a minute." : "Approve a spending session to read the result."}</span>}
        </div>
      ) : null}

      <Modal open={confirm} onClose={() => { if (!place.isPending) setConfirm(false); }} label="Place the call" wide>
        <div style={{ padding: 24, display: "grid", gap: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Phone {sellerName}?</h3>
            <p className="mut" style={{ fontSize: 12.5, margin: "4px 0 0" }}>This phones a real person at the number {info.data?.phoneHint}. It cannot be undone once it rings.</p>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5, fontSize: 13 }}>
            <li>An AI makes the call and says it is an AI at the start.</li>
            <li>It only asks the questions you just read, and never agrees to buy or gives payment details.</li>
            <li>It costs about <b>${price}</b>, paid from your spending session. Up to {info.data?.maxMinutes} minutes, not recorded.</li>
          </ul>
          {sessions.length > 1 ? (
            <div className="fld" style={{ marginBottom: 0 }}><label htmlFor="call-session">Pay from session</label>
              <select id="call-session" className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                {sessions.map((s) => <option key={s.id} value={s.id}>{s.taskSummary.slice(0, 50)} (up to ${Number(s.maxTotal)})</option>)}
              </select></div>
          ) : null}
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I read the script and I want this seller phoned now.</span>
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn btn-sec" onClick={() => setConfirm(false)} disabled={place.isPending}>Cancel</button>
            <button className="btn btn-pri" disabled={!sure || !sessionId || place.isPending} onClick={() => void call()}>
              <Icon name="agent" /> {place.isPending ? "Placing the call…" : `Call now, $${price}`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
