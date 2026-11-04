"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import type { RequestDTO } from "@/lib/dto";
import { stageProgress, STAGES } from "@/lib/stages";
import { Icon } from "./icon";

/** Five headline steps for the dashboard card, mapped from the 11 stages. */
const SUMMARY = [
  { label: "Analysed requirements", upTo: 2 },
  { label: "Discovered suppliers", upTo: 3 },
  { label: "Collected quotations", upTo: 4 },
  { label: "Compared delivered prices", upTo: 6 },
  { label: "Generated recommendation", upTo: 7 },
];

/**
 * The agent card on the dashboard. It describes the most recent active request from its real
 * status. SERV Reasoning is not connected yet, so sourcing is run by the demo provider and the
 * card says so rather than implying an AI is working.
 */
export function AgentPanel({ request }: { request: RequestDTO | undefined }) {
  const { mode } = useApp();
  const progress = request ? stageProgress(request.status) : null;
  const live = progress?.kind === "now";

  return (
    <div className="agent-panel" data-tour="agent-panel">
      <div className="ap-head">
        <div className={`ap-orb ${live ? "live" : ""}`}><Icon name="spark" /></div>
        <div>
          <h3>Procura agent</h3>
          <div className="st">{!request ? "● Idle" : live ? "● Working now" : progress?.kind === "attn" ? "● Waiting on you" : "● Ready"}</div>
        </div>
      </div>
      {request && progress ? (
        <>
          <div className="ap-task"><b>{request.title}</b> · {request.requestNumber}<br /><span style={{ color: "var(--panel-ink-2)" }}>{progress.note}</span></div>
          <div className="ap-steps">
            {SUMMARY.map((s, i) => {
              const done = progress.done >= s.upTo;
              const now = !done && (i === 0 || progress.done >= SUMMARY[i - 1]!.upTo) && progress.kind === "now";
              return (
                <div key={s.label} className={`ap-step ${done ? "done" : now ? "now" : ""}`}>
                  <span className="tick">{done ? <Icon name="check" strokeWidth={3} /> : null}</span>{s.label}
                </div>
              );
            })}
          </div>
          <Link href={`/procurement/${request.id}`} className="btn btn-sm" style={{ background: "rgba(255,255,255,.1)", color: "#fff", marginTop: 16, width: "100%" }}>
            Open workspace <Icon name="arr" />
          </Link>
        </>
      ) : (
        <div className="ap-task">No active request. Start a procurement and Procura will source and compare suppliers for you.
          <Link href="/procurement/new" className="btn btn-sm" style={{ background: "var(--panel-accent)", color: "var(--panel)", marginTop: 16, width: "100%" }}>
            <Icon name="plus" /> New procurement
          </Link>
        </div>
      )}
      {mode === "live" ? (
        <div className="ap-task" style={{ fontSize: 11.5, color: "var(--panel-ink-2)", marginTop: 14 }}>
          Sourcing currently uses the demo supplier provider. SERV Reasoning is not connected yet.
        </div>
      ) : null}
    </div>
  );
}

/** The execution timeline for one request: complete, in progress, or waiting on a person. */
export function ExecutionTimeline({ progress, replay }: { progress: ReturnType<typeof stageProgress>; replay?: boolean }) {
  // In demo mode the run is replayed from the start so the stages visibly advance.
  const [shown, setShown] = useState(replay ? 2 : progress.done);
  useEffect(() => {
    if (!replay) { setShown(progress.done); return; }
    setShown(2);
    const t = window.setInterval(() => setShown((s) => (s < progress.done ? s + 1 : s)), 1100);
    return () => window.clearInterval(t);
  }, [replay, progress.done]);

  const done = replay ? shown : progress.done;
  const replaying = replay && done < progress.done;
  const current = replaying ? done : progress.current;
  const kind = replaying ? "now" : progress.kind;

  return (
    <div className="timeline" role="list" aria-label="Execution stages">
      {STAGES.map((s, i) => {
        const cls = i < done ? "done" : i === current ? (kind === "attn" ? "attn" : "now") : "";
        return (
          <div key={s.title} role="listitem" className={`tl-i ${cls}`}>
            <div className="tl-node"><Icon name="check" strokeWidth={3} /></div>
            <div className="tl-h">{s.title}</div>
            <div className="tl-d">{i === current && !replaying ? progress.note || s.detail : s.detail}</div>
          </div>
        );
      })}
    </div>
  );
}
