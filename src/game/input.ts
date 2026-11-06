export interface Stick {
  active: boolean;
  id: number;
  /** Titik awal sentuhan (pusat joystick) & posisi jari, dalam px layar */
  ox: number;
  oy: number;
  x: number;
  y: number;
  startTime: number;
}

const STICK_RADIUS = 56;

const emptyStick = (): Stick => ({ active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, startTime: 0 });

/**
 * Kontrol:
 * - HP: joystick kiri (gerak) & kanan (bidik + tembak otomatis), muncul di tempat jari menyentuh
 * - Laptop: WASD/panah untuk gerak, mouse untuk bidik, klik/spasi untuk tembak
 */
export class Input {
  readonly radius = STICK_RADIUS;
  left = emptyStick();
  right = emptyStick();
  mouse = { x: 0, y: 0, down: false, used: false };
  touchUsed = false;
  private keys = new Set<string>();
  private tapQueued = false;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  destroy() {
    this.el.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
  }

  reset() {
    this.left = emptyStick();
    this.right = emptyStick();
    this.mouse.down = false;
    this.keys.clear();
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      this.mouse.down = true;
      this.mouse.used = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      return;
    }
    this.touchUsed = true;
    const stick = e.clientX < window.innerWidth / 2 ? this.left : this.right;
    if (stick.active) return;
    Object.assign(stick, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, startTime: performance.now() });
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.used = true;
      return;
    }
    for (const stick of [this.left, this.right]) {
      if (stick.active && stick.id === e.pointerId) {
        stick.x = e.clientX;
        stick.y = e.clientY;
        // Joystick ikut bergeser jika jari keluar terlalu jauh
        const dx = stick.x - stick.ox;
        const dy = stick.y - stick.oy;
        const d = Math.hypot(dx, dy);
        if (d > STICK_RADIUS * 1.6) {
          stick.ox = stick.x - (dx / d) * STICK_RADIUS * 1.6;
          stick.oy = stick.y - (dy / d) * STICK_RADIUS * 1.6;
        }
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      this.mouse.down = false;
      return;
    }
    for (const stick of [this.left, this.right]) {
      if (stick.active && stick.id === e.pointerId) {
        // Ketukan singkat di sisi kanan = tembak sekali ke arah turret
        if (stick === this.right && performance.now() - stick.startTime < 220 && Math.hypot(stick.x - stick.ox, stick.y - stick.oy) < 14) {
          this.tapQueued = true;
        }
        Object.assign(stick, emptyStick());
      }
    }
  };

  private onKey = (e: KeyboardEvent) => {
    // Jangan ganggu saat mengetik nama / kode room
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const key = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) e.preventDefault();
    if (e.type === "keydown") this.keys.add(key);
    else this.keys.delete(key);
  };

  /** Vektor gerak dengan panjang 0–1 (arah layar = arah dunia) */
  get move() {
    if (this.left.active) {
      const dx = this.left.x - this.left.ox;
      const dy = this.left.y - this.left.oy;
      const d = Math.hypot(dx, dy);
      if (d < 6) return { x: 0, y: 0 };
      const m = Math.min(1, d / STICK_RADIUS);
      return { x: (dx / d) * m, y: (dy / d) * m };
    }
    let x = 0;
    let y = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) y -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) y += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) x -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) x += 1;
    const d = Math.hypot(x, y);
    return d ? { x: x / d, y: y / d } : { x: 0, y: 0 };
  }

  /** Keyboard ala tank: maju/mundur searah badan & putar badan (null jika joystick dipakai / tak ada tombol) */
  get keyDrive(): { forward: number; turn: number } | null {
    if (this.left.active) return null;
    const k = this.keys;
    const forward = Number(k.has("w") || k.has("arrowup")) - Number(k.has("s") || k.has("arrowdown"));
    const turn = Number(k.has("d") || k.has("arrowright")) - Number(k.has("a") || k.has("arrowleft"));
    return forward || turn ? { forward, turn } : null;
  }

  /** Arah bidik dari joystick kanan (null jika tidak dipakai) & apakah sedang menembak */
  get aimStick(): { angle: number; firing: boolean } | null {
    if (!this.right.active) return null;
    const dx = this.right.x - this.right.ox;
    const dy = this.right.y - this.right.oy;
    const d = Math.hypot(dx, dy);
    if (d < 10) return null;
    return { angle: Math.atan2(dy, dx), firing: d > STICK_RADIUS * 0.35 };
  }

  get keyFire() {
    return this.keys.has(" ") || this.mouse.down;
  }

  consumeTap() {
    const tap = this.tapQueued;
    this.tapQueued = false;
    return tap;
  }
}
