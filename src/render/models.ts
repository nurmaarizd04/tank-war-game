import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { TankModel } from "../data/tanks";
import { camoCanvas, getTankSprites, SPRITE_SCALE, turretShape, turretSize } from "../game/sprites";

/**
 * Koordinat: x dunia → X three.js, y dunia → Z three.js, tinggi = Y.
 * Sudut 2D θ → rotation.y = −θ.
 */

export const TRACK_H = 12;
const HULL_H = 10;
const TURRET_H = 8;
/** Dek badan tank modern: rendah & ramping, badan atas melebar menutupi rantai */
const MODERN_DECK = TRACK_H + 4.6;

type Pt = [number, number];

// ---------------- Geometri tank PD II (badan & turret berbentuk lempeng) ----------------

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

/** Kontur turret tampak atas (x, y dunia); lingkaran/elips diubah menjadi poligon */
function turretPoints(model: TankModel, ts: number): Pt[] {
  const shape = turretShape(model.look, ts);
  if (Array.isArray(shape)) return shape;
  const [cx, rx, ry] = shape === "circle" ? [0, ts * 0.5, ts * 0.5] : [-ts * 0.05, ts * 0.56, ts * 0.46];
  return Array.from({ length: 24 }, (_, i): Pt => [cx + Math.cos((i / 24) * Math.PI * 2) * rx, Math.sin((i / 24) * Math.PI * 2) * ry]);
}

function extrude(shape: THREE.Shape, depth: number, bevel: number) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function shapeOf(pts: Pt[]) {
  // y dibalik agar setelah rotateX(−90°) sumbu y 2D menjadi +Z
  const shape = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? shape.lineTo(x, -y) : shape.moveTo(x, -y)));
  shape.closePath();
  return shape;
}

// ---------------- Geometri tank modern (bidang miring bersudut) ----------------

/** Satu kontur (x, z) pada ketinggian y; semua kontur dalam satu tumpukan berjumlah titik sama */
interface Ring {
  y: number;
  pts: Pt[];
}

/**
 * Badan bersudut dari kontur-kontur bertumpuk: tiap pasang kontur berurutan dihubungkan
 * dengan bidang miring. Grup 0 = tutup atas (uv = koordinat bentuk, untuk tekstur kamuflase),
 * grup 1 = dinding. Normal datar agar tepinya tegas seperti pelat baja.
 */
function loft(stacks: { rings: Ring[]; cap: boolean }[]) {
  const caps: number[] = [];
  const capUv: number[] = [];
  const walls: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const triNormal = (p: number[]) => {
    a.fromArray(p, 0);
    b.fromArray(p, 3).sub(a);
    c.fromArray(p, 6).sub(a);
    return normal.crossVectors(b, c);
  };

  for (const { rings, cap } of stacks) {
    const n = rings[0].pts.length;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of rings[0].pts) {
      cx += x / n;
      cz += z / n;
    }
    for (let r = 0; r + 1 < rings.length; r++) {
      const lo = rings[r];
      const hi = rings[r + 1];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const quad = [
          [lo.pts[i][0], lo.y, lo.pts[i][1]],
          [lo.pts[j][0], lo.y, lo.pts[j][1]],
          [hi.pts[j][0], hi.y, hi.pts[j][1]],
          [hi.pts[i][0], hi.y, hi.pts[i][1]],
        ];
        for (const tri of [[0, 1, 2], [0, 2, 3]]) {
          const p = tri.flatMap((k) => quad[k]);
          const nrm = triNormal(p);
          if (nrm.lengthSq() < 1e-6) continue;
          // Pastikan normal menghadap keluar dari sumbu tumpukan
          const mx = (p[0] + p[3] + p[6]) / 3 - cx;
          const mz = (p[2] + p[5] + p[8]) / 3 - cz;
          if (nrm.x * mx + nrm.z * mz < 0) p.splice(0, 9, ...p.slice(0, 3), ...p.slice(6, 9), ...p.slice(3, 6));
          walls.push(...p);
        }
      }
    }
    if (!cap) continue;
    const top = rings[rings.length - 1];
    const tris = THREE.ShapeUtils.triangulateShape(
      top.pts.map(([x, z]) => new THREE.Vector2(x, z)),
      [],
    );
    for (const tri of tris) {
      const p = tri.flatMap((k) => [top.pts[k][0], top.y, top.pts[k][1]]);
      if (triNormal(p).y < 0) p.splice(0, 9, ...p.slice(0, 3), ...p.slice(6, 9), ...p.slice(3, 6));
      caps.push(...p);
      for (let k = 0; k < 9; k += 3) capUv.push(p[k], -p[k + 2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([...caps, ...walls], 3));
  const wallUv: number[] = [];
  for (let k = 0; k < walls.length; k += 3) wallUv.push(walls[k] + walls[k + 2], walls[k + 1]);
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([...capUv, ...wallUv], 2));
  geo.addGroup(0, caps.length / 3, 0);
  geo.addGroup(caps.length / 3, walls.length / 3, 1);
  geo.computeVertexNormals();
  return geo;
}

