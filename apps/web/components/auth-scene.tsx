"use client";

import { useEffect, useRef, useState } from "react";
import type { SceneData } from "@/components/landing/rack-scene";

/**
 * The animated side of the sign-in and sign-up screens: a looping sample run of the agent. A packet
 * travels down six stages while each one lights up and plays its little scene. It is an illustration
 * (the caption says so), and it stops when off screen, draws one still frame for reduced motion,
 * and costs one canvas with no libraries.
 */

const LIME = "183,243,107";
const AMBER = "224,169,75";
const LOOP = 17;
/** When the packet arrives at each stage, in seconds. */
const ARRIVE = [0.8, 3.2, 5.6, 8.0, 10.4, 12.8];
/** How long it rests at a stage before moving on. */
const DWELL = 1.5;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, Consolas, monospace';
const SANS = '"Inter Variable", system-ui, sans-serif';

interface Stage { label: string; value: string }
const STAGES: Stage[] = [
  { label: "REQUEST", value: "50 bags rice · budget $2,000" },
  { label: "SOURCE", value: "3 suppliers · 3 quotes" },
  { label: "PROVE", value: "2 verified · 1 held for review" },
  { label: "COMPARE", value: "$1,630 recommended" },
  { label: "YOU APPROVE", value: "passkey approved" },
  { label: "PAY", value: "paid inside your approved limit" },
];

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

interface Layout { w: number; h: number; cx: number; cw: number; ch: number; y0: number; gap: number }

function layout(w: number, h: number): Layout {
  const cw = Math.min(360, w - 80), ch = 60;
  // Leave room for the headline above and the caption below; use spare height to breathe, not to stretch.
  const gap = Math.max(ch + 6, Math.min(82, (h - 350 - 90) / (STAGES.length - 1)));
  const y0 = Math.max(350, h - (STAGES.length - 1) * gap - 96);
  return { w, h, cx: w / 2, cw, ch, y0, gap };
}

const nodeY = (L: Layout, i: number) => L.y0 + i * L.gap;

/** Where the packet is at time t: it enters, rests on each stage, then glides to the next. */
function packetY(L: Layout, t: number): number {
  if (t < ARRIVE[0]!) return nodeY(L, 0) - 90 + 90 * ease(clamp(t / ARRIVE[0]!));
  for (let i = 0; i < STAGES.length - 1; i++) {
    const leave = ARRIVE[i]! + DWELL, next = ARRIVE[i + 1]!;
    if (t < leave) return nodeY(L, i);
    if (t < next) return nodeY(L, i) + (nodeY(L, i + 1) - nodeY(L, i)) * ease((t - leave) / (next - leave));
  }
  return nodeY(L, STAGES.length - 1);
}

function typed(text: string, since: number, cps = 30): string {
  return text.slice(0, Math.max(0, Math.floor(since * cps)));
}

