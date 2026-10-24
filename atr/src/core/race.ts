/**
 * Race session: owns the cars, steps the simulation at a fixed rate and applies the rules of the mode.
 *
 *  race   – laps; positions by distance covered; prize money per position plus cash collected.
 *  battle – no laps: one screen follows the leader. Dropping off screen teleports you behind the leader
 *           (+1 for the leader), a missile hit is +1 for the shooter, leading a lap is +2. First to the
 *           target wins.
 *
 * Progress is the unwrapped arc length on the main loop (shortcuts map onto it), so laps, positions and
 * gaps all come from one number. Discrete happenings are queued in `events` for sound and effects.
 */

import { AIDriver } from "./ai";
import { collideCars, collideWalls } from "./collide";
import { clamp, mulberry32, type Rng } from "./math";
import { applyDamage, carSpeed, createCar, forwardSpeed, NO_INPUT, stepCar, type CarState, type DriveInput, type PhysicsEnv } from "./physics";
import { surfaceProps } from "./surfaces";
import { emptyHit, type NearestHit, type PickupKind, type PickupSpec, type Track } from "./track";
import { computeStats, type CarStats, type SpecialId, type UpgradeLevels, type VehicleKind } from "./vehicles";
import type { WorldDef } from "./worlds";

export type RaceMode = "race" | "battle";
export type WeaponKind = "missile" | "mine";

export interface EntrantSetup {
  name: string;
  color: string;
  kind: VehicleKind;
  levels: UpgradeLevels;
  specials?: SpecialId[];
  /** Index of the human player driving this car, or null for the computer. */
  human: number | null;
  skill?: number;
  /** Damage carried into the race (arcade career). */
  damage?: number;
}

export interface RaceOptions {
  track: Track;
  world: WorldDef;
  mode: RaceMode;
  laps: number;
  entrants: EntrantSetup[];
  weapons?: boolean;
  cones?: boolean;
  targetPoints?: number;
  /** 0 = off, 1 = normal. */
  rubberBand?: number;
  seed?: number;
  /** Skip the 3-2-1 countdown (tests, attract mode). */
  noCountdown?: boolean;
}

export interface Entrant {
  index: number;
  setup: EntrantSetup;
  stats: CarStats;
  car: CarState;
  ai: AIDriver | null;
  /** Fallback driver for humans once they have finished (and in autopilot mode). */
  autopilot: AIDriver;
  progress: number;
  /** Distance covered when the race was called (for cars that had not finished). */
  finalProgress: number;
  lastS: number;
  hit: NearestHit;
  lapsDone: number;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  finished: boolean;
  finishTime: number;
  place: number;
  cash: number;
  points: number;
  weapon: WeaponKind | null;
  ammo: number;
  wrecked: boolean;
  offscreen: number;
  grace: number;
  prevFire: boolean;
  onRamp: boolean;
}

export interface PickupState {
  spec: PickupSpec;
  active: boolean;
  respawn: number;
}

export interface ConeState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  z: number;
  vz: number;
}

export interface MineState {
  x: number;
  y: number;
  owner: number;
  age: number;
}

export interface MissileState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  owner: number;
  life: number;
}

export type RaceEvent =
  | { type: "countdown"; n: number }
  | { type: "go" }
  | { type: "pickup"; who: number; kind: PickupKind; x: number; y: number; weapon?: WeaponKind }
  | { type: "wall"; who: number; x: number; y: number; impact: number }
  | { type: "bump"; who: number; other: number; x: number; y: number; impact: number }
  | { type: "spin"; who: number }
  | { type: "jump"; who: number }
  | { type: "land"; who: number; impact: number }
  | { type: "lap"; who: number; lap: number; time: number; best: boolean }
  | { type: "finish"; who: number; place: number }
  | { type: "wreck"; who: number; x: number; y: number }
  | { type: "cone"; who: number; x: number; y: number }
  | { type: "fire"; who: number; weapon: WeaponKind; x: number; y: number }
  | { type: "explode"; x: number; y: number; victim: number | null }
  | { type: "teleport"; who: number; leader: number }
  | { type: "point"; who: number; points: number; reason: string }
  | { type: "win"; who: number };

export const STEP = 1 / 120;

