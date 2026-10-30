import { rand } from "./math";

export type ParticleKind = "smoke" | "fire" | "spark" | "debris" | "dust";

/** Partikel 3D: x/y = posisi di tanah, z = ketinggian */
export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  drag: number;
  gravity: number;
  /** "r,g,b" 0–255 */
  color: string;
}

export interface FloatingText {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  life: number;
  size: number;
}

export interface Flash {
  x: number;
  y: number;
  z: number;
  intensity: number;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 900;

export class Effects {
  particles: Particle[] = [];
  texts: FloatingText[] = [];
  flashes: Flash[] = [];

  private add(p: Omit<Particle, "maxLife">) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ ...p, maxLife: p.life });
  }

  muzzle(x: number, y: number, angle: number, z = 24) {
    this.flashes.push({ x, y, z, intensity: 2.2, life: 0.09, maxLife: 0.09 });
    for (let i = 0; i < 10; i++) {
      const a = angle + rand(-0.35, 0.35);
      const s = rand(80, 280);
      this.add({ kind: "fire", x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(-20, 40), life: rand(0.08, 0.18), size: rand(8, 16), grow: -30, drag: 6, gravity: 0, color: "255,214,130" });
    }
    for (let i = 0; i < 8; i++) {
      const a = angle + rand(-0.7, 0.7);
      const s = rand(30, 120);
      this.add({ kind: "smoke", x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(10, 40), life: rand(0.7, 1.3), size: rand(12, 20), grow: 30, drag: 2.5, gravity: -8, color: "205,205,200" });
    }
  }

  impact(x: number, y: number, metal: boolean, z = 14) {
    for (let i = 0; i < (metal ? 16 : 9); i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(80, 320);
      this.add({ kind: "spark", x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(40, 200), life: rand(0.2, 0.45), size: rand(3, 5), grow: -4, drag: 2.5, gravity: 420, color: metal ? "255,231,163" : "217,195,154" });
    }
    for (let i = 0; i < 6; i++) {
      this.add({ kind: metal ? "smoke" : "dust", x, y, z, vx: rand(-40, 40), vy: rand(-40, 40), vz: rand(10, 50), life: rand(0.5, 0.9), size: rand(10, 16), grow: 26, drag: 2, gravity: -5, color: metal ? "95,90,85" : "150,128,92" });
    }
    this.flashes.push({ x, y, z, intensity: 1.2, life: 0.07, maxLife: 0.07 });
  }

  explosion(x: number, y: number, scale = 1) {
    this.flashes.push({ x, y, z: 30, intensity: 6 * scale, life: 0.3, maxLife: 0.3 });
    for (let i = 0; i < 34 * scale; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(40, 240) * scale;
      this.add({ kind: "fire", x, y, z: rand(5, 25), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(30, 180) * scale, life: rand(0.3, 0.7), size: rand(18, 34) * scale, grow: 14, drag: 3.2, gravity: -20, color: Math.random() < 0.5 ? "255,179,71" : "255,122,47" });
    }
    for (let i = 0; i < 26 * scale; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(20, 120) * scale;
      this.add({ kind: "smoke", x, y, z: rand(10, 40), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(30, 110), life: rand(1.2, 2.4), size: rand(24, 40) * scale, grow: 30, drag: 1.6, gravity: -14, color: "58,54,50" });
    }
    for (let i = 0; i < 16 * scale; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(140, 380) * scale;
      this.add({ kind: "debris", x, y, z: 15, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(120, 360), life: rand(0.6, 1.1), size: rand(4, 7), grow: 0, drag: 1.2, gravity: 700, color: "43,42,38" });
    }
  }

  smoke(x: number, y: number, heavy: boolean, z = 26) {
    this.add({
      kind: "smoke",
      x: x + rand(-6, 6),
      y: y + rand(-6, 6),
      z,
      vx: rand(-10, 10),
      vy: rand(-10, 10),
      vz: rand(25, 55),
      life: rand(1.2, 2.0),
      size: rand(12, 18),
      grow: 22,
      drag: 0.6,
      gravity: 0,
      color: heavy ? "40,37,35" : "120,115,110",
    });
  }

  fireFlicker(x: number, y: number) {
    this.add({ kind: "fire", x: x + rand(-10, 10), y: y + rand(-10, 10), z: rand(18, 30), vx: rand(-8, 8), vy: rand(-8, 8), vz: rand(30, 70), life: rand(0.25, 0.5), size: rand(10, 16), grow: -10, drag: 1, gravity: 0, color: "255,140,58" });
  }

  dust(x: number, y: number) {
    this.add({ kind: "dust", x: x + rand(-4, 4), y: y + rand(-4, 4), z: 3, vx: rand(-12, 12), vy: rand(-12, 12), vz: rand(5, 20), life: rand(0.5, 0.9), size: rand(8, 13), grow: 18, drag: 1.5, gravity: 0, color: "160,138,100" });
  }

  leaves(x: number, y: number) {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      this.add({ kind: "debris", x, y, z: rand(20, 50), vx: Math.cos(a) * rand(40, 140), vy: Math.sin(a) * rand(40, 140), vz: rand(20, 120), life: rand(0.8, 1.4), size: rand(4, 6), grow: 0, drag: 2, gravity: 200, color: "70,110,40" });
    }
  }

  text(x: number, y: number, text: string, color: string, size = 16) {
    this.texts.push({ x: x + rand(-8, 8), y, z: 50, text, color, life: 1.1, size });
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vz = p.vz * drag - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.size = Math.max(0.5, p.size + p.grow * dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.z += 40 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => f.life > 0);
  }
}
