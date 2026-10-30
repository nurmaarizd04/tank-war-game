import { angleDiff, rand, TAU } from "./math";
import type { Tank } from "./tank";
import type { Battle, Controls } from "./types";

export type DifficultyId = "easy" | "normal" | "hard";

export interface Difficulty {
  id: DifficultyId;
  name: string;
  description: string;
  /** Simpangan bidik acak (radian) */
  aimError: number;
  /** Seberapa baik AI memperhitungkan gerak target (0–1) */
  lead: number;
  /** Jeda sebelum menembak setelah melihat target (detik) */
  reaction: number;
  hpMult: number;
  damageMult: number;
  reloadMult: number;
  scoreMult: number;
  waveSize: (wave: number) => number;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: "easy",
    name: "Mudah",
    description: "Musuh lambat bereaksi dan sering meleset. Cocok untuk latihan.",
    aimError: 0.16,
    lead: 0.15,
    reaction: 1.1,
    hpMult: 0.75,
    damageMult: 0.55,
    reloadMult: 1.4,
    scoreMult: 1,
    waveSize: (w) => Math.min(1 + Math.floor((w - 1) / 2), 4),
  },
  {
    id: "normal",
    name: "Normal",
    description: "Musuh membidik dengan baik dan bergerak memutar. Pertempuran seimbang.",
    aimError: 0.08,
    lead: 0.6,
    reaction: 0.6,
    hpMult: 0.95,
    damageMult: 0.8,
    reloadMult: 1.15,
    scoreMult: 1.5,
    waveSize: (w) => Math.min(1 + Math.floor(w * 0.7), 5),
  },
  {
    id: "hard",
    name: "Sulit",
    description: "Musuh menembak akurat, memprediksi gerakanmu, dan datang lebih banyak.",
    aimError: 0.035,
    lead: 0.95,
    reaction: 0.3,
    hpMult: 1.1,
    damageMult: 1,
    reloadMult: 1,
    scoreMult: 2.2,
    waveSize: (w) => Math.min(1 + w, 7),
  },
];

export class AIController {
  private readonly diff: Difficulty;
  private target: Tank | null = null;
  private targetTimer = 0;
  private los = false;
  private losTimer = 0;
  private seenTime = 0;
  private strafeDir = Math.random() < 0.5 ? 1 : -1;
  private strafeTimer = rand(2, 4);
  private stuckTimer = 0;
  private lastX: number;
  private lastY: number;
  private unstuck = 0;
  private unstuckAngle = 0;
  private aimNoise = 0;
  private noiseTimer = 0;
  private wanderAngle = rand(0, TAU);

  constructor(diff: Difficulty, tank: Tank) {
    this.diff = diff;
    this.lastX = tank.x;
    this.lastY = tank.y;
  }

  private pickTarget(tank: Tank, battle: Battle) {
    let best: Tank | null = null;
    let bestDistance = Infinity;
    for (const other of battle.tanks) {
      if (!other.alive || other.team === tank.team) continue;
      const d = Math.hypot(other.x - tank.x, other.y - tank.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = other;
      }
    }
    return best;
  }

  update(tank: Tank, battle: Battle, dt: number): Controls {
    this.targetTimer -= dt;
    if (this.targetTimer <= 0 || !this.target?.alive) {
      this.target = this.pickTarget(tank, battle);
      this.targetTimer = 1;
    }
    const target = this.target;
    if (!target) {
      this.wanderAngle += rand(-1, 1) * dt;
      const dir = this.avoid(tank, battle, this.wanderAngle);
      return { moveX: Math.cos(dir) * 0.5, moveY: Math.sin(dir) * 0.5, aim: dir, fire: false };
    }

    const dx = target.x - tank.x;
    const dy = target.y - tank.y;
    const d = Math.hypot(dx, dy);
    const range = tank.model.range;

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.los = battle.world.lineOfSight(tank.x, tank.y, target.x, target.y);
      this.losTimer = 0.25;
    }
    this.seenTime = this.los ? this.seenTime + dt : 0;

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir *= -1;
      this.strafeTimer = rand(2, 4.5);
    }

    // Tentukan arah gerak
    const toTarget = Math.atan2(dy, dx);
    let dir: number;
    let throttle = 1;
    if (this.unstuck > 0) {
      this.unstuck -= dt;
      dir = this.unstuckAngle;
      throttle = 0.8;
    } else {
      if (!this.los || d > range * 0.85) dir = toTarget;
      else if (d < range * 0.4) dir = toTarget + Math.PI + this.strafeDir * 0.6;
      else {
        // Memutari target sambil menjaga jarak ideal
        const keep = ((d - range * 0.62) / range) * 1.4;
        dir = toTarget + this.strafeDir * (Math.PI / 2 - keep);
        throttle = 0.75;
      }
      dir = this.avoid(tank, battle, dir);
    }

    // Deteksi tersangkut
    this.stuckTimer += dt;
    if (this.stuckTimer > 1) {
      if (Math.hypot(tank.x - this.lastX, tank.y - this.lastY) < 12 && this.unstuck <= 0) {
        this.unstuck = 0.9;
        this.unstuckAngle = tank.angle + Math.PI + rand(-0.8, 0.8);
        this.strafeDir *= -1;
      }
      this.stuckTimer = 0;
      this.lastX = tank.x;
      this.lastY = tank.y;
    }

    // Bidik dengan prediksi gerak target + simpangan sesuai kesulitan
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.aimNoise = rand(-1, 1) * this.diff.aimError;
      this.noiseTimer = rand(0.4, 0.9);
    }
    const travel = d / tank.model.shellSpeed;
    const px = target.x + target.vx * travel * this.diff.lead;
    const py = target.y + target.vy * travel * this.diff.lead;
    const aim = Math.atan2(py - tank.y, px - tank.x) + this.aimNoise;
    const aimed = Math.abs(angleDiff(tank.turret, aim)) < 0.07;
    const fire = this.los && d < range * 0.98 && aimed && this.seenTime > this.diff.reaction;

    return { moveX: Math.cos(dir) * throttle, moveY: Math.sin(dir) * throttle, aim, fire };
  }

  /** Belokkan arah jika ada obstacle, tepi arena, atau tank lain di depan */
  private avoid(tank: Tank, battle: Battle, dir: number) {
    const blocked = (angle: number, length: number) => {
      const px = tank.x + Math.cos(angle) * length;
      const py = tank.y + Math.sin(angle) * length;
      return !battle.world.insideBounds(px, py, 45) || battle.world.pointBlocked(px, py) !== null || battle.tankAt(px, py, tank);
    };
    if (!blocked(dir, 75) && !blocked(dir, 42)) return dir;
    for (const offset of [0.6, 1.1, 1.6, 2.2]) {
      const a = dir + offset * this.strafeDir;
      if (!blocked(a, 75)) return a;
      const b = dir - offset * this.strafeDir;
      if (!blocked(b, 75)) return b;
    }
    return dir + Math.PI;
  }
}