export class Race {
  readonly track: Track;
  readonly world: WorldDef;
  readonly mode: RaceMode;
  readonly laps: number;
  readonly weapons: boolean;
  readonly targetPoints: number;
  readonly entrants: Entrant[];
  readonly pickups: PickupState[];
  readonly cones: ConeState[];
  readonly mines: MineState[] = [];
  readonly missiles: MissileState[] = [];
  events: RaceEvent[] = [];
  phase: "countdown" | "running" | "done" = "countdown";
  countdown = 3.2;
  time = 0;
  /** Seconds since the last human finished (race mode). */
  private afterFinish = -1;
  private finishedCount = 0;
  private lapsLed = 0;
  winner: Entrant | null = null;
  /** Debug/demo: computer drives the human cars too. */
  autopilotHumans = false;
  /** Visible world rectangle for battle teleports; set by the app every frame. */
  view: { cx: number; cy: number; hw: number; hh: number } | null = null;
  private readonly rng: Rng;
  private readonly env: PhysicsEnv;
  private readonly rubberBand: number;
  private contact = { x: 0, y: 0 };

  constructor(opts: RaceOptions) {
    this.track = opts.track;
    this.world = opts.world;
    this.mode = opts.mode;
    this.laps = opts.laps;
    this.weapons = opts.mode === "battle" && !!opts.weapons;
    this.targetPoints = opts.targetPoints ?? 10;
    this.rubberBand = opts.rubberBand ?? 1;
    this.rng = mulberry32(opts.seed ?? 1);
    this.env = { gravity: opts.world.gravity, rng: this.rng };
    if (opts.noCountdown) {
      this.phase = "running";
      this.countdown = 0;
    }

    this.entrants = opts.entrants.map((setup, i) => {
      const slot = this.track.gridSlot(i);
      const car = createCar(slot.x, slot.y, slot.angle);
      car.damage = setup.damage ?? 0;
      const stats = computeStats(setup.kind, setup.levels, setup.specials ?? []);
      const hit = this.track.nearest(car.x, car.y, emptyHit());
      // Grid slots are behind the line: progress starts slightly negative.
      let s = hit.sMain;
      if (s > this.track.length / 2) s -= this.track.length;
      const seed = (opts.seed ?? 1) * 31 + i * 977;
      return {
        index: i,
        setup,
        stats,
        car,
        ai: setup.human === null ? new AIDriver(setup.skill ?? 0.7, seed) : null,
        autopilot: new AIDriver(0.6, seed + 1),
        progress: s,
        finalProgress: s,
        lastS: hit.sMain,
        hit,
        lapsDone: 0,
        lapStart: 0,
        lastLap: NaN,
        bestLap: Infinity,
        finished: false,
        finishTime: Infinity,
        place: i + 1,
        cash: 0,
        points: 0,
        weapon: null,
        ammo: 0,
        wrecked: false,
        offscreen: 0,
        grace: 3,
        prevFire: false,
        onRamp: false,
      };
    });

    this.pickups = this.track.spec.pickups
      .filter((p) => this.pickupUseful(p.kind))
      .map((spec) => ({ spec, active: true, respawn: 0 }));
    this.cones = opts.cones === false ? [] : this.track.spec.cones.map((c) => ({ x: c.x, y: c.y, vx: 0, vy: 0, rot: 0, spin: 0, z: 0, vz: 0 }));
  }

  /** Which pickups exist in this mode. */
  pickupUseful(kind: PickupKind): boolean {
    if (kind === "weapon") return this.weapons;
    if (kind === "cash") return this.mode === "race";
    return true;
  }

  humans(): Entrant[] {
    return this.entrants.filter((e) => e.setup.human !== null);
  }

