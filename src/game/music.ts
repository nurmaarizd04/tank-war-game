import { sound } from "./audio";

/**
 * Musik latar orisinal yang dimainkan langsung oleh sequencer Web Audio.
 * Dua suasana: "menu" (tenang & megah) dan "battle" (cepat & menegangkan).
 * Progresi D minor: Dm – B♭ – F – C (i – VI – III – VII).
 */

type Mood = "menu" | "battle";

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Akar & akor tiap birama (nomor MIDI)
const PROGRESSION = [
  { root: 38, chord: [62, 65, 69] }, // Dm
  { root: 34, chord: [58, 62, 65] }, // B♭
  { root: 41, chord: [60, 65, 69] }, // F
  { root: 36, chord: [60, 64, 67] }, // C
];

// Melodi pertempuran (16 langkah × 4 birama), null = diam
const LEAD: (number | null)[][] = [
  [74, null, 72, null, 69, null, null, 72, 74, null, 77, null, 76, null, 74, null],
  [70, null, null, 72, 74, null, 70, null, 69, null, null, null, 65, null, 67, null],
  [69, null, 72, null, 77, null, 76, null, 74, null, 72, null, 69, null, null, null],
  [67, null, 69, null, 72, null, 76, null, 74, null, null, 72, 71, null, 72, null],
];

class Music {
  private mood: Mood | null = null;
  private step = 0;
  private nextTime = 0;
  private timer = 0;

  play(mood: Mood) {
    if (this.mood === mood) return;
    this.mood = mood;
    sound.onUnlock(() => this.start());
  }

  private start() {
    if (this.timer || !sound.ctx) return;
    this.step = 0;
    this.nextTime = sound.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private get bpm() {
    return this.mood === "battle" ? 112 : 84;
  }

  private schedule() {
    const ctx = sound.ctx;
    if (!ctx || !this.mood) return;
    const stepTime = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, stepTime);
      this.nextTime += stepTime;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, stepTime: number) {
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const { root, chord } = PROGRESSION[bar];
    const battle = this.mood === "battle";

    // Pad akor panjang di awal tiap birama
    if (beat === 0) for (const n of chord) this.voice(midi(n), t, stepTime * 16, battle ? 0.05 : 0.07, "sawtooth", 1400, 0.25);

    if (battle) {
      if (beat % 4 === 0 || beat === 10) this.kick(t, 0.9);
      if (beat === 4 || beat === 12) this.snare(t, 0.5);
      if (beat % 2 === 1) this.hat(t, 0.12);
      if (beat % 2 === 0) this.voice(midi(root + (beat % 8 === 6 ? 12 : 0)), t, stepTime * 1.8, 0.22, "sawtooth", 600, 0.01);
      const note = LEAD[bar][beat];
      if (note !== null) this.voice(midi(note), t, stepTime * 1.9, 0.07, "square", 2600, 0.01);
    } else {
      if (beat === 0 || beat === 8) this.kick(t, 0.45);
      if (beat === 0 || beat === 6 || beat === 8) this.voice(midi(root), t, stepTime * 5, 0.18, "triangle", 500, 0.02);
      // Arpeggio lembut
      if (beat % 2 === 0) this.voice(midi(chord[(beat / 2) % 3] + 12), t, stepTime * 2.5, 0.045, "triangle", 3000, 0.01);
    }
  }

  private voice(freq: number, t: number, duration: number, volume: number, type: OscillatorType, cutoff: number, attack: number) {
    const ctx = sound.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + attack + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(filter).connect(gain).connect(sound.musicBus!);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  private kick(t: number, volume: number) {
    const ctx = sound.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain).connect(sound.musicBus!);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  private noise(t: number, duration: number, volume: number, type: BiquadFilterType, freq: number) {
    const ctx = sound.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = sound.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(sound.musicBus!);
    src.start(t, Math.random(), duration + 0.02);
  }

  private snare(t: number, volume: number) {
    this.noise(t, 0.18, volume, "bandpass", 1800);
    const ctx = sound.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * 0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain).connect(sound.musicBus!);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  private hat(t: number, volume: number) {
    this.noise(t, 0.05, volume, "highpass", 7000);
  }
}

export const music = new Music();
