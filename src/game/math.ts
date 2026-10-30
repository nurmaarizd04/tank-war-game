export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (min: number, max: number) => min + Math.random() * (max - min);
export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

/** Selisih sudut terpendek dari a ke b, dalam rentang −π..π */
export function angleDiff(a: number, b: number) {
  return ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

export function rotateTowards(current: number, target: number, maxStep: number) {
  const d = angleDiff(current, target);
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

/** Bilangan acak dengan seed (hasil sama untuk seed sama) */
export function seededRandom(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Faktor smoothing yang tidak bergantung frame rate */
export const smoothing = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
