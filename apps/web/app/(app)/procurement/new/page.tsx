"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { PageHead, Toggle } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { errorMessage, useCreateRequest, useStartSourcing, type NewRequestInput } from "@/lib/queries";
import { CreateProcurementRequestSchema } from "@procura/shared";

interface Line { productName: string; quantity: string; unit: string; category: string }
const blankLine = (): Line => ({ productName: "", quantity: "", unit: "", category: "" });

const PRIORITIES = [
  { v: "price", l: "Lowest price" }, { v: "reliability", l: "Supplier reliability" },
  { v: "speed", l: "Delivery speed" }, { v: "quality", l: "Quality" },
] as const;

const EXAMPLE = "I need 50 bags of premium basmati rice, 20 cartons of vegetable oil and 10 cartons of frozen chicken. Find reliable suppliers. My maximum budget is $2,000, including delivery.";
const CHIPS = ["Restock our kitchen supplies", "Find the best supplier for office equipment", "Compare prices for packaging materials", "Find alternative suppliers for our current vendor"];

export default function NewProcurementPage() {
  const { mode, business } = useApp();
  const router = useRouter();
  const { show } = useToast();
  const create = useCreateRequest();
  const sourcing = useStartSourcing();

  const [busy, setBusy] = useState<null | "creating" | "sourcing">(null);
  const [prompt, setPrompt] = useState(mode === "demo" ? EXAMPLE : "");
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [location, setLocation] = useState("");
  const [deadline, setDeadline] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState(business.defaultCurrency);
  const [priority, setPriority] = useState<NewRequestInput["priority"]>("price");
  const [includeDelivery, setIncludeDelivery] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function run(input: NewRequestInput) {
    try {
      setBusy("creating");
      const request = await create.mutateAsync(input);
      setBusy("sourcing");
      await Promise.all([sourcing.mutateAsync(request.id), new Promise((r) => setTimeout(r, 1500))]);
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
        <div className="ap-orb live"><Icon name="spark" /></div>
        <h2>{busy === "creating" ? "Saving your request" : "Sourcing suppliers"}</h2>
        <p className="mut">{busy === "creating" ? "Recording the request and its line items." : "Finding suppliers, collecting quotes and checking their evidence."}</p>
        <div className="src-steps">
          {["Request saved", "Searching supplier sources", "Collecting and checking quotations"].map((s, i) => (
            <div key={s} className="src-step" style={{ animationDelay: `${i * 0.4}s` }}>{s}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHead title="New procurement" sub="Describe what you need, or build a structured request. Both create the same request and start the same workflow." />
      <div className="two-col" style={{ alignItems: "start" }}>
        <div className="card" style={{ padding: 22 }} data-tour="ask-card">
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span className="k-ic" style={{ background: "var(--green)", color: "var(--forest)" }}><Icon name="spark" /></span>
            <h2 style={{ fontSize: 16 }}>Ask Procura</h2>
          </div>
          <p className="mut" style={{ fontSize: 13, marginBottom: 14 }}>The fastest way: tell the agent in plain language.</p>
          {mode === "live" ? (
            <div className="callout info" style={{ marginBottom: 14 }}>
              <Icon name="alert" />
              <div>Plain-language requests need SERV Reasoning, which is not connected yet. Use the structured form for now.</div>
            </div>
          ) : (
            <div className="callout info" style={{ marginBottom: 14 }}>
              <Icon name="alert" />
              <div>In this demo, any prompt starts the Northstar Kitchen scenario. Plain-language parsing arrives with SERV Reasoning.</div>
            </div>
          )}
          <textarea className="input" style={{ minHeight: 120, background: "var(--surface-2)" }} aria-label="Describe what your business needs to purchase"
            placeholder="Describe what your business needs to purchase…" value={prompt} disabled={mode === "live"} onChange={(e) => setPrompt(e.target.value)} />
          <div className="prompt-chips">
            {CHIPS.map((c) => <button key={c} type="button" className="prompt-chip" disabled={mode === "live"} onClick={() => setPrompt(c)}>{c}</button>)}
          </div>
          <button className="btn btn-pri btn-lg" style={{ marginTop: 18, width: "100%" }} disabled={mode === "live" || !prompt.trim()} onClick={submitPrompt}>
            <Icon name="bolt" /> Start sourcing
          </button>
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
              <div>Supplier data comes from the demo provider, which covers rice, vegetable oil and frozen chicken. Other products will find no suppliers until live providers are connected.</div>
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