function drawStage(c: CanvasRenderingContext2D, L: Layout, i: number, t: number) {
  const x = L.cx - L.cw / 2, y = nodeY(L, i) - L.ch / 2;
  const since = t - ARRIVE[i]!;
  const on = clamp(since / 0.5);
  const hot = since >= 0 ? Math.max(0, 1 - since / 2.4) : 0;

  // card
  c.save();
  c.shadowColor = `rgba(${LIME},${0.35 * hot})`; c.shadowBlur = 26 * hot;
  rr(c, x, y, L.cw, L.ch, 14);
  c.fillStyle = `rgba(255,255,255,${0.04 + 0.04 * on})`; c.fill();
  c.restore();
  rr(c, x, y, L.cw, L.ch, 14);
  c.strokeStyle = on > 0 ? `rgba(${LIME},${0.22 + 0.5 * on})` : "rgba(255,255,255,0.1)";
  c.lineWidth = 1; c.stroke();

  // status dot
  c.beginPath(); c.arc(x + 20, y + L.ch / 2, 4.5, 0, 6.283);
  c.fillStyle = on > 0 ? `rgba(${LIME},1)` : "rgba(255,255,255,0.18)"; c.fill();

  // label and typed value
  c.textBaseline = "middle"; c.textAlign = "left";
  c.font = `600 10.5px ${MONO}`; c.fillStyle = `rgba(255,255,255,${0.45 + 0.4 * on})`;
  c.fillText(STAGES[i]!.label, x + 36, y + 21);
  let value = STAGES[i]!.value;
  let valueColor = `rgba(233,240,230,${0.35 + 0.65 * on})`;
  if (i === 4) {
    // Waiting for the person, then approved: the one human step in the run.
    const waiting = since < 1.1;
    value = waiting ? "waiting for your passkey" : "passkey approved";
    valueColor = waiting ? `rgba(${AMBER},${0.5 + 0.5 * on})` : `rgba(${LIME},1)`;
  }
  c.font = `500 13px ${SANS}`; c.fillStyle = valueColor;
  c.fillText(since < 0 ? "" : i === 4 ? value : typed(value, since - 0.1), x + 36, y + 41);

  // a small scene at the right edge of each card
  const rx = x + L.cw - 78, cy = y + L.ch / 2;
  if (i === 1 && since >= 0) {
    for (let k = 0; k < 3; k++) {
      const a = clamp((since - 0.3 - k * 0.25) / 0.3);
      rr(c, rx + k * 22, cy - 8, 16, 16, 4);
      c.fillStyle = `rgba(${LIME},${0.15 + 0.5 * a})`; c.fill();
    }
  }
  if (i === 2 && since >= 0) {
    for (let k = 0; k < 3; k++) {
      const a = clamp((since - 0.4 - k * 0.45) / 0.25);
      c.beginPath(); c.arc(rx + 8 + k * 24, cy, 7, 0, 6.283);
      if (k < 2) { c.fillStyle = `rgba(${LIME},${0.9 * a})`; c.fill(); c.strokeStyle = `rgba(${LIME},${0.3 + 0.5 * a})`; }
      else { c.strokeStyle = `rgba(${AMBER},${0.3 + 0.7 * a})`; }
      c.lineWidth = 1.6; c.stroke();
      if (a > 0.6 && k < 2) {
        c.strokeStyle = "#0a1208"; c.lineWidth = 1.8; c.beginPath();
        c.moveTo(rx + 4 + k * 24, cy); c.lineTo(rx + 7 + k * 24, cy + 3); c.lineTo(rx + 12 + k * 24, cy - 3); c.stroke();
      }
    }
  }
  if (i === 3 && since >= 0) {
    const bars = [0.8, 1, 0.9];
    for (let k = 0; k < 3; k++) {
      const grow = ease(clamp((since - 0.3 - k * 0.2) / 0.5));
      const bh = 26 * bars[k]! * grow;
      c.fillStyle = k === 0 ? `rgba(${LIME},0.95)` : "rgba(255,255,255,0.22)";
      rr(c, rx + k * 22, cy + 13 - bh, 14, Math.max(0.1, bh), 3); c.fill();
    }
  }
  if (i === 4 && since >= 0) {
    // the key turns once approved
    const turn = ease(clamp((since - 1.1) / 0.5));
    c.save(); c.translate(rx + 30, cy); c.rotate(turn * Math.PI / 2);
    c.strokeStyle = since < 1.1 ? `rgba(${AMBER},0.9)` : `rgba(${LIME},1)`; c.lineWidth = 2;
    c.beginPath(); c.arc(-8, 0, 6, 0, 6.283); c.moveTo(-2, 0); c.lineTo(14, 0); c.moveTo(10, 0); c.lineTo(10, 5); c.stroke();
    c.restore();
  }
  if (i === 5 && since >= 0) {
    // a padlock that closes: the spending cap
    const close = ease(clamp((since - 0.3) / 0.5));
    const px = rx + 26, py = cy + 4;
    c.strokeStyle = `rgba(${LIME},1)`; c.lineWidth = 2;
    c.beginPath(); c.arc(px, py - 8 - (1 - close) * 5, 7, Math.PI, 0); c.stroke();
    rr(c, px - 10, py - 6, 20, 15, 4); c.fillStyle = `rgba(${LIME},${0.25 + 0.65 * close})`; c.fill();
  }
}

function draw(c: CanvasRenderingContext2D, L: Layout, tRaw: number) {
  const t = tRaw % LOOP;
  c.clearRect(0, 0, L.w, L.h);
  const fade = t < 0.5 ? t / 0.5 : t > LOOP - 1 ? Math.max(0, LOOP - t) : 1;
  c.globalAlpha = fade;

  const py = packetY(L, t);

  // connectors: faint track, lime where the packet has been, dashes flowing down
  for (let i = 0; i < STAGES.length - 1; i++) {
    const ya = nodeY(L, i) + L.ch / 2, yb = nodeY(L, i + 1) - L.ch / 2;
    c.strokeStyle = "rgba(255,255,255,0.1)"; c.lineWidth = 1; c.setLineDash([3, 5]);
    c.lineDashOffset = -tRaw * 14;
    c.beginPath(); c.moveTo(L.cx, ya); c.lineTo(L.cx, yb); c.stroke();
    const reach = clamp((py - ya) / (yb - ya));
    if (reach > 0) {
      c.setLineDash([]); c.strokeStyle = `rgba(${LIME},0.75)`; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(L.cx, ya); c.lineTo(L.cx, ya + (yb - ya) * reach); c.stroke();
    }
  }
  c.setLineDash([]);

  for (let i = 0; i < STAGES.length; i++) drawStage(c, L, i, t);

  // the packet and its glow
  const g = c.createRadialGradient(L.cx, py, 0, L.cx, py, 70);
  g.addColorStop(0, `rgba(${LIME},0.42)`); g.addColorStop(1, `rgba(${LIME},0)`);
  c.fillStyle = g; c.fillRect(L.cx - 70, py - 70, 140, 140);
  c.beginPath(); c.arc(L.cx, py, 6, 0, 6.283); c.fillStyle = `rgb(${LIME})`; c.fill();

  // after payment: the run is done, inside the cap
  const end = t - (ARRIVE[5]! + 1.6);
  if (end > 0) {
    const a = ease(clamp(end / 0.6));
    c.globalAlpha = fade * a;
    c.textAlign = "center"; c.font = `600 11px ${MONO}`; c.fillStyle = `rgba(${LIME},1)`;
    c.fillText("WITHIN THE CAP  ·  RECORDED", L.cx, nodeY(L, 5) + L.ch / 2 + 22);
  }
  c.globalAlpha = 1;
}

