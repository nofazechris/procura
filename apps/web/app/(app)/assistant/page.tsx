"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { PageHead } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { initials, moneyShort } from "@/lib/format";
import { spentOrders, totalOf } from "@/lib/derive";
import { useAgentStatus, useApprovals, useOrders, useRequests } from "@/lib/queries";

interface Msg { who: "u" | "a"; body: ReactNode }

const CHIPS = ["Find a laptop stand under $40", "How much have I spent this month?", "What is waiting for me?", "Check my requests"];

/**
 * The assistant workspace. In live mode it takes a plain-language purchase request and hands it to
 * the new-request page, where SERV Reasoning reads it and a person reviews the result; without a
 * SERV key it says so and offers no pretend replies. Demo mode answers a few questions from the
 * sample data using fixed rules, and labels itself as scripted.
 */
export default function AssistantPage() {
  const { mode, user, business } = useApp();
  const router = useRouter();
  const agent = useAgentStatus();
  const agentReady = mode === "live" && agent.data?.configured === true;
  const orders = useOrders();
  const requests = useRequests();
  const approvals = useApprovals();
  const [msgs, setMsgs] = useState<Msg[]>([{
    who: "a",
    body: mode === "demo"
      ? <>Hi {user.name.split(" ")[0]}, I am Procura. This demo assistant answers a few questions from the sample data with fixed rules. What would you like to check?</>
      : <>Hi {user.name.split(" ")[0]}. Tell me what you need to buy, with quantities and a budget, and I will read it and fill in a request for you to review. Nothing starts until you confirm it.</>,
  }]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, typing]);

  function card(icon: "agent" | "trend" | "shield" | "pkg", title: string, href: string, label: string) {
    return (
      <div className="chat-card"><div className="cc-h"><Icon name={icon} /> {title}</div>
        <div style={{ padding: 13 }}><Link href={href} className="btn btn-pri btn-sm" style={{ width: "100%" }}>{label} <Icon name="arr" /></Link></div></div>
    );
  }

  function answer(q: string): ReactNode {
    const lower = q.toLowerCase();
    const cur = business.defaultCurrency;
    if (/spend|summar/.test(lower)) {
      const spent = spentOrders(orders.data ?? [], cur, Date.now() - 30 * 86_400_000);
      return <>In the last 30 days you spent <b>{moneyShort(totalOf(spent, cur), cur)}</b> across {spent.length} paid {spent.length === 1 ? "order" : "orders"}.{card("trend", "Spending", "/payments", "Open spending")}</>;
    }
    if (/approv/.test(lower)) {
      const p = (approvals.data ?? []).filter((a) => a.status === "pending");
      return <>{p.length ? <>You have <b>{p.length}</b> {p.length === 1 ? "order" : "orders"} waiting: {p.map((a) => a.orderNumber).join(", ")}.</> : "Nothing is waiting for your approval."}{p.length ? card("shield", "Action needed", "/approvals", "Review approvals") : null}</>;
    }
    if (/request|status|pr-/.test(lower)) {
      const r = (requests.data ?? []).filter((x) => !["completed", "cancelled", "failed"].includes(x.status));
      return <>You have <b>{r.length}</b> open {r.length === 1 ? "request" : "requests"}{r[0] ? <>. The latest is <b>{r[0].title}</b> ({r[0].requestNumber}), which is {r[0].status.replace("_", " ")}.</> : "."}{card("pkg", "Procurement", "/requests", "Open procurement")}</>;
    }
    if (/supplier|packaging|box|find|source|compare/.test(lower)) {
      return <>I can source suppliers, but starting from free text needs SERV Reasoning. In this demo, create the request in the form and I will run the comparison.{card("agent", "Start a request", "/requests/new", "Create request")}</>;
    }
    return <>I do not have a rule for that in the demo. Try asking about spending, approvals or requests.</>;
  }

  function send(raw?: string) {
    const q = (raw ?? text).trim();
    if (!q) return;
    if (mode === "live") {
      if (!agentReady) return;
      // The new-request page reads this once, runs the agent, and shows the result for review.
      try { sessionStorage.setItem("procura_ask", q); } catch { /* storage unavailable: the page opens empty */ }
      router.push("/requests/new");
      return;
    }
    setText("");
    setMsgs((m) => [...m, { who: "u", body: q }]);
    setTyping(true);
    window.setTimeout(() => { setTyping(false); setMsgs((m) => [...m, { who: "a", body: answer(q) }]); }, 900);
  }

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead title="Ask Procura" sub="Say what you need, compare options and check on things in plain language." />
      <div className="chat" style={{ flex: 1, minHeight: 420 }}>
        {mode === "live" ? (
          agentReady ? (
            <div className="callout info" style={{ marginBottom: 14 }}><Icon name="shield" /><div>Your message is read by SERV Reasoning and turned into a draft request. You review it before anything is created. It never sets spending limits.</div></div>
          ) : (
            <div className="callout info" style={{ marginBottom: 14 }}><Icon name="alert" /><div>{agent.isLoading ? "Checking the agent…" : "SERV Reasoning is not connected, so this assistant cannot interpret free text. It never pretends to."}</div></div>
          )
        ) : (
          <div className="callout info" style={{ marginBottom: 14 }}><Icon name="alert" /><div>Demo: replies come from fixed rules over the sample data, not from a language model.</div></div>
        )}
        <div className="chat-stream" style={{ minHeight: 260 }}>
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.who}`}>
              <div className="av">{m.who === "u" ? initials(user.name) : "P"}</div>
              <div className="bubble">{m.body}</div>
            </div>
          ))}
          {typing ? <div className="msg a"><div className="av">P</div><div className="bubble"><div className="typing"><i /><i /><i /></div></div></div> : null}
          {msgs.length === 1 && mode === "demo" ? (
            <div className="prompt-chips" style={{ paddingLeft: 42 }}>{CHIPS.map((c) => <button key={c} className="prompt-chip" onClick={() => send(c)}>{c}</button>)}</div>
          ) : null}
          <div ref={end} />
        </div>
        <div className="composer">
          <textarea className="input" style={{ minHeight: 46, maxHeight: 120 }} rows={1} aria-label="Message Procura" disabled={mode === "live" && !agentReady} maxLength={1500}
            placeholder={mode === "live" ? (agentReady ? "Describe what you need to buy" : "Needs SERV Reasoning") : "Message Procura"} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn btn-pri" aria-label="Send" style={{ height: 46, width: 46, padding: 0 }} disabled={(mode === "live" && !agentReady) || !text.trim()} onClick={() => send()}><Icon name="send" /></button>
        </div>
      </div>
    </div>
  );
}
