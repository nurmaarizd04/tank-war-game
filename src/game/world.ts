import { mapById, type MapTheme } from "../data/maps";
import { seededRandom } from "./math";

export type ObstacleKind = "building" | "wall" | "crate" | "barrel" | "tree" | "rock";

export interface Obstacle {
  /** Indeks tetap (sama di semua pemain) untuk sinkronisasi online */
  index: number;
  kind: ObstacleKind;
  /** Pusat obstacle */
  x: number;
  y: number;
  /** Untuk bentuk kotak: lebar & tinggi. Untuk bentuk bulat: r */
  w: number;
  h: number;
  r: number;
  round: boolean;
  hp: number;
  destroyed: boolean;
  /** Variasi warna/bentuk 0–1 */
  tint: number;
}

/** Bekas di tanah yang digambar oleh renderer */
export type Decal = { kind: "track"; x: number; y: number; angle: number; width: number } | { kind: "scorch"; x: number; y: number; r: number };

export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1600;

export class World {
  readonly width = WORLD_WIDTH;
  readonly height = WORLD_HEIGHT;
  readonly seed: number;
  readonly theme: MapTheme;
  obstacles: Obstacle[] = [];
  /** Tekstur tanah (dibuat sekali) */
  ground: HTMLCanvasElement;
  /** Antrian bekas rantai/ledakan untuk renderer */
  decals: Decal[] = [];
  private rng: () => number;

  constructor(seed: number, mapId?: string) {
    this.seed = seed;
    this.theme = mapById(mapId);
    this.rng = seededRandom(seed);
    this.ground = document.createElement("canvas");
    this.ground.width = this.width / 2;
    this.ground.height = this.height / 2;
    this.paintGround();
    this.placeObstacles();
  }

  private r(min: number, max: number) {
    return min + this.rng() * (max - min);
  }