  /** Current order: finishers by time, then by distance covered. */
  standings(): Entrant[] {
    // Once a race is over its order is final, even though the cars keep rolling behind the results.
    if (this.phase === "done" && this.mode === "race") return [...this.entrants].sort((a, b) => a.place - b.place);
    return [...this.entrants].sort((a, b) => {
      if (this.mode === "battle" && a.points !== b.points) return b.points - a.points;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.wrecked !== b.wrecked) return a.wrecked ? 1 : -1;
      return b.progress - a.progress;
    });
  }

  /** The car furthest along the track. */
  leader(): Entrant {
    let best = this.entrants[0];
    for (const e of this.entrants) if (!e.wrecked && e.progress > best.progress) best = e;
    return best;
  }

  step(dt: number, inputs: DriveInput[]): void {
    if (this.phase === "done") {
      // Keep the cars rolling to a stop behind the results.
      for (const e of this.entrants) this.stepEntrant(e, e.ai ? e.ai.drive(e, this, dt) : e.autopilot.drive(e, this, dt), dt);
      return;
    }
    if (this.phase === "countdown") {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after >= 1 && after <= 3) this.events.push({ type: "countdown", n: after });
      if (this.countdown <= 0) {
        this.phase = "running";
        this.events.push({ type: "go" });
        for (const e of this.entrants) {
          if (e.setup.specials?.includes("nitro")) e.car.turbo = 4;
          if (e.setup.specials?.includes("shield")) e.car.shield = 12;
        }
      }
      for (const e of this.entrants) e.car.throttle = e.setup.human !== null ? (inputs[e.setup.human]?.throttle ?? 0) : 0.3;
      return;
    }

    this.time += dt;
    this.applyRubberBand();
    for (const e of this.entrants) {
      let input: DriveInput;
      if (e.wrecked) input = NO_INPUT;
      else if (e.setup.human !== null && !e.finished && !this.autopilotHumans) input = inputs[e.setup.human] ?? NO_INPUT;
      else if (e.ai) input = e.ai.drive(e, this, dt);
      else input = e.autopilot.drive(e, this, dt);
      this.stepEntrant(e, input, dt);
      if (input.fire && !e.prevFire) this.fire(e);
      e.prevFire = input.fire;
    }
    this.carContacts();
    this.stepCones(dt);
    this.stepWeapons(dt);
    this.stepPickups(dt);
    if (this.mode === "battle") this.battleRules(dt);
    else this.raceRules(dt);
  }

  private applyRubberBand(): void {
    if (this.mode !== "race" || this.rubberBand <= 0) return;
    const humans = this.humans();
    if (humans.length === 0) return;
    const ref = Math.max(...humans.map((h) => h.progress));
    for (const e of this.entrants) {
      if (!e.ai) continue;
      const gap = e.progress - ref; // + ahead of the player
      e.car.rubber = clamp(1 - (gap / 5000) * 0.1 * this.rubberBand, 0.9, 1 + 0.06 * this.rubberBand);
    }
  }

  private stepEntrant(e: Entrant, input: DriveInput, dt: number): void {
    const car = e.car;
    const wasAir = car.z > 0;
    if (car.z <= 0) car.surface = this.track.surfaceAt(car.x, car.y);
    const surf = surfaceProps(car.surface);
    const spinBefore = car.spin;
    stepCar(car, e.stats, input, this.env, dt);
    if (car.spin > 0 && spinBefore <= 0) this.events.push({ type: "spin", who: e.index });

    // Ramps launch the car; low gravity worlds fly further.
    const ramp = car.z <= 0 ? this.track.rampAt(car.x, car.y) : -1;
    if (ramp >= 0 && !e.onRamp) {
      const v = forwardSpeed(car);
      if (v > 150) {
        car.vz = Math.min(v * 0.42, this.world.gravity * 0.6);
        car.z = 0.01;
        this.events.push({ type: "jump", who: e.index });
      }
    }
    e.onRamp = ramp >= 0;
    if (wasAir && car.landImpact > 0) {
      const hard = car.landImpact - 260;
      if (hard > 0) applyDamage(car, e.stats, hard * 0.04 * (1 - e.stats.roughResist));
      this.events.push({ type: "land", who: e.index, impact: car.landImpact });
    }
    void surf;

    const impact = collideWalls(car, e.stats, this.track, this.contact);
    if (impact > 40) {
      if (impact > 90) applyDamage(car, e.stats, (impact - 90) * 0.045);
      this.events.push({ type: "wall", who: e.index, x: this.contact.x, y: this.contact.y, impact });
    }

    // Progress along the main loop.
    this.track.nearest(car.x, car.y, e.hit);
    const L = this.track.length;
    let ds = e.hit.sMain - e.lastS;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    if (Math.abs(ds) < L * 0.4) e.progress += ds;
    e.lastS = e.hit.sMain;
    const laps = Math.floor(e.progress / L);
    if (laps > e.lapsDone && this.phase === "running") {
      e.lapsDone = laps;
      e.lastLap = this.time - e.lapStart;
      const best = e.lastLap < e.bestLap;
      if (best) e.bestLap = e.lastLap;
      e.lapStart = this.time;
      this.events.push({ type: "lap", who: e.index, lap: laps, time: e.lastLap, best });
    }

    if (car.damage >= 100 && !e.wrecked) {
      if (this.mode === "race" && !e.finished) {
        e.wrecked = true;
        this.events.push({ type: "wreck", who: e.index, x: car.x, y: car.y });
      } else {
        car.damage = 85;
      }
    }
    if (this.mode === "battle") car.damage = Math.max(0, car.damage - dt * 1.5);
    e.grace = Math.max(0, e.grace - dt);
  }

  private carContacts(): void {
    const n = this.entrants.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.entrants[i];
        const b = this.entrants[j];
        const imp = collideCars(a, b, this.contact);
        if (imp > 60) {
          const dmg = (imp - 60) * 0.03;
          applyDamage(a.car, a.stats, dmg * (b.stats.mass / a.stats.mass));
          applyDamage(b.car, b.stats, dmg * (a.stats.mass / b.stats.mass));
          this.events.push({ type: "bump", who: i, other: j, x: this.contact.x, y: this.contact.y, impact: imp });
        }
      }
    }
  }

  private stepCones(dt: number): void {
    for (const c of this.cones) {
      for (const e of this.entrants) {
        const car = e.car;
        if (car.z > 14) continue;
        const dx = c.x - car.x;
        const dy = c.y - car.y;
        const r = e.stats.length / 2 + 6;
        if (dx * dx + dy * dy > r * r) continue;
        // Closer test along the car's body.
        const fx = Math.cos(car.angle);
        const fy = Math.sin(car.angle);
        const along = dx * fx + dy * fy;
        const across = -dx * fy + dy * fx;
        if (Math.abs(along) > e.stats.length / 2 + 5 || Math.abs(across) > e.stats.width / 2 + 5) continue;
        const sp = carSpeed(car);
        const rel = Math.hypot(c.vx - car.vx, c.vy - car.vy);
        if (rel < 60) continue;
        c.vx = car.vx * 1.25 + (this.rng() - 0.5) * 120 + (across > 0 ? -fy : fy) * 60;
        c.vy = car.vy * 1.25 + (this.rng() - 0.5) * 120 + (across > 0 ? fx : -fx) * 60;
        c.vz = 80 + sp * 0.3;
        c.spin = (this.rng() - 0.5) * 24;
        car.vx *= 0.95;
        car.vy *= 0.95;
        applyDamage(car, e.stats, 0.6);
        this.events.push({ type: "cone", who: e.index, x: c.x, y: c.y });
      }
      if (c.vx !== 0 || c.vy !== 0 || c.z > 0) {
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.spin * dt;
        if (c.z > 0 || c.vz > 0) {
          c.vz -= this.world.gravity * dt;
          c.z = Math.max(0, c.z + c.vz * dt);
          if (c.z === 0) c.vz = 0;
        }
        const f = c.z > 0 ? 0.3 : 3.5;
        c.vx *= Math.max(0, 1 - f * dt);
        c.vy *= Math.max(0, 1 - f * dt);
        c.spin *= Math.max(0, 1 - 2 * dt);
        if (this.track.marginAt(c.x, c.y) < 4) {
          c.vx *= -0.3;
          c.vy *= -0.3;
          c.x += c.vx * dt * 2;
          c.y += c.vy * dt * 2;
        }
        if (Math.hypot(c.vx, c.vy) < 4 && c.z === 0) {
          c.vx = 0;
          c.vy = 0;
        }
      }
    }
  }

  private fire(e: Entrant): void {
    if (!e.weapon || e.ammo <= 0 || e.wrecked) return;
    const car = e.car;
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    if (e.weapon === "missile") {
      const v = Math.max(0, forwardSpeed(car)) + 620;
      this.missiles.push({ x: car.x + fx * (e.stats.length / 2 + 8), y: car.y + fy * (e.stats.length / 2 + 8), vx: fx * v, vy: fy * v, angle: car.angle, owner: e.index, life: 2.2 });
    } else {
      this.mines.push({ x: car.x - fx * (e.stats.length / 2 + 12), y: car.y - fy * (e.stats.length / 2 + 12), owner: e.index, age: 0 });
    }
    this.events.push({ type: "fire", who: e.index, weapon: e.weapon, x: car.x, y: car.y });
    e.ammo--;
    if (e.ammo <= 0) e.weapon = null;
  }

  private blast(victim: Entrant, x: number, y: number): void {
    const car = victim.car;
    this.events.push({ type: "explode", x, y, victim: victim.index });
    if (car.shield > 0) return;
    car.spin = 0.9;
    car.spinDir = this.rng() < 0.5 ? -1 : 1;
    car.vx *= 0.3;
    car.vy *= 0.3;
    if (car.z <= 0) {
      car.vz = 190;
      car.z = 0.01;
    }
    applyDamage(car, victim.stats, 12);
  }

  private stepWeapons(dt: number): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      // Gentle homing on the nearest car in front.
      let best: Entrant | null = null;
      let bestD = 900;
      const fx = Math.cos(m.angle);
      const fy = Math.sin(m.angle);
      for (const e of this.entrants) {
        if (e.index === m.owner || e.wrecked) continue;
        const dx = e.car.x - m.x;
        const dy = e.car.y - m.y;
        const d = Math.hypot(dx, dy);
        if (d < bestD && (dx * fx + dy * fy) / (d || 1) > 0.8) {
          bestD = d;
          best = e;
        }
      }
      if (best) {
        const want = Math.atan2(best.car.y - m.y, best.car.x - m.x);
        let da = want - m.angle;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        m.angle += clamp(da, -2.6 * dt, 2.6 * dt);
        const sp = Math.hypot(m.vx, m.vy);
        m.vx = Math.cos(m.angle) * sp;
        m.vy = Math.sin(m.angle) * sp;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      let gone = m.life <= 0 || this.track.marginAt(m.x, m.y) < 0;
      if (!gone) {
        for (const e of this.entrants) {
          if (e.index === m.owner || e.car.z > 30) continue;
          if (Math.hypot(e.car.x - m.x, e.car.y - m.y) < e.stats.length / 2 + 4) {
            const shielded = e.car.shield > 0;
            this.blast(e, m.x, m.y);
            if (!shielded && this.mode === "battle") this.award(this.entrants[m.owner], 1, "missile hit");
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        if (m.life <= 0 || this.track.marginAt(m.x, m.y) < 0) this.events.push({ type: "explode", x: m.x, y: m.y, victim: null });
        this.missiles.splice(i, 1);
      }
    }
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mi = this.mines[i];
      mi.age += dt;
      if (mi.age > 40) {
        this.mines.splice(i, 1);
        continue;
      }
      if (mi.age < 0.5) continue;
      for (const e of this.entrants) {
        if ((e.index === mi.owner && mi.age < 1.5) || e.car.z > 14) continue;
        if (Math.hypot(e.car.x - mi.x, e.car.y - mi.y) < e.stats.length / 2 + 6) {
          this.blast(e, mi.x, mi.y);
          this.mines.splice(i, 1);
          break;
        }
      }
    }
  }

  private stepPickups(dt: number): void {
    for (const p of this.pickups) {
      if (!p.active) {
        p.respawn -= dt;
        if (p.respawn <= 0) p.active = true;
        continue;
      }
      for (const e of this.entrants) {
        if (e.wrecked || e.car.z > 24) continue;
        const reach = 26 + (p.spec.kind === "cash" && e.setup.specials?.includes("magnet") ? 52 : 0);
        if (Math.hypot(e.car.x - p.spec.x, e.car.y - p.spec.y) > reach + e.stats.width / 2) continue;
        if (p.spec.kind === "weapon" && e.weapon && e.ammo >= 3) continue;
        p.active = false;
        p.respawn = p.spec.kind === "cash" ? 14 : 7;
        let weapon: WeaponKind | undefined;
        switch (p.spec.kind) {
          case "turbo":
            e.car.turbo = Math.max(e.car.turbo, 2.3);
            break;
          case "cash":
            e.cash += 100;
            break;
          case "shield":
            e.car.shield = 7;
            break;
          case "brakes":
            e.car.powerBrakes = 10;
            break;
          case "repair":
            e.car.damage = Math.max(0, e.car.damage - 35);
            break;
          case "weapon":
            weapon = this.rng() < 0.6 ? "missile" : "mine";
            if (e.weapon === weapon) e.ammo = Math.min(3, e.ammo + 1);
            else {
              e.weapon = weapon;
              e.ammo = 1;
            }
            break;
        }
        this.events.push({ type: "pickup", who: e.index, kind: p.spec.kind, x: p.spec.x, y: p.spec.y, weapon });
        break;
      }
    }
  }

  private award(e: Entrant, points: number, reason: string): void {
    if (this.phase !== "running") return;
    e.points += points;
    this.events.push({ type: "point", who: e.index, points, reason });
    if (e.points >= this.targetPoints && !this.winner) {
      this.winner = e;
      this.phase = "done";
      this.events.push({ type: "win", who: e.index });
    }
  }

  private raceRules(dt: number): void {
    for (const e of this.entrants) {
      if (e.finished || e.wrecked) continue;
      if (e.progress >= this.laps * this.track.length) {
        e.finished = true;
        e.finishTime = this.time;
        e.place = ++this.finishedCount;
        this.events.push({ type: "finish", who: e.index, place: e.place });
      }
    }
    const order = this.standings();
    order.forEach((e, i) => {
      if (!e.finished) e.place = i + 1;
    });
    const humans = this.humans();
    const running = (e: Entrant) => !e.finished && !e.wrecked;
    const pending = humans.length ? humans.some(running) : this.entrants.some(running);
    // Every computer car is home: whoever is still out there cannot finish better than last.
    const aiDone = humans.length > 0 && humans.length < this.entrants.length && !this.entrants.some((e) => e.setup.human === null && running(e));
    if (!pending || aiDone) {
      if (this.afterFinish < 0) this.afterFinish = 0;
      this.afterFinish += dt;
      const allDone = this.entrants.every((e) => e.finished || e.wrecked);
      if (allDone || this.afterFinish > (pending ? 8 : 5)) this.finishRace();
    }
  }

  /** Ends the race; cars still running are ranked by distance covered. */
  finishRace(): void {
    if (this.phase === "done") return;
    const order = this.standings();
    order.forEach((e, i) => {
      e.place = i + 1;
      e.finalProgress = e.progress;
    });
    this.phase = "done";
  }

  private battleRules(dt: number): void {
    const leader = this.leader();
    const L = this.track.length;
    // Leading a lap: the first car to complete each lap.
    if (leader.lapsDone > this.lapsLed) {
      this.lapsLed = leader.lapsDone;
      this.award(leader, 2, "led a lap");
    }
    const view = this.view ?? { cx: leader.car.x, cy: leader.car.y, hw: 640, hh: 380 };
    for (const e of this.entrants) {
      if (e === leader) continue;
      const out = Math.abs(e.car.x - view.cx) > view.hw + 10 || Math.abs(e.car.y - view.cy) > view.hh + 10;
      const gap = leader.progress - e.progress;
      if ((out || gap > L * 0.3) && e.grace <= 0 && leader.grace <= 0.0) e.offscreen += dt;
      else e.offscreen = 0;
      if (e.offscreen > 0.25) {
        this.teleportBehind(e, leader);
        this.award(leader, 1, "pulled away");
      }
    }
  }

  private teleportBehind(e: Entrant, leader: Entrant): void {
    const back = 130 + (e.index % 3) * 45;
    const s = leader.hit.sMain - back;
    const lat = ((e.index % 2) * 2 - 1) * this.track.main.halfW * 0.4;
    const at = this.track.pointOnMain(s, lat);
    const car = e.car;
    const v = Math.max(120, forwardSpeed(leader.car) * 0.7);
    car.x = at.x;
    car.y = at.y;
    car.angle = at.angle;
    car.vx = Math.cos(at.angle) * v;
    car.vy = Math.sin(at.angle) * v;
    car.angVel = 0;
    car.spin = 0;
    car.z = 0;
    car.vz = 0;
    car.drift = 0;
    this.track.nearest(car.x, car.y, e.hit);
    e.lastS = e.hit.sMain;
    let ds = e.hit.sMain - leader.hit.sMain;
    const L = this.track.length;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    e.progress = leader.progress + ds;
    e.lapsDone = Math.floor(e.progress / L);
    e.offscreen = 0;
    e.grace = 1.6;
    e.ai?.resync();
    e.autopilot.resync();
    this.events.push({ type: "teleport", who: e.index, leader: leader.index });
  }

  /** Drains queued events. */
  takeEvents(): RaceEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}
