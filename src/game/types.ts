import type { Effects } from "./effects";
import type { Tank } from "./tank";
import type { World } from "./world";

/** Tim: "player"/"enemy" (solo), "blue"/"red" (demo), atau id pemain (versus: semua lawan semua) */
export type Team = string;

export interface Controls {
  /** Arah gerak yang diinginkan (vektor dunia, panjang 0–1) */
  moveX: number;
  moveY: number;
  /** Sudut bidik turret, null = biarkan */
  aim: number | null;
  fire: boolean;
}

export interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  team: Team;
  owner: Tank;
  traveled: number;
  range: number;
}

/** Bagian dari Game yang dibutuhkan tank & AI */
export interface Battle {
  world: World;
  effects: Effects;
  tanks: Tank[];
  fireShell(tank: Tank, shell: Shell): void;
  tankAt(x: number, y: number, except: Tank): boolean;
}
