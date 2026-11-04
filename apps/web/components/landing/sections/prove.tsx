"use client";

import { useMemo, useState } from "react";
import { evaluateEligibility } from "@procura/procurement/core";
import type { SupplierEvidenceSummary } from "@procura/shared";
import type { LandingData } from "@/lib/landing/data";
import { reasonText } from "@/lib/landing/text";
import type { PlateState, ProveProps } from "./prove-types";
import { ProveVisual } from "./visuals";
import { Split } from "./split";

const DAY = 86_400_000;

export function ProveSection({ data }: { data: LandingData }) {
  const [route, setRoute] = useState<"direct" | "marketplace">("direct");
  const [identity, setIdentity] = useState(true);
  const [contact, setContact] = useState(false);
  const [payout, setPayout] = useState(false);

  const result = useMemo(() => {
    const direct = route === "direct";
    const quote = data.seed.quotes.find((q) => (direct ? q.supplierId === "local-ikeja" : q.supplierId.startsWith("amazon:")))!;
    const evidence: SupplierEvidenceSummary = {
      identityVerified: identity ? true : null, contactVerified: contact ? true : null, quotationReceived: true,
      paymentDestinationMatched: payout ? true : null, historicalPerformanceAvailable: false, unresolvedConcerns: [],
    };
    const e = evaluateEligibility({ ...quote, validUntil: new Date(Date.now() + DAY) }, data.seed.requirement,
      { supplierId: quote.supplierId, restricted: false, evidence, paymentRoute: direct ? "supplier_payout" : "marketplace_checkout" }, new Date());
    const st = (on: boolean): PlateState => (on ? "verified" : "unknown");
    const props: ProveProps = {
      verdict: e.verdict,
      plates: [
        { id: "identity", label: "Business identity", state: st(identity) },
        { id: "quote", label: "Live quote", state: "verified" },
        { id: "contact", label: "Contact details", state: direct ? st(contact) : "na" },
        { id: "payout", label: "Payout address", state: direct ? st(payout) : "na" },
      ],
    };
    return { e, props };
  }, [data, route, identity, contact, payout]);

  const chip = (label: string, on: boolean, set: (v: boolean) => void, disabled = false) => (
    <button className={`lx-chip2 ${on ? "ok" : "unk"}`} disabled={disabled} aria-pressed={on} onClick={() => set(!on)}>{on ? "✓" : "?"} {label}</button>
  );

  return (
    <Split
      id="prove" side="right" kicker="Try it · Prove" title="Evidence, or it does not count."
      visual={<ProveVisual {...result.props} />}
    >
      <p className="lx-body">
        Every option is held to the evidence behind it. Missing proof reads as unknown, never as verified. How a seller is paid
        decides what proof matters: a direct supplier needs a verified contact and payout address, while a marketplace takes
        payment at its own checkout.
      </p>
      <div className="lx-seg2" role="group" aria-label="How the seller is paid">
        <button className={route === "direct" ? "on" : ""} aria-pressed={route === "direct"} onClick={() => setRoute("direct")}>Direct supplier</button>
        <button className={route === "marketplace" ? "on" : ""} aria-pressed={route === "marketplace"} onClick={() => setRoute("marketplace")}>Amazon checkout</button>
      </div>
      <div className="lx-chips2">
        {chip("Identity", identity, setIdentity)}
        {chip("Contact", contact, setContact, route === "marketplace")}
        {chip("Payout address", payout, setPayout, route === "marketplace")}
      </div>
      <div className={`lx-verdict2 ${result.e.verdict}`} aria-live="polite">
        <b>{result.e.verdict === "eligible" ? "Eligible" : result.e.verdict === "review_required" ? "Held for review" : "Not eligible"}</b>
        <span>{result.e.reasons.length ? result.e.reasons.map(reasonText).join(" · ") : "nothing missing"}</span>
      </div>
    </Split>
  );
}
