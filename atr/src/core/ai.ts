/**
 * Computer driver: follows its own route (main loop or a chosen shortcut) with a look-ahead target,
 * aims for the inside of corners, steers round hazards, brakes for the tightest corner within braking
 * distance and sometimes misjudges one. Skill (0..1) scales corner speed, hazard avoidance and mistakes.
 */

import { clamp, mulberry32, wrapAngle, type Rng } from "./math";
import { effectiveGrip, forwardSpeed, surfaceTopSpeed, type DriveInput } from "./physics";
import { surfaceProps, Surface } from "./surfaces";
import type { NearestHit, Track } from "./track";
import type { CarStats } from "./vehicles";
import type { Entrant, Race } from "./race";

const BAD_PATCH = new Set(["oil", "water", "ice", "goo", "sand", "crystal"]);

export class AIDriver {
  readonly skill: number;
  private readonly rng: Rng;
  /** Route tracking: which path the driver believes it is on and where. */
  path = 0;
  idx = 0;
  s = 0;
  private synced = false;
  private takeBranch: boolean[] = [];
  private decidedLap = -1;
  private stuckT = 0;
  private reverseT = 0;
  private reverseSteer = 1;
  private mistakeT = 0;
  private lastCorner = -1;
  private wobble: number;
  private fireCooldown = 0;
  /** Base time estimates per branch: [main route, shortcut] in seconds. */
  private routeTimes: [number, number][] | null = null;
  private patchInfo: NearestHit[] | null = null;

  constructor(skill: number, seed: number) {
    this.skill = clamp(skill, 0, 1);
    this.rng = mulberry32(seed);
    this.wobble = this.rng() * 10;
  }

  /** Forget the tracked route (after a teleport). */
  resync(): void {
    this.synced = false;
  }

  private sync(track: Track, x: number, y: number): void {
    const h = track.nearest(x, y);
    this.path = h.path;
    this.idx = h.seg;
    this.s = h.s;
    this.synced = true;
  }

  private track(track: Track, x: number, y: number): void {
    if (!this.synced) return this.sync(track, x, y);
    const r = track.nearestOnPath(this.path, x, y, this.idx);
    const p = track.paths[this.path];
    if (r.dist > p.limit * 1.3) return this.sync(track, x, y);
    const prevS = this.s;
    this.idx = r.idx;
    this.s = r.s;
    if (this.path !== 0) {
      if (this.s >= p.length - 12) {
        const to = p.join!.to;
        this.path = 0;
        this.idx = track.main.indexAt(to);
        this.s = to;
      }
      return;
    }
    // On the main loop: switch onto a chosen shortcut when passing its fork.
    for (let b = 1; b < track.paths.length; b++) {
      if (!this.takeBranch[b]) continue;
      const from = track.paths[b].join!.from;
      const passed = prevS <= from && this.s > from && this.s - prevS < 200;
      if (passed) {
        this.path = b;
        this.idx = 0;
        this.s = 0;
        return;
      }
    }
  }

  /** Point `d` px ahead along the route. */
  private ahead(track: Track, d: number): { path: number; s: number } {
    let path = this.path;
    let s = this.s;
    let guard = 0;
    while (d > 0 && guard++ < 6) {
      if (path === 0) {
        let best = -1;
        let bestD = Infinity;
        for (let b = 1; b < track.paths.length; b++) {
          if (!this.takeBranch[b]) continue;
          let delta = track.paths[b].join!.from - s;
          if (delta < 0) delta += track.length;
          if (delta > 0 && delta <= d && delta < bestD) {
            bestD = delta;
            best = b;
          }
        }
        if (best > 0) {
          d -= bestD;
          path = best;
          s = 0;
          continue;
        }
        s = track.main.wrapS(s + d);
        d = 0;
      } else {
        const p = track.paths[path];
        const rem = p.length - s;
        if (d < rem) {
          s += d;
          d = 0;
        } else {
          d -= rem;
          s = p.join!.to;
          path = 0;
        }
      }
    }
    return { path, s };
  }

  private cornerSpeed(stats: CarStats, curv: number, grip: number): number {
    const k = Math.max(Math.abs(curv), 1e-5);
    const yaw = stats.steer * (0.45 + 0.55 * clamp(grip, 0, 1)) * 0.86;
    return (yaw / k) * (0.84 + 0.16 * this.skill);
  }

