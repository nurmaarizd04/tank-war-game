import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { TankModel } from "../data/tanks";
import { getTankSprites, SPRITE_SCALE } from "../game/sprites";

/**
 * Koordinat: x dunia → X three.js, y dunia → Z three.js, tinggi = Y.
 * Sudut 2D θ → rotation.y = −θ.
 */

export const TRACK_H = 12;
export const HULL_H = 10;
export const TURRET_H = 8;

type Pt = [number, number];

function hullOutline(L: number, W: number): Pt[] {
  const hw = W * 0.4;
  return [
    [-L / 2 + 2, -hw],
    [L / 2 - 7, -hw],
    [L / 2, -hw + 5],
    [L / 2, hw - 5],
    [L / 2 - 7, hw],
    [-L / 2 + 2, hw],
  ];
}

function turretOutline(model: TankModel, ts: number): THREE.Shape {
  const shape = new THREE.Shape();
  const poly = (pts: Pt[]) => {
    // y dibalik agar setelah rotateX(−90°) sumbu y 2D menjadi +Z
    pts.forEach(([x, y], i) => (i ? shape.lineTo(x, -y) : shape.moveTo(x, -y)));
    shape.closePath();
  };
  switch (model.look.turret) {
    case "wedge":
      poly([[-ts * 0.5, -ts * 0.46], [ts * 0.22, -ts * 0.46], [ts * 0.6, -ts * 0.12], [ts * 0.6, ts * 0.12], [ts * 0.22, ts * 0.46], [-ts * 0.5, ts * 0.46]]);
      break;
    case "long":
      poly([[-ts * 0.75, -ts * 0.38], [ts * 0.05, -ts * 0.44], [ts * 0.6, -ts * 0.14], [ts * 0.6, ts * 0.14], [ts * 0.05, ts * 0.44], [-ts * 0.75, ts * 0.38]]);
      break;
    case "box":
      poly([[-ts * 0.55, -ts * 0.44], [ts * 0.38, -ts * 0.44], [ts * 0.55, -ts * 0.3], [ts * 0.55, ts * 0.3], [ts * 0.38, ts * 0.44], [-ts * 0.55, ts * 0.44]]);
      break;
    case "dome":
      shape.absarc(0, 0, ts * 0.5, 0, Math.PI * 2, false);
      break;
    case "cast":
      shape.absellipse(-ts * 0.05, 0, ts * 0.56, ts * 0.46, 0, Math.PI * 2, false, 0);
      break;
  }
  return shape;
}

function extrude(shape: THREE.Shape, depth: number, bevel: number) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Tekstur atas (kamuflase) dari sprite 2D; dipetakan ke koordinat bentuk */
function topTexture(canvas: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const span = canvas.width / SPRITE_SCALE;
  const spanY = canvas.height / SPRITE_SCALE;
  tex.repeat.set(1 / span, 1 / spanY);
  tex.offset.set(0.5, 0.5);
  tex.anisotropy = 4;
  return tex;
}

let treadCanvas: HTMLCanvasElement | null = null;
function treadTexture() {
  if (!treadCanvas) {
    treadCanvas = document.createElement("canvas");
    treadCanvas.width = 64;
    treadCanvas.height = 16;
    const ctx = treadCanvas.getContext("2d")!;
    ctx.fillStyle = "#24221d";
    ctx.fillRect(0, 0, 64, 16);
    ctx.fillStyle = "#4b473d";
    for (let x = 0; x < 64; x += 8) ctx.fillRect(x, 0, 3, 16);
  }
  const tex = new THREE.CanvasTexture(treadCanvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface ModelParts {
  hullGeo: THREE.BufferGeometry;
  turretGeo: THREE.BufferGeometry;
  wheelGeo: THREE.BufferGeometry;
  hullTop: THREE.Texture;
  turretTop: THREE.Texture;
  ts: number;
}

const partsCache = new Map<string, ModelParts>();

function partsFor(model: TankModel): ModelParts {
  const cached = partsCache.get(model.id);
  if (cached) return cached;
  const { length: L, width: W } = model.look;
  const sprites = getTankSprites(model);

  const hullShape = new THREE.Shape();
  hullOutline(L, W).forEach(([x, y], i) => (i ? hullShape.lineTo(x, -y) : hullShape.moveTo(x, -y)));
  hullShape.closePath();
  const hullGeo = extrude(hullShape, HULL_H, 1.4);

  const ts = W * 0.62 * model.look.turretScale;
  const turretGeo = extrude(turretOutline(model, ts), TURRET_H, 1.6);

  // Roda jalan di sisi luar kedua rantai, digabung jadi satu geometri
  const wheels: THREE.BufferGeometry[] = [];
  const count = model.era === "ww2" ? 5 : 6;
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const g = new THREE.CylinderGeometry(TRACK_H * 0.38, TRACK_H * 0.38, 2, 12);
      g.rotateX(Math.PI / 2);
      g.translate(-L / 2 + 8 + (i * (L - 16)) / (count - 1), TRACK_H * 0.42, side * (W / 2 + 0.6));
      wheels.push(g);
    }
  }
  const wheelGeo = mergeGeometries(wheels)!;

  const parts = { hullGeo, turretGeo, wheelGeo, hullTop: topTexture(sprites.hull), turretTop: topTexture(sprites.turret), ts };
  partsCache.set(model.id, parts);
  return parts;
}

