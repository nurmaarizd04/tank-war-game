import { MAPS } from "../data/maps";
import { shownModel, STANDARD_TANKS, tankById, type TankModel } from "../data/tanks";
import { Renderer } from "../render/renderer";
import { AIController, DIFFICULTIES, type Difficulty } from "./ai";
import { sound } from "./audio";
import { crew } from "./crew";
import { Effects } from "./effects";
import { Input } from "./input";
import { angleDiff, clamp, pick, rand, smoothing } from "./math";
import { round, TEAMS, teamTotals, type GameEvent, type ScoreRow, type Snapshot, type TankState, type VersusPlayer, type VersusSettings } from "./protocol";
import { Tank } from "./tank";
import type { Battle, Controls, Shell } from "./types";
import { World, type Obstacle } from "./world";

export type Mode = "idle" | "demo" | "solo" | "host" | "client";

export interface Pickup {
  id: number;
  kind: "repair" | "rapid";
  x: number;
  y: number;
  life: number;
}

export interface HudState {
  versus: boolean;
  hp: number;
  maxHp: number;
  reload: number;
  rapidFire: number;
  alive: boolean;
  // Solo
  wave: number;
  score: number;
  enemiesLeft: number;
  // Versus
  teams: boolean;
  kills: number;
  timeLeft: number;
  killLimit: number;
  respawnIn: number;
  board: ScoreRow[];
}

export interface GameResult {
  wave: number;
  kills: number;
  score: number;
  best: number;
  newBest: boolean;
}

export interface GameEvents {
  hud(state: HudState): void;
  banner(title: string, subtitle: string): void;
  gameOver(result: GameResult): void;
  killFeed(killer: string | null, victim: string, killerLocal: boolean, victimLocal: boolean): void;
  matchEnd(rows: ScoreRow[]): void;
}

const IDLE: Controls = { moveX: 0, moveY: 0, aim: null, fire: false };
const BEST_KEY = "tank-best-score";
const RESPAWN_TIME = 3;

export class Game implements Battle {
  world = new World(1);
  effects = new Effects();
  tanks: Tank[] = [];
  shells: Shell[] = [];
  pickups: Pickup[] = [];
  readonly input: Input;
  readonly renderer: Renderer;
  paused = false;
  mode: Mode = "idle";
  /** Tank yang dikendalikan pemain di perangkat ini */
  local: Tank | null = null;

  /** Host: kirim snapshot ke pemain lain */
  onSnapshot: (s: Snapshot) => void = () => {};
  /** Client: kirim input ke host */
  onLocalInput: (ctrl: Controls) => void = () => {};

  private readonly events: GameEvents;
  private difficulty: Difficulty = DIFFICULTIES[1];
  private wave = 0;
  private score = 0;
  private kills = 0;
  private intermission = 0;
  private overTimer = -1;
  private tapFire = 0;
  private demoRespawn: Record<string, number> = {};
  private last = 0;
  private hudTimer = 0;
  private netTimer = 0;
  private pendingEvents: GameEvent[] = [];
  private pickupId = 1;
  private pickupTimer = 0;