  private estimateRoutes(track: Track, stats: CarStats): [number, number][] {
    const out: [number, number][] = [[0, 0]];
    const timeAlong = (pi: number, s0: number, len: number): number => {
      const p = track.paths[pi];
      let t = 0;
      for (let d = 0; d < len; d += 20) {
        const a = p.at(s0 + d);
        const surf = track.surfaceAt(a.x, a.y);
        const v = Math.min(surfaceTopSpeed(stats, surf), this.cornerSpeed(stats, p.curv[a.i], effectiveGrip(stats, surf)));
        t += 20 / Math.max(60, v);
      }
      return t;
    };
    for (let b = 1; b < track.paths.length; b++) {
      const bp = track.paths[b];
      let span = bp.join!.to - bp.join!.from;
      if (span < 0) span += track.length;
      const main = timeAlong(0, bp.join!.from, span);
      let branch = timeAlong(b, 0, bp.length);
      for (const pa of track.spec.patches) {
        if (!BAD_PATCH.has(pa.kind)) continue;
        const h = track.nearest(pa.x, pa.y);
        if (h.path === b) branch += 0.35;
      }
      out.push([main, branch]);
    }
    return out;
  }

  private decideRoutes(track: Track, stats: CarStats, lap: number): void {
    if (lap === this.decidedLap) return;
    this.decidedLap = lap;
    if (!this.routeTimes) this.routeTimes = this.estimateRoutes(track, stats);
    for (let b = 1; b < track.paths.length; b++) {
      const [tm, tb] = this.routeTimes[b];
      const noise = 1 + (this.rng() - 0.5) * 0.3 * (1.2 - this.skill);
      this.takeBranch[b] = tb * noise < tm;
    }
  }

  drive(me: Entrant, race: Race, dt: number): DriveInput {
    const track = race.track;
    const car = me.car;
    const stats = me.stats;
    this.track(track, car.x, car.y);
    this.decideRoutes(track, stats, Math.floor(me.progress / track.length));
    const v = forwardSpeed(car);
    const sp = Math.abs(v);
    this.fireCooldown -= dt;

    // Unsticking: reverse out when pinned against something.
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      return { throttle: 0, brake: 1, steer: this.reverseSteer, fire: false };
    }

    // Target point.
    const look = 70 + sp * 0.42;
    const tgt = this.ahead(track, look);
    const tp = track.paths[tgt.path];
    const ta = tp.at(tgt.s);
    const far = this.ahead(track, look * 1.7 + 60);
    const fp = track.paths[far.path];
    const fc = fp.curv[fp.indexAt(far.s)];
    let offset = Math.sign(fc) * Math.min(1, Math.abs(fc) * 260) * tp.halfW * 0.42 * this.skill;
    offset += Math.sin(race.time * 0.35 + this.wobble) * tp.halfW * 0.18;

    // Goodies near the target, then hazards (which win).
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    for (const pk of race.pickups) {
      if (!pk.active || !race.pickupUseful(pk.spec.kind)) continue;
      const dx = pk.spec.x - car.x;
      const dy = pk.spec.y - car.y;
      const along = dx * fx + dy * fy;
      if (along < 40 || along > look + 120) continue;
      const lat = (pk.spec.x - ta.x) * -ta.ty + (pk.spec.y - ta.y) * ta.tx;
      if (Math.abs(lat - offset) < 70 && Math.abs(lat) < tp.halfW - 15) offset = lat;
    }
    if (!this.patchInfo) this.patchInfo = track.spec.patches.map((pa) => track.nearest(pa.x, pa.y));
    for (let i = 0; i < track.spec.patches.length; i++) {
      const pa = track.spec.patches[i];
      const info = this.patchInfo[i];
      if (info.path !== tgt.path && info.path !== this.path) continue;
      const dx = pa.x - car.x;
      const dy = pa.y - car.y;
      const along = dx * fx + dy * fy;
      if (along < -20 || along > look + 260) continue;
      const lat = info.lateral;
      const reach = Math.max(pa.rx, pa.ry) * 0.85 + 22;
      if (Math.abs(lat) > tp.halfW + reach) continue;
      if (pa.kind === "boost") {
        if (this.skill > 0.5) offset = clamp(lat, -tp.halfW + 20, tp.halfW - 20);
        continue;
      }
      if (!BAD_PATCH.has(pa.kind)) continue;
      if (pa.ry > tp.halfW * 0.85) continue; // full-width ford: no way round
      const avoid = ((i * 7919 + me.index * 104729) % 1000) / 1000 < 0.25 + 0.75 * this.skill;
      if (!avoid) continue;
      if (Math.abs(offset - lat) < reach) {
        const side = lat > 0 ? -1 : 1;
        offset = clamp(lat + side * reach, -tp.halfW + 18, tp.halfW - 18);
      }
    }
    // Overtaking: pull out beside a slower car just ahead.
    for (const o of race.entrants) {
      if (o === me || o.car.z > 20) continue;
      const dx = o.car.x - car.x;
      const dy = o.car.y - car.y;
      const along = dx * fx + dy * fy;
      if (along < 10 || along > 70 + sp * 0.25) continue;
      const across = -dx * fy + dy * fx;
      if (Math.abs(across) > me.stats.width + 8) continue;
      if (sp < Math.abs(forwardSpeed(o.car)) + 15) continue;
      const theirs = o.hit.path === this.path ? o.hit.lateral : offset;
      const side = theirs > 0 ? -1 : 1;
      const room = side > 0 ? tp.halfW - theirs : tp.halfW + theirs;
      offset = room > me.stats.width + 30 ? theirs + side * (me.stats.width + 14) : theirs - side * (me.stats.width + 14);
      break;
    }
    offset = clamp(offset, -tp.halfW + 16, tp.halfW - 16);
    const tx = ta.x - ta.ty * offset;
    const ty = ta.y + ta.tx * offset;