/** Slow drifting points behind everything, for depth. Cheap: a handful of arcs. */
function drawDust(c: CanvasRenderingContext2D, w: number, h: number, t: number) {
  for (let i = 0; i < 46; i++) {
    const seed = i * 97.13;
    const x = ((Math.sin(seed) * 0.5 + 0.5) * w + Math.sin(t * 0.15 + seed) * 10) % w;
    const y = (((Math.cos(seed * 1.7) * 0.5 + 0.5) * h - t * (4 + (i % 5) * 2)) % h + h) % h;
    c.beginPath(); c.arc(x, y, 0.6 + (i % 3) * 0.5, 0, 6.283);
    c.fillStyle = `rgba(${LIME},${0.05 + (i % 4) * 0.035})`; c.fill();
  }
}

function AuthScene2D() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = wrap.current, cv = canvas.current;
    if (!host || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let L = layout(1, 1), raf = 0, visible = true, start = 0;

    const resize = () => {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(1, Math.floor(r.width * dpr)); cv.height = Math.max(1, Math.floor(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      L = layout(r.width, r.height);
      if (reduced) paint(ARRIVE[5]! + 3);
    };
    const paint = (t: number) => { ctx.clearRect(0, 0, L.w, L.h); drawDust(ctx, L.w, L.h, t); draw(ctx, L, t); };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      if (!start) start = now;
      const t = (now - start) / 1000;
      paint(t);
    };

    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    io.observe(host);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    // Fonts for the canvas text, then start. Reduced motion gets a single finished frame.
    void Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => {
      if (reduced) { paint(ARRIVE[5]! + 3); return; }
      raf = requestAnimationFrame(frame);
    });
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); };
  }, []);

  return (
    <div ref={wrap} className="auth-scene" aria-hidden="true">
      <canvas ref={canvas} />
      <div className="auth-cap">Illustration · sample data</div>
    </div>
  );
}

const LOOP_SECONDS = 34;

/**
 * The sign-in and sign-up backdrop: the same 3D rack as the landing story, on a slow wide shot that
 * plays the whole purchase on a loop. Falls back to the flat illustration without WebGL.
 */
export function AuthScene({ scene: data, progress, caption = "Illustration · sample data" }: { scene: SceneData; progress?: number; caption?: string }) {
  // When a progress is given the shot is driven by it (the onboarding steps) instead of looping.
  const driven = useRef<number | undefined>(progress);
  driven.current = progress;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = wrap.current, cv = canvas.current;
    if (!host || !cv) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false, raf = 0, visible = true, dispose: (() => void) | null = null;

    (async () => {
      try {
        await Promise.race([
          Promise.all([document.fonts.load('600 32px "Inter Variable"'), document.fonts.load('600 32px "JetBrains Mono Variable"')]),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
        const { createRackScene } = await import("@/components/landing/rack-scene");
        if (cancelled) return;
        const rack = createRackScene(cv, data, { reducedMotion: reduced, overview: true, offsetFactor: 0 });
        const size = () => { const r = host.getBoundingClientRect(); rack.resize(r.width, r.height, false); };
        const ro = new ResizeObserver(size); ro.observe(host); size();
        const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }); io.observe(host);

        if (reduced) { rack.jump(0.58); rack.render(0); }
        else {
          let t0 = 0, lastCycle = 0;
          const frame = (now: number) => {
            raf = requestAnimationFrame(frame);
            if (!visible) return;
            if (driven.current !== undefined) { cv.style.opacity = "1"; rack.setProgress(driven.current); rack.render(now); return; }
            if (!t0) t0 = now;
            const u = (now - t0) / 1000 / LOOP_SECONDS, cycle = Math.floor(u), p = u - cycle;
            if (cycle !== lastCycle) { rack.jump(0); lastCycle = cycle; }
            // Fade out at the end of each run and back in at the start, so the restart is never seen.
            cv.style.opacity = String(p < 0.02 ? p / 0.02 : p > 0.97 ? Math.max(0, (1 - p) / 0.03) : 1);
            rack.setProgress(p);
            rack.render(now);
          };
          raf = requestAnimationFrame(frame);
        }
        dispose = () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); rack.dispose(); };
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => { cancelled = true; dispose?.(); };
  }, [data]);

  if (failed) return <AuthScene2D />;
  return (
    <div ref={wrap} className="auth-scene" aria-hidden="true">
      <canvas ref={canvas} />
      <div className="auth-cap">{caption}</div>
    </div>
  );
}