  // Versus
  private players: VersusPlayer[] = [];
  private settings: VersusSettings = { killLimit: 10, timeLimit: 300 };
  private scores = new Map<string, { kills: number; deaths: number }>();
  private respawnTimers = new Map<string, number>();
  private remoteInputs = new Map<string, Controls>();
  private timeLeft = 0;
  private matchOver = false;
  /** Client: posisi target dari snapshot untuk dihaluskan; age = detik sejak snapshot (untuk perkiraan gerak) */
  private targets = new Map<string, { x: number; y: number; angle: number; turret: number; speed: number; age: number }>();

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, events: GameEvents) {
    this.events = events;
    this.renderer = new Renderer(canvas, overlay);
    this.input = new Input(overlay);
    requestAnimationFrame(this.frame);
  }

  // ---------------- Mode ----------------

  private reset(seed: number, mapId?: string) {
    this.world = new World(seed, mapId);
    this.renderer.setWorld(this.world);
    this.effects = new Effects();
    this.tanks = [];
    this.shells = [];
    this.pickups = [];
    this.local = null;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.intermission = 0;
    this.overTimer = -1;
    this.paused = false;
    this.pendingEvents = [];
    this.scores.clear();
    this.respawnTimers.clear();
    this.remoteInputs.clear();
    this.targets.clear();
    this.matchOver = false;
    this.input.reset();
    crew.silence();
  }

  /** Pertempuran AI vs AI sebagai latar menu */
  startDemo() {
    this.reset(Math.floor(Math.random() * 1e9), pick(MAPS).id);
    this.mode = "demo";
    this.difficulty = DIFFICULTIES[1];
    for (const team of ["blue", "red"]) this.spawnDemoTeam(team);
    this.renderer.focus(this.world.width / 2, this.world.height / 2, true);
  }

  private spawnDemoTeam(team: string) {
    const left = team === "blue";
    for (let i = 0; i < 3; i++) {
      const tank = new Tank(pick(STANDARD_TANKS), team, left ? rand(250, 600) : rand(1800, 2150), rand(300, 1300));
      this.world.resolveCircle(tank, tank.radius);
      tank.angle = left ? 0 : Math.PI;
      tank.turret = tank.angle;
      tank.ai = new AIController(this.difficulty, tank);
      this.tanks.push(tank);
    }
  }

  startSolo(model: TankModel, difficulty: Difficulty, mapId: string) {
    this.reset(Math.floor(Math.random() * 1e9), mapId);
    this.mode = "solo";
    this.difficulty = difficulty;
    this.local = new Tank(model, "player", this.world.width / 2, this.world.height / 2);
    this.local.angle = -Math.PI / 2;
    this.local.turret = this.local.angle;
    this.tanks.push(this.local);
    this.renderer.chase(this.local.x, this.local.y, this.local.angle, true);
    this.intermission = 1.2;
  }

  /**
   * Versus semua lawan semua, atau Merah lawan Biru bila settings.teams.
   * Host menjalankan simulasi, client hanya menampilkan.
   */
  startVersus(role: "host" | "client", seed: number, players: VersusPlayer[], settings: VersusSettings, localId: string) {
    this.reset(seed, settings.map);
    this.mode = role;
    this.players = players;
    this.settings = settings;
    this.timeLeft = settings.timeLimit;
    const taken: { x: number; y: number }[] = [];
    players.forEach((p, i) => {
      // Posisi awal melingkar di arena; mode tim: tiap tim di sisi petanya sendiri
      const a = (i / players.length) * Math.PI * 2;
      const side = settings.teams ? p.team : undefined;
      const spot = role === "host" ? this.world.findOpenSpot(taken, 450, side) : { x: this.world.width / 2 + Math.cos(a) * 600, y: this.world.height / 2 + Math.sin(a) * 450 };
      taken.push(spot);
      // Tank satu tim tidak saling melukai (peluru melewati kawan)
      const team = settings.teams ? `team${p.team}` : p.id;
      const tank = new Tank(tankById(p.tank), team, spot.x, spot.y, undefined, p.id);
      tank.label = p.name;
      tank.angle = Math.atan2(this.world.height / 2 - spot.y, this.world.width / 2 - spot.x);
      tank.turret = tank.angle;
      tank.shield = 2.5;
      this.tanks.push(tank);
      this.scores.set(p.id, { kills: 0, deaths: 0 });
      if (p.id === localId) this.local = tank;
    });
    if (this.local) this.renderer.chase(this.local.x, this.local.y, this.local.angle, true);
    const mine = players.find((p) => p.id === localId);
    this.events.banner(
      settings.teams && mine ? `Tim ${TEAMS[mine.team].name}` : "Pertempuran Dimulai!",
      settings.teams ? `Hancurkan ${settings.killLimit} tank musuh bersama timmu` : `Hancurkan ${settings.killLimit} tank untuk menang`,
    );
    sound.fanfare();
    crew.say("start");
  }

  stop() {
    this.mode = "idle";
    crew.silence();
  }

  setRemoteInput(id: string, ctrl: Controls) {
    this.remoteInputs.set(id, ctrl);
  }

  removePlayer(id: string) {
    this.tanks = this.tanks.filter((t) => t.id !== id);
    this.players = this.players.filter((p) => p.id !== id);
  }

  get isVersus() {
    return this.mode === "host" || this.mode === "client";
  }

  // ---------------- Battle interface ----------------

  fireShell(tank: Tank, shell: Shell) {
    this.shells.push(shell);
    this.emit({ k: "fire", id: tank.id, x: round.r1(shell.x), y: round.r1(shell.y), a: round.r2(tank.turret) });
  }

  tankAt(x: number, y: number, except: Tank) {
    return this.tanks.some((t) => t !== except && (t.alive || t.deadTime < 13) && Math.hypot(t.x - x, t.y - y) < t.radius + 4);
  }

  private volumeAt(x: number, y: number) {
    const f = this.renderer.focusPoint;
    const v = clamp(1 - Math.hypot(x - f.x, y - f.y) / 1500, 0.12, 1);
    return this.mode === "demo" ? v * 0.2 : v;
  }

  private tankById(id: string) {
    return this.tanks.find((t) => t.id === id);
  }

  private nameOf(id: string | null) {
    if (!id) return null;
    return this.players.find((p) => p.id === id)?.name ?? this.tankById(id)?.label ?? "?";
  }

  // ---------------- Event ----------------

  private emit(ev: GameEvent) {
    this.applyEvent(ev);
    if (this.mode === "host") this.pendingEvents.push(ev);
  }

  /** Efek visual & suara dari sebuah event (sama di host maupun client) */
  private applyEvent(ev: GameEvent) {
    switch (ev.k) {
      case "fire": {
        const tank = this.tankById(ev.id);
        if (tank) tank.recoil = 1;
        this.effects.muzzle(ev.x, ev.y, ev.a);
        sound.fire(this.volumeAt(ev.x, ev.y));
        if (tank && tank === this.local) {
          this.renderer.shake(5);
          crew.fired(tank.reloadTime);
        }
        break;
      }
      case "imp":
        this.effects.impact(ev.x, ev.y, ev.m === 1);
        sound.hit(this.volumeAt(ev.x, ev.y) * (ev.m ? 1 : 0.6));
        break;
      case "dmg": {
        const tank = this.tankById(ev.id);
        if (!tank) break;
        tank.hitFlash = 1;
        const color = tank === this.local ? "#ff6b6b" : ev.c ? "#ffd166" : "#ffffff";
        this.effects.text(tank.x, tank.y, `-${ev.n}${ev.c ? " KRITIS!" : ""}`, color, ev.c ? 20 : 17);
        if (tank === this.local) {
          this.renderer.shake(9);
          const shooter = ev.a && ev.a !== tank.id ? this.tankById(ev.a) : null;
          if (shooter) this.renderer.hitFrom(Math.atan2(shooter.y - tank.y, shooter.x - tank.x));
          crew.damaged(tank.hp / tank.maxHp, ev.c === 1);
        } else if (ev.a && ev.a === this.local?.id && tank.hp > 0) crew.say(ev.c ? "weakspot" : "hit");
        break;
      }
      case "boom":
        this.effects.explosion(ev.x, ev.y, ev.s);
        this.world.stampScorch(ev.x, ev.y, 55 * ev.s);
        sound.explosion(this.volumeAt(ev.x, ev.y));
        this.renderer.shake(ev.s > 1.2 && this.local && Math.hypot(this.local.x - ev.x, this.local.y - ev.y) < 60 ? 20 : 11 * this.volumeAt(ev.x, ev.y));
        break;
      case "obs": {
        const o = this.world.obstacles[ev.i];
        if (!o) break;
        o.destroyed = true;
        if (o.kind === "tree") this.effects.leaves(o.x, o.y);
        else if (o.kind === "crate") this.effects.explosion(o.x, o.y, 0.35);
        this.renderer.obstacleDestroyed(o);
        break;
      }
      case "kill": {
        const victim = this.tankById(ev.v);
        if (victim) {
          victim.alive = false;
          victim.hp = 0;
          victim.deadTime = 0;
        }
        if (this.local && ev.v === this.local.id) crew.say("dead");
        else if (this.local && ev.a === this.local.id) crew.say("kill");
        if (this.isVersus) {
          this.events.killFeed(this.nameOf(ev.a), this.nameOf(ev.v) ?? "?", ev.a === this.local?.id, ev.v === this.local?.id);
          if (ev.v === this.local?.id) this.events.banner("Tank kamu hancur!", ev.a && ev.a !== ev.v ? `Dihancurkan oleh ${this.nameOf(ev.a)}` : "Muncul kembali sebentar lagi");
          else if (ev.a === this.local?.id && victim) this.effects.text(victim.x, victim.y, "+1 HANCUR", "#7dff9a", 22);
        }
        break;
      }
      case "pick": {
        const tank = this.tankById(ev.id);
        if (!tank) break;
        this.effects.text(tank.x, tank.y, ev.p === 0 ? "+HP" : "TEMBAK CEPAT!", ev.p === 0 ? "#7dff9a" : "#ffd166", 18);
        if (tank === this.local) {
          sound.pickup();
          crew.say(ev.p === 0 ? "repair" : "rapid");
          if (ev.p === 0) crew.healed(tank.hp / tank.maxHp);
        }
        break;
      }
    }
  }

  // ---------------- Loop ----------------

  private frame = (time: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (time - this.last) / 1000 || 0);
    this.last = time;
    this.updateEngineSound();
    if (this.mode === "idle") return;
    // Mode versus tidak bisa dijeda (pemain lain tetap bermain)
    if (!this.paused || this.isVersus) {
      if (this.mode === "client") this.updateClient(dt);
      else this.updateSim(dt);
    }
    this.renderer.render(dt, this);
  };

  /** Suara mesin hanya untuk tank pemain yang masih hidup dan sedang bertempur */
  private updateEngineSound() {
    const t = this.local;
    const running = t && t.alive && (this.mode === "solo" || this.isVersus) && (!this.paused || this.isVersus) && !this.matchOver;
    if (!running) return sound.engine(null);
    const move = this.input.move;
    sound.engine({ load: Math.min(1, Math.hypot(move.x, move.y)), speed: Math.min(1, Math.abs(t.speed) / t.model.speed) });
  }

  private playerControls(player: Tank): Controls {
    // Input mengikuti arah kamera: "atas" di layar = arah pandang kamera (depan tank)
    const raw = this.input.move;
    const move = this.renderer.viewToWorld(raw.x, raw.y);
    let aim: number | null = null;
    let fire = this.input.keyFire;
    const stick = this.input.aimStick;
    if (stick) {
      const dir = this.renderer.viewToWorld(Math.cos(stick.angle), Math.sin(stick.angle));
      aim = Math.atan2(dir.y, dir.x);
      fire = fire || stick.firing;
    } else if (this.input.mouse.used && !this.input.touchUsed) {
      const p = this.renderer.screenToGround(this.input.mouse.x, this.input.mouse.y, true);
      if (p) aim = Math.atan2(p.y - player.pivotY, p.x - player.pivotX);
    } else {
      aim = this.autoAim(player) ?? (Math.hypot(move.x, move.y) > 0.2 ? Math.atan2(move.y, move.x) : null);
    }
    if (this.input.consumeTap()) this.tapFire = 0.35;
    if (this.tapFire > 0) fire = true;
    return { moveX: move.x, moveY: move.y, aim, fire };
  }

  /** Bantuan bidik di HP: turret mengikuti musuh terdekat yang terlihat */
  private autoAim(player: Tank) {
    let best: Tank | null = null;
    let bestD = player.model.range * 1.05;
    for (const t of this.tanks) {
      if (!t.alive || t.team === player.team) continue;
      const d = Math.hypot(t.x - player.x, t.y - player.y);
      if (d < bestD && this.world.lineOfSight(player.x, player.y, t.x, t.y)) {
        best = t;
        bestD = d;
      }
    }
    return best ? Math.atan2(best.y - player.pivotY, best.x - player.pivotX) : null;
  }

  private controlsFor(tank: Tank, dt: number): Controls {
    if (!tank.alive) return IDLE;
    if (tank === this.local && !this.matchOver && this.overTimer < 0) return this.playerControls(tank);
    if (tank.ai) return tank.ai.update(tank, this, dt);
    if (this.mode === "host") return this.remoteInputs.get(tank.id) ?? IDLE;
    return IDLE;
  }

  /** Simulasi penuh: solo, demo, dan host versus */
  private updateSim(dt: number) {
    this.tapFire = Math.max(0, this.tapFire - dt);
    for (const tank of this.tanks) {
      const before = tank.reloadTimer;
      tank.simulate(dt, this.matchOver ? IDLE : this.controlsFor(tank, dt), this);
      if (tank === this.local && this.tapFire > 0 && tank.reloadTimer > before) this.tapFire = 0;
    }
    this.resolveCollisions();
    for (const tank of this.tanks) tank.cosmetics(dt, tank.speed * dt, this);
    this.updateShells(dt);
    this.updatePickups(dt);
    this.effects.update(dt);
    if (this.mode === "solo" || this.mode === "demo") this.tanks = this.tanks.filter((t) => t.alive || t.deadTime < 13);

    if (this.mode === "solo") this.updateWaves(dt);
    else if (this.mode === "demo") this.updateDemo(dt);
    else if (this.mode === "host") this.updateMatch(dt);

    this.followLocal();
    this.publishHud(dt);
  }

  /** Client versus: tampilkan snapshot dari host dengan gerak yang dihaluskan */
  private updateClient(dt: number) {
    this.tapFire = Math.max(0, this.tapFire - dt);
    const k = smoothing(14, dt);
    for (const tank of this.tanks) {
      const target = this.targets.get(tank.id);
      if (target) {
        // Perkirakan gerak di antara snapshot (20×/detik) agar tank melaju mulus, bukan maju-berhenti.
        // Dibatasi 0,2 detik supaya tidak kebablasan bila paket terlambat.
        if (target.age < 0.2 && tank.alive) {
          target.x += Math.cos(target.angle) * target.speed * dt;
          target.y += Math.sin(target.angle) * target.speed * dt;
        }
        target.age += dt;
        const beforeX = tank.x;
        const beforeY = tank.y;
        tank.x += (target.x - tank.x) * k;
        tank.y += (target.y - tank.y) * k;
        tank.angle += angleDiff(tank.angle, target.angle) * k;
        // Turret milik sendiri langsung mengikuti bidikan lokal agar terasa responsif
        if (tank !== this.local || !this.localAim) tank.turret += angleDiff(tank.turret, target.turret) * k;
        const moved = (tank.x - beforeX) * Math.cos(tank.angle) + (tank.y - beforeY) * Math.sin(tank.angle);
        tank.cosmetics(dt, moved, this);
      }
      if (!tank.alive) tank.deadTime += dt;
    }
    for (const s of this.shells) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    this.effects.update(dt);

    if (this.local && this.local.alive && !this.matchOver) {
      const ctrl = this.playerControls(this.local);
      this.localAim = ctrl.aim;
      if (ctrl.aim !== null) this.local.turret = ctrl.aim;
      this.netTimer -= dt;
      if (this.netTimer <= 0) {
        this.netTimer = 1 / 30;
        this.onLocalInput(ctrl);
      }
    } else if (this.netTimer <= 0) {
      this.netTimer = 0.2;
      this.onLocalInput(IDLE);
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.followLocal();
    this.publishHud(dt);
  }

  private localAim: number | null = null;

  applySnapshot(s: Snapshot) {
    if (this.mode !== "client") return;
    const seen = new Set<string>();
    for (const [id, x, y, angle, turret, hp, alive, speed, rapid, shield] of s.tanks as TankState[]) {
      seen.add(id);
      const tank = this.tankById(id);
      if (!tank) continue;
      const target = this.targets.get(id);
      const respawned = !tank.alive && alive === 1;
      // Teleport (muncul kembali) → langsung pindah tanpa dihaluskan
      if (!target || respawned || Math.hypot(tank.x - x, tank.y - y) > 160) {
        tank.x = x;
        tank.y = y;
        tank.angle = angle;
        tank.turret = turret;
      }
      this.targets.set(id, { x, y, angle, turret, speed, age: 0 });
      tank.hp = hp;
      if (respawned) {
        tank.deadTime = 0;
        tank.alive = true;
        if (tank === this.local) crew.respawned();
      } else if (alive === 0 && tank.alive) {
        tank.alive = false;
        tank.deadTime = 0;
      }
      tank.speed = speed;
      tank.vx = Math.cos(tank.angle) * speed;
      tank.vy = Math.sin(tank.angle) * speed;
      tank.rapidFire = rapid ? 1 : 0;
      tank.shield = shield ? 1 : 0;
    }
    this.tanks = this.tanks.filter((t) => seen.has(t.id));
    this.shells = s.shells.map(([x, y, vx, vy]) => ({ x, y, vx, vy, damage: 0, team: "", owner: this.tanks[0], traveled: 0, range: 0 }));
    this.pickups = s.pickups.map(([id, kind, x, y]) => ({ id, kind: kind === 0 ? "repair" : "rapid", x, y, life: 99 }));
    for (const [id, kills, deaths] of s.scores) this.scores.set(id, { kills, deaths });
    this.respawnTimers = new Map(s.respawn);
    this.timeLeft = s.time;
    for (const ev of s.ev) this.applyEvent(ev);
    if (s.over && !this.matchOver) {
      this.matchOver = true;
      this.events.matchEnd(this.scoreRows());
    }
  }

  private followLocal() {
    const target = this.local ?? null;
    if (target) {
      this.renderer.chase(target.x, target.y, target.angle);
    } else {
      const alive = this.tanks.filter((t) => t.alive);
      if (alive.length) this.renderer.focus(alive.reduce((s, t) => s + t.x, 0) / alive.length, alive.reduce((s, t) => s + t.y, 0) / alive.length, false, 1.2);
    }
  }

  private publishHud(dt: number) {
    this.hudTimer -= dt;
    if (this.hudTimer > 0 || !this.local || (this.mode !== "solo" && !this.isVersus)) return;
    this.hudTimer = 0.1;
    const p = this.local;
    const mine = this.scores.get(p.id);
    // Tank yang menyamar menampilkan HP dalam skala tank yang ditirunya (persentasenya tetap jujur)
    const shownMax = p.model.disguise ? shownModel(p.model).hp : p.maxHp;
    this.events.hud({
      versus: this.isVersus,
      hp: (Math.max(0, p.hp) / p.maxHp) * shownMax,
      maxHp: shownMax,
      reload: this.mode === "client" ? 1 : p.reloadProgress,
      rapidFire: p.rapidFire,
      alive: p.alive,
      wave: this.wave,
      score: this.score,
      enemiesLeft: this.tanks.filter((t) => t.alive && t.team === "enemy").length,
      teams: !!this.settings.teams,
      kills: mine?.kills ?? 0,
      timeLeft: this.timeLeft,
      killLimit: this.settings.killLimit,
      respawnIn: this.respawnTimers.get(p.id) ?? 0,
      board: this.isVersus ? this.scoreRows() : [],
    });
  }

  scoreRows(): ScoreRow[] {
    return this.players
      .map((p) => {
        const s = this.scores.get(p.id) ?? { kills: 0, deaths: 0 };
        return { id: p.id, name: p.name, tank: p.tank, team: p.team, kills: s.kills, deaths: s.deaths, local: p.id === this.local?.id };
      })
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  // ---------------- Fisika ----------------

  private resolveCollisions() {
    for (const t of this.tanks) {
      if (t.alive && this.world.resolveCircle(t, t.radius)) t.speed *= 0.92;
    }
    for (let i = 0; i < this.tanks.length; i++) {
      for (let j = i + 1; j < this.tanks.length; j++) {
        const a = this.tanks[i];
        const b = this.tanks[j];
        if (!a.alive && !b.alive) continue;
        // Bangkai versus segera "hilang" saat muncul kembali; tetap menghalangi sebentar
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = (a.radius + b.radius) * 0.85;
        if (d >= min || d < 0.01) continue;
        const push = min - d;
        const nx = dx / d;
        const ny = dy / d;
        const shareA = !a.alive ? 0 : !b.alive ? 1 : 0.5;
        a.x -= nx * push * shareA;
        a.y -= ny * push * shareA;
        b.x += nx * push * (1 - shareA);
        b.y += ny * push * (1 - shareA);
      }
    }
  }

  private updateShells(dt: number) {
    const remaining: Shell[] = [];
    for (const s of this.shells) {
      const stepLength = Math.hypot(s.vx, s.vy) * dt;
      const steps = Math.max(1, Math.ceil(stepLength / 10));
      let alive = true;
      for (let i = 0; i < steps && alive; i++) {
        s.x += (s.vx * dt) / steps;
        s.y += (s.vy * dt) / steps;
        s.traveled += stepLength / steps;

        const obstacle = this.world.pointBlocked(s.x, s.y);
        if (obstacle) {
          this.hitObstacle(obstacle, s);
          alive = false;
          break;
        }
        for (const t of this.tanks) {
          if (t.team === s.team && t.alive) continue;
          if (!t.alive && t.deadTime > 2.5) continue;
          if (Math.hypot(t.x - s.x, t.y - s.y) < t.radius * 0.82) {
            if (t.alive) this.hitTank(t, s);
            else this.emit({ k: "imp", x: round.r1(s.x), y: round.r1(s.y), m: 1 });
            alive = false;
            break;
          }
        }
        if (alive && (s.traveled > s.range || !this.world.insideBounds(s.x, s.y))) {
          this.emit({ k: "imp", x: round.r1(s.x), y: round.r1(s.y), m: 0 });
          alive = false;
        }
      }
      if (alive) remaining.push(s);
    }
    this.shells = remaining;
  }

  private hitObstacle(o: Obstacle, s: Shell) {
    const hard = o.kind === "building" || o.kind === "wall" || o.kind === "rock";
    this.emit({ k: "imp", x: round.r1(s.x), y: round.r1(s.y), m: hard ? 1 : 0 });
    if (o.hp !== Infinity) {
      o.hp -= s.damage;
      if (o.hp <= 0) this.destroyObstacle(o, s.owner);
    }
  }

  private destroyObstacle(o: Obstacle, by: Tank | null) {
    if (o.destroyed) return;
    this.emit({ k: "obs", i: o.index });
    if (o.kind === "crate" && (this.mode === "solo" || this.isVersus) && Math.random() < 0.35) this.spawnPickup(o.x, o.y);
    if (o.kind === "barrel") {
      this.emit({ k: "boom", x: o.x, y: o.y, s: 1.1 });
      this.areaDamage(o.x, o.y, 120, 75, by);
    }
  }

  private areaDamage(x: number, y: number, radius: number, damage: number, by: Tank | null) {
    for (const t of [...this.tanks]) {
      if (!t.alive || t.shield > 0) continue;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d > radius) continue;
      const amount = Math.round(damage * (1 - d / radius) * (1 - t.model.armor * 0.5));
      if (amount <= 0) continue;
      t.hp -= amount;
      this.emit({ k: "dmg", id: t.id, n: amount, c: 0, a: by?.id });
      if (t.hp <= 0) this.killTank(t, by);
    }
    for (const o of this.world.obstacles) {
      if (o.destroyed || o.hp === Infinity) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < radius) {
        o.hp -= damage * (1 - d / radius);
        if (o.hp <= 0) this.destroyObstacle(o, by);
      }
    }
  }

  private hitTank(t: Tank, s: Shell) {
    this.emit({ k: "imp", x: round.r1(s.x), y: round.r1(s.y), m: 1 });
    if (t.shield > 0) return;
    // Sisi yang terkena: depan lebih tahan, belakang paling rentan
    const incoming = Math.atan2(-s.vy, -s.vx);
    const facing = Math.cos(angleDiff(t.angle, incoming));
    const mult = facing > 0.55 ? 0.8 : facing < -0.55 ? 1.4 : 1;
    const amount = Math.max(1, Math.round(s.damage * mult * (1 - t.model.armor) * rand(0.9, 1.1)));
    t.hp -= amount;
    this.emit({ k: "dmg", id: t.id, n: amount, c: mult > 1 ? 1 : 0, a: s.owner.id });
    if (t.hp <= 0) this.killTank(t, s.owner);
  }

  private killTank(t: Tank, killer: Tank | null) {
    if (!t.alive) return;
    t.speed = 0;
    this.emit({ k: "boom", x: Math.round(t.x), y: Math.round(t.y), s: 1.4 });
    this.emit({ k: "kill", a: killer?.id ?? null, v: t.id });

    if (this.isVersus) {
      const victim = this.scores.get(t.id);
      if (victim) victim.deaths++;
      // Menghancurkan diri sendiri atau kawan setim (mis. lewat tong meledak) tidak dihitung
      if (killer && killer.team !== t.team) {
        const score = this.scores.get(killer.id);
        if (score) score.kills++;
        const total = this.settings.teams ? Math.max(...teamTotals(this.scoreRows())) : (score?.kills ?? 0);
        if (total >= this.settings.killLimit) this.endMatch();
      }
      this.respawnTimers.set(t.id, RESPAWN_TIME);
      return;
    }

    if (this.mode !== "solo") return;
    if (killer === this.local && t.team === "enemy") {
      this.kills++;
      const points = Math.round((100 + this.wave * 15) * this.difficulty.scoreMult);
      this.score += points;
      this.effects.text(t.x, t.y, `+${points}`, "#7dff9a", 22);
      if (Math.random() < 0.4) this.spawnPickup(t.x, t.y);
    }
    if (t === this.local) this.overTimer = 2.4;
  }

  private spawnPickup(x: number, y: number) {
    this.pickups.push({ id: this.pickupId++, kind: Math.random() < 0.6 ? "repair" : "rapid", x, y, life: 18 });
  }

  private updatePickups(dt: number) {
    this.pickups = this.pickups.filter((p) => {
      p.life -= dt;
      const taker = this.tanks.find((t) => t.alive && (t === this.local || this.isVersus) && Math.hypot(t.x - p.x, t.y - p.y) < t.radius + 16);
      if (taker) {
        if (p.kind === "repair") taker.hp = Math.min(taker.maxHp, taker.hp + Math.round(taker.maxHp * 0.35));
        else taker.rapidFire = 8;
        this.emit({ k: "pick", id: taker.id, p: p.kind === "repair" ? 0 : 1 });
        return false;
      }
      return p.life > 0;
    });
  }

  // ---------------- Solo: gelombang musuh ----------------

  private updateWaves(dt: number) {
    const player = this.local;
    if (!player) return;
    if (this.overTimer >= 0) {
      this.overTimer -= dt;
      if (this.overTimer < 0) {
        this.overTimer = -2;
        this.finishSolo();
      }
      return;
    }
    if (this.overTimer === -2) return;

    const enemiesAlive = this.tanks.some((t) => t.alive && t.team === "enemy");
    if (!enemiesAlive && this.intermission <= 0) {
      this.intermission = 3;
      if (this.wave > 0) {
        const heal = Math.round(player.maxHp * 0.25);
        player.hp = Math.min(player.maxHp, player.hp + heal);
        crew.healed(player.hp / player.maxHp);
        this.score += Math.round(50 * this.wave * this.difficulty.scoreMult);
        this.events.banner(`Gelombang ${this.wave} selesai!`, `Tank diperbaiki +${heal} HP`);
      }
    }
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startWave(this.wave + 1);
    }
  }

  private startWave(n: number) {
    this.wave = n;
    const count = this.difficulty.waveSize(n);
    for (let i = 0; i < count; i++) {
      const spot = this.world.findOpenSpot(this.local ? [this.local] : [], 750);
      const enemy = new Tank(pick(STANDARD_TANKS), "enemy", spot.x, spot.y, {
        hpMult: this.difficulty.hpMult * (1 + (n - 1) * 0.05),
        damageMult: this.difficulty.damageMult * (1 + (n - 1) * 0.03),
        reloadMult: this.difficulty.reloadMult,
      });
      if (this.local) enemy.angle = Math.atan2(this.local.y - spot.y, this.local.x - spot.x);
      enemy.turret = enemy.angle;
      enemy.ai = new AIController(this.difficulty, enemy);
      this.tanks.push(enemy);
    }
    this.events.banner(`Gelombang ${n}`, `${count} tank musuh mendekat!`);
    sound.fanfare();
    crew.say(n === 1 ? "start" : "wave");
  }

  private finishSolo() {
    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      /* abaikan */
    }
    const newBest = this.score > best;
    if (newBest) {
      best = this.score;
      try {
        localStorage.setItem(BEST_KEY, String(best));
      } catch {
        /* abaikan */
      }
    }
    this.events.gameOver({ wave: this.wave, kills: this.kills, score: this.score, best, newBest });
  }

  private updateDemo(dt: number) {
    for (const team of ["blue", "red"]) {
      if (this.tanks.some((t) => t.alive && t.team === team)) {
        this.demoRespawn[team] = 0;
        continue;
      }
      this.demoRespawn[team] = (this.demoRespawn[team] ?? 0) + dt;
      if (this.demoRespawn[team] > 2.5) {
        this.demoRespawn[team] = 0;
        this.spawnDemoTeam(team);
      }
    }
  }

  // ---------------- Versus: aturan pertandingan (host) ----------------

  private updateMatch(dt: number) {
    if (!this.matchOver) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) this.endMatch();

      for (const [id, left] of this.respawnTimers) {
        const next = left - dt;
        if (next > 0) {
          this.respawnTimers.set(id, next);
          continue;
        }
        this.respawnTimers.delete(id);
        const tank = this.tankById(id);
        if (!tank) continue;
        const others = this.tanks.filter((t) => t !== tank && t.alive);
        const side = this.settings.teams ? this.players.find((p) => p.id === id)?.team : undefined;
        const spot = this.world.findOpenSpot(others, 550, side);
        tank.respawn(spot.x, spot.y, Math.atan2(this.world.height / 2 - spot.y, this.world.width / 2 - spot.x));
        if (tank === this.local) crew.respawned();
      }

      // Item muncul berkala di arena
      this.pickupTimer -= dt;
      if (this.pickupTimer <= 0) {
        this.pickupTimer = 9;
        if (this.pickups.length < 4) {
          const spot = this.world.findOpenSpot(this.tanks.filter((t) => t.alive), 250);
          this.pickups.push({ id: this.pickupId++, kind: Math.random() < 0.6 ? "repair" : "rapid", x: spot.x, y: spot.y, life: 30 });
        }
      }
    }

    this.netTimer -= dt;
    if (this.netTimer <= 0) {
      this.netTimer = 0.05;
      this.onSnapshot(this.snapshot());
      this.pendingEvents = [];
    }
  }

  private endMatch() {
    if (this.matchOver) return;
    this.matchOver = true;
    this.shells = [];
    this.events.matchEnd(this.scoreRows());
  }

  private snapshot(): Snapshot {
    return {
      time: Math.ceil(this.timeLeft),
      tanks: this.tanks.map((t) => [
        t.id,
        round.r1(t.x),
        round.r1(t.y),
        round.r2(t.angle),
        round.r2(t.turret),
        Math.max(0, Math.round(t.hp)),
        t.alive ? 1 : 0,
        Math.round(t.speed),
        t.rapidFire > 0 ? 1 : 0,
        t.shield > 0 ? 1 : 0,
      ]),
      shells: this.shells.map((s) => [Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy)]),
      pickups: this.pickups.map((p) => [p.id, p.kind === "repair" ? 0 : 1, Math.round(p.x), Math.round(p.y)]),
      scores: [...this.scores].map(([id, s]) => [id, s.kills, s.deaths]),
      respawn: [...this.respawnTimers].map(([id, s]) => [id, Math.ceil(s)]),
      ev: this.pendingEvents,
      over: this.matchOver ? 1 : 0,
    };
  }
}