/** Kontur badan: belakang lurus, sudut depan dipotong */
function hullRing(y: number, front: number, rear: number, hw: number, chamfer: number): Ring {
  return {
    y,
    pts: [
      [rear, -hw],
      [front - chamfer, -hw],
      [front, -hw + chamfer],
      [front, hw - chamfer],
      [front - chamfer, hw],
      [rear, hw],
    ],
  };
}

function modernHull(model: TankModel) {
  const { length: L, width: W, frontEngine } = model.look;
  const tw = W * 0.24;
  // Glacis (pelat depan atas) panjang & landai; Merkava lebih panjang karena mesinnya di depan
  const glacis = L * (frontEngine ? 0.3 : 0.21);
  return loft([
    // Badan bawah di antara rantai, pelat depan bawah miring ke belakang
    { rings: [hullRing(2.5, L / 2 - 8, -L / 2 + 4, W / 2 - tw, 1), hullRing(TRACK_H, L / 2, -L / 2 + 1, W / 2 - tw, 1)], cap: false },
    // Badan atas melebar menutupi rantai (sponson), lalu glacis menuju dek
    {
      rings: [
        hullRing(TRACK_H, L / 2, -L / 2 + 0.5, W / 2 - 0.4, 3),
        hullRing(TRACK_H + 1.3, L / 2 - 0.5, -L / 2 + 0.5, W / 2 - 0.4, 3),
        hullRing(MODERN_DECK, L / 2 - glacis, -L / 2 + 1.4, W / 2 - 1.3, 2.5),
      ],
      cap: true,
    },
  ]);
}

/** Profil turret modern: [tinggi relatif, skala belakang, skala samping, skala depan] */
const TURRET_PROFILES: Record<"default" | "angular" | "dome", [number, number, number, number][]> = {
  // Bagian bawah sedikit masuk (undercut), sisi atas miring ke dalam, muka depan miring ke belakang
  default: [[0, 0.97, 0.9, 0.95], [0.42, 1, 1, 1], [1, 0.97, 0.85, 0.88]],
  angular: [[0, 0.97, 0.88, 0.96], [0.3, 1, 1, 1], [1, 0.93, 0.74, 0.84]],
  dome: [[0, 0.94, 0.94, 0.94], [0.35, 1, 1, 1], [0.75, 0.88, 0.88, 0.88], [1, 0.6, 0.6, 0.6]],
};

function modernTurret(model: TankModel, ts: number, h: number) {
  const outline = turretPoints(model, ts);
  const kind = model.look.turret === "angular" ? "angular" : model.look.turret === "dome" ? "dome" : "default";
  const rings = TURRET_PROFILES[kind].map(([t, back, side, front]): Ring => ({
    y: t * h,
    pts: outline.map(([x, y]): Pt => [x * (x > 0 ? front : back), y * side]),
  }));
  return loft([{ rings, cap: true }]);
}

