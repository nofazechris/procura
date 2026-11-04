"use client";

import { Icon } from "@/components/icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { errorMessage, useAgentStatus, useExplain } from "@/lib/queries";

/**
 * Plain-language commentary on the comparison, written by the agent from what the engine computed.
 * It cannot change the ranking or recommend a quote the engine rejected; a person still decides.
 */
export function AgentExplain({ requestId, hasEligible }: { requestId: string; hasEligible: boolean }) {
  const { mode } = useApp();
  const status = useAgentStatus();
  const explain = useExplain(requestId);

  if (mode !== "live" || !hasEligible) return null;
  if (status.data && !status.data.configured) return null;

  const r = explain.data;
  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="k-ic" style={{ background: "var(--green)", color: "var(--forest)" }}><Icon name="agent" /></span>
          <div>
            <h3 style={{ fontSize: 14.5 }}>Agent's reasoning</h3>
            <div className="mut3" style={{ fontSize: 12 }}>Commentary on the comparison. The ranking is computed by the engine.</div>
          </div>
        </div>
        {!r ? (
          <button className="btn btn-sec btn-sm" onClick={() => explain.mutate()} disabled={explain.isPending || status.isLoading}>
            <Icon name="agent" /> {explain.isPending ? "Thinking…" : "Explain this comparison"}
          </button>
        ) : (
          <Pill tone={r.agreesWithEngine ? "ok" : "warn"}>{r.agreesWithEngine ? "Agrees with the engine" : `Prefers ${r.preferredSupplier ?? "none"}, the engine recommends another`}</Pill>
        )}
      </div>

      {explain.isError ? <div className="callout err" role="alert" style={{ marginTop: 14 }}><Icon name="alert" /><div>{errorMessage(explain.error)}</div></div> : null}

      {r ? (
        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>{r.summary}</p>
          {r.tradeoffs.length ? (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Trade-offs</div>
              <ul style={{ paddingLeft: 18, display: "grid", gap: 4, fontSize: 13.5 }}>{r.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ) : null}
          {r.questionsForYou.length ? (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Check before approving</div>
              <ul style={{ paddingLeft: 18, display: "grid", gap: 4, fontSize: 13.5 }}>{r.questionsForYou.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ) : null}
          <div className="mut3" style={{ fontSize: 11.5 }}>
            Written by {r.model} through SERV Reasoning, from the engine's figures only. It cannot approve, pay or change a limit.
            <button className="linkbtn" style={{ marginLeft: 8 }} onClick={() => explain.mutate()} disabled={explain.isPending}>{explain.isPending ? "Thinking…" : "Ask again"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