export interface TankRig {
  root: THREE.Group;
  turret: THREE.Group;
  barrel: THREE.Group;
  treads: THREE.Texture[];
  /** Material milik rig ini (diwarnai saat rusak/hancur) */
  paint: THREE.MeshStandardMaterial[];
  baseColors: THREE.Color[];
  shield: THREE.Mesh;
  wrecked: boolean;
}

export function buildTank(model: TankModel): TankRig {
  const { length: L, width: W, colors, turretOffset, barrel: barrelLength, barrelWidth, muzzleBrake } = model.look;
  const parts = partsFor(model);
  const base = new THREE.Color(colors[0]);
  const side = base.clone().multiplyScalar(0.62);

  const hullTop = new THREE.MeshStandardMaterial({ map: parts.hullTop, roughness: 0.75, metalness: 0.25 });
  const hullSide = new THREE.MeshStandardMaterial({ color: side, roughness: 0.8, metalness: 0.25 });
  const turretTop = new THREE.MeshStandardMaterial({ map: parts.turretTop, roughness: 0.7, metalness: 0.3 });
  const turretSide = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.75), roughness: 0.75, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.55), roughness: 0.55, metalness: 0.5 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.9, metalness: 0.1 });
  const paint = [hullTop, hullSide, turretTop, turretSide, steel];

  const root = new THREE.Group();

  // Rantai dengan tekstur tapak yang bisa digulir
  const treads: THREE.Texture[] = [];
  const tw = W * 0.24;
  for (const sideSign of [-1, 1]) {
    const tex = treadTexture();
    tex.repeat.set(L / 8, 1);
    treads.push(tex);
    const track = new THREE.Mesh(new THREE.BoxGeometry(L, TRACK_H, tw), [rubber, rubber, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), rubber, rubber, rubber]);
    track.position.set(0, TRACK_H / 2, sideSign * (W / 2 - tw / 2));
    track.castShadow = true;
    root.add(track);
    // Fender di atas rantai
    const fender = new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 1.6, tw + 1), hullSide);
    fender.position.set(0, TRACK_H + 0.8, sideSign * (W / 2 - tw / 2));
    fender.castShadow = true;
    root.add(fender);
  }
  const wheels = new THREE.Mesh(parts.wheelGeo, steel);
  root.add(wheels);

  const hull = new THREE.Mesh(parts.hullGeo, [hullTop, hullSide]);
  hull.position.y = TRACK_H * 0.55;
  hull.castShadow = true;
  hull.receiveShadow = true;
  root.add(hull);

  // Turret
  const turret = new THREE.Group();
  turret.position.set(turretOffset, TRACK_H * 0.55 + HULL_H + 1.4, 0);
  const turretMesh = new THREE.Mesh(parts.turretGeo, [turretTop, turretSide]);
  turretMesh.castShadow = true;
  turret.add(turretMesh);

  const barrel = new THREE.Group();
  barrel.position.set(parts.ts * 0.3, TURRET_H * 0.55, 0);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(barrelWidth * 0.45, barrelWidth * 0.55, barrelLength, 14), steel);
  tube.rotation.z = -Math.PI / 2;
  tube.position.x = barrelLength / 2;
  tube.castShadow = true;
  barrel.add(tube);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(barrelWidth * 0.7, barrelWidth * 0.7, 5, 14), steel);
  sleeve.rotation.z = -Math.PI / 2;
  sleeve.position.x = barrelLength * 0.48;
  barrel.add(sleeve);
  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(6, TURRET_H * 0.8, barrelWidth * 2.6), turretSide);
  mantlet.position.x = 1;
  barrel.add(mantlet);
  if (muzzleBrake) {
    const brake = new THREE.Mesh(new THREE.BoxGeometry(5, barrelWidth * 1.4, barrelWidth * 1.7), steel);
    brake.position.x = barrelLength - 2;
    barrel.add(brake);
  }
  turret.add(barrel);

  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(parts.ts * 0.13, parts.ts * 0.13, 2, 14), steel);
  hatch.position.set(-parts.ts * 0.18, TURRET_H + 2, -parts.ts * 0.18);
  turret.add(hatch);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 26, 4), rubber);
  antenna.position.set(-parts.ts * 0.45, TURRET_H + 13, parts.ts * 0.3);
  turret.add(antenna);
  if (model.look.era) {
    for (const s of [-1, 1]) {
      const era = new THREE.Mesh(new THREE.BoxGeometry(5, 4, parts.ts * 0.32), steel);
      era.position.set(parts.ts * 0.38, TURRET_H * 0.55, s * parts.ts * 0.24);
      era.rotation.y = s * 0.5;
      turret.add(era);
    }
  }
  root.add(turret);

  // Perisai saat baru muncul kembali
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(L, W) * 0.72, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  shield.position.y = 14;
  shield.visible = false;
  root.add(shield);

  return { root, turret, barrel, treads, paint, baseColors: paint.map((m) => m.color.clone()), shield, wrecked: false };
}