/** Rantai modern: ujung depan & belakang miring mengikuti sprocket dan idler */
function modernTrack(L: number, tw: number) {
  const s = new THREE.Shape();
  s.moveTo(-L / 2 + 6, 0);
  s.lineTo(L / 2 - 7, 0);
  s.lineTo(L / 2, TRACK_H * 0.62);
  s.lineTo(L / 2 - 2, TRACK_H);
  s.lineTo(-L / 2 + 1.5, TRACK_H);
  s.lineTo(-L / 2, TRACK_H * 0.5);
  s.closePath();
  // Grup 0 = sisi rantai (karet), grup 1 = permukaan tapak (tekstur bergulir, uv dalam unit dunia)
  return new THREE.ExtrudeGeometry(s, { depth: tw, bevelEnabled: false }).translate(0, 0, -tw / 2);
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
  /** Roda jalan (tank modern: velg + sprocket + idler) */
  wheelGeo: THREE.BufferGeometry;
  hullTop: THREE.Texture;
  turretTop: THREE.Texture;
  ts: number;
  /** Ketinggian dudukan turret & tinggi turret */
  deckY: number;
  turretH: number;
  /** Perlengkapan tank modern (null untuk tank PD II), digabung per material agar hemat draw call */
  modern: ModernKit | null;
  /** Geometri milik model (dipakai bersama semua rig, tidak dilepas per rig) */
  shared: Set<THREE.BufferGeometry>;
}

interface ModernKit {
  track: THREE.BufferGeometry;
  /** Ban karet roda jalan */
  tires: THREE.BufferGeometry;
  /** Pelat lapis baja penutup rantai & kotak simpan di atas sponson (warna badan) */
  skirts: THREE.BufferGeometry;
  /** Modul armor tambahan di dinding turret (warna turret) */
  armor: THREE.BufferGeometry;
  /** Kisi mesin, knalpot, periskop pengemudi & pengait derek (logam gelap) */
  hullKit: THREE.BufferGeometry;
  /** Bidikan, senjata jarak jauh, peluncur asap, sistem pertahanan aktif & keranjang belakang (logam gelap) */
  turretKit: THREE.BufferGeometry;
  /** Lensa bidikan & panel radar (kaca gelap) */
  glass: THREE.BufferGeometry;
  /** Evakuator asap, sabuk termal & sensor moncong di laras */
  barrelKit: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
}

/** Gabungkan geometri; daftar kosong (mis. turret kubah tanpa modul armor) menjadi geometri kosong */
function merge(list: THREE.BufferGeometry[]) {
  return list.length ? mergeGeometries(list)! : new THREE.BufferGeometry();
}

/** Posisi belakang turret per bentuk (kelipatan ts) */
const TURRET_REAR: Record<TankModel["look"]["turret"], number> = { wedge: -0.5, long: -0.75, box: -0.55, dome: -0.5, cast: -0.61, angular: -0.6 };
/** Setengah lebar sisi turret (kelipatan ts) untuk menempelkan perlengkapan di dindingnya */
const TURRET_SIDE: Record<TankModel["look"]["turret"], number> = { wedge: 0.46, long: 0.42, box: 0.44, dome: 0.5, cast: 0.46, angular: 0.46 };

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  return g.translate(x, y, z);
}

function rod(r: number, length: number, x: number, y: number, z: number, segments = 10) {
  // Silinder memanjang searah sumbu x (depan tank)
  return new THREE.CylinderGeometry(r, r, length, segments).rotateZ(-Math.PI / 2).translate(x, y, z);
}

function disc(r: number, thickness: number, x: number, y: number, z: number, segments = 14) {
  // Silinder menghadap ke samping (sumbu z), untuk roda
  return new THREE.CylinderGeometry(r, r, thickness, segments).rotateX(Math.PI / 2).translate(x, y, z);
}

