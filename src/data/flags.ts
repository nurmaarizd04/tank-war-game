export type FlagCode =
  | "us"
  | "de"
  | "ru"
  | "su"
  | "gb"
  | "fr"
  | "il"
  | "cn"
  | "kr"
  | "jp"
  | "it"
  | "in"
  | "tr"
  | "id";

function star(cx: number, cy: number, outer: number, inner: number, rotation = -Math.PI / 2) {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i * Math.PI) / 5;
    points.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return points.join(" ");
}

const horizontal = (...colors: string[]) =>
  colors
    .map((c, i) => {
      const h = 20 / colors.length;
      return `<rect y="${i * h}" width="30" height="${h + 0.1}" fill="${c}"/>`;
    })
    .join("");

const vertical = (...colors: string[]) =>
  colors
    .map((c, i) => {
      const w = 30 / colors.length;
      return `<rect x="${i * w}" width="${w + 0.1}" height="20" fill="${c}"/>`;
    })
    .join("");

/** Bendera sederhana (bukan replika presisi) dalam viewBox 30×20. */
const FLAGS: Record<FlagCode, string> = {
  us: (() => {
    const h = 20 / 13;
    let s = `<rect width="30" height="20" fill="#b22234"/>`;
    for (let i = 1; i < 13; i += 2) s += `<rect y="${i * h}" width="30" height="${h}" fill="#fff"/>`;
    s += `<rect width="12" height="${7 * h}" fill="#3c3b6e"/>`;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 5; c++)
        s += `<circle cx="${1.4 + c * 2.3}" cy="${1.3 + r * 2.4}" r="0.45" fill="#fff"/>`;
    return s;
  })(),
  de: horizontal("#000", "#dd0000", "#ffce00"),
  ru: horizontal("#fff", "#0039a6", "#d52b1e"),
  su: `<rect width="30" height="20" fill="#cc0000"/><polygon points="${star(5, 4.5, 2, 0.8)}" fill="#ffd700"/>`,
  gb: `<rect width="30" height="20" fill="#012169"/>
    <path d="M0,0L30,20M30,0L0,20" stroke="#fff" stroke-width="4"/>
    <path d="M0,0L30,20M30,0L0,20" stroke="#c8102e" stroke-width="1.4"/>
    <path d="M15,0V20M0,10H30" stroke="#fff" stroke-width="6"/>
    <path d="M15,0V20M0,10H30" stroke="#c8102e" stroke-width="3.4"/>`,
  fr: vertical("#0055a4", "#fff", "#ef4135"),
  it: vertical("#009246", "#fff", "#ce2b37"),
  il: `<rect width="30" height="20" fill="#fff"/>
    <rect y="2" width="30" height="2.8" fill="#0038b8"/><rect y="15.2" width="30" height="2.8" fill="#0038b8"/>
    <polygon points="15,6.4 18,11.6 12,11.6" fill="none" stroke="#0038b8" stroke-width="0.8"/>
    <polygon points="15,13.6 18,8.4 12,8.4" fill="none" stroke="#0038b8" stroke-width="0.8"/>`,
  cn: `<rect width="30" height="20" fill="#de2910"/><polygon points="${star(5, 5, 3, 1.15)}" fill="#ffde00"/>
    <polygon points="${star(10, 2, 0.9, 0.35)}" fill="#ffde00"/><polygon points="${star(12, 4, 0.9, 0.35)}" fill="#ffde00"/>
    <polygon points="${star(12, 7, 0.9, 0.35)}" fill="#ffde00"/><polygon points="${star(10, 9, 0.9, 0.35)}" fill="#ffde00"/>`,
  kr: `<rect width="30" height="20" fill="#fff"/>
    <path d="M10,10 A5,5 0 0 1 20,10 Z" fill="#cd2e3a"/><path d="M10,10 A5,5 0 0 0 20,10 Z" fill="#0047a0"/>
    <g fill="#000"><rect x="4" y="3" width="4" height="0.9" transform="rotate(34 6 4)"/><rect x="4" y="4.6" width="4" height="0.9" transform="rotate(34 6 4)"/>
    <rect x="22" y="15" width="4" height="0.9" transform="rotate(34 24 16)"/><rect x="22" y="16.6" width="4" height="0.9" transform="rotate(34 24 16)"/>
    <rect x="22" y="3" width="4" height="0.9" transform="rotate(-34 24 4)"/><rect x="22" y="4.6" width="4" height="0.9" transform="rotate(-34 24 4)"/>
    <rect x="4" y="15" width="4" height="0.9" transform="rotate(-34 6 16)"/><rect x="4" y="16.6" width="4" height="0.9" transform="rotate(-34 6 16)"/></g>`,
  jp: `<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>`,
  in: `${horizontal("#ff9933", "#fff", "#138808")}<circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" stroke-width="0.6"/>`,
  tr: `<rect width="30" height="20" fill="#e30a17"/><circle cx="11" cy="10" r="5" fill="#fff"/>
    <circle cx="12.3" cy="10" r="4" fill="#e30a17"/><polygon points="${star(17.3, 10, 2, 0.8, 0)}" fill="#fff"/>`,
  id: horizontal("#ce1126", "#fff"),
};

export function flagSvg(code: FlagCode, className = "flag") {
  return `<svg class="${className}" viewBox="0 0 30 20" preserveAspectRatio="none" aria-hidden="true">${FLAGS[code]}</svg>`;
}
