import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * The agent rack: six modules joined edge to edge, with a request packet that travels through
 * them. One number (scroll progress, 0 to 1) drives everything, so the page can be scrubbed
 * forwards and backwards. All geometry is procedural; there are no model or texture files.
 */

export interface SceneSupplier {
  name: string;
  total: string;
  days: number | null;
  verdict: "eligible" | "review_required" | "ineligible";
  evidence: { identity: boolean | null; contact: boolean | null; payment: boolean | null };
}

export interface SceneData {
  request: { number: string; lines: string[]; budget: string };
  /** In rank order: the recommended supplier first. */
  suppliers: SceneSupplier[];
  order: { number: string; total: string; fingerprint: string };
}

export interface RackScene {
  setProgress(p: number): void;
  setPointer(nx: number, ny: number): void;
  resize(w: number, h: number, mobile: boolean): void;
  render(timeMs: number): void;
  dispose(): void;
}

const LIME = 0xb7f36b;
const AMBER = 0xe0a94b;
const MODULES = ["ORCHESTRATOR", "SOURCING", "EVIDENCE", "COMPARE", "PURCHASE ORDER", "PAYMENT"];

const W = 2.2, D = 1.7, H = 0.8, STEP = 2.24;
const mx = (i: number) => (i - 2.5) * STEP;
const GATE_X = (mx(4) + mx(5)) / 2;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const sm = (t: number) => t * t * (3 - 2 * t);
const ss = (p: number, a: number, b: number) => sm(seg(p, a, b));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Key { p: number; pos: [number, number, number]; look: [number, number, number] }
const CAMERA: Key[] = [
  { p: 0.0, pos: [-1.2, 3.4, 12.6], look: [0, 0.2, 0] },
  { p: 0.09, pos: [-7.4, 2.5, 7.2], look: [-5.4, 0.6, 0] },
  { p: 0.16, pos: [-7.0, 2.2, 6.0], look: [-5.4, 0.7, 0] },
  { p: 0.26, pos: [-5.0, 2.6, 6.8], look: [-3.2, 0.9, 0] },
  { p: 0.42, pos: [-2.6, 2.7, 6.9], look: [-1.0, 0.9, 0] },
  { p: 0.56, pos: [0.0, 2.9, 6.9], look: [1.3, 0.9, 0] },
  { p: 0.71, pos: [2.0, 4.1, 5.6], look: [3.4, 0.4, 0] },
  { p: 0.84, pos: [2.8, 2.3, 6.2], look: [4.6, 0.9, 0] },
  { p: 0.94, pos: [4.4, 2.6, 6.4], look: [5.6, 0.6, 0] },
  { p: 1.0, pos: [1.8, 5.4, 16.8], look: [1.8, 1.3, 0] },
];

/** Where the packet is at each progress, x only. It waits inside each module's chapter. */
const PACKET: [number, number][] = [
  [0, -7.4], [0.1, -7.4], [0.16, mx(0)], [0.22, mx(0)], [0.28, mx(1)], [0.36, mx(1)], [0.41, mx(2)], [0.5, mx(2)],
  [0.55, mx(3)], [0.64, mx(3)], [0.69, mx(4)], [0.78, mx(4)], [0.82, GATE_X - 0.55], [0.91, GATE_X - 0.55], [0.95, mx(5)], [1, mx(5)],
];

function piecewise(table: [number, number][], p: number): number {
  for (let i = 0; i < table.length - 1; i++) {
    const [a, av] = table[i]!, [b, bv] = table[i + 1]!;
    if (p <= b) return lerp(av, bv, sm(seg(p, a, b)));
  }
  return table[table.length - 1]![1];
}

/* ---------- canvas textures ---------- */

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';
const SANS = '"Inter Variable", system-ui, sans-serif';

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

const labelTex = (text: string) => canvasTex(512, 96, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  c.fillStyle = "#ffffff"; c.font = `600 40px ${MONO}`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(text, w / 2, h / 2 + 2);
});