export function setWrecked(rig: TankRig, wrecked: boolean) {
  if (rig.wrecked === wrecked) return;
  rig.wrecked = wrecked;
  rig.paint.forEach((m, i) => {
    if (wrecked) m.color.setRGB(0.16, 0.13, 0.11);
    else m.color.copy(rig.baseColors[i]);
  });
}

/** Lepas memori GPU milik rig (geometri bersama per model tetap disimpan) */
export function disposeTankRig(rig: TankRig, model: TankModel) {
  const parts = partsCache.get(model.id);
  const shared = new Set<THREE.BufferGeometry | undefined>([parts?.hullGeo, parts?.turretGeo, parts?.wheelGeo]);
  const materials = new Set<THREE.Material>();
  rig.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!shared.has(o.geometry)) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  materials.forEach((m) => m.dispose());
  rig.treads.forEach((t) => t.dispose());
}

// ---------------- Tekstur lingkungan ----------------

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, repeat = false) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

export const textures = {
  facade: () =>
    canvasTexture(
      128,
      128,
      (ctx) => {
        ctx.fillStyle = "#d8cdb5";
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        for (let i = 0; i < 300; i++) ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        for (let row = 0; row < 2; row++)
          for (let col = 0; col < 2; col++) {
            const x = 18 + col * 64;
            const y = 18 + row * 64;
            ctx.fillStyle = "#3e4a52";
            ctx.fillRect(x, y, 28, 30);
            ctx.fillStyle = "rgba(160,200,220,0.35)";
            ctx.fillRect(x + 3, y + 3, 10, 24);
            ctx.strokeStyle = "#8c7f68";
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, 28, 30);
          }
      },
      true,
    ),
  concrete: () =>
    canvasTexture(
      64,
      64,
      (ctx) => {
        ctx.fillStyle = "#9e9a90";
        ctx.fillRect(0, 0, 64, 64);
        for (let i = 0; i < 160; i++) {
          ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
          ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
        }
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.strokeRect(0, 0, 64, 64);
      },
      true,
    ),
  crate: () =>
    canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = "#a87b40";
      ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = "#6b4c24";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 58, 58);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(6, 6);
      ctx.lineTo(58, 58);
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      for (let y = 12; y < 64; y += 13) ctx.fillRect(6, y, 52, 1.5);
    }),
  barrel: () =>
    canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = "#b8322a";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#7a1d17";
      ctx.fillRect(0, 10, 64, 4);
      ctx.fillRect(0, 50, 64, 4);
      ctx.fillStyle = "#f2c94c";
      ctx.fillRect(0, 26, 64, 12);
      ctx.fillStyle = "#222";
      for (let x = -8; x < 64; x += 12) {
        ctx.beginPath();
        ctx.moveTo(x, 38);
        ctx.lineTo(x + 6, 38);
        ctx.lineTo(x + 12, 26);
        ctx.lineTo(x + 6, 26);
        ctx.fill();
      }
    }),
  soft: () =>
    canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.55, "rgba(255,255,255,0.45)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }),
};
