import { sound } from "./audio";
import { pick } from "./math";

/**
 * Suara kru tank lewat interkom: kalimat bahasa Indonesia diucapkan oleh suara bawaan
 * browser (Web Speech API), diawali klik radio. Tanpa file audio.
 */

export type CrewLine = "start" | "wave" | "reload" | "hit" | "kill" | "damaged" | "critical" | "repair" | "rapid" | "dead" | "respawn";

interface LineDef {
  text: string[];
  /** Kalimat berprioritas lebih tinggi boleh memotong kalimat yang sedang diucapkan */
  priority: number;
  /** Jeda minimum (detik) sebelum kalimat yang sama boleh diulang */
  cooldown: number;
}

const LINES: Record<CrewLine, LineDef> = {
  start: { text: ["Semua kru siap!", "Mesin menyala, ayo maju!", "Kru siap tempur, Komandan!"], priority: 2, cooldown: 3 },
  wave: { text: ["Musuh terdeteksi!", "Kontak! Musuh mendekat!", "Gelombang musuh datang!"], priority: 2, cooldown: 5 },
  reload: { text: ["Peluru siap!", "Siap tembak!", "Terisi, tembak!"], priority: 1, cooldown: 9 },
  hit: { text: ["Kena!", "Tembakan tepat!", "Sasaran kena!"], priority: 1, cooldown: 4 },
  kill: { text: ["Target hancur!", "Musuh dilumpuhkan!", "Satu lagi tumbang!", "Sasaran musnah!"], priority: 3, cooldown: 1.5 },
  damaged: { text: ["Kita kena!", "Armor tertembus!", "Kena tembakan!"], priority: 2, cooldown: 5 },
  critical: { text: ["Kerusakan parah! Mundur!", "Kita rusak berat, Komandan!"], priority: 4, cooldown: 8 },
  repair: { text: ["Perbaikan selesai!", "Armor diperbaiki!"], priority: 2, cooldown: 2 },
  rapid: { text: ["Tembak cepat aktif!", "Isi ulang dipercepat!"], priority: 2, cooldown: 2 },
  dead: { text: ["Tank hancur! Keluar, keluar!", "Kita kehilangan tank!"], priority: 5, cooldown: 2 },
  respawn: { text: ["Kembali bertempur!", "Tank baru siap!"], priority: 3, cooldown: 2 },
};

const STORAGE_KEY = "tank-crew";

class Crew {
  enabled = true;
  private readonly synth: SpeechSynthesis | null = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
  private voice: SpeechSynthesisVoice | null = null;
  private lastSaid = new Map<CrewLine, number>();
  private speakingPriority = 0;
  private speakingUntil = 0;
  private reloadTimer = 0;
  private critical = false;
  private primed = false;

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      /* penyimpanan tidak tersedia */
    }
    if (this.synth) {
      this.pickVoice();
      this.synth.addEventListener?.("voiceschanged", () => this.pickVoice());
    }
  }

  get supported() {
    return !!this.synth;
  }

  /** Pilih suara bahasa Indonesia, utamakan suara pria (Andika/Ardi) agar terdengar seperti kru */
  private pickVoice() {
    const voices = this.synth!.getVoices().filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("id"));
    this.voice = voices.find((v) => /andika|ardi|male|pria/i.test(v.name)) ?? voices[0] ?? null;
  }

  /** Beberapa browser HP hanya mengizinkan suara setelah interaksi pertama; panggil dari klik/tap */
  unlock() {
    if (!this.synth || this.primed) return;
    this.primed = true;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    this.synth.speak(u);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* abaikan */
    }
    if (!on) this.silence();
  }

  say(line: CrewLine) {
    if (!this.synth || !this.enabled || !sound.sfxOn) return;
    const def = LINES[line];
    const now = performance.now();
    if (now - (this.lastSaid.get(line) ?? -Infinity) < def.cooldown * 1000) return;
    const busy = now < this.speakingUntil;
    if (busy && def.priority <= this.speakingPriority) return;
    if (busy) this.synth.cancel();
    this.lastSaid.set(line, now);

    const text = pick(def.text);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "id-ID";
    if (this.voice) u.voice = this.voice;
    u.rate = 1.15;
    u.pitch = 0.85;
    u.volume = 0.95;
    u.onend = () => (this.speakingUntil = 0);
    this.speakingPriority = def.priority;
    // Perkiraan durasi bila onend tidak terpanggil (terjadi di sebagian browser)
    this.speakingUntil = now + 700 + text.length * 70;
    sound.radio();
    this.synth.speak(u);
  }

  // ---------------- Kejadian dari pertempuran ----------------

  damaged(hpRatio: number) {
    if (hpRatio <= 0) return;
    if (hpRatio < 0.3 && !this.critical) {
      this.critical = true;
      this.say("critical");
    } else this.say("damaged");
  }

  healed(hpRatio: number) {
    if (hpRatio > 0.5) this.critical = false;
  }

  /** Setelah menembak: umumkan "peluru siap" bila isi ulangnya cukup lama */
  fired(reloadSeconds: number) {
    clearTimeout(this.reloadTimer);
    if (reloadSeconds >= 1.2) this.reloadTimer = window.setTimeout(() => this.say("reload"), reloadSeconds * 1000);
  }

  respawned() {
    this.critical = false;
    this.say("respawn");
  }

  /** Hentikan semua ucapan (keluar dari pertempuran / mulai baru) */
  silence() {
    clearTimeout(this.reloadTimer);
    this.critical = false;
    this.speakingUntil = 0;
    this.synth?.cancel();
  }
}

export const crew = new Crew();
