"use client";

import { useRef } from "react";

interface Lane { name: string; status: "Live" | "Needs funds" | "Preview"; line: string; detail: string; cost: string; glyph: string }

const LANES: Lane[] = [
  { name: "Shop", status: "Live", glyph: "01", line: "Search real products and compare baskets.", detail: "Amazon search through Kite Passport is free and buys nothing. Checkout runs as a practice for now: the full payment gate, with no money moved until a wallet is funded.", cost: "search is free, practice checkout is free" },
  { name: "Verify", status: "Needs funds", glyph: "02", line: "Check a seller before you trust it.", detail: "Sanctions, company registry and email checks, bought per call for cents from a session you approve, and turned into evidence. Built, and waiting for a funded wallet.", cost: "about 1 to 30 cents a check" },
  { name: "Call", status: "Preview", glyph: "03", line: "Phone sellers that have no website.", detail: "The agent drafts the call, saying it is an AI and only asking questions, and you read it first. Real calls are not switched on.", cost: "about 54 cents a call" },
];

function Panel({ lane, i }: { lane: Lane; i: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 18}deg`);
    el.style.setProperty("--rx", `${-((e.clientY - r.top) / r.height - 0.5) * 14}deg`);
  };
  const leave = () => { ref.current?.style.setProperty("--ry", "0deg"); ref.current?.style.setProperty("--rx", "0deg"); };
  return (
    <div className="lane" ref={ref} onPointerMove={move} onPointerLeave={leave} style={{ transitionDelay: `${i * 60}ms` }}>
      <div className="lane-layer lane-base" />
      <div className="lane-layer lane-glyph">{lane.glyph}</div>
      <div className="lane-layer lane-body">
        <span className={`lane-pill ${lane.status === "Live" ? "live" : lane.status === "Needs funds" ? "next" : ""}`}>{lane.status}</span>
        <h3>{lane.name}</h3>
        <p className="lane-line">{lane.line}</p>
        <p className="lane-detail">{lane.detail}</p>
        <div className="lane-cost">{lane.cost}</div>
      </div>
    </div>
  );
}

export function LanesSection() {
  return (
    <section id="lanes" className="lx-sec">
      <div className="lx-sec-in">
        <div className="lx-kicker">Three ways it buys</div>
        <h2 className="lx-h">Built on what Kite offers today.</h2>
        <p className="lx-body">Each lane is a real purchase an agent can make through Passport, inside a cap you approve. Where something is not built yet, it says so.</p>
        <div className="lanes">{LANES.map((l, i) => <Panel key={l.name} lane={l} i={i} />)}</div>
      </div>
    </section>
  );
}
