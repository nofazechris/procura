"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import type { RequestDTO } from "@/lib/dto";
import { useAgentStatus, usePassport } from "@/lib/queries";
import { stageProgress, STAGES } from "@/lib/stages";
import { Icon } from "./icon";

/** Five headline steps for the dashboard card, mapped from the 11 stages. */
const SUMMARY = [
  { label: "Analysed requirements", upTo: 2 },
  { label: "Found options", upTo: 3 },
  { label: "Collected offers", upTo: 4 },
  { label: "Compared delivered prices", upTo: 6 },
  { label: "Generated recommendation", upTo: 7 },
];

/**
 * The agent card on the dashboard. It describes the most recent active request from its real
 * status, and says plainly what is connected: SERV Reasoning for reading requests, and Amazon
 * search through Kite Passport. Where neither is, it says so rather than implying an AI is working.
 */
export function AgentPanel({ request }: { request: RequestDTO | undefined }) {
  const { mode } = useApp();
  const serv = useAgentStatus();
  const passport = usePassport();
  const progress = request ? stageProgress(request.status) : null;
  const live = progress?.kind === "now";

  return (
    <div className="agent-panel" data-tour="agent-panel">
      <div className="ap-head">
        <div className={`ap-orb ${live ? "live" : ""}`}><Icon name="agent" /></div>
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
          <Link href={`/requests/${request.id}`} className="btn btn-sm" style={{ background: "rgba(255,255,255,.1)", color: "#fff", marginTop: 16, width: "100%" }}>
            Open request <Icon name="arr" />
          </Link>
        </>
      ) : (
        <div className="ap-task">No active request. Describe what you need and Procura will find options and compare them for you.
          <Link href="/requests/new" className="btn btn-sm" style={{ background: "var(--panel-accent)", color: "var(--panel)", marginTop: 16, width: "100%" }}>
            <Icon name="plus" /> New request
          </Link>
        </div>
      )}
      {mode === "live" ? (
        <div className="ap-task" style={{ fontSize: 11.5, color: "var(--panel-ink-2)", marginTop: 14 }}>
          {serv.data?.configured ? "SERV Reasoning reads your requests and explains comparisons." : "SERV Reasoning is not connected, so requests are filled in by hand."}{" "}
          {passport.data?.enabled ? "Amazon search runs through Kite Passport. Checkout comes next." : "Sourcing uses the demo seller set."}
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
