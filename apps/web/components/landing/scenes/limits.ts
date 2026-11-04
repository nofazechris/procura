import type * as T from "three";
import { AMBER, LIME, RED, type SceneBuilder } from "../three-kit";

export interface LimitsProps {
  /** Each is a fraction left, 0 to 1. */
  time: number;
  budget: number;
  next: number;
  /** A new id each time something happens, so repeating the same kind of event still animates. */
  event: { id: number; kind: "paid" | "blocked" } | null;
}

const SEGMENTS = 72;
const RINGS = [
  { r: 1.55, color: 0x6f8f78, key: "time" as const },
  { r: 2.1, color: LIME, key: "budget" as const },
  { r: 2.65, color: AMBER, key: "next" as const },
];

export const build: SceneBuilder<LimitsProps> = (kit, initial) => {
  const { THREE, scene, camera } = kit;
  scene.add(new THREE.HemisphereLight(0x9ab5a4, 0x050806, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(3, 6, 5); scene.add(key);

  const group = new THREE.Group(); scene.add(group);
  const seg = kit.own(new THREE.BoxGeometry(0.2, 0.09, 0.075));
  const dummy = new THREE.Object3D();
  const dim = new THREE.Color(0x1a241d);

  const rings = RINGS.map((cfg) => {
    const mat = kit.own(new THREE.MeshBasicMaterial({ toneMapped: false }));
    const mesh = new THREE.InstancedMesh(seg, mat, SEGMENTS);
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * cfg.r, 0, Math.sin(a) * cfg.r); dummy.rotation.set(0, -a, 0); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, dim);
    }
    mesh.instanceMatrix.needsUpdate = true; group.add(mesh);
    return { ...cfg, mesh, shown: initial[cfg.key], lit: new THREE.Color(cfg.color) };
  });
  // a faint track under the rings
  RINGS.forEach((cfg) => {
    const track = new THREE.Mesh(kit.own(new THREE.TorusGeometry(cfg.r, 0.008, 6, 128)), kit.own(new THREE.MeshBasicMaterial({ color: 0x2a3a2f, toneMapped: false })));
    track.rotation.x = Math.PI / 2; group.add(track);
  });

  // the core: an approved key, hovering
  const core = new THREE.Mesh(kit.own(new THREE.SphereGeometry(0.34, 32, 32)), kit.own(new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false })));
  group.add(core);
  const halo = new THREE.Sprite(kit.own(new THREE.SpriteMaterial({
    map: kit.tex(128, 128, (c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, "rgba(183,243,107,0.9)"); g.addColorStop(0.3, "rgba(183,243,107,0.3)"); g.addColorStop(1, "rgba(183,243,107,0)"); c.fillStyle = g; c.fillRect(0, 0, w, h); }),
    transparent: true, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
  })));
  halo.scale.setScalar(2.1); group.add(halo);

  type Particle = { m: T.Mesh; born: number; from: T.Vector3 };
  type Shock = { m: T.Mesh; born: number };
  const particles: Particle[] = [], shocks: Shock[] = [];
  let lastEvent = initial.event?.id ?? 0, target = { ...initial }, flicker = -10, kick = 0, pulse = 0, clock = 0;

  const apply = (p: LimitsProps) => {
    target = p;
    if (p.event && p.event.id !== lastEvent) {
      lastEvent = p.event.id;
      if (p.event.kind === "paid") {
        const a = Math.random() * Math.PI * 2;
        const m = new THREE.Mesh(kit.own(new THREE.SphereGeometry(0.1, 12, 12)), kit.own(new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false })));
        m.position.set(Math.cos(a) * 3.4, 0.4, Math.sin(a) * 3.4); group.add(m);
        particles.push({ m, born: clock, from: m.position.clone() });
      } else {
        const m = new THREE.Mesh(kit.own(new THREE.TorusGeometry(1, 0.03, 8, 96)), kit.own(new THREE.MeshBasicMaterial({ color: RED, transparent: true, toneMapped: false, depthWrite: false })));
        m.rotation.x = Math.PI / 2; group.add(m); shocks.push({ m, born: clock });
        flicker = clock; kick = 1;
      }
    }
  };

  camera.position.set(0, 5.9, 9.8); camera.lookAt(0, -0.15, 0);
  const red = new THREE.Color(RED), tmp = new THREE.Color();

  return {
    set: apply,
    update(t, dt) {
      clock = t;
      const k = 1 - Math.exp(-dt * 4.5);
      const hot = Math.max(0, 1 - (t - flicker) / 0.55);
      rings.forEach((r) => {
        r.shown += (target[r.key] - r.shown) * k;
        const lit = Math.round(r.shown * SEGMENTS);
        for (let i = 0; i < SEGMENTS; i++) {
          if (i < lit) { tmp.copy(r.lit).lerp(red, hot); r.mesh.setColorAt(i, tmp); } else r.mesh.setColorAt(i, dim);
        }
        r.mesh.instanceColor!.needsUpdate = true;
      });
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!, u = Math.min(1, (t - p.born) / 0.7);
        p.m.position.lerpVectors(p.from, new THREE.Vector3(0, 0.1, 0), u * u * (3 - 2 * u));
        if (u >= 1) { group.remove(p.m); particles.splice(i, 1); pulse = 1; }
      }
      for (let i = shocks.length - 1; i >= 0; i--) {
        const s = shocks[i]!, u = (t - s.born) / 0.9;
        s.m.scale.setScalar(0.5 + u * 3.6); (s.m.material as T.MeshBasicMaterial).opacity = Math.max(0, 1 - u);
        if (u >= 1) { group.remove(s.m); shocks.splice(i, 1); }
      }
      pulse = Math.max(0, pulse - dt * 3); kick = Math.max(0, kick - dt * 3);
      core.scale.setScalar(1 + pulse * 0.35 + Math.sin(t * 2.2) * 0.04); halo.scale.setScalar(2.1 + pulse * 1.2);
      (core.material as T.MeshBasicMaterial).color.setHex(hot > 0 ? RED : LIME).lerp(new THREE.Color(LIME), 1 - hot);
      core.position.y = 0.15 + Math.sin(t * 1.6) * 0.06;
      group.rotation.y = t * 0.12 + kit.pointer.x * 0.5;
      group.rotation.x = kit.pointer.y * 0.12 + Math.sin(t * 60) * 0.012 * kick;
    },
  };
};
