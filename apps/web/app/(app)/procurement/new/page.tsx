"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { PageHead, Toggle } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { errorMessage, useAgentStatus, useCreateRequest, useInterpret, usePassport, useStartSourcing, type NewRequestInput, type SourceChoice } from "@/lib/queries";
import { CreateProcurementRequestSchema } from "@procura/shared";

interface Line { productName: string; quantity: string; unit: string; category: string }
const blankLine = (): Line => ({ productName: "", quantity: "", unit: "", category: "" });

const PRIORITIES = [
  { v: "price", l: "Lowest price" }, { v: "reliability", l: "Seller reliability" },
  { v: "speed", l: "Delivery speed" }, { v: "quality", l: "Quality" },
] as const;

const EXAMPLE = "I need 50 bags of premium basmati rice, 20 cartons of vegetable oil and 10 cartons of frozen chicken. Find reliable sellers. My maximum budget is $2,000, including delivery.";
const CHIPS = ["A 65W USB-C charger under $25", "Printer labels, two rolls", "A standing desk mat under $60", "Gift for a coffee lover under $40"];

export default function NewProcurementPage() {
  const { mode, business } = useApp();
  const router = useRouter();
  const { show } = useToast();
  const create = useCreateRequest();
  const sourcing = useStartSourcing();
  const agent = useAgentStatus();
  const interpret = useInterpret();
  const agentReady = mode === "live" && agent.data?.configured === true;
  const passport = usePassport();
  // Amazon search runs through Kite Passport, so it is offered only where Passport is enabled.
  const amazonReady = mode === "live" && passport.data?.enabled === true;
  const [source, setSource] = useState<SourceChoice>("demo");
  const chose = useRef(false);
  useEffect(() => { if (amazonReady && !chose.current) { chose.current = true; setSource("amazon"); } }, [amazonReady]);

  const [busy, setBusy] = useState<null | "creating" | "sourcing">(null);
  const [prompt, setPrompt] = useState(mode === "demo" ? EXAMPLE : "");
  // The Home page can hand over what you typed there.
  useEffect(() => { const q = new URLSearchParams(window.location.search).get("q"); if (q) setPrompt(q.slice(0, 1500)); }, []);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [location, setLocation] = useState("");
  const [deadline, setDeadline] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState(business.defaultCurrency);
  const [priority, setPriority] = useState<NewRequestInput["priority"]>("price");
  const [includeDelivery, setIncludeDelivery] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{ missing: string[]; notes: string[]; model: string } | null>(null);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  /** The agent reads the text and fills the form below. Nothing is created until a person submits it. */
  async function readRequest(text: string) {
    try {
      const { draft, missing, notes, model } = await interpret.mutateAsync(text);
      setTitle(draft.title);
      setLines(draft.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unit: i.unit, category: i.category })));
      setLocation(draft.deliveryLocation);
      setDeadline(draft.deliveryDeadline);
      setBudget(draft.budgetAmount);
      setCurrency(draft.currency);
      setPriority(draft.priority);
      setErrors({});
      setReview({ missing, notes, model });
    } catch (e) {
      setReview(null);
      show(errorMessage(e), "err");
    }
  }

  // The assistant page hands over what the person typed. Read it once, then clear it.
  const handedOver = useRef(false);
  useEffect(() => {
    if (handedOver.current || mode !== "live") return;
    handedOver.current = true;
    let text: string | null = null;
    try { text = sessionStorage.getItem("procura_ask"); sessionStorage.removeItem("procura_ask"); } catch { /* storage unavailable */ }
    if (text) { setPrompt(text); void readRequest(text); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function run(input: NewRequestInput) {
    try {
      setBusy("creating");
      const request = await create.mutateAsync(input);
      setBusy("sourcing");
      await Promise.all([sourcing.mutateAsync({ id: request.id, source: amazonReady ? source : "demo" }), new Promise((r) => setTimeout(r, 1500))]);
      router.push(`/procurement/${request.id}/compare`);
    } catch (e) {
      setBusy(null);
      show(errorMessage(e), "err");
    }
  }

  function submitStructured(e: React.FormEvent) {
    e.preventDefault();
    const candidate = {
      title: title.trim(), budgetAmount: budget.trim(), currency, priority,
      ...(location.trim() ? { deliveryLocation: location.trim() } : {}),
      ...(deadline ? { deliveryDeadline: new Date(`${deadline}T23:59:59`).toISOString() } : {}),
      items: lines.filter((l) => l.productName.trim() || l.quantity.trim() || l.unit.trim()).map((l) => ({
        productName: l.productName.trim(), quantity: l.quantity.trim(), unit: l.unit.trim(), ...(l.category.trim() ? { category: l.category.trim() } : {}),
      })),
    };
    const parsed = CreateProcurementRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (!next[key]) next[key] = issue.path.includes("items") && issue.path.length === 1 ? "Add at least one item." : friendly(issue.message, key);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    void run({ ...candidate, items: candidate.items });
  }

  function submitPrompt() {
    if (mode !== "demo") return;
    // Demo: natural language is not parsed (that needs SERV Reasoning). The prompt maps to the Northstar scenario.
    void run({
      title: "Kitchen inventory restock", budgetAmount: "2000", currency: "USD", priority: "price", deliveryLocation: "Victoria Island, Lagos",
      items: [
        { productName: "Premium basmati rice", quantity: "50", unit: "bags", category: "food" },
        { productName: "Vegetable oil", quantity: "20", unit: "cartons", category: "food" },
        { productName: "Frozen chicken", quantity: "10", unit: "cartons", category: "food" },
      ],
    });
  }

  if (busy) {
    return (
      <div className="sourcing" role="status">
        <div className="ap-orb live"><Icon name="agent" /></div>
        <h2>{busy === "creating" ? "Saving your request" : "Searching for options"}</h2>
        <p className="mut">{busy === "creating" ? "Recording the request and its line items." : "Finding sellers, collecting prices and checking the evidence."}</p>
        <div className="src-steps">
          {["Request saved", "Searching sellers", "Collecting and checking prices"].map((s, i) => (
            <div key={s} className="src-step" style={{ animationDelay: `${i * 0.4}s` }}>{s}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHead title="New request" sub="Describe what you need, or fill in the details yourself. Either way, Procura searches and shows you the options." />
      {amazonReady ? (
        <div className="card" style={{ padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
          <div className="eyebrow">Where should I look?</div>
          <nav className="filters" aria-label="Where to look for products" style={{ margin: 0 }}>
            {([["amazon", "Amazon (live)"], ["demo", "Demo sellers"]] as const).map(([v, l]) => (
              <button key={v} type="button" className={`filt ${source === v ? "on" : ""}`} aria-pressed={source === v} onClick={() => setSource(v)}>{l}</button>
            ))}
          </nav>
          <p className="mut" style={{ fontSize: 12.5, margin: 0 }}>
            {source === "amazon"
              ? "Searches Amazon through Kite Passport. Searching is free and buys nothing. Prices are in USD, and shipping and tax are added at checkout."
              : "Fictional sellers for rice, vegetable oil and frozen chicken, to try the flow."}
          </p>
          {source === "amazon" && currency !== "USD" ? <div className="callout warn"><Icon name="alert" /><div>Amazon prices are in USD and Procura does not guess exchange rates. Set the currency to USD to get quotes.</div></div> : null}
        </div>
      ) : null}
      <div className="two-col" style={{ alignItems: "start" }}>
        <div className="card" style={{ padding: 22 }} data-tour="ask-card">
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span className="k-ic" style={{ background: "var(--green)", color: "var(--forest)" }}><Icon name="agent" /></span>
            <h2 style={{ fontSize: 16 }}>Ask Procura</h2>
          </div>
          <p className="mut" style={{ fontSize: 13, marginBottom: 14 }}>The fastest way: tell the agent in plain language.</p>
          {mode === "live" && !agentReady ? (
            <div className="callout info" style={{ marginBottom: 14 }}>
              <Icon name="alert" />
              <div>{agent.isLoading ? "Checking the agent…" : "Plain-language requests need SERV Reasoning, which is not connected. Use the form instead."}</div>
            </div>
          ) : mode === "live" ? (
            <div className="callout info" style={{ marginBottom: 14 }}>
              <Icon name="shield" />
              <div>Procura reads your request and fills in the form. You review it before anything starts, and the agent never sets your spending limits.</div>
            </div>
          ) : (
            <div className="callout info" style={{ marginBottom: 14 }}>
              <Icon name="alert" />
              <div>In this demo, any prompt starts the Northstar Kitchen scenario. Plain-language parsing arrives with SERV Reasoning.</div>
            </div>
          )}
          <textarea className="input" style={{ minHeight: 120, background: "var(--surface-2)" }} aria-label="Describe what you need to buy"
            placeholder="Describe what you need to buy…" value={prompt} disabled={mode === "live" && !agentReady} maxLength={1500} onChange={(e) => setPrompt(e.target.value)} />
          <div className="prompt-chips">
            {CHIPS.map((c) => <button key={c} type="button" className="prompt-chip" disabled={mode === "live" && !agentReady} onClick={() => setPrompt(c)}>{c}</button>)}
          </div>
          {mode === "live" ? (
            <>
              <button className="btn btn-pri btn-lg" style={{ marginTop: 18, width: "100%" }} disabled={!agentReady || !prompt.trim() || interpret.isPending} onClick={() => void readRequest(prompt)}>
                <Icon name="agent" /> {interpret.isPending ? "Reading your request…" : "Read my request"}
              </button>
              {review ? (
                <div className="callout ok" style={{ marginTop: 14, display: "grid", gap: 6 }} role="status">
                  <div style={{ display: "flex", gap: 8 }}><Icon name="check" /><div><b>I filled in the form.</b> Check each line, then start sourcing.</div></div>
                  {review.missing.length ? <div style={{ fontSize: 13 }}>Still needed: {review.missing.join(", ")}.</div> : null}
                  {review.notes.map((n) => <div key={n} style={{ fontSize: 13 }}>{n}</div>)}
                  <div className="mut3" style={{ fontSize: 11.5 }}>Read by {review.model} through SERV Reasoning.</div>
                </div>
              ) : null}
            </>
          ) : (
            <button className="btn btn-pri btn-lg" style={{ marginTop: 18, width: "100%" }} disabled={!prompt.trim()} onClick={submitPrompt}>
              <Icon name="bolt" /> Start sourcing
            </button>
          )}
        </div>

        <form className="card" style={{ padding: 22 }} onSubmit={submitStructured} noValidate>
          <h2 style={{ fontSize: 16, marginBottom: 4 }}>Create manually</h2>
          <p className="mut" style={{ fontSize: 13, marginBottom: 16 }}>Precise control over line items and requirements.</p>

          <Field label="Request title" error={errors["title"]}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen inventory restock" aria-invalid={!!errors["title"]} />
          </Field>

          <div className="eyebrow" style={{ margin: "18px 0 10px" }}>Items</div>
          {lines.map((l, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: 12, marginBottom: 10 }}>
              <Field label="Product or service" error={errors[`items.${i}.productName`]}>
                <input className="input" value={l.productName} onChange={(e) => setLine(i, { productName: e.target.value })} placeholder="Premium basmati rice" aria-invalid={!!errors[`items.${i}.productName`]} />
              </Field>
              <div className="grid-2">
                <Field label="Quantity" error={errors[`items.${i}.quantity`]}>
                  <input className="input num" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="50" aria-invalid={!!errors[`items.${i}.quantity`]} />
                </Field>
                <Field label="Unit" error={errors[`items.${i}.unit`]}>
                  <input className="input" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} placeholder="bags" aria-invalid={!!errors[`items.${i}.unit`]} />
                </Field>
              </div>
              <Field label="Category (optional)"><input className="input" value={l.category} onChange={(e) => setLine(i, { category: e.target.value })} placeholder="food" /></Field>
              {lines.length > 1 ? <button type="button" className="linkbtn" style={{ fontSize: 12.5, color: "var(--err)" }} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>Remove item</button> : null}
            </div>
          ))}
          {errors["items"] ? <div className="ferr" style={{ color: "var(--err)", fontSize: 12, marginBottom: 8 }}>{errors["items"]}</div> : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, blankLine()])}><Icon name="plus" /> Add another item</button>

          <div style={{ height: 14 }} />
          <Field label="Delivery location"><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Victoria Island, Lagos" /></Field>
          <div className="grid-2">
            <Field label="Budget (delivered)" error={errors["budgetAmount"]}>
              <input className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="2000" aria-invalid={!!errors["budgetAmount"]} />
            </Field>
            <Field label="Currency">
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {[...new Set([business.defaultCurrency, "USD", "NGN", "GBP", "EUR"])].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Delivery deadline (optional)"><input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
            <Field label="Priority">
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as NewRequestInput["priority"])}>
                {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ marginTop: 6, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Purchasing controls</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 0" }}>
              <span style={{ fontSize: 13.5 }}>Include delivery and additional costs</span>
              <Toggle on={includeDelivery} onChange={setIncludeDelivery} label="Include delivery and additional costs" />
            </div>
            <p className="mut3" style={{ fontSize: 12, marginTop: 6 }}>Totals always include delivery and stated fees, so quotes are compared on what you actually pay.</p>
          </div>

          {mode === "live" ? (
            <div className="callout warn" style={{ marginTop: 14 }}>
              <Icon name="alert" />
              <div>Seller data comes from the demo provider, which covers rice, vegetable oil and frozen chicken. Other products will find no sellers until live providers are connected.</div>
            </div>
          ) : null}
          <button className="btn btn-pri btn-lg" type="submit" style={{ marginTop: 18, width: "100%" }}><Icon name="bolt" /> Start sourcing</button>
        </form>
      </div>
    </>
  );
}

function Field({ label, error, children }: { label: string; error?: string | undefined; children: ReactNode }) {
  return <div className="fld"><label>{label}</label>{children}{error ? <div className="ferr" role="alert">{error}</div> : null}</div>;
}

function friendly(message: string, key: string): string {
  if (key.endsWith("quantity")) return "Enter a quantity greater than zero, such as 50 or 2.5.";
  if (key === "budgetAmount") return "Enter a budget such as 2000 or 2000.50.";
  if (key.endsWith("productName")) return "Enter the product or service.";
  if (key.endsWith("unit")) return "Enter a unit, such as bags or cartons.";
  if (key === "title") return "Give the request a short title.";
  return message;
}