function buildModernKit(model: TankModel, ts: number, h: number): { kit: ModernKit; wheels: THREE.BufferGeometry } {
  const { length: L, width: W, barrel: barrelLength, barrelWidth, frontEngine, aps, unmanned } = model.look;
  const tw = W * 0.24;
  const deck = MODERN_DECK;
  const glacis = L * (frontEngine ? 0.3 : 0.21);

  // Roda jalan: velg logam + ban karet, sprocket penggerak di belakang & idler di depan
  const wheels: THREE.BufferGeometry[] = [];
  const tires: THREE.BufferGeometry[] = [];
  const count = model.look.wheels ?? 6;
  const r = TRACK_H * 0.36;
  for (const s of [-1, 1]) {
    const z = s * (W / 2 - tw / 2);
    for (let i = 0; i < count; i++) {
      const x = -L / 2 + 9.5 + (i * (L - 20)) / (count - 1);
      tires.push(disc(r, tw + 0.6, x, r + 0.4, z, 16));
      wheels.push(disc(r * 0.62, tw + 1.4, x, r + 0.4, z, 12));
    }
    wheels.push(disc(TRACK_H * 0.33, tw - 1, -L / 2 + 4.5, TRACK_H * 0.55, z, 12));
    wheels.push(disc(TRACK_H * 0.3, tw - 1, L / 2 - 5, TRACK_H * 0.6, z, 12));
  }

  // Side skirt: panel tebal per sisi dengan celah kecil, menutupi bagian atas roda
  const skirts: THREE.BufferGeometry[] = [];
  const panels = 6;
  const span = L * 0.9;
  const panelLength = span / panels - 0.6;
  const skirtBottom = TRACK_H * 0.38;
  const skirtTop = TRACK_H + 0.9;
  for (const s of [-1, 1]) {
    for (let i = 0; i < panels; i++) {
      const x = -span / 2 + (i + 0.5) * (span / panels) + L * 0.03;
      skirts.push(box(panelLength, skirtTop - skirtBottom, 1.6, x, (skirtTop + skirtBottom) / 2, s * (W / 2 + 0.8)));
    }
  }

  // Kotak simpan di atas sponson, di belakang turret
  for (const s of [-1, 1]) {
    const x = frontEngine ? -L * 0.28 : -L * 0.22;
    skirts.push(box(L * 0.26, 2.6, 4.2, x, deck + 1.2, s * (W / 2 - 3.6)));
  }

  const armor: THREE.BufferGeometry[] = [];
  // Modul armor tambahan di dinding samping turret (memberi kesan lapis baja modular)
  const side = TURRET_SIDE[model.look.turret] * ts;
  if (model.look.turret !== "dome") {
    for (const s of [-1, 1]) armor.push(box(ts * 0.42, h * 0.5, 1.4, -ts * 0.14, h * 0.48, s * (side + 0.5)));
  }

  const hull: THREE.BufferGeometry[] = [];
  // Kisi mesin di dek & knalpot di pelat belakang
  const engineX = frontEngine ? L / 2 - glacis - L * 0.12 : -L / 2 + L * 0.17;
  hull.push(box(L * 0.24, 0.6, W * 0.5, engineX, deck + 0.3, 0));
  for (let i = -3; i <= 3; i++) hull.push(box(L * 0.22, 0.5, 0.8, engineX, deck + 0.8, i * W * 0.07));
  hull.push(box(1.4, 4, W * 0.5, -L / 2 + 0.9, TRACK_H + 1.6, 0));
  // Palka & periskop pengemudi di belakang glacis
  const driverX = L / 2 - glacis - 2.5;
  hull.push(new THREE.CylinderGeometry(3.2, 3.2, 1, 12).translate(driverX - 1, deck + 0.5, 0));
  for (let i = -1; i <= 1; i++) hull.push(box(1.8, 1.4, 1.8, driverX + 2.6, deck + 0.7, i * 2.4));
  // Pengait derek di hidung tank
  for (const s of [-1, 1]) hull.push(box(2.4, 2, 2, L / 2 - 0.2, TRACK_H - 0.4, s * W * 0.22));

  const turret: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  // Bidikan panorama komandan (kepala bisa berputar) di atap kanan belakang
  turret.push(new THREE.CylinderGeometry(ts * 0.055, ts * 0.065, 3.4, 10).translate(-ts * 0.08, h + 1.7, ts * 0.22));
  turret.push(box(ts * 0.15, 3.6, ts * 0.12, -ts * 0.08, h + 4.6, ts * 0.22));
  glass.push(box(0.4, 2, ts * 0.09, -ts * 0.08 + ts * 0.075, h + 4.6, ts * 0.22));
  // Kotak bidik utama penembak di atap kiri depan
  turret.push(box(ts * 0.22, 3.6, ts * 0.14, ts * 0.22, h + 1.8, -ts * 0.27));
  glass.push(box(0.4, 2.2, ts * 0.1, ts * 0.33 + 0.2, h + 2, -ts * 0.27));
  // Remote weapon station: dudukan, badan sensor & laras senapan mesin
  const rwsX = unmanned ? -ts * 0.18 : -ts * 0.28;
  const rwsZ = unmanned ? 0 : -ts * 0.06;
  turret.push(new THREE.CylinderGeometry(ts * 0.08, ts * 0.09, 1.8, 10).translate(rwsX, h + 0.9, rwsZ));
  turret.push(box(ts * 0.18, 3.2, ts * 0.13, rwsX, h + 3.4, rwsZ));
  turret.push(box(ts * 0.08, 2.2, ts * 0.06, rwsX - ts * 0.02, h + 3.2, rwsZ + ts * 0.1));
  glass.push(box(0.4, 1.6, ts * 0.06, rwsX + ts * 0.09 + 0.2, h + 3.8, rwsZ - ts * 0.03));
  turret.push(rod(0.5, ts * 0.36, rwsX + ts * 0.26, h + 3.6, rwsZ - ts * 0.02, 8));
  // Peluncur granat asap: 4 tabung per sisi, mengarah ke depan-atas-luar
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const g = new THREE.CylinderGeometry(1, 1, 3.8, 8);
      g.rotateZ(-0.95);
      g.rotateX(s * 0.45);
      turret.push(g.translate(-ts * 0.02 + i * 2.3, h * 0.82, s * (side + 1.2)));
    }
  }
  // Tiang sensor angin di belakang atap & antena
  turret.push(new THREE.CylinderGeometry(0.3, 0.3, 6, 6).translate(-ts * 0.45, h + 3, -ts * 0.12));
  turret.push(box(0.6, 0.6, 3, -ts * 0.45, h + 6, -ts * 0.12));
  turret.push(new THREE.CylinderGeometry(0.28, 0.28, 22, 4).translate(-ts * 0.5, h + 11, -ts * 0.3));
  if (unmanned) {
    // Turret tanpa awak: tiang sensor dengan kepala kamera & sensor di keempat sudut
    turret.push(new THREE.CylinderGeometry(0.7, 0.9, 5, 8).translate(-ts * 0.3, h + 2.5, ts * 0.2));
    turret.push(box(ts * 0.14, 2.4, ts * 0.14, -ts * 0.3, h + 6, ts * 0.2));
    glass.push(box(0.4, 1.4, ts * 0.1, -ts * 0.3 + ts * 0.07 + 0.2, h + 6, ts * 0.2));
  }
  if (aps) {
    // Sistem pertahanan aktif: panel radar miring di keempat sudut & peluncur pencegat di sisi
    for (const s of [-1, 1]) {
      for (const [x, rot] of [[ts * 0.18, s * 0.75], [-ts * 0.42, s * 2.4]] as const) {
        turret.push(box(4.6, 4.2, 0.8, x, h + 1.8, s * (side - 0.6), rot));
        glass.push(box(3.6, 3.2, 0.3, x + Math.sin(rot) * 0.5 * s, h + 1.8, s * (side - 0.6) + s * 0.45, rot));
      }
      turret.push(box(5.2, 3.6, 3.6, -ts * 0.22, h + 1.6, s * (side - 0.2)));
      turret.push(rod(1.1, 2.2, -ts * 0.22 + 3.4, h + 1.8, s * (side - 0.2), 8));
    }
  }
  // Keranjang barang terbuka di belakang turret: alas, tiang & pagar tipis, berisi tas perlengkapan
  const rear = TURRET_REAR[model.look.turret] * ts;
  const depth = 6.5;
  const y = h * 0.4;
  const half = ts * 0.4;
  turret.push(box(depth, 0.5, half * 2, rear - depth / 2, y - 1.6, 0));
  for (const s of [-1, 1]) turret.push(box(depth, 0.5, 0.5, rear - depth / 2, y + 1.6, s * half));
  turret.push(box(0.5, 0.5, half * 2, rear - depth, y + 1.6, 0));
  for (const s of [-1, 0, 1]) turret.push(box(0.5, 3.2, 0.5, rear - depth, y, s * half));
  for (const s of [-1, 1]) turret.push(box(0.5, 3.2, 0.5, rear - depth / 2, y, s * half));
  armor.push(box(depth * 0.7, 2.6, half * 0.7, rear - depth * 0.45, y - 0.2, -half * 0.45, 0.08));
  armor.push(box(depth * 0.6, 2.2, half * 0.6, rear - depth * 0.5, y - 0.4, half * 0.4, -0.12));

  // Laras (ruang laras: dari 0 sampai barrelLength di sumbu x)
  const barrelKit: THREE.BufferGeometry[] = [];
  // Evakuator asap, sabuk termal, dan sensor referensi moncong di ujung atas
  barrelKit.push(rod(barrelWidth * 0.68, barrelLength * 0.14, barrelLength * 0.5, 0, 0, 14));
  for (const t of [0.2, 0.3, 0.68, 0.8, 0.9]) barrelKit.push(rod(barrelWidth * 0.56, 1.6, barrelLength * t, 0, 0, 14));
  barrelKit.push(box(2.4, 1.4, 1.6, barrelLength - 2, barrelWidth * 0.55 + 0.6, 0));

  const lights: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) lights.push(box(1.6, 1.4, 2.6, L / 2 - 1.6, TRACK_H + 1.6, s * W * 0.36));

  return {
    wheels: merge(wheels),
    kit: {
      track: modernTrack(L, tw),
      tires: merge(tires),
      skirts: merge(skirts),
      armor: merge(armor),
      hullKit: merge(hull),
      turretKit: merge(turret),
      glass: merge(glass),
      barrelKit: merge(barrelKit),
      lights: merge(lights),
    },
  };
}

