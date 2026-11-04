import { sound } from "./audio";
import { pick } from "./math";

/**
 * Suara kru tank lewat interkom: kalimat bahasa Inggris gaya radio militer diucapkan oleh
 * suara bawaan browser (Web Speech API), diapit klik radio. Tanpa file audio.
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
  start: { text: ["Crew's ready.", "Engine's up, let's roll.", "Driver, move out.", "All set, let's go."], priority: 2, cooldown: 3 },
  wave: { text: ["Contact front!", "Enemy armor, twelve o'clock!", "Here they come!", "Heads up, more tanks inbound."], priority: 2, cooldown: 5 },
  reload: { text: ["Up!", "Loaded!", "Gun's up!", "Ready, fire!"], priority: 1, cooldown: 9 },
  hit: { text: ["Hit!", "Good hit!", "That's a hit."], priority: 1, cooldown: 4 },
  kill: { text: ["Target destroyed!", "Got him!", "Scratch one!", "He's down!", "Target, cease fire."], priority: 3, cooldown: 1.5 },
  damaged: { text: ["We're hit!", "Taking fire!", "Ah, that one hurt."], priority: 2, cooldown: 5 },
  critical: { text: ["We're hurt bad, back up!", "Armor's failing, get us out of here!"], priority: 4, cooldown: 8 },
  repair: { text: ["Repairs done.", "Okay, armor's patched up."], priority: 2, cooldown: 2 },
  rapid: { text: ["Fast reload, keep firing!", "Keep 'em coming!"], priority: 2, cooldown: 2 },
  dead: { text: ["Bail out! Bail out!", "We lost her, get out!"], priority: 5, cooldown: 2 },
  respawn: { text: ["Back in the fight.", "New tank, ready to roll."], priority: 3, cooldown: 2 },
};

/** Suara bawaan OS/browser yang terdengar sangat robotik atau berupa efek novelty (macOS) */
const ROBOTIC = /zira|hazel|susan|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|ralph|kathy|junior|espeak/i;
const MALE = /\b(guy|christopher|eric|ryan|roger|steffan|andrew|brian|davis|tony|thomas|william|liam|george|daniel|aaron|alex|tom|oliver|arthur|mark|male)\b/i;

/** Nilai "kealamian" suara: suara neural/online jauh lebih manusiawi daripada suara SAPI lama */
function voiceScore(v: SpeechSynthesisVoice) {
  let score = 0;
  if (/natural|neural|enhanced|premium/i.test(v.name)) score += 100;
  if (/online/i.test(v.name)) score += 40;
  if (/google/i.test(v.name)) score += 50;
  if (!v.localService) score += 15;
  if (MALE.test(v.name)) score += 25;
  if (/^en[-_](us|gb)/i.test(v.lang)) score += 5;
  if (ROBOTIC.test(v.name)) score -= 200;
  return score;
}

const STORAGE_KEY = "tank-crew";

class Crew {
  enabled = true;
  private readonly synth: SpeechSynthesis | null = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
  private voice: SpeechSynthesisVoice | null = null;
  private current: SpeechSynthesisUtterance | null = null;
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

  /** Pilih suara bahasa Inggris yang paling natural, utamakan suara pria agar terdengar seperti kru */
  private pickVoice() {
    const voices = this.synth!.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
    voices.sort((a, b) => voiceScore(b) - voiceScore(a));
    this.voice = voices[0] ?? null;
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
    u.lang = this.voice?.lang ?? "en-US";
    if (this.voice) u.voice = this.voice;
    // Pitch dibiarkan asli (menggeser pitch membuat suara terdengar sintetis);
    // tempo sedikit bervariasi supaya tidak monoton seperti mesin
    u.rate = 1.02 + Math.random() * 0.1;
    u.pitch = 1;
    u.volume = 0.95;
    u.onend = () => {
      // Ucapan yang dipotong kalimat lain / dihentikan tidak boleh mengganggu ucapan berikutnya
      if (this.current !== u) return;
      this.current = null;
      this.speakingUntil = 0;
      sound.radio(true);
    };
    this.current = u;
    this.speakingPriority = def.priority;
    // Perkiraan durasi bila onend tidak terpanggil (terjadi di sebagian browser)
    this.speakingUntil = now + 700 + text.length * 65;
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
    this.current = null;
    this.synth?.cancel();
  }
}

export const crew = new Crew();