    // Steering.
    const desired = Math.atan2(ty - car.y, tx - car.x);
    const err = wrapAngle(desired - car.angle);
    let steer = clamp(err * 2.6 - car.angVel * 0.1, -1, 1);
    if (this.skill < 0.7) steer = clamp(steer + Math.sin(race.time * 3.1 + this.wobble) * (0.7 - this.skill) * 0.25, -1, 1);

    // Speed: slowest corner within braking distance, with kinematic allowance for the distance.
    const brakeEff = stats.brake * 0.75;
    const horizon = Math.max(260, (sp * sp) / (2 * brakeEff) + 140);
    let target = stats.vmax * 1.4;
    let cornerId = -1;
    for (let d = 40; d <= horizon; d += 40) {
      const q = this.ahead(track, d);
      const p = track.paths[q.path];
      const a = p.at(q.s);
      const k = p.curv[a.i];
      const surf = track.surfaceAt(a.x, a.y);
      const grip = effectiveGrip(stats, surf);
      const vc = this.cornerSpeed(stats, k, grip) * (surfaceProps(surf).spin ? 0.8 : 1);
      const allowed = Math.sqrt(vc * vc + 2 * brakeEff * Math.max(0, d - 60));
      if (allowed < target) {
        target = allowed;
        if (Math.abs(k) > 1 / 240) cornerId = q.path * 100000 + Math.floor(p.indexAt(q.s) / 40);
      }
    }
    if (car.surface === Surface.Ice || car.surface === Surface.Crystal) target = Math.min(target, stats.vmax * 0.72);

    // Occasional misjudged corner.
    if (cornerId >= 0 && cornerId !== this.lastCorner) {
      this.lastCorner = cornerId;
      if (this.rng() < (1 - this.skill) * 0.28) this.mistakeT = 0.45;
    }
    let throttle: number;
    let brake = 0;
    if (this.mistakeT > 0) {
      this.mistakeT -= dt;
      throttle = 1;
    } else if (sp < target - 12) {
      throttle = 1;
    } else if (sp < target + 10) {
      throttle = 0.4;
    } else {
      throttle = 0;
      brake = clamp((sp - target) / 90, 0.25, 1);
    }

    // Facing the wrong way at low speed: turn round.
    const path = track.paths[this.path];
    const here = path.at(this.s);
    const facing = fx * here.tx + fy * here.ty;
    if (facing < -0.2 && sp < 120) {
      steer = (here.tx * fy - here.ty * fx) > 0 ? -1 : 1;
      throttle = 1;
      brake = 0;
    }

    // Stuck detection.
    if (throttle > 0.5 && sp < 25 && race.phase === "running") {
      this.stuckT += dt;
      if (this.stuckT > 1.1) {
        this.stuckT = 0;
        this.reverseT = 0.9;
        this.reverseSteer = err > 0 ? -1 : 1;
      }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
    }

    // Weapons.
    let fire = false;
    if (me.weapon && this.fireCooldown <= 0) {
      for (const o of race.entrants) {
        if (o === me) continue;
        const dx = o.car.x - car.x;
        const dy = o.car.y - car.y;
        const d = Math.hypot(dx, dy);
        const along = (dx * fx + dy * fy) / (d || 1);
        if (me.weapon === "missile" && d < 650 && along > 0.93) fire = true;
        if (me.weapon === "mine" && d < 260 && along < -0.85) fire = true;
      }
      if (fire) this.fireCooldown = 1.2 + this.rng() * 1.5;
    }

    return { throttle, brake, steer, fire };
  }
}