const partsCache = new Map<string, ModelParts>();

function partsFor(model: TankModel): ModelParts {
  const cached = partsCache.get(model.id);
  if (cached) return cached;
  const { length: L, width: W } = model.look;
  const sprites = getTankSprites(model);
  const ts = turretSize(model);

  let parts: ModelParts;
  if (model.era === "modern") {
    const turretH = TURRET_H * (model.look.unmanned ? 0.76 : model.look.turret === "angular" ? 0.86 : 0.95);
    const { kit, wheels } = buildModernKit(model, ts, turretH);
    parts = {
      hullGeo: modernHull(model),
      turretGeo: modernTurret(model, ts, turretH),
      wheelGeo: wheels,
      // Dek modern selebar tank (lebih lebar dari sprite badan 2D), jadi pakai kamuflase penuh
      hullTop: topTexture(camoCanvas(model, sprites.hull.width / SPRITE_SCALE, sprites.hull.height / SPRITE_SCALE)),
      turretTop: topTexture(sprites.turret),
      ts,
      deckY: MODERN_DECK,
      turretH,
      modern: kit,
      shared: new Set(),
    };
  } else {
    // Roda jalan di sisi luar kedua rantai, digabung jadi satu geometri
    const wheels: THREE.BufferGeometry[] = [];
    const count = 5;
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        wheels.push(disc(TRACK_H * 0.38, 2, -L / 2 + 8 + (i * (L - 16)) / (count - 1), TRACK_H * 0.42, side * (W / 2 + 0.6), 12));
      }
    }
    parts = {
      hullGeo: extrude(shapeOf(hullOutline(L, W)), HULL_H, 1.4).translate(0, TRACK_H * 0.55, 0),
      turretGeo: extrude(shapeOf(turretPoints(model, ts)), TURRET_H, 1.6),
      wheelGeo: mergeGeometries(wheels)!,
      hullTop: topTexture(sprites.hull),
      turretTop: topTexture(sprites.turret),
      ts,
      deckY: TRACK_H * 0.55 + HULL_H + 1.4,
      turretH: TURRET_H + 1.6,
      modern: null,
      shared: new Set(),
    };
  }
  parts.shared = new Set([parts.hullGeo, parts.turretGeo, parts.wheelGeo, ...Object.values(parts.modern ?? {})]);
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
  /** Lampu depan (padam saat tank hancur) */
  lights: THREE.MeshStandardMaterial | null;
  wrecked: boolean;
}

