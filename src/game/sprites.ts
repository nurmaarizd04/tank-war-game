import type { TankLook, TankModel } from "../data/tanks";
import { hashString, seededRandom } from "./math";

/** Resolusi sprite relatif terhadap unit dunia (2× agar tajam di layar HiDPI) */
export const SPRITE_SCALE = 2;

export interface TankSprites {
  hull: HTMLCanvasElement;
  turret: HTMLCanvasElement;
  hullWreck: HTMLCanvasElement;
  turretWreck: HTMLCanvasElement;
  /** Jarak dari pusat turret ke ujung laras */
  muzzle: number;
}

type Pt = [number, number];

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, ((n >> shift) & 255) + amount));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function polygon(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function paintCamo(
  ctx: CanvasRenderingContext2D,
  look: TankLook,
  rnd: () => number,
  w: number,
  h: number,
) {
  const [, c1, c2] = look.colors;
  if (look.camo === "blobs") {
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? c1 : c2;
      ctx.beginPath();
      ctx.ellipse(
        (rnd() - 0.5) * w,
        (rnd() - 0.5) * h,
        4 + rnd() * w * 0.16,
        3 + rnd() * h * 0.22,
        rnd() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  } else if (look.camo === "stripes") {
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      ctx.strokeStyle = i % 2 ? c1 : c2;
      ctx.lineWidth = 2.5 + rnd() * 2;
      const x = -w / 2 + (i / 6) * w + (rnd() - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(x, -h / 2 - 4);
      ctx.bezierCurveTo(x + 8, -h / 6, x - 8, h / 6, x + 4, h / 2 + 4);
      ctx.stroke();
    }
  } else if (look.camo === "digital") {
    const size = 3;
    for (let x = -w / 2; x < w / 2; x += size)
      for (let y = -h / 2; y < h / 2; y += size) {
        const r = rnd();
        if (r < 0.3) ctx.fillStyle = c1;
        else if (r < 0.5) ctx.fillStyle = c2;
        else continue;
        ctx.fillRect(x, y, size, size);
      }
  }
}

/** Isi bentuk dengan warna dasar + kamuflase + gradasi cahaya + garis tepi */
function paintBody(
  ctx: CanvasRenderingContext2D,
  look: TankLook,
  shape: () => void,
  rnd: () => number,
  w: number,
  h: number,
  lighten = 0,
) {
  ctx.save();
  shape();
  ctx.fillStyle = shade(look.colors[0], lighten);
  ctx.fill();
  ctx.clip();
  paintCamo(ctx, look, rnd, w, h);
  const light = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  light.addColorStop(0, "rgba(255,255,255,0.22)");
  light.addColorStop(0.5, "rgba(255,255,255,0)");
  light.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = light;
  ctx.fillRect(-w, -h, w * 2, h * 2);
  ctx.restore();
  shape();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function hullShape(L: number, W: number): Pt[] {
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

function drawHull(ctx: CanvasRenderingContext2D, model: TankModel, rnd: () => number) {
  const { length: L, width: W } = model.look;
  const look = model.look;
  const hw = W * 0.4;
  paintBody(ctx, look, () => polygon(ctx, hullShape(L, W)), rnd, L, W);

  // Kisi-kisi mesin (belakang, atau depan untuk Merkava)
  const engineX = look.frontEngine ? L / 2 - L * 0.3 : -L / 2 + 5;
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(engineX, -hw * 0.7, L * 0.22, hw * 1.4);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 6; i++) {
    const x = engineX + (i * L * 0.22) / 6;
    ctx.beginPath();
    ctx.moveTo(x, -hw * 0.65);
    ctx.lineTo(x, hw * 0.65);
    ctx.stroke();
  }

  // Lampu depan & kotak peralatan
  ctx.fillStyle = "rgba(255,240,200,0.8)";
  ctx.fillRect(L / 2 - 4, -hw + 2, 2, 3);
  ctx.fillRect(L / 2 - 4, hw - 5, 2, 3);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(-L / 2 + 4, -hw + 1, L * 0.55, 2.5);
  ctx.fillRect(-L / 2 + 4, hw - 3.5, L * 0.55, 2.5);

  if (look.rivets) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let x = -L / 2 + 5; x < L / 2 - 4; x += 6) {
      ctx.beginPath();
      ctx.arc(x, -hw + 1.5, 0.7, 0, Math.PI * 2);
      ctx.arc(x, hw - 1.5, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Ukuran dasar turret; tank modern memakai turret yang lebih lebar (dipakai juga oleh model 3D) */
export function turretSize(model: TankModel) {
  return model.look.width * (model.era === "modern" ? 0.8 : 0.62) * model.look.turretScale;
}

export function turretShape(look: TankLook, ts: number): Pt[] | "circle" | "ellipse" {
  switch (look.turret) {
    case "angular":
      return [
        [-ts * 0.6, -ts * 0.36],
        [-ts * 0.5, -ts * 0.46],
        [ts * 0.26, -ts * 0.46],
        [ts * 0.62, -ts * 0.17],
        [ts * 0.62, ts * 0.17],
        [ts * 0.26, ts * 0.46],
        [-ts * 0.5, ts * 0.46],
        [-ts * 0.6, ts * 0.36],
      ];
    case "wedge":
      return [
        [-ts * 0.5, -ts * 0.46],
        [ts * 0.22, -ts * 0.46],
        [ts * 0.6, -ts * 0.12],
        [ts * 0.6, ts * 0.12],
        [ts * 0.22, ts * 0.46],
        [-ts * 0.5, ts * 0.46],
      ];
    case "long":
      return [
        [-ts * 0.75, -ts * 0.38],
        [ts * 0.05, -ts * 0.44],
        [ts * 0.6, -ts * 0.14],
        [ts * 0.6, ts * 0.14],
        [ts * 0.05, ts * 0.44],
        [-ts * 0.75, ts * 0.38],
      ];
    case "box":
      return [
        [-ts * 0.55, -ts * 0.44],
        [ts * 0.38, -ts * 0.44],
        [ts * 0.55, -ts * 0.3],
        [ts * 0.55, ts * 0.3],
        [ts * 0.38, ts * 0.44],
        [-ts * 0.55, ts * 0.44],
      ];
    case "dome":
      return "circle";
    case "cast":
      return "ellipse";
  }
}

function drawTurret(ctx: CanvasRenderingContext2D, model: TankModel, rnd: () => number) {
  const look = model.look;
  const ts = turretSize(model);
  const bw = look.barrelWidth;

  // Laras
  const barrelStart = ts * 0.3;
  const barrelEnd = barrelStart + look.barrel;
  const barrelGrad = ctx.createLinearGradient(0, -bw / 2, 0, bw / 2);
  barrelGrad.addColorStop(0, shade(look.colors[0], 25));
  barrelGrad.addColorStop(0.5, shade(look.colors[0], -10));
  barrelGrad.addColorStop(1, shade(look.colors[0], -45));
  ctx.fillStyle = barrelGrad;
  ctx.fillRect(barrelStart, -bw / 2, look.barrel, bw);
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 0.8;
  ctx.strokeRect(barrelStart, -bw / 2, look.barrel, bw);
  // Selubung termal / evakuator
  ctx.fillStyle = shade(look.colors[0], -30);
  ctx.fillRect(barrelStart + look.barrel * 0.45, -bw / 2 - 0.8, 4, bw + 1.6);
  if (look.muzzleBrake) {
    ctx.fillStyle = shade(look.colors[0], -50);
    ctx.fillRect(barrelEnd - 5, -bw / 2 - 1.5, 5, bw + 3);
  }

  // Badan turret
  const shape = turretShape(look, ts);
  const draw = () => {
    if (shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, ts * 0.5, 0, Math.PI * 2);
    } else if (shape === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(-ts * 0.05, 0, ts * 0.56, ts * 0.46, 0, 0, Math.PI * 2);
    } else polygon(ctx, shape);
  };
  paintBody(ctx, look, draw, rnd, ts * 1.4, ts, 12);

  // Blok armor reaktif
  if (look.era) {
    ctx.fillStyle = shade(look.colors[0], -25);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.6;
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const a = i * 0.32;
      const x = Math.cos(a) * ts * 0.42;
      const y = Math.sin(a) * ts * 0.42;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillRect(-2, -3, 4, 6);
      ctx.strokeRect(-2, -3, 4, 6);
      ctx.restore();
    }
  }

  // Palka komandan & periskop (turret tanpa awak tidak punya palka)
  if (look.unmanned) return;
  ctx.fillStyle = shade(look.colors[0], -20);
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(-ts * 0.18, -ts * 0.18, ts * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-ts * 0.2, ts * 0.2, ts * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(20,30,40,0.8)";
  ctx.fillRect(ts * 0.1, -ts * 0.3, 3, 2);
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * SPRITE_SCALE);
  canvas.height = Math.ceil(h * SPRITE_SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
  ctx.translate(w / 2, h / 2);
  return { canvas, ctx };
}

/** Kanvas kamuflase penuh (tanpa garis bentuk) untuk permukaan atas model 3D tank modern */
export function camoCanvas(model: TankModel, w: number, h: number) {
  const { canvas, ctx } = makeCanvas(w, h);
  const rect = () => {
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
  };
  paintBody(ctx, model.look, rect, seededRandom(hashString(model.id) + 3), w, h);
  return canvas;
}

function wreckOf(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(28,22,18,0.78)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

const cache = new Map<string, TankSprites>();

export function getTankSprites(model: TankModel): TankSprites {
  const cached = cache.get(model.id);
  if (cached) return cached;

  const { length: L, width: W } = model.look;
  const hull = makeCanvas(L + 6, W + 6);
  drawHull(hull.ctx, model, seededRandom(hashString(model.id)));

  const ts = turretSize(model);
  const muzzle = ts * 0.3 + model.look.barrel;
  const span = (muzzle + 4) * 2;
  const turret = makeCanvas(span, span);
  drawTurret(turret.ctx, model, seededRandom(hashString(model.id) + 7));

  const sprites: TankSprites = {
    hull: hull.canvas,
    turret: turret.canvas,
    hullWreck: wreckOf(hull.canvas),
    turretWreck: wreckOf(turret.canvas),
    muzzle,
  };
  cache.set(model.id, sprites);
  return sprites;
}

/** Gambar tank utuh untuk menu & garasi, diskalakan agar pas di kanvas */
export function drawTankPreview(canvas: HTMLCanvasElement, model: TankModel, heading = -0.35, turretAngle = 0) {
  const ctx = canvas.getContext("2d")!;
  const sprites = getTankSprites(model);
  const { length: L, width: W, turretOffset } = model.look;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Kotak pembatas tank (termasuk laras) setelah diputar
  const back = L / 2 + 4;
  const front = Math.max(L / 2, turretOffset + sprites.muzzle) + 2;
  const half = W / 2 + 4;
  const cos = Math.abs(Math.cos(heading));
  const sin = Math.abs(Math.sin(heading));
  const boxW = (back + front) * cos + 2 * half * sin;
  const boxH = (back + front) * sin + 2 * half * cos;
  const scale = Math.min(canvas.width / (boxW * 1.08), canvas.height / (boxH * 1.12));

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.rotate(heading);
  ctx.translate(-(front - back) / 2, 0);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.roundRect(-L / 2 + 3, -W / 2 + 5, L, W, 5);
  ctx.fill();
  drawTracks(ctx, L, W, 0);
  ctx.drawImage(sprites.hull, -(L + 6) / 2, -(W + 6) / 2, L + 6, W + 6);
  const span = sprites.turret.width / SPRITE_SCALE;
  ctx.translate(turretOffset, 0);
  ctx.rotate(turretAngle);
  ctx.drawImage(sprites.turret, -span / 2, -span / 2, span, span);
  ctx.restore();
}

/** Rantai tank dengan pola tapak yang bergerak sesuai jarak tempuh */
export function drawTracks(ctx: CanvasRenderingContext2D, L: number, W: number, offset: number) {
  const tw = W * 0.24;
  const y1 = -W / 2;
  const y2 = W / 2 - tw;
  ctx.fillStyle = "#26241f";
  ctx.fillRect(-L / 2, y1, L, tw);
  ctx.fillRect(-L / 2, y2, L, tw);
  ctx.fillStyle = "#4a463c";
  const spacing = 5;
  const shift = ((offset % spacing) + spacing) % spacing;
  for (let x = -L / 2 + shift; x < L / 2; x += spacing) {
    ctx.fillRect(x, y1 + 0.5, 1.6, tw - 1);
    ctx.fillRect(x, y2 + 0.5, 1.6, tw - 1);
  }
}
