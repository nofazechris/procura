import type * as T from "three";
import { buildBasket, type BasketListing, type Strategy } from "@procura/procurement/core";
import { money, multiply, sum } from "@procura/shared";
import { LIME, MONO, roundRect, SANS, type SceneBuilder } from "../three-kit";

export interface FindProps {
  items: { name: string; short: string; quantity: string }[];
  listings: Record<string, BasketListing[]>;
  strategy: Strategy;
}

const wrapText = (c: CanvasRenderingContext2D, text: string, max: number, lines: number) => {
  const words = text.split(" "), out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (c.measureText(`${cur} ${w}`.trim()).width > max && cur) { out.push(cur); cur = w; if (out.length === lines - 1) break; } else cur = `${cur} ${w}`.trim();
  }
  if (out.length < lines && cur) out.push(cur);
  return out.slice(0, lines).map((l, i, a) => (i === a.length - 1 && words.join(" ").length > a.join(" ").length + 1 ? `${l.replace(/\s+\S*$/, "")}...` : l));
};

/** The basket total, exactly, from the chosen listings. */
export function basketTotal(props: FindProps): string {
  const basket = buildBasket(props.strategy, props.listings);
  return sum(props.items.flatMap((i) => (basket[i.name] ? [multiply(money(basket[i.name]!.price, "USD"), i.quantity)] : [])), "USD").amount;
}

export const build: SceneBuilder<FindProps> = (kit, initial) => {
  const { THREE, scene, camera } = kit;
  scene.add(new THREE.HemisphereLight(0x9ab5a4, 0x050806, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(3, 6, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(LIME, 0.7); rim.position.set(-5, 2, -4); scene.add(rim);

  const group = new THREE.Group(); scene.add(group);
  const slabGeo = kit.roundedBox(1.06, 0.74, 0.08, 0.05);
  const glowGeo = kit.own(new THREE.PlaneGeometry(1.26, 0.92));
  const rows = initial.items.map((it, r) => {
    const list = initial.listings[it.name] ?? [];
    const y = (initial.items.length - 1) / 2 * 1.08 - r * 1.08;
    const label = new THREE.Mesh(
      kit.own(new THREE.PlaneGeometry(1.1, 0.3)),
      kit.own(new THREE.MeshBasicMaterial({
        map: kit.tex(256, 70, (c, w, h) => { c.fillStyle = "#b7f36b"; c.font = `600 30px ${MONO}`; c.textBaseline = "middle"; c.fillText(it.short.toUpperCase(), 4, h / 2); }),
        transparent: true, toneMapped: false, depthWrite: false,
      })),
    );
    label.position.set(-3.05, y, 0.05); group.add(label);

    const slabs = list.map((l, k) => {
      const tex = kit.tex(256, 178, (c, w, h) => {
        c.fillStyle = "#0e1510"; roundRect(c, 3, 3, w - 6, h - 6, 14); c.fill(); c.strokeStyle = "#2a3a2f"; c.lineWidth = 3; c.stroke();
        c.fillStyle = "#e9f0e6"; c.font = `500 17px ${SANS}`; c.textBaseline = "alphabetic";
        wrapText(c, l.title, w - 28, 3).forEach((ln, i) => c.fillText(ln, 14, 32 + i * 21));
        c.fillStyle = "#b7f36b"; c.font = `700 34px ${MONO}`; c.fillText(`$${l.price}`, 14, 138);
        c.fillStyle = "#9fb0a3"; c.font = `500 15px ${MONO}`; c.fillText(`${l.rating ?? "-"}*  ${l.reviews?.toLocaleString("en-US") ?? "-"} reviews`, 14, 164);
      });
      const mat = kit.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(0x000000) }));
      const slab = new THREE.Mesh(slabGeo, mat);
      const x = -1.6 + k * 1.34;
      slab.position.set(x, y, 0); group.add(slab);
      const glowMat = kit.own(new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      const glow = new THREE.Mesh(glowGeo, glowMat); glow.position.set(x, y, -0.07); group.add(glow);
      return { l, slab, mat, glow, glowMat, x, y, z: 0, lift: 0, glowA: 0, dim: 1 };
    });
    return { it, slabs };
  });

  // the basket tray the chosen listings sit above
  const trayY = -((initial.items.length - 1) / 2 * 1.08) - 1.3;
  const tray = new THREE.Mesh(kit.roundedBox(5.8, 0.1, 1.2, 0.05), kit.own(new THREE.MeshStandardMaterial({ color: 0x1b231e, metalness: 0.9, roughness: 0.3 })));
  tray.position.set(-0.4, trayY, 0.4); tray.rotation.x = -0.25; group.add(tray);
  const trayEdge = new THREE.Mesh(kit.own(new THREE.BoxGeometry(5.7, 0.02, 0.03)), kit.own(new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false })));
  trayEdge.position.set(-0.4, trayY + 0.07, 0.95); trayEdge.rotation.x = -0.25; group.add(trayEdge);
  const totalMat = kit.own(new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false }));
  const total = new THREE.Mesh(kit.own(new THREE.PlaneGeometry(3.4, 0.62)), totalMat); total.position.set(-0.4, trayY + 0.2, 0.55); total.rotation.x = -0.25; group.add(total);

  const drawTotal = (p: FindProps) => {
    totalMat.map?.dispose();
    const t = Number(basketTotal(p)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    totalMat.map = kit.tex(512, 96, (c, w, h) => {
      c.textBaseline = "middle"; c.fillStyle = "#9fb0a3"; c.font = `500 24px ${MONO}`; c.textAlign = "left"; c.fillText("BASKET", 8, h / 2);
      c.fillStyle = "#ffffff"; c.font = `700 56px ${SANS}`; c.textAlign = "right"; c.fillText(`$${t}`, w - 8, h / 2 + 2);
    });
    totalMat.needsUpdate = true;
  };

  const apply = (p: FindProps) => {
    const basket = buildBasket(p.strategy, p.listings);
    for (const row of rows) for (const s of row.slabs) {
      const chosen = basket[row.it.name]?.id === s.l.id;
      s.lift = chosen ? 0.55 : 0; s.glowA = chosen ? 0.55 : 0; s.dim = chosen ? 1 : 0.5;
    }
    drawTotal(p);
  };
  apply(initial);

  camera.position.set(0.5, 0.5, 10.6); camera.lookAt(0.2, -0.5, 0);

  return {
    set: apply,
    update(t, dt) {
      const k = 1 - Math.exp(-dt * 7);
      for (const row of rows) for (const s of row.slabs) {
        s.z += (s.lift - s.z) * k; s.glowA += ((s.lift ? 0.55 : 0) - s.glowA) * k;
        s.slab.position.z = s.z + Math.sin(t * 1.1 + s.x) * 0.012;
        s.glowMat.opacity = s.glowA * (0.8 + 0.2 * Math.sin(t * 2.4));
        s.glow.position.z = s.z - 0.07;
        const c = 0.5 + 0.5 * (s.lift ? 1 : 0.5) * s.dim;
        s.mat.color.setScalar(c); s.mat.emissive.setHex(s.lift ? 0x1f3a10 : 0x000000);
      }
      group.rotation.y = -0.42 + kit.pointer.x * 0.16 + Math.sin(t * 0.25) * 0.03;
      group.rotation.x = 0.2 - kit.pointer.y * 0.08;
    },
  };
};