export function buildTank(model: TankModel): TankRig {
  const { length: L, width: W, colors, turretOffset, barrel: barrelLength, barrelWidth, muzzleBrake } = model.look;
  const parts = partsFor(model);
  const kit = parts.modern;
  const { ts, turretH: th } = parts;
  const base = new THREE.Color(colors[0]);
  // Tank modern diterangi PBR + pantulan lingkungan, jadi sisinya tidak perlu digelapkan banyak
  const side = base.clone().multiplyScalar(kit ? 0.8 : 0.62);

  const hullTop = new THREE.MeshStandardMaterial({ map: parts.hullTop, roughness: 0.75, metalness: 0.25 });
  const hullSide = new THREE.MeshStandardMaterial({ color: side, roughness: 0.8, metalness: 0.25 });
  const turretTop = new THREE.MeshStandardMaterial({ map: parts.turretTop, roughness: 0.7, metalness: 0.3 });
  const turretSide = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(kit ? 0.86 : 0.75), roughness: 0.75, metalness: 0.3 });
  // Tank rahasia emas/perak: meriam, roda & armor reaktif berlapis logam mengilap (= look.colors[1]).
  // Tank rahasia "hidden" sengaja tampil seperti tank biasa.
  // userData.glow = pendar dasar, ditambahkan renderer di atas kilatan saat terkena tembakan.
  const shiny = model.secret === "gold" || model.secret === "silver";
  const steel = shiny
    ? new THREE.MeshStandardMaterial({ color: colors[1], roughness: 0.28, metalness: 0.9 })
    : new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.55), roughness: 0.55, metalness: 0.5 });
  if (shiny) {
    steel.userData.glow = new THREE.Color(colors[1]).multiplyScalar(0.14);
    steel.emissive.copy(steel.userData.glow);
  }
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.9, metalness: 0.1 });
  // Perlengkapan tank modern: logam gelap kebiruan
  const gear = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color(0x2a2e33), 0.65), roughness: 0.5, metalness: 0.6 });
  const paint = [hullTop, hullSide, turretTop, turretSide, steel, gear];

  const root = new THREE.Group();

  // Rantai dengan tekstur tapak yang bisa digulir
  const treads: THREE.Texture[] = [];
  const tw = W * 0.24;
  for (const sideSign of [-1, 1]) {
    const tex = treadTexture();
    treads.push(tex);
    const tread = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    let track: THREE.Mesh;
    if (kit) {
      // uv permukaan tapak dalam unit dunia: satu pola per 8 unit
      tex.repeat.set(1 / 8, 1 / tw);
      track = new THREE.Mesh(kit.track, [rubber, tread]);
      track.position.z = sideSign * (W / 2 - tw / 2);
    } else {
      tex.repeat.set(L / 8, 1);
      track = new THREE.Mesh(new THREE.BoxGeometry(L, TRACK_H, tw), [rubber, rubber, tread, rubber, rubber, rubber]);
      track.position.set(0, TRACK_H / 2, sideSign * (W / 2 - tw / 2));
      // Fender di atas rantai
      const fender = new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 1.6, tw + 1), hullSide);
      fender.position.set(0, TRACK_H + 0.8, sideSign * (W / 2 - tw / 2));
      fender.castShadow = true;
      root.add(fender);
    }
    track.castShadow = true;
    root.add(track);
  }
  root.add(new THREE.Mesh(parts.wheelGeo, steel));

  const hull = new THREE.Mesh(parts.hullGeo, [hullTop, hullSide]);
  hull.castShadow = true;
  hull.receiveShadow = true;
  root.add(hull);

  let lights: THREE.MeshStandardMaterial | null = null;
  const glass = new THREE.MeshStandardMaterial({ color: 0x10161c, roughness: 0.15, metalness: 0.8 });
  if (kit) {
    const shadowed = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      return mesh;
    };
    lights = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe2a0, emissiveIntensity: 1.2, roughness: 0.3 });
    root.add(
      new THREE.Mesh(kit.tires, rubber),
      shadowed(kit.skirts, hullSide),
      shadowed(kit.hullKit, gear),
      new THREE.Mesh(kit.lights, lights),
    );
  }

  // Turret
  const turret = new THREE.Group();
  turret.position.set(turretOffset, parts.deckY, 0);
  const turretMesh = new THREE.Mesh(parts.turretGeo, [turretTop, turretSide]);
  turretMesh.castShadow = true;
  turretMesh.receiveShadow = true;
  turret.add(turretMesh);

  const barrel = new THREE.Group();
  barrel.position.set(ts * 0.3, th * 0.55, 0);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(barrelWidth * 0.42, barrelWidth * 0.55, barrelLength, 14), steel);
  tube.rotation.z = -Math.PI / 2;
  tube.position.x = barrelLength / 2;
  tube.castShadow = true;
  barrel.add(tube);
  if (kit) {
    barrel.add(new THREE.Mesh(kit.barrelKit, steel));
    // Mantel meriam: pelat lebar yang menonjol dari muka turret
    const mantlet = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.36, th * 0.7, barrelWidth * 2.5), turretSide);
    mantlet.position.x = ts * 0.16;
    mantlet.castShadow = true;
    barrel.add(mantlet);
  } else {
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(barrelWidth * 0.7, barrelWidth * 0.7, 5, 14), steel);
    sleeve.rotation.z = -Math.PI / 2;
    sleeve.position.x = barrelLength * 0.48;
    barrel.add(sleeve);
    const mantlet = new THREE.Mesh(new THREE.BoxGeometry(6, TURRET_H * 0.8, barrelWidth * 2.6), turretSide);
    mantlet.position.x = 1;
    barrel.add(mantlet);
  }
  if (muzzleBrake) {
    const brake = new THREE.Mesh(new THREE.BoxGeometry(5, barrelWidth * 1.4, barrelWidth * 1.7), steel);
    brake.position.x = barrelLength - 2;
    barrel.add(brake);
  }
  turret.add(barrel);

  if (kit) {
    const armor = new THREE.Mesh(kit.armor, turretSide);
    armor.castShadow = true;
    const turretKit = new THREE.Mesh(kit.turretKit, gear);
    turretKit.castShadow = true;
    turret.add(armor, turretKit, new THREE.Mesh(kit.glass, glass));
  }

  if (!model.look.unmanned) {
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(ts * 0.12, ts * 0.12, kit ? 1.2 : 2, 14), steel);
    hatch.position.set(-ts * 0.2, th + (kit ? 0.6 : 0.4), kit ? ts * 0.02 : -ts * 0.18);
    turret.add(hatch);
  }
  if (!kit) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 26, 4), rubber);
    antenna.position.set(-ts * 0.45, th + 13, ts * 0.3);
    turret.add(antenna);
  }
  if (model.look.era) {
    for (const s of [-1, 1]) {
      const era = new THREE.Mesh(new THREE.BoxGeometry(5, 4, ts * 0.3), steel);
      era.position.set(ts * 0.4, th * 0.55, s * ts * 0.24);
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

  return { root, turret, barrel, treads, paint, baseColors: paint.map((m) => m.color.clone()), shield, lights, wrecked: false };
}

export function setWrecked(rig: TankRig, wrecked: boolean) {
  if (rig.wrecked === wrecked) return;
  rig.wrecked = wrecked;
  rig.paint.forEach((m, i) => {
    if (wrecked) m.color.setRGB(0.16, 0.13, 0.11);
    else m.color.copy(rig.baseColors[i]);
  });
  if (rig.lights) rig.lights.emissiveIntensity = wrecked ? 0 : 1.2;
}

/**
 * Pantulan lingkungan agar logam & cat terlihat lebih realistis.
 * env harus dibuat oleh renderer yang sama yang menggambar rig ini.
 */
export function applyEnvironment(rig: TankRig, env: THREE.Texture) {
  rig.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o === rig.shield) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      m.envMap = env;
      m.envMapIntensity = m.metalness > 0.8 ? 1 : 0.45;
    }
  });
}

/** Environment map studio lembut untuk pantulan tank, dibuat sekali per renderer */
export function createTankEnvironment(gl: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(gl);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return env;
}

/** Lepas memori GPU milik rig (geometri bersama per model tetap disimpan) */
export function disposeTankRig(rig: TankRig, model: TankModel) {
  const shared = partsCache.get(model.id)?.shared;
  const materials = new Set<THREE.Material>();
  rig.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!shared?.has(o.geometry)) o.geometry.dispose();
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
