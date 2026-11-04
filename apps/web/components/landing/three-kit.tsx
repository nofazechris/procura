"use client";

import { useEffect, useRef, useState } from "react";
import type * as ThreeNS from "three";

/**
 * A small harness for the landing page's 3D sections. Each scene is a module that builds its own
 * meshes; this component owns everything around it: loading three only when a scene is near the
 * viewport, sizing, pointer parallax, pausing when off screen, releasing the GPU context when far
 * away, one still frame for reduced motion, and a plain fallback if WebGL is unavailable.
 */

export type ThreeLib = typeof ThreeNS;

export interface Kit {
  THREE: ThreeLib;
  scene: ThreeNS.Scene;
  camera: ThreeNS.PerspectiveCamera;
  renderer: ThreeNS.WebGLRenderer;
  /** Registers something for disposal when the scene unmounts. */
  own<T extends { dispose(): void }>(x: T): T;
  /** A canvas-drawn texture, for labels and card faces. */
  tex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): ThreeNS.CanvasTexture;
  roundedBox(w: number, h: number, d: number, r?: number): ThreeNS.BufferGeometry;
  /** -1..1 within the canvas, eased so motion never jumps. */
  pointer: { x: number; y: number };
  reduced: boolean;
}

export interface SceneHandle<P> {
  /** Called every frame while visible. t is seconds since mount, dt the frame time. */
  update(t: number, dt: number): void;
  /** New props from React. */
  set?(props: P): void;
  resize?(w: number, h: number): void;
  dispose?(): void;
}

export type SceneBuilder<P> = (kit: Kit, props: P) => SceneHandle<P>;
export type SceneLoader<P> = () => Promise<{ build: SceneBuilder<P> }>;

export const MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, Consolas, monospace';
export const SANS = '"Inter Variable", system-ui, sans-serif';
export const LIME = 0xb7f36b;
export const AMBER = 0xe0a94b;
export const RED = 0xef7f78;

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

/**
 * side: which part of the (wide, full-section) canvas the scene should sit in, so it can fill one half of
 * a section while the other half holds the words. On narrow screens it is centred.
 */
export function Scene3D<P>({ load, props, label, className = "", side = "center" }: {
  load: SceneLoader<P>; props: P; label: string; className?: string; side?: "left" | "right" | "center";
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<SceneHandle<P> | null>(null);
  const redraw = useRef<(() => void) | null>(null);
  const latest = useRef(props);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  latest.current = props;

  useEffect(() => {
    const host = wrap.current, cv = canvas.current;
    if (!host || !cv) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let mounted: { dispose(): void } | null = null;
    let near = false, visible = false, starting = false, cancelled = false;

    async function mount() {
      if (mounted || starting || cancelled || !cv || !host) return;
      starting = true;
      try {
        const THREE = await import("three");
        const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
        const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
        const mod = await load();
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
        if (cancelled || !near) { starting = false; return; }

        const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
        renderer.setClearColor(0x000000, 0);
        const scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = env; scene.environmentIntensity = 0.55;
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
        const owned: { dispose(): void }[] = [env, pmrem];
        const kit: Kit = {
          THREE, scene, camera, renderer, reduced, pointer: { x: 0, y: 0 },
          own: (x) => { owned.push(x); return x; },
          tex: (w, h, draw) => {
            const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!, w, h);
            const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; owned.push(t); return t;
          },
          roundedBox: (w, h, d, r = 0.06) => { const g = new RoundedBoxGeometry(w, h, d, 4, r); owned.push(g); return g; },
        };
        const h = mod.build(kit, latest.current);
        handle.current = h;

        let target = { x: 0, y: 0 };
        const onMove = (e: PointerEvent) => {
          const r = host.getBoundingClientRect();
          target = { x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), y: Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1))) };
        };
        const onLeave = () => { target = { x: 0, y: 0 }; };
        // The scene sits behind the words, so follow the cursor anywhere in its section.
        const area: HTMLElement = host.closest("section") ?? host;
        area.addEventListener("pointermove", onMove, { passive: true });
        area.addEventListener("pointerleave", onLeave);

        const resize = () => {
          const r = host.getBoundingClientRect();
          const w = Math.max(1, r.width), hh = Math.max(1, r.height);
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
          renderer.setSize(w, hh, false);
          camera.aspect = w / hh;
          const wide = w >= 960 && side !== "center";
          // As a background the scene is smaller than the section and sits on the open side, clear of the words.
          camera.zoom = wide ? 0.62 : 1;
          if (wide) camera.setViewOffset(w, hh, side === "left" ? w * 0.21 : -w * 0.21, 0, w, hh); else camera.clearViewOffset();
          camera.updateProjectionMatrix();
          h.resize?.(w, hh);
        };
        const ro = new ResizeObserver(resize); ro.observe(host); resize();

        let raf = 0, last = performance.now(), t0 = last;
        const frame = (now: number) => {
          raf = requestAnimationFrame(frame);
          if (!visible) return;
          const dt = Math.min(0.1, (now - last) / 1000); last = now;
          kit.pointer.x += (target.x - kit.pointer.x) * 0.08; kit.pointer.y += (target.y - kit.pointer.y) * 0.08;
          h.update((now - t0) / 1000, dt);
          renderer.render(scene, camera);
        };
        redraw.current = () => { h.update(4, 0.016); renderer.render(scene, camera); };
        if (reduced) redraw.current();
        else raf = requestAnimationFrame(frame);
        setReady(true);

        mounted = {
          dispose() {
            cancelAnimationFrame(raf); ro.disconnect();
            area.removeEventListener("pointermove", onMove); area.removeEventListener("pointerleave", onLeave);
            h.dispose?.(); handle.current = null; redraw.current = null;
            scene.traverse((o) => { const m = o as ThreeNS.Mesh; m.geometry?.dispose?.(); const mat = m.material as ThreeNS.Material | ThreeNS.Material[] | undefined; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose(); });
            owned.forEach((o) => o.dispose());
            renderer.dispose(); renderer.forceContextLoss();
            setReady(false);
          },
        };
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        starting = false;
      }
    }

    // Build a screen early, drop the GPU context when far away; draw only while actually visible.
    const near$ = new IntersectionObserver(([e]) => {
      near = !!e?.isIntersecting;
      if (near) void mount(); else if (mounted) { mounted.dispose(); mounted = null; }
    }, { rootMargin: "90% 0px" });
    const vis$ = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    near$.observe(host); vis$.observe(host);

    return () => { cancelled = true; near$.disconnect(); vis$.disconnect(); mounted?.dispose(); mounted = null; };
    // The loader is stable per section; props flow through the ref below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.set?.(props);
    // Reduced motion draws no frames, so a change needs one explicit update.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) redraw.current?.();
  }, [props]);

  return (
    <div ref={wrap} className={`lx3 ${ready ? "on" : ""} ${className}`} role="img" aria-label={label}>
      <canvas ref={canvas} />
      {failed ? <div className="lx3-fallback">{label}</div> : null}
    </div>
  );
}