const cardTex = (s: SceneSupplier) => canvasTex(560, 380, (c, w, h) => {
  c.fillStyle = "#0e1510"; roundRect(c, 4, 4, w - 8, h - 8, 26); c.fill();
  c.strokeStyle = "#2a3a2f"; c.lineWidth = 3; c.stroke();
  c.fillStyle = "#9fb0a3"; c.font = `500 22px ${MONO}`; c.textAlign = "left"; c.fillText("QUOTE", 36, 56);
  c.fillStyle = "#e9f0e6"; c.font = `600 34px ${SANS}`; c.fillText(s.name, 36, 108);
  c.fillStyle = "#9fb0a3"; c.font = `500 20px ${MONO}`; c.fillText("TOTAL DELIVERED", 36, 170);
  c.fillStyle = "#ffffff"; c.font = `700 72px ${SANS}`; c.fillText(`$${Number(s.total).toLocaleString("en-US", { minimumFractionDigits: 0 })}`, 36, 246);
  c.fillStyle = "#9fb0a3"; c.font = `500 22px ${MONO}`;
  c.fillText(s.days ? `${s.days} days` : "delivery not stated", 36, 292);
  c.fillStyle = "#5d6b60"; c.font = `500 15px ${MONO}`;
  c.textAlign = "center";
  c.fillText("ID", 93, 366); c.fillText("CONTACT", 280, 366); c.fillText("PAYMENT", 467, 366);
});

