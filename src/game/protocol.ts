/** Event permainan: dijalankan lokal dan dikirim host ke semua pemain (mode versus) */
export type GameEvent =
  | { k: "fire"; id: string; x: number; y: number; a: number }
  | { k: "imp"; x: number; y: number; m: 0 | 1 }
  | { k: "dmg"; id: string; n: number; c: 0 | 1 }
  | { k: "boom"; x: number; y: number; s: number }
  | { k: "obs"; i: number }
  | { k: "kill"; a: string | null; v: string }
  | { k: "pick"; id: string; p: 0 | 1 };

/** [id, x, y, angle, turret, hp, alive, speed, rapidFire, shield] */
export type TankState = [string, number, number, number, number, number, 0 | 1, number, 0 | 1, 0 | 1];

/** Keadaan permainan yang dikirim host ~20× per detik */
export interface Snapshot {
  /** Sisa waktu pertandingan (detik) */
  time: number;
  tanks: TankState[];
  /** [x, y, vx, vy] */
  shells: [number, number, number, number][];
  /** [id, jenis 0=perbaikan 1=tembak cepat, x, y] */
  pickups: [number, 0 | 1, number, number][];
  /** [id, kills, deaths] */
  scores: [string, number, number][];
  /** Detik tersisa sampai muncul kembali, per id */
  respawn: [string, number][];
  ev: GameEvent[];
  over: 0 | 1;
}

export interface VersusPlayer {
  id: string;
  name: string;
  tank: string;
}

export interface VersusSettings {
  killLimit: number;
  /** Detik */
  timeLimit: number;
}

export interface ScoreRow {
  id: string;
  name: string;
  tank: string;
  kills: number;
  deaths: number;
  local: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const round = { r1, r2 };
