import type { ObstacleKind } from "../game/world";

type RGB = [number, number, number];

export interface MapTheme {
  id: string;
  name: string;
  /** Nama pendek untuk tombol pilihan */
  short: string;
  description: string;
  /** Gradasi warna dasar tanah */
  ground: [string, string, string];
  /** Bercak di tanah: warna dasar ± variasi, dan transparansi [min, max] */
  patch: { color: RGB; jitter: number; alpha: [number, number] };
  /** Jalan tanah/aspal yang melintang */
  road: { count: number; color: string; highlight: string };
  /** Bintik kecil (rumput/pasir/salju); "flowers" = sebagian jadi bunga */
  speck: { color: RGB; flowers: boolean };
  /** Jumlah tiap jenis obstacle */
  obstacles: Record<ObstacleKind, number>;
  /** Warna langit & kabut, tanah di luar arena, dan cahaya pantul dari tanah */
  sky: number;
  outside: number;
  bounce: number;
  rock: number;
  /** Warna daun pohon dalam HSL: hue [min, max], saturasi, terang [min, max] */
  leaves: { hue: [number, number]; sat: number; light: [number, number] };
  roofs?: number[];
}

export const MAPS: MapTheme[] = [
  {
    id: "padang",
    name: "Padang Rumput",
    short: "Padang",
    description: "Ladang hijau dengan desa kecil, hutan, dan jalan tanah.",
    ground: ["#6a8740", "#5f7d3d", "#557236"],
    patch: { color: [90, 120, 55], jitter: 25, alpha: [0.15, 0.35] },
    road: { count: 3, color: "rgba(128,102,66,0.6)", highlight: "rgba(156,130,88,0.4)" },
    speck: { color: [40, 70, 25], flowers: true },
    obstacles: { building: 9, wall: 8, rock: 9, tree: 34, crate: 14, barrel: 10 },
    sky: 0x7d8f6a,
    outside: 0x4a6332,
    bounce: 0x46552c,
    rock: 0x8a867c,
    leaves: { hue: [100, 130], sat: 0.55, light: [0.17, 0.23] },
  },
  {
    id: "gurun",
    name: "Gurun",
    short: "Gurun",
    description: "Hamparan pasir terbuka dengan bebatuan besar. Sedikit tempat berlindung.",
    ground: ["#d8b878", "#cfae6c", "#c39f5e"],
    patch: { color: [190, 150, 95], jitter: 20, alpha: [0.18, 0.4] },
    road: { count: 2, color: "rgba(150,112,70,0.45)", highlight: "rgba(220,190,140,0.35)" },
    speck: { color: [140, 105, 60], flowers: false },
    obstacles: { building: 6, wall: 9, rock: 20, tree: 9, crate: 12, barrel: 16 },
    sky: 0xd9c49a,
    outside: 0xb8955a,
    bounce: 0x9c7b46,
    rock: 0xa47f5a,
    leaves: { hue: [70, 90], sat: 0.4, light: [0.22, 0.3] },
    roofs: [0xc9a46a, 0xb58b55, 0xd8c39a],
  },
  {
    id: "salju",
    name: "Salju",
    short: "Salju",
    description: "Medan beku bersalju dengan hutan pinus lebat dan pondok kayu.",
    ground: ["#e9eef2", "#dde5ea", "#cfd9e0"],
    patch: { color: [190, 205, 220], jitter: 15, alpha: [0.2, 0.45] },
    road: { count: 3, color: "rgba(120,125,135,0.4)", highlight: "rgba(175,180,190,0.35)" },
    speck: { color: [150, 165, 180], flowers: false },
    obstacles: { building: 7, wall: 7, rock: 12, tree: 46, crate: 12, barrel: 8 },
    sky: 0xc5d2dc,
    outside: 0xd4dde4,
    bounce: 0xb7c3cc,
    rock: 0x7d8288,
    leaves: { hue: [150, 170], sat: 0.25, light: [0.2, 0.3] },
    roofs: [0xeef2f5, 0xdfe6eb, 0x6b4a36],
  },
  {
    id: "kota",
    name: "Kota",
    short: "Kota",
    description: "Reruntuhan kota padat gedung dan tembok. Pertarungan jarak dekat di setiap tikungan.",
    ground: ["#7c7a74", "#74726c", "#6b6964"],
    patch: { color: [95, 92, 86], jitter: 15, alpha: [0.18, 0.4] },
    road: { count: 5, color: "rgba(45,45,48,0.7)", highlight: "rgba(80,80,84,0.5)" },
    speck: { color: [50, 48, 45], flowers: false },
    obstacles: { building: 18, wall: 14, rock: 4, tree: 12, crate: 18, barrel: 14 },
    sky: 0x9aa0a6,
    outside: 0x5d5b57,
    bounce: 0x56544f,
    rock: 0x8a867c,
    leaves: { hue: [95, 120], sat: 0.45, light: [0.16, 0.22] },
  },
];

export const mapById = (id: string | undefined) => MAPS.find((m) => m.id === id) ?? MAPS[0];