const chipTex = (kind: "pending" | "ok" | "unknown") => canvasTex(128, 128, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  c.lineWidth = 8;
  if (kind === "pending") { c.strokeStyle = "#3a4a3f"; c.beginPath(); c.arc(cx, cy, 44, 0, 6.283); c.stroke(); }
  if (kind === "ok") {
    c.fillStyle = "#b7f36b"; c.beginPath(); c.arc(cx, cy, 48, 0, 6.283); c.fill();
    c.strokeStyle = "#0a0f0b"; c.lineWidth = 11; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(cx - 20, cy + 2); c.lineTo(cx - 5, cy + 18); c.lineTo(cx + 22, cy - 16); c.stroke();
  }
  if (kind === "unknown") {
    c.strokeStyle = "#e0a94b"; c.beginPath(); c.arc(cx, cy, 44, 0, 6.283); c.stroke();
    c.fillStyle = "#e0a94b"; c.font = `700 56px ${SANS}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("?", cx, cy + 4);
  }
});

const requestTex = (d: SceneData["request"]) => canvasTex(560, 340, (c, w, h) => {
  c.fillStyle = "#0e1510"; roundRect(c, 4, 4, w - 8, h - 8, 26); c.fill(); c.strokeStyle = "#b7f36b"; c.lineWidth = 3; c.stroke();
  c.fillStyle = "#b7f36b"; c.font = `600 22px ${MONO}`; c.textAlign = "left"; c.fillText(`REQUEST ${d.number}`, 34, 54);
  c.fillStyle = "#e9f0e6"; c.font = `500 28px ${SANS}`;
  d.lines.forEach((l, i) => c.fillText(l, 34, 112 + i * 44));
  c.fillStyle = "#9fb0a3"; c.font = `500 22px ${MONO}`; c.fillText(`budget ${d.budget}`, 34, h - 36);
});

const poTex = (d: SceneData["order"]) => canvasTex(560, 380, (c, w, h) => {
  c.fillStyle = "#111a14"; roundRect(c, 4, 4, w - 8, h - 8, 26); c.fill(); c.strokeStyle = "#b7f36b"; c.lineWidth = 3; c.stroke();
  c.fillStyle = "#b7f36b"; c.font = `600 22px ${MONO}`; c.textAlign = "left"; c.fillText("PURCHASE ORDER", 34, 54);
  c.fillStyle = "#ffffff"; c.font = `700 56px ${SANS}`; c.fillText(d.number, 34, 126);
  c.fillStyle = "#9fb0a3"; c.font = `500 20px ${MONO}`; c.fillText("TOTAL", 34, 192);
  c.fillStyle = "#e9f0e6"; c.font = `700 52px ${SANS}`; c.fillText(`$${Number(d.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, 34, 250);
  c.fillStyle = "#9fb0a3"; c.font = `500 18px ${MONO}`; c.fillText("FINGERPRINT", 34, 312);
  c.fillStyle = "#b7f36b"; c.font = `600 22px ${MONO}`; c.fillText(`${d.fingerprint.slice(0, 20)}…`, 34, 346);
});

const haloTex = () => canvasTex(128, 128, (c, w, h) => {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(183,243,107,1)"); g.addColorStop(0.25, "rgba(183,243,107,0.45)"); g.addColorStop(1, "rgba(183,243,107,0)");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});

const shadowTex = () => canvasTex(128, 128, (c, w, h) => {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(0,0,0,0.65)"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});

/* ---------- the scene ---------- */

export function createRackScene(canvas: HTMLCanvasElement, data: SceneData, opts: { reducedMotion: boolean }): RackScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x050806, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050806, 15, 36);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0x9ab5a4, 0x050806, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(4, 8, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb7f36b, 0.6); rim.position.set(-6, 3, -5); scene.add(rim);

  const disposables: { dispose(): void }[] = [envTex, pmrem];
  const own = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };

  const metal = (color: number, rough = 0.3) =>
    own(new THREE.MeshPhysicalMaterial({ color, metalness: 0.92, roughness: rough, clearcoat: 0.35, clearcoatRoughness: 0.4 }));

  /* floor */
  const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(80, 80)), own(new THREE.MeshStandardMaterial({ color: 0x070b08, roughness: 0.42, metalness: 0.5, envMapIntensity: 0.3 })));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -H / 2 - 0.002; scene.add(floor);
  const shadowMat = own(new THREE.MeshBasicMaterial({ map: own(shadowTex()), transparent: true, depthWrite: false }));

  /* modules */
  const modGeo = own(new RoundedBoxGeometry(W, H, D, 4, 0.07));
  const modMat = metal(0x1b231e, 0.28);
  const stripGeo = own(new THREE.BoxGeometry(W * 0.94, 0.022, 0.034));
  const labelGeo = own(new THREE.PlaneGeometry(W * 0.82, W * 0.82 * (96 / 512)));
  const modules = MODULES.map((name, i) => {
    const g = new THREE.Group(); g.position.x = mx(i);
    g.add(new THREE.Mesh(modGeo, modMat));
    const stripMat = own(new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.15, toneMapped: false }));
    const strip = new THREE.Mesh(stripGeo, stripMat); strip.position.set(0, H / 2 + 0.003, D / 2 - 0.05); g.add(strip);
    const labelMat = own(new THREE.MeshBasicMaterial({ map: own(labelTex(name)), transparent: true, opacity: 0.4, color: 0x8da092, depthWrite: false, toneMapped: false }));
    const label = new THREE.Mesh(labelGeo, labelMat); label.rotation.x = -Math.PI / 2; label.position.set(0, H / 2 + 0.004, 0.3); g.add(label);
    const sh = new THREE.Mesh(own(new THREE.PlaneGeometry(W * 1.5, D * 1.5)), shadowMat); sh.rotation.x = -Math.PI / 2; sh.position.y = -H / 2 + 0.001; g.add(sh);
    scene.add(g);
    return { g, stripMat, labelMat };
  });

  /* packet */
  const packet = new THREE.Group();
  const core = new THREE.Mesh(own(new THREE.SphereGeometry(0.11, 24, 24)), own(new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false })));
  const halo = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: own(haloTex()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
  halo.scale.setScalar(1.1);
  const packetLight = new THREE.PointLight(LIME, 5, 4.5, 1.6);
  packet.add(core, halo, packetLight); scene.add(packet);

  /* request card (folds into the packet) */
  const reqMat = own(new THREE.MeshBasicMaterial({ map: own(requestTex(data.request)), transparent: true, side: THREE.DoubleSide, toneMapped: false }));
  const reqCard = new THREE.Mesh(own(new THREE.PlaneGeometry(1.9, 1.9 * (340 / 560))), reqMat); scene.add(reqCard);

  /* supplier cards */
  const cardGeo = own(new THREE.PlaneGeometry(1.5, 1.5 * (380 / 560)));
  const glowGeo = own(new THREE.PlaneGeometry(1.62, 1.62 * (380 / 560) + 0.12));
  const chipGeo = own(new THREE.PlaneGeometry(0.2, 0.2));
  const chipTexs = { pending: own(chipTex("pending")), ok: own(chipTex("ok")), unknown: own(chipTex("unknown")) };
  const cards = data.suppliers.map((s, k) => {
    const g = new THREE.Group();
    const faceMat = own(new THREE.MeshBasicMaterial({ map: own(cardTex(s)), transparent: true, toneMapped: false }));
    const face = new THREE.Mesh(cardGeo, faceMat);
    const glowMat = own(new THREE.MeshBasicMaterial({ color: s.verdict === "eligible" ? LIME : AMBER, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    const glow = new THREE.Mesh(glowGeo, glowMat); glow.position.z = -0.01;
    // Explicit order: transparent sorting is by object origin, which puts lower chips behind the face.
    glow.renderOrder = 10; face.renderOrder = 11;
    g.add(glow, face);
    const states = [s.evidence.identity, s.evidence.contact, s.evidence.payment];
    const chips = states.map((st, j) => {
      const m = own(new THREE.MeshBasicMaterial({ map: chipTexs.pending, transparent: true, toneMapped: false, depthWrite: false }));
      const c = new THREE.Mesh(chipGeo, m); c.renderOrder = 12; c.position.set(-0.5 + j * 0.5, -0.3, 0.01); g.add(c);
      return { mesh: c, mat: m, final: st === true ? chipTexs.ok : chipTexs.unknown, order: j };
    });
    scene.add(g);
    return { g, faceMat, glowMat, chips, k, verdict: s.verdict };
  });

  /* purchase order plate and press */
  const poMat = own(new THREE.MeshBasicMaterial({ map: own(poTex(data.order)), transparent: true, opacity: 0, toneMapped: false }));
  const poPlate = new THREE.Mesh(own(new THREE.PlaneGeometry(1.7, 1.7 * (380 / 560))), poMat);
  poPlate.rotation.x = -Math.PI / 2; poPlate.position.set(mx(4), H / 2 + 0.012, 0); scene.add(poPlate);
  const stampGlow = new THREE.Mesh(own(new THREE.PlaneGeometry(1.85, 1.3)), own(new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0, toneMapped: false, depthWrite: false })));
  stampGlow.rotation.x = -Math.PI / 2; stampGlow.position.set(mx(4), H / 2 + 0.008, 0); scene.add(stampGlow);

  const press = new THREE.Group();
  const pressBody = new THREE.Mesh(own(new RoundedBoxGeometry(1.5, 0.9, 1.5, 3, 0.08)), metal(0x232d26, 0.22));
  pressBody.position.y = 0.95;
  const pressTip = new THREE.Mesh(own(new THREE.CylinderGeometry(0.7, 0.5, 0.55, 4, 1)), metal(0x2b372f, 0.2));
  pressTip.rotation.y = Math.PI / 4; pressTip.position.y = 0.25;
  const pressRod = new THREE.Mesh(own(new THREE.CylinderGeometry(0.16, 0.16, 6, 16)), metal(0x1b231e, 0.3)); pressRod.position.y = 4.4;
  press.add(pressBody, pressTip, pressRod); press.position.set(mx(4), 5, 0); scene.add(press);

  /* gate and key */
  const gate = new THREE.Group(); gate.position.x = GATE_X; scene.add(gate);
  const post = own(new THREE.BoxGeometry(0.12, 1.9, 0.12));
  const amberMat = own(new THREE.MeshBasicMaterial({ color: AMBER, toneMapped: false, transparent: true }));
  for (const z of [-D / 2 - 0.02, D / 2 + 0.02]) { const m = new THREE.Mesh(post, metal(0x2a342d, 0.25)); m.position.set(0, H / 2 + 0.95, z); gate.add(m); }
  const lintel = new THREE.Mesh(own(new THREE.BoxGeometry(0.14, 0.14, D + 0.3)), metal(0x2a342d, 0.25)); lintel.position.set(0, H / 2 + 1.9, 0); gate.add(lintel);
  const lintelStrip = new THREE.Mesh(own(new THREE.BoxGeometry(0.02, 0.03, D + 0.1)), amberMat); lintelStrip.position.set(-0.075, H / 2 + 1.9, 0); gate.add(lintelStrip);
  const barMat = own(new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.28, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
  const bar = new THREE.Mesh(own(new THREE.PlaneGeometry(D, 1.75)), barMat); bar.rotation.y = Math.PI / 2; bar.position.set(0, H / 2 + 0.9, 0); gate.add(bar);
  const barEdge = new THREE.Mesh(own(new THREE.BoxGeometry(0.03, 0.04, D)), amberMat); barEdge.position.set(0, H / 2 + 1.77, 0); gate.add(barEdge);
  const keyG = new THREE.Group(); keyG.position.set(GATE_X, H / 2 + 2.6, D / 2 + 0.4);
  const keyRing = new THREE.Mesh(own(new THREE.TorusGeometry(0.2, 0.045, 16, 32)), own(new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false })));
  const keyStem = new THREE.Mesh(own(new THREE.BoxGeometry(0.07, 0.62, 0.07)), own(new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false })));
  keyStem.position.y = -0.4; const keyTooth = new THREE.Mesh(own(new THREE.BoxGeometry(0.22, 0.07, 0.07)), keyStem.material as THREE.Material);
  keyTooth.position.set(0.11, -0.6, 0);
  keyG.add(keyRing, keyStem, keyTooth); scene.add(keyG);

  /* session rings around payment */
  const rings = [1.55, 1.9, 2.25].map((r, i) => {
    const m = own(new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    const t = new THREE.Mesh(own(new THREE.TorusGeometry(r, 0.014, 8, 96)), m);
    t.rotation.x = Math.PI / 2; t.position.set(mx(5), H / 2 + 0.03 + i * 0.01, 0); scene.add(t);
    return { t, m, i };
  });

  /* state */
  let target = 0, shown = 0, px = 0, py = 0, w = 1, h = 1, mobile = false, lastT = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  function cameraAt(p: number) {
    let i = 0;
    while (i < CAMERA.length - 2 && p > CAMERA[i + 1]!.p) i++;
    const a = CAMERA[i]!, b = CAMERA[i + 1]!, t = sm(seg(p, a.p, b.p));
    tmpA.set(...a.pos).lerp(tmpB.set(...b.pos), t); camPos.copy(tmpA);
    tmpA.set(...a.look).lerp(tmpB.set(...b.look), t); camLook.copy(tmpA);
  }

  function applyView() {
    camera.aspect = w / h;
    // Push the scene off-centre so the chapter text has the other side to itself.
    if (mobile) camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    else camera.setViewOffset(w, h, -w * (w > 1100 ? 0.2 : 0.14), 0, w, h);
    camera.fov = mobile ? 58 : 37;
    camera.updateProjectionMatrix();
  }

  function update(p: number, time: number) {
    const t = opts.reducedMotion ? 0 : time / 1000;

    /* module activity: lit during its chapter, softly lit after, ripple at the end */
    const windows: [number, number][] = [[0.09, 0.22], [0.22, 0.36], [0.36, 0.5], [0.5, 0.64], [0.64, 0.78], [0.9, 1.0]];
    modules.forEach((m, i) => {
      const [a, b] = windows[i]!;
      const on = ss(p, a - 0.02, a + 0.025) * (1 - ss(p, b - 0.01, b + 0.03) * 0.6);
      const done = i === 5 ? 0 : ss(p, b, b + 0.04) * 0.4;
      const ripple = ss(p, 0.965 + i * 0.005, 0.975 + i * 0.005);
      const v = Math.max(on, done, ripple * 0.9);
      m.stripMat.opacity = 0.12 + v * 0.88;
      m.labelMat.opacity = 0.35 + v * 0.65;
      m.labelMat.color.setHex(v > 0.5 ? LIME : 0x8da092);
    });

    /* packet */
    const bob = Math.sin(t * 2.2) * 0.04;
    const px_ = piecewise(PACKET, p);
    packet.position.set(px_, H / 2 + 0.62 + bob, 0);
    const afterPay = ss(p, 0.975, 1.0);
    const packetScale = 1 + Math.sin(t * 3) * 0.06 - afterPay * 0.2;
    packet.scale.setScalar(Math.max(0.3, packetScale));

    /* request card folds into the packet */
    const reqIn = ss(p, 0.1, 0.14), reqFold = ss(p, 0.18, 0.225);
    reqCard.position.set(mx(0), lerp(2.6, H / 2 + 0.62, reqFold), 0.3);
    reqCard.scale.set(Math.max(0.001, 1 - reqFold), Math.max(0.001, (1 - reqFold) * (1 - reqFold * 0.3)), 1);
    reqMat.opacity = reqIn * (1 - ss(p, 0.215, 0.225));
    reqCard.visible = reqMat.opacity > 0.01;
    reqCard.rotation.y = -0.12;

    /* supplier cards travel with the packet's chapters */
    const spread = mobile ? 1.1 : 1.62, cardK = mobile ? 0.72 : 1;
    cards.forEach((c) => {
      const off = (c.k - 1) * spread;
      const arrive = ss(p, 0.24, 0.31);
      const t3 = ss(p, 0.37, 0.43), t4 = ss(p, 0.51, 0.57), lift = ss(p, 0.57, 0.62);
      let x = mx(1) + off;
      x = lerp(x, mx(2) + off, t3); x = lerp(x, mx(3) + off, t4);
      let y = lerp(H / 2 + 0.2, 1.55, arrive) + Math.sin(t * 1.4 + c.k) * 0.03;
      let s = lerp(0.05, 1, arrive);
      const isRec = c.k === 0;
      if (isRec) { y += 0.3 * lift; s *= 1 + 0.1 * lift; }
      let opacity = arrive;

      // The recommended card flies to the purchase order and becomes the plate; the others retire.
      const toPo = ss(p, 0.65, 0.71), retire = ss(p, 0.64, 0.69);
      if (isRec) {
        x = lerp(x, mx(4), toPo); y = lerp(y, H / 2 + 1.3, toPo); s *= lerp(1, 0.85, toPo);
        opacity *= 1 - ss(p, 0.7, 0.735);
      } else {
        y += retire * 0.8; opacity *= 1 - retire; s *= 1 - retire * 0.2;
      }
      c.g.position.set(x, y, 0.1); c.g.scale.setScalar(Math.max(0.001, s * cardK)); c.g.rotation.y = -0.1;
      c.g.visible = opacity > 0.01;
      c.faceMat.opacity = opacity;
      const dim = !isRec && c.verdict === "eligible" ? 1 - lift * 0.45 : c.verdict === "review_required" ? 1 - lift * 0.3 : 1;
      c.faceMat.color.setScalar(dim);
      c.glowMat.opacity = opacity * (isRec ? lift * 0.85 : c.verdict === "review_required" ? lift * 0.55 : 0);

      // Evidence stamps land one after another during the Prove chapter.
      c.chips.forEach((chip) => {
        const at = 0.385 + chip.order * 0.026 + c.k * 0.006;
        const st = ss(p, at, at + 0.014);
        chip.mat.map = st > 0.5 ? chip.final : chipTexs.pending;
        chip.mat.opacity = opacity * (0.55 + st * 0.45);
        chip.mesh.scale.setScalar(1 + Math.sin(st * Math.PI) * 0.45);
      });
    });

    /* purchase order plate, press and stamp */
    const plateIn = ss(p, 0.705, 0.735);
    poMat.opacity = plateIn;
    const down = ss(p, 0.735, 0.752), up = ss(p, 0.765, 0.79);
    press.position.y = lerp(5, H / 2 + 0.28, down) + (up * 4.5) * (down > 0.99 ? 1 : 0);
    const stamped = ss(p, 0.748, 0.757) * (1 - ss(p, 0.76, 0.8));
    (stampGlow.material as THREE.MeshBasicMaterial).opacity = stamped * 0.55;
    poPlate.scale.setScalar(1 + stamped * 0.02);

    /* gate: closed until the key turns */
    const keyIn = ss(p, 0.815, 0.84), turn = ss(p, 0.855, 0.885), open = ss(p, 0.885, 0.915);
    keyG.position.y = lerp(H / 2 + 2.9, H / 2 + 1.45, keyIn);
    keyG.rotation.z = turn * (Math.PI / 2); keyG.rotation.y = Math.sin(t * 0.8) * 0.2;
    keyG.visible = keyIn > 0.01 && open < 0.98;
    bar.position.y = H / 2 + 0.9 + open * 1.7; barEdge.position.y = H / 2 + 1.77 + open * 1.7;
    barMat.opacity = 0.28 * (1 - open * 0.9); amberMat.opacity = 1 - open * 0.6;
    gate.visible = ss(p, 0.76, 0.8) > 0.01;

    /* session rings pulse around payment */
    rings.forEach((r) => {
      const a = ss(p, 0.9 + r.i * 0.012, 0.94 + r.i * 0.012);
      r.t.scale.setScalar(lerp(0.25, 1, a) + Math.sin(t * 1.6 - r.i) * 0.012);
      r.m.opacity = a * (0.55 - r.i * 0.13);
      r.t.visible = a > 0.01;
    });

    /* light follows the packet */
    packetLight.intensity = 4 + Math.sin(t * 3) * 0.6 + afterPay * 2;
    halo.scale.setScalar(1.05 + Math.sin(t * 2.4) * 0.08);

    /* camera, with a little pointer parallax */
    cameraAt(p);
    const drift = opts.reducedMotion ? 0 : Math.sin(t * 0.25) * 0.15 * (1 - seg(p, 0.1, 0.2));
    camera.position.set(camPos.x + px * 0.35 + drift, camPos.y + py * 0.18, camPos.z);
    camera.lookAt(camLook);
  }

  return {
    setProgress(p) { target = clamp(p); },
    setPointer(nx, ny) { px = nx; py = ny; },
    resize(nw, nh, isMobile) {
      w = Math.max(1, nw); h = Math.max(1, nh); mobile = isMobile;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
      renderer.setSize(w, h, false);
      applyView();
    },
    render(timeMs) {
      // Ease towards the target so fast scrolling still feels weighted and smooth.
      // Time-based so a slow GPU converges as fast as a quick one.
      const dt = lastT ? Math.min(0.25, (timeMs - lastT) / 1000) : 0.016;
      lastT = timeMs;
      shown += (target - shown) * (opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 9));
      if (Math.abs(target - shown) < 0.0002) shown = target;
      update(shown, timeMs);
      renderer.render(scene, camera);
    },
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
      });
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
