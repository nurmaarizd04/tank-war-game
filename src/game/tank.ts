import type { TankModel } from "../data/tanks";
import type { AIController } from "./ai";
import { angleDiff, clamp, rand, rotateTowards } from "./math";
import { getTankSprites, type TankSprites } from "./sprites";
import type { Battle, Controls, Team } from "./types";

export interface TankMods {
  hpMult: number;
  damageMult: number;
  reloadMult: number;
}

const NO_MODS: TankMods = { hpMult: 1, damageMult: 1, reloadMult: 1 };

let nextId = 1;

export class Tank {
  /** Id unik (untuk sinkronisasi online) */
  readonly id: string;
  readonly model: TankModel;
  readonly team: Team;
  readonly sprites: TankSprites;
  readonly radius: number;
  readonly mods: TankMods;
  /** Nama pemain (mode versus) */
  label = "";
  x: number;
  y: number;
  angle: number;
  turret: number;
  /** Kecepatan maju (+) / mundur (−) */
  speed = 0;
  vx = 0;
  vy = 0;
  hp: number;
  maxHp: number;
  alive = true;
  reloadTimer = 0;
  recoil = 0;
  rapidFire = 0;
  /** Kebal sesaat setelah muncul kembali */
  shield = 0;
  hitFlash = 0;
  /** Waktu sejak hancur */
  deadTime = 0;
  /** Jarak tempuh untuk animasi rantai */
  trackDistance = 0;
  ai: AIController | null = null;
  private stampDistance = 0;
  private smokeTimer = 0;

  constructor(model: TankModel, team: Team, x: number, y: number, mods: TankMods = NO_MODS, id?: string) {
    this.id = id ?? `t${nextId++}`;
    this.model = model;
    this.team = team;
    this.x = x;
    this.y = y;
    this.angle = rand(0, Math.PI * 2);
    this.turret = this.angle;
    this.mods = mods;
    this.maxHp = Math.round(model.hp * mods.hpMult);
    this.hp = this.maxHp;
    this.sprites = getTankSprites(model);
    this.radius = Math.max(model.look.length, model.look.width) * 0.46;
  }

  get reloadTime() {
    return this.model.reload * this.mods.reloadMult * (this.rapidFire > 0 ? 0.5 : 1);
  }

  get reloadProgress() {
    return clamp(1 - this.reloadTimer / this.reloadTime, 0, 1);
  }

  get pivotX() {
    return this.x + Math.cos(this.angle) * this.model.look.turretOffset;
  }

  get pivotY() {
    return this.y + Math.sin(this.angle) * this.model.look.turretOffset;
  }

  get muzzleX() {
    return this.pivotX + Math.cos(this.turret) * this.sprites.muzzle;
  }

  get muzzleY() {
    return this.pivotY + Math.sin(this.turret) * this.sprites.muzzle;
  }

  respawn(x: number, y: number, angle: number) {
    Object.assign(this, { x, y, angle, turret: angle, speed: 0, vx: 0, vy: 0, hp: this.maxHp, alive: true, deadTime: 0, reloadTimer: 0, rapidFire: 0, shield: 2.5, recoil: 0 });
  }

  /** Fisika & senjata — hanya dijalankan oleh pihak yang memegang simulasi (solo / host) */
  simulate(dt: number, ctrl: Controls, battle: Battle) {
    if (!this.alive) {
      this.deadTime += dt;
      return;
    }
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    this.rapidFire = Math.max(0, this.rapidFire - dt);
    this.shield = Math.max(0, this.shield - dt);

    // Badan berputar ke arah tujuan; mundur jika tujuan ada di belakang
    const magnitude = Math.min(1, Math.hypot(ctrl.moveX, ctrl.moveY));
    let targetSpeed = 0;
    if (magnitude > 0.12) {
      let desired = Math.atan2(ctrl.moveY, ctrl.moveX);
      let direction = 1;
      if (Math.abs(angleDiff(this.angle, desired)) > 2.0) {
        desired += Math.PI;
        direction = -1;
      }
      const diff = angleDiff(this.angle, desired);
      this.angle += clamp(diff, -this.model.hullTurn * dt, this.model.hullTurn * dt);
      const alignment = Math.max(0, Math.cos(diff));
      targetSpeed = this.model.speed * magnitude * alignment * alignment * direction * (direction < 0 ? 0.65 : 1);
    }
    const accel = Math.abs(targetSpeed) > Math.abs(this.speed) ? 220 : 380;
    this.speed += clamp(targetSpeed - this.speed, -accel * dt, accel * dt);
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (ctrl.aim !== null) this.turret = rotateTowards(this.turret, ctrl.aim, this.model.turretTurn * dt);
    if (ctrl.fire && this.reloadTimer <= 0) this.fire(battle);
  }

  private fire(battle: Battle) {
    const spread = rand(-0.012, 0.012);
    const speed = this.model.shellSpeed;
    battle.fireShell(this, {
      x: this.muzzleX,
      y: this.muzzleY,
      vx: Math.cos(this.turret + spread) * speed,
      vy: Math.sin(this.turret + spread) * speed,
      damage: this.model.damage * this.mods.damageMult,
      team: this.team,
      owner: this,
      traveled: 0,
      range: this.model.range,
    });
    this.reloadTimer = this.reloadTime;
    this.speed -= 30 * Math.cos(angleDiff(this.angle, this.turret));
  }

  /** Efek visual (asap, debu, bekas rantai) — dijalankan di semua pemain */
  cosmetics(dt: number, moved: number, battle: Battle) {
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.trackDistance += moved;

    if (!this.alive) {
      this.smokeTimer -= dt;
      if (this.deadTime < 9 && this.smokeTimer <= 0) {
        battle.effects.smoke(this.x, this.y, true, 28);
        if (this.deadTime < 4) battle.effects.fireFlicker(this.x, this.y);
        this.smokeTimer = 0.14;
      }
      return;
    }

    this.stampDistance += Math.abs(moved);
    if (this.stampDistance > 8) {
      this.stampDistance = 0;
      battle.world.stampTrack(this.x, this.y, this.angle, this.model.look.width);
    }
    if (Math.abs(this.speed) > 60 && Math.random() < dt * 8) {
      const back = this.speed > 0 ? -1 : 1;
      battle.effects.dust(this.x + Math.cos(this.angle) * this.model.look.length * 0.5 * back, this.y + Math.sin(this.angle) * this.model.look.length * 0.5 * back);
    }
    if (this.hp < this.maxHp * 0.4) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        const critical = this.hp < this.maxHp * 0.2;
        battle.effects.smoke(this.x - Math.cos(this.angle) * 18, this.y - Math.sin(this.angle) * 18, critical, 22);
        this.smokeTimer = critical ? 0.09 : 0.22;
      }
    }
  }
}
