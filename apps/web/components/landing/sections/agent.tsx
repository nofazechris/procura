"use client";

import type { LandingData } from "@/lib/landing/data";
import { Split } from "./split";

export function AgentSection({ data }: { data: LandingData }) {
  const two = (v: string) => `$${Number(v).toFixed(2)}`;
  return (
    <Split
      id="agent" side="right" kicker="Who is buying"
      title="An agent with a name, and a leash."
      visual={
        <div className="ag" role="img" aria-label="A registered agent and its capped spending session">
          <div className="ag-card">
            <div className="ag-row"><span className="ag-k">AGENT</span><span className="ag-chip ok">registered</span></div>
            <div className="ag-id">procura-agent</div>
            <div className="ag-mono">agent_01a1a60e…3891</div>
            <div className="ag-mono dim">owner: you, with a passkey</div>
          </div>
          <div className="ag-link" aria-hidden="true" />
          <div className="ag-card hot">
            <div className="ag-k">SPENDING SESSION</div>
            <div className="ag-big">{two(data.session.budget)}</div>
            <div className="ag-lines">
              <span>per payment {two(data.session.perTransaction)}</span>
              <span>expires in {data.session.minutes} min</span>
            </div>
            <div className="ag-bar"><i /></div>
            <span className="ag-chip warn">needs your passkey</span>
          </div>
        </div>
      }
    >
      <p className="lx-body">
        Every purchase starts with an identity. The agent is registered under your Kite Passport account, so each action traces back to
        it, and to you. It never holds your card or your keys.
      </p>
      <ul className="lx-points">
        <li><b>You set the limits.</b> A per-payment cap, a total and a short expiry. Passport enforces them, so the agent cannot talk its way past one.</li>
        <li><b>You approve with a passkey.</b> The agent can request a session. It cannot activate one.</li>
        <li><b>Everything is recorded.</b> Who asked, what was approved, what was spent.</li>
      </ul>
    </Split>
  );
}
