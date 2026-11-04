"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LandingData } from "@/lib/landing/data";
import { buildChapters, buildLedger, CHAPTER_EDGES } from "./chapters";
import type { RackScene } from "./rack-scene";
import { SignupPrompt } from "./signup-prompt";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const sm = (t: number) => t * t * (3 - 2 * t);

/**
 * The pinned scroll story. One tall section holds a sticky stage; scroll progress through it
 * drives the 3D rack and fades the chapter copy. Falls back to plain stacked cards when WebGL
 * is unavailable, so the message is never lost.
 */
export function Experience({ data }: { data: LandingData }) {
  const chapters = useMemo(() => buildChapters(data), [data]);
  const ledger = useMemo(() => buildLedger(data), [data]);

  const story = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const copy = useRef<(HTMLDivElement | null)[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [ready, setReady] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const activeRef = useRef(0);

  useEffect(() => {
    const el = story.current, cv = canvas.current;
    if (!el || !cv) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scene: RackScene | null = null;
    let raf = 0;
    let lenis: { raf(t: number): void; destroy(): void } | null = null;
    let cancelled = false;
    let visible = true;
    let cleanupExtra: (() => void) | null = null;
    let mobile = window.innerWidth < 760;

    const onResize = () => {
      mobile = window.innerWidth < 760;
      const r = cv.getBoundingClientRect();
      scene?.resize(r.width, r.height, mobile);
    };
    const onPointer = (e: PointerEvent) => scene?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));

    (async () => {
      try {
        // Canvas text needs the fonts, so wait for them (briefly) before drawing textures.
        await Promise.race([
          Promise.all([document.fonts.load('600 32px "Inter Variable"'), document.fonts.load('600 32px "JetBrains Mono Variable"')]),
          new Promise((r) => setTimeout(r, 1800)),
        ]);
        const { createRackScene } = await import("./rack-scene");
        if (cancelled) return;
        scene = createRackScene(cv, {
          request: { number: data.request.number, lines: data.request.items.map((i) => `${i.quantity} ${i.unit} ${i.name.toLowerCase()}`), budget: `$${Number(data.request.budget).toLocaleString("en-US")}` },
          suppliers: data.suppliers.map((s) => ({ name: s.name, total: s.total, days: s.days, verdict: s.verdict, evidence: { identity: s.evidence.identity, contact: s.evidence.contact, payment: s.evidence.payment } })),
          order: { number: data.order.number, total: data.order.total, fingerprint: data.order.fingerprint },
        }, { reducedMotion: reduced });
        onResize();
        setReady(true);
      } catch {
        if (!cancelled) setFallback(true);
        return;
      }

      if (!reduced) {
        const { default: Lenis } = await import("lenis");
        if (cancelled) return;
        lenis = new Lenis({ duration: 1.1, smoothWheel: true });
      }

      const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { rootMargin: "20% 0px" });
      io.observe(el);
      window.addEventListener("resize", onResize);
      window.addEventListener("pointermove", onPointer, { passive: true });

      const frame = (time: number) => {
        raf = requestAnimationFrame(frame);
        lenis?.raf(time);
        const r = el.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        const p = total > 0 ? clamp(-r.top / total) : 0;
        if (visible) {
          scene?.setProgress(p);
          scene?.render(time);
        }
        // Chapter copy: fade in just after a boundary, out just before the next.
        let idx = 0;
        chapters.forEach((_, i) => {
          const a = CHAPTER_EDGES[i]!, b = CHAPTER_EDGES[i + 1]!;
          const inT = i === 0 ? 1 : sm(seg(p, a, a + 0.035));
          const outT = i === chapters.length - 1 ? 1 : 1 - sm(seg(p, b - 0.03, b));
          const o = Math.min(inT, outT);
          const node = copy.current[i];
          if (node) {
            node.style.opacity = String(o);
            node.style.transform = `translate3d(0, ${(1 - inT) * 26 - (1 - outT) * 18}px, 0)`;
            node.style.pointerEvents = o > 0.6 ? "auto" : "none";
          }
          if (p >= a && p < b) idx = i;
        });
        if (p >= 1) idx = chapters.length - 1;
        if (idx !== activeRef.current) { activeRef.current = idx; setActive(idx); }
        if (bar.current) bar.current.style.transform = `scaleX(${p})`;
        if (hint.current) hint.current.style.opacity = String(1 - seg(p, 0.01, 0.05));
      };
      raf = requestAnimationFrame(frame);
      cleanupExtra = () => { io.disconnect(); window.removeEventListener("resize", onResize); window.removeEventListener("pointermove", onPointer); };
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanupExtra?.();
      lenis?.destroy();
      scene?.dispose();
    };
  }, [data, chapters]);

  if (fallback) return <Fallback chapters={chapters} />;

  return (
    <>
      <section ref={story} className="lx-story" id="story" aria-label="How Procura works, step by step">
        <div className="lx-stage">
          <canvas ref={canvas} className={`lx-canvas ${ready ? "on" : ""}`} aria-hidden="true" />
          <div className="lx-vignette" aria-hidden="true" />

          <div className="lx-ledger" aria-hidden="true">
            <div className="lx-ledger-h">ledger · {data.request.number}</div>
            {ledger.map((l) => (
              <div key={l.label} className={`lx-ledger-row ${active >= l.from ? "on" : ""}`}>
                <span>{l.label}</span><b>{l.value}</b>
              </div>
            ))}
          </div>

          <div className="lx-copy">
            {chapters.map((c, i) => (
              <div key={c.kicker} ref={(n) => { copy.current[i] = n; }} className={`lx-chap ${i === 0 ? "hero" : ""}`} style={{ opacity: i === 0 ? 1 : 0 }}>
                <div className="lx-kicker">{c.kicker}</div>
                {i === 0 ? <h1 className="lx-h">{c.headline}</h1> : <h2 className="lx-h">{c.headline}</h2>}
                <div className="lx-data">{c.data}</div>
                <p className="lx-body">{c.body}</p>
                {i === 0 ? (
                  <div className="lx-cta">
                    <Link href="/signup" className="lx-btn pri">Start free</Link>
                    <button className="lx-btn" onClick={() => setPrompt(true)}>See it run</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="lx-hint" ref={hint}><span className="line" />Scroll to run it</div>
          <div className="lx-progress" aria-hidden="true"><div ref={bar} /></div>
        </div>
      </section>
      <SignupPrompt open={prompt} onClose={() => setPrompt(false)} />
    </>
  );
}

function Fallback({ chapters }: { chapters: ReturnType<typeof buildChapters> }) {
  return (
    <section className="lx-fallback" id="story">
      {chapters.map((c, i) => (
        <div key={c.kicker} className="lx-fb-card">
          <div className="lx-kicker">{c.kicker}</div>
          {i === 0 ? <h1 className="lx-h">{c.headline}</h1> : <h2 className="lx-h">{c.headline}</h2>}
          <div className="lx-data">{c.data}</div>
          <p className="lx-body">{c.body}</p>
          {i === 0 ? <div className="lx-cta"><Link href="/signup" className="lx-btn pri">Start free</Link></div> : null}
        </div>
      ))}
    </section>
  );
}
