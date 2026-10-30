/** Efek suara & musik yang disintesis langsung lewat Web Audio (tanpa file audio). */
export class Sound {
  ctx: AudioContext | null = null;
  /** Keluaran efek suara & musik (volume terpisah) */
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  noise: AudioBuffer | null = null;
  sfxOn = true;
  musicOn = true;
  private unlockListeners: (() => void)[] = [];

  constructor() {
    try {
      this.sfxOn = localStorage.getItem("tank-sfx") !== "0";
      this.musicOn = localStorage.getItem("tank-music") !== "0";
    } catch {
      /* penyimpanan tidak tersedia */
    }
  }

  /** Harus dipanggil dari interaksi pengguna (klik/tap) */
  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 0.7 : 0;
      this.sfxBus.connect(limiter);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.42 : 0;
      this.musicBus.connect(limiter);
      const length = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      for (const fn of this.unlockListeners) fn();
    }
    void this.ctx.resume();
  }

  onUnlock(fn: () => void) {
    if (this.ctx) fn();
    else this.unlockListeners.push(fn);
  }

  private persist(key: string, on: boolean) {
    try {
      localStorage.setItem(key, on ? "1" : "0");
    } catch {
      /* abaikan */
    }
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    this.persist("tank-sfx", on);
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.persist("tank-music", on);
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.42 : 0, this.ctx.currentTime, 0.3);
  }

  private noiseBurst(duration: number, filterFrom: number, filterTo: number, volume: number, type: BiquadFilterType = "lowpass") {
    if (!this.ctx || !this.sfxBus || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFrom, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, filterTo), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5, duration + 0.05);
  }

  private tone(freqFrom: number, freqTo: number, duration: number, volume: number, type: OscillatorType = "sine", delay = 0) {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** volume 0–1 sesuai jarak dari kamera */
  fire(volume = 1) {
    if (volume < 0.05) return;
    this.noiseBurst(0.45, 1800, 120, 0.9 * volume);
    this.tone(110, 40, 0.35, 0.8 * volume);
  }

  explosion(volume = 1) {
    if (volume < 0.05) return;
    this.noiseBurst(1.3, 900, 60, 1.0 * volume);
    this.tone(70, 25, 0.9, 0.9 * volume);
  }

  hit(volume = 1) {
    if (volume < 0.05) return;
    this.noiseBurst(0.12, 4000, 1500, 0.5 * volume, "highpass");
    this.tone(420, 180, 0.12, 0.25 * volume, "square");
  }

  pickup() {
    this.tone(660, 660, 0.12, 0.3, "triangle");
    this.tone(990, 990, 0.18, 0.3, "triangle", 0.1);
  }

  fanfare() {
    this.tone(330, 330, 0.25, 0.25, "sawtooth");
    this.tone(440, 440, 0.25, 0.25, "sawtooth", 0.22);
    this.tone(660, 660, 0.45, 0.25, "sawtooth", 0.44);
  }

  click() {
    this.tone(900, 600, 0.06, 0.15, "triangle");
  }
}

export const sound = new Sound();
