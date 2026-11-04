"use client";

import { useMemo, useState } from "react";
import { buildBasket, STRATEGIES, STRATEGY_LABEL, type Strategy } from "@procura/procurement/core";
import type { LandingData } from "@/lib/landing/data";
import { Scene3D } from "../three-kit";
import { basketTotal, type FindProps } from "../scenes/find";
import { Split } from "./split";

const RULE: Record<Strategy, string> = {
  cheapest: "The lowest price for each item.",
  balanced: "The best-rated listing that costs no more than a quarter above the cheapest.",
  "top-rated": "The highest rating for each item, then the most reviews.",
};

const load = () => import("../scenes/find");

export function FindSection({ data }: { data: LandingData }) {
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const shortOf = useMemo(() => {
    const first = Object.values(data.seed.lines)[0] ?? [];
    return Object.fromEntries(first.map((l) => [l.item, l.short]));
  }, [data]);
  const props = useMemo<FindProps>(() => ({
    items: data.request.items.map((i) => ({ name: i.name, short: shortOf[i.name] ?? i.name, quantity: i.quantity })),
    listings: data.seed.listings, strategy,
  }), [data, shortOf, strategy]);
  const basket = buildBasket(strategy, data.seed.listings);
  const total = Number(basketTotal(props)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Split
      id="find" side="left" kicker="Try it · Find" title="It looks where you cannot."
      caption="Sample listings. Move over the board."
      bg={<Scene3D load={load} props={props} side="left" label="A board of product listings; the chosen ones lift into a basket" />}
    >
      <p className="lx-body">
        The agent searches real listings through Kite Passport and builds baskets by different rules. Searching is free and buys
        nothing. Pick a rule and watch which product it takes for each item.
      </p>
      <div className="lx-seg2" role="group" aria-label="Basket rule">
        {STRATEGIES.map((s) => <button key={s} className={strategy === s ? "on" : ""} aria-pressed={strategy === s} onClick={() => setStrategy(s)}>{STRATEGY_LABEL[s]}</button>)}
      </div>
      <p className="lx-note">{RULE[strategy]}</p>
      <ul className="lx-picks" aria-live="polite">
        {data.request.items.map((i) => {
          const p = basket[i.name];
          return p ? <li key={i.name}><span>{shortOf[i.name]}</span><span className="t">{p.title}</span><b>${p.price}</b></li> : null;
        })}
        <li className="sum"><span>Basket</span><span className="t">before shipping and tax</span><b>${total}</b></li>
      </ul>
    </Split>
  );
}