  /** Tanah dilukis setengah resolusi (cukup tajam sebagai tekstur, hemat memori HP) */
  private paintGround() {
    const ctx = this.ground.getContext("2d")!;
    const W = this.ground.width;
    const H = this.ground.height;
    const { ground, patch, road, speck } = this.theme;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, ground[0]);
    g.addColorStop(0.5, ground[1]);
    g.addColorStop(1, ground[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const [pr, pg, pb] = patch.color;
    const j = patch.jitter;
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(${this.r(pr - j, pr + j)},${this.r(pg - j, pg + j)},${this.r(pb - j, pb + j)},${this.r(patch.alpha[0], patch.alpha[1])})`;
      ctx.beginPath();
      ctx.ellipse(this.r(0, W), this.r(0, H), this.r(15, 70), this.r(10, 45), this.r(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineCap = "round";
    for (let i = 0; i < road.count; i++) {
      const y0 = this.r(100, H - 100);
      const y1 = this.r(100, H - 100);
      const c1 = this.r(0, H);
      const c2 = this.r(0, H);
      ctx.strokeStyle = road.color;
      ctx.lineWidth = this.r(25, 40);
      ctx.beginPath();
      ctx.moveTo(-25, y0);
      ctx.bezierCurveTo(W * 0.3, c1, W * 0.7, c2, W + 25, y1);
      ctx.stroke();
      ctx.strokeStyle = road.highlight;
      ctx.lineWidth *= 0.55;
      ctx.stroke();
    }

    for (let i = 0; i < 2600; i++) {
      const roll = this.rng();
      const flower = speck.flowers && roll < 0.03;
      ctx.fillStyle = flower ? (roll < 0.015 ? "#e8d36a" : "#ececec") : `rgba(${speck.color.join(",")},${this.r(0.2, 0.5)})`;
      ctx.fillRect(this.r(0, W), this.r(0, H), this.r(0.6, 1.8), this.r(0.6, 1.8));
    }
  }

  private make(kind: ObstacleKind, x: number, y: number, size: { w?: number; h?: number; r?: number }): Obstacle {
    const hp = { building: Infinity, wall: Infinity, rock: Infinity, crate: 45, barrel: 12, tree: 30 }[kind];
    return {
      index: -1,
      kind,
      x,
      y,
      w: size.w ?? 0,
      h: size.h ?? 0,
      r: size.r ?? 0,
      round: size.r !== undefined,
      hp,
      destroyed: false,
      tint: this.rng(),
    };
  }

  private fits(x: number, y: number, radius: number, margin: number) {
    if (x - radius < 70 || y - radius < 70 || x + radius > this.width - 70 || y + radius > this.height - 70) return false;
    if (Math.hypot(x - this.width / 2, y - this.height / 2) < 220 + radius) return false;
    return this.obstacles.every((o) => {
      const or = o.round ? o.r : Math.hypot(o.w, o.h) / 2;
      return Math.hypot(o.x - x, o.y - y) > or + radius + margin;
    });
  }

  private scatter(count: number, attempts: number, create: () => Obstacle, margin: number) {
    let placed = 0;
    for (let i = 0; i < attempts && placed < count; i++) {
      const o = create();
      const radius = o.round ? o.r : Math.hypot(o.w, o.h) / 2;
      if (this.fits(o.x, o.y, radius, margin)) {
        o.index = this.obstacles.length;
        this.obstacles.push(o);
        placed++;
      }
    }
  }

  private placeObstacles() {
    const W = this.width;
    const H = this.height;
    const count = this.theme.obstacles;
    // Peta padat (kota) memakai jarak antar gedung yang lebih rapat
    this.scatter(count.building, 300, () => this.make("building", this.r(0, W), this.r(0, H), { w: this.r(110, 180), h: this.r(90, 140) }), count.building > 12 ? 85 : 130);
    this.scatter(
      count.wall,
      300,
      () => {
        const horizontal = this.rng() < 0.5;
        const len = this.r(140, 260);
        return this.make("wall", this.r(0, W), this.r(0, H), horizontal ? { w: len, h: 18 } : { w: 18, h: len });
      },
      110,
    );
    this.scatter(count.rock, 300, () => this.make("rock", this.r(0, W), this.r(0, H), { r: this.r(20, 36) }), 70);
    this.scatter(count.tree, 600, () => this.make("tree", this.r(0, W), this.r(0, H), { r: this.r(17, 26) }), 40);
    this.scatter(count.crate, 400, () => this.make("crate", this.r(0, W), this.r(0, H), { w: 30, h: 30 }), 50);
    this.scatter(count.barrel, 400, () => this.make("barrel", this.r(0, W), this.r(0, H), { r: 12 }), 60);
  }

  /** Apakah titik berada di dalam obstacle yang menghalangi */
  pointBlocked(x: number, y: number): Obstacle | null {
    for (const o of this.obstacles) {
      if (o.destroyed) continue;
      if (o.round) {
        if ((x - o.x) ** 2 + (y - o.y) ** 2 < o.r * o.r) return o;
      } else if (Math.abs(x - o.x) < o.w / 2 && Math.abs(y - o.y) < o.h / 2) return o;
    }
    return null;
  }

  insideBounds(x: number, y: number, margin = 0) {
    return x > margin && y > margin && x < this.width - margin && y < this.height - margin;
  }

  /** Garis pandang bebas (pohon/peti/tong tidak menghalangi sepenuhnya) */
  lineOfSight(ax: number, ay: number, bx: number, by: number) {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / 18);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const o = this.pointBlocked(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (o && (o.kind === "building" || o.kind === "wall" || o.kind === "rock")) return false;
    }
    return true;
  }

  /** Dorong lingkaran keluar dari obstacle & batas arena */
  resolveCircle(p: { x: number; y: number }, radius: number) {
    let hit = false;
    for (const o of this.obstacles) {
      if (o.destroyed) continue;
      if (o.round) {
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const d = Math.hypot(dx, dy);
        const min = radius + o.r;
        if (d < min && d > 0.001) {
          p.x = o.x + (dx / d) * min;
          p.y = o.y + (dy / d) * min;
          hit = true;
        }
      } else {
        const cx = Math.max(o.x - o.w / 2, Math.min(p.x, o.x + o.w / 2));
        const cy = Math.max(o.y - o.h / 2, Math.min(p.y, o.y + o.h / 2));
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < radius) {
          if (d > 0.001) {
            p.x = cx + (dx / d) * radius;
            p.y = cy + (dy / d) * radius;
          } else {
            p.y = p.y < o.y ? o.y - o.h / 2 - radius : o.y + o.h / 2 + radius;
          }
          hit = true;
        }
      }
    }
    p.x = Math.max(radius + 8, Math.min(this.width - radius - 8, p.x));
    p.y = Math.max(radius + 8, Math.min(this.height - radius - 8, p.y));
    return hit;
  }

  /** Titik acak yang bebas obstacle dan jauh dari titik-titik tertentu */
  findOpenSpot(avoid: { x: number; y: number }[], minDistance: number) {
    for (let i = 0; i < 300; i++) {
      const edge = Math.random() < 0.6;
      const x = edge ? (Math.random() < 0.5 ? 90 + Math.random() * 260 : this.width - 350 + Math.random() * 260) : 90 + Math.random() * (this.width - 180);
      const y = 90 + Math.random() * (this.height - 180);
      const distance = i < 200 ? minDistance : minDistance * 0.4;
      if (avoid.some((p) => Math.hypot(x - p.x, y - p.y) < distance)) continue;
      let clear = !this.pointBlocked(x, y);
      for (let a = 0; a < 8 && clear; a++) {
        if (this.pointBlocked(x + Math.cos(a) * 42, y + Math.sin(a) * 42)) clear = false;
      }
      if (clear) return { x, y };
    }
    return { x: this.width / 2, y: this.height / 2 };
  }

  stampTrack(x: number, y: number, angle: number, width: number) {
    this.decals.push({ kind: "track", x, y, angle, width });
  }

  stampScorch(x: number, y: number, r: number) {
    this.decals.push({ kind: "scorch", x, y, r });
  }
}
