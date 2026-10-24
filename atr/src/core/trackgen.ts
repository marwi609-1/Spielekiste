/**
 * Deterministic track generator: world + index (0..6) → TrackSpec.
 *
 * Shape: a closed polar curve r(θ) built from a few harmonics, stretched and bent by a smooth
 * displacement field (gives S-bends and hairpins that a pure star shape cannot have). Candidates are
 * rejected when a corner is tighter than the car can take or when two distant parts of the loop come
 * close enough for their corridors to touch. Shortcuts are Hermite curves that leave and rejoin the
 * main loop tangentially; they are shorter but carry the world's risky surface and hazards. Everything
 * else (sections, patches, fords, ramps, tunnels, pickups, cones, scenery) is placed along the arc.
 */

import { clamp, hashString, lerp, mulberry32, pickWeighted, randInt, randRange, TAU, type Rng } from "./math";
import type { PatchKind } from "./surfaces";
import {
  Track,
  TrackPath,
  type ConeSpec,
  type DecorSpec,
  type PatchSpec,
  type PathSpec,
  type PickupKind,
  type PickupSpec,
  type RampSpec,
  type SectionSpec,
  type TrackSpec,
  type TunnelSpec,
} from "./track";
import { WORLD_BY_ID, type WorldDef, type WorldId } from "./worlds";

const SPACING = 10;
export const DEFAULT_LAPS = 6;

type Flat = number[];

function polyLength(p: Flat, closed: boolean): number {
  let L = 0;
  const n = p.length / 2;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const j = (i + 1) % n;
    L += Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]);
  }
  return L;
}

/** Resamples a polyline at (almost) exactly `spacing`. */
export function resample(p: Flat, closed: boolean, spacing: number): Flat {
  const n = p.length / 2;
  const L = polyLength(p, closed);
  const count = Math.max(2, Math.round(L / spacing));
  const step = L / count;
  const out: Flat = [p[0], p[1]];
  let i = 0;
  let segStart = 0;
  let segLen = Math.hypot(p[2] - p[0], p[3] - p[1]);
  const last = closed ? count : count;
  for (let k = 1; k < last + (closed ? 0 : 1); k++) {
    const target = k * step;
    while (segStart + segLen < target && i < n - (closed ? 0 : 1)) {
      segStart += segLen;
      i++;
      const a = i % n;
      const b = (i + 1) % n;
      segLen = Math.hypot(p[b * 2] - p[a * 2], p[b * 2 + 1] - p[a * 2 + 1]);
    }
    const a = i % n;
    const b = (i + 1) % n;
    const t = segLen > 0 ? clamp((target - segStart) / segLen, 0, 1) : 0;
    out.push(p[a * 2] + (p[b * 2] - p[a * 2]) * t, p[a * 2 + 1] + (p[b * 2 + 1] - p[a * 2 + 1]) * t);
  }
  if (!closed) {
    out[out.length - 2] = p[p.length - 2];
    out[out.length - 1] = p[p.length - 1];
  }
  return out;
}

function smoothClosed(p: Flat, passes: number): Flat {
  const n = p.length / 2;
  let a = p.slice();
  for (let k = 0; k < passes; k++) {
    const b = a.slice();
    for (let i = 0; i < n; i++) {
      const h = (i - 1 + n) % n;
      const j = (i + 1) % n;
      b[i * 2] = a[i * 2] + 0.5 * ((a[h * 2] + a[j * 2]) / 2 - a[i * 2]);
      b[i * 2 + 1] = a[i * 2 + 1] + 0.5 * ((a[h * 2 + 1] + a[j * 2 + 1]) / 2 - a[i * 2 + 1]);
    }
    a = b;
  }
  return a;
}

function maxCurv(path: TrackPath): number {
  let m = 0;
  for (let i = 0; i < path.n; i++) m = Math.max(m, Math.abs(path.curv[i]));
  return m;
}

/** Spatial hash of path samples for proximity queries. */
class SampleHash {
  private readonly cells = new Map<number, number[]>();
  constructor(
    readonly path: TrackPath,
    readonly size: number,
  ) {
    for (let i = 0; i < path.n; i++) {
      const k = this.key(Math.floor(path.xs[i] / size), Math.floor(path.ys[i] / size));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(i);
    }
  }
  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }
  /** Calls fn for every sample within roughly one cell of (x, y). */
  near(x: number, y: number, fn: (i: number) => void): void {
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get(this.key(cx + dx, cy + dy));
        if (list) for (const i of list) fn(i);
      }
  }
  /** Distance from (x, y) to the nearest sample within `size`, Infinity if none. */
  minDist(x: number, y: number, skip?: (i: number) => boolean): number {
    let best = Infinity;
    this.near(x, y, (i) => {
      if (skip && skip(i)) return;
      const d = Math.hypot(this.path.xs[i] - x, this.path.ys[i] - y);
      if (d < best) best = d;
    });
    return best;
  }
}

function arcGap(a: number, b: number, L: number): number {
  const d = Math.abs(a - b) % L;
  return Math.min(d, L - d);
}

interface Loop {
  points: Flat;
  path: TrackPath;
}

function makeLoop(world: WorldDef, diff: number, rng: Rng, width: number, shoulder: number): Loop | null {
  const R = randRange(rng, world.radius[0], world.radius[1]);
  const amp = lerp(world.wiggle[0], world.wiggle[1], diff) * randRange(rng, 0.8, 1.15);
  const harmonics: { h: number; a: number; ph: number }[] = [];
  for (let h = 2; h <= 6; h++) harmonics.push({ h, a: (amp * randRange(rng, 0.25, 1)) / Math.pow(h, 0.7), ph: rng() * TAU });
  const aspect = randRange(rng, 0.78, 1.28);
  const warpA = R * lerp(0.08, 0.2, diff) * randRange(rng, 0.6, 1.2);
  const warpF = TAU / (R * randRange(rng, 1.1, 2.2));
  const wp1 = rng() * TAU;
  const wp2 = rng() * TAU;
  const rot = rng() * TAU;

  const dense: Flat = [];
  const N = 2400;
  for (let k = 0; k < N; k++) {
    const th = (k / N) * TAU;
    let r = 1;
    for (const hm of harmonics) r += hm.a * Math.sin(hm.h * th + hm.ph);
    r = R * Math.max(0.35, r);
    let x = Math.cos(th + rot) * r * aspect;
    let y = Math.sin(th + rot) * r / aspect;
    const x2 = x + warpA * Math.sin(y * warpF + wp1);
    const y2 = y + warpA * Math.sin(x * warpF + wp2);
    x = x2;
    y = y2;
    dense.push(x, y);
  }

  const halfW = width / 2;
  const minRad = Math.max(halfW + 22, 105);
  let coarse = resample(dense, true, 30);
  let path: TrackPath | null = null;
  let points: Flat = [];
  for (let pass = 0; pass < 12; pass++) {
    points = resample(coarse, true, SPACING);
    path = new TrackPath({ points, closed: true, width, shoulder });
    if (maxCurv(path) <= 1 / minRad) break;
    coarse = smoothClosed(coarse, 4);
    path = null;
  }
  if (!path) return null;

  // Distant parts of the loop must not touch.
  const limit = halfW + shoulder;
  const sep = 2 * limit + 60;
  const minArc = 2.4 * sep;
  const hash = new SampleHash(path, sep);
  for (let i = 0; i < path.n; i += 2) {
    let bad = false;
    hash.near(path.xs[i], path.ys[i], (j) => {
      if (bad || arcGap(path!.cum[i], path!.cum[j], path!.length) < minArc) return;
      if (Math.hypot(path!.xs[i] - path!.xs[j], path!.ys[i] - path!.ys[j]) < sep) bad = true;
    });
    if (bad) return null;
  }
  return { points, path };
}

/** Rotates a closed loop so that sample `start` becomes sample 0. */
function rotate(points: Flat, start: number): Flat {
  return points.slice(start * 2).concat(points.slice(0, start * 2));
}

function reverse(points: Flat): Flat {
  const out: Flat = [];
  for (let i = points.length / 2 - 1; i >= 0; i--) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

interface Interval {
  from: number;
  to: number;
}

class Reserve {
  private readonly list: Interval[] = [];
  constructor(readonly L: number) {}
  add(from: number, to: number): void {
    this.list.push({ from, to });
  }
  free(from: number, to: number): boolean {
    for (const r of this.list) {
      // Compare on the circle by testing both shifted copies.
      for (const shift of [-this.L, 0, this.L]) {
        if (from < r.to + shift && to > r.from + shift) return false;
      }
    }
    return true;
  }
}

function hermite(ax: number, ay: number, atx: number, aty: number, bx: number, by: number, btx: number, bty: number, m: number, steps: number): Flat {
  const out: Flat = [];
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    out.push(h00 * ax + h10 * m * atx + h01 * bx + h11 * m * btx, h00 * ay + h10 * m * aty + h01 * by + h11 * m * bty);
  }
  return out;
}

interface Branch {
  spec: PathSpec;
  path: TrackPath;
  /** Branch arc where the corridor is clear of the main one (junction ends). */
  clearFrom: number;
  clearTo: number;
}

function makeBranch(main: TrackPath, mainHash: SampleHash, others: Branch[], rng: Rng, width: number, shoulder: number): Branch | null {
  const L = main.length;
  const bWidth = Math.round(width * 0.78);
  const bShoulder = Math.round(shoulder * 0.8);
  const bLimit = bWidth / 2 + bShoulder;
  const req = main.limit + bLimit + 40;
  const minRad = Math.max(bWidth / 2 + 25, 95);
  for (let attempt = 0; attempt < 220; attempt++) {
    const span = randRange(rng, 0.15 * L, 0.42 * L);
    const from = randRange(rng, 0.08 * L, 0.94 * L - span);
    const to = from + span;
    if (others.some((o) => from < o.path.join!.to + 400 && to > o.path.join!.from - 400)) continue;
    const A = main.at(from);
    const B = main.at(to);
    const chord = Math.hypot(B.x - A.x, B.y - A.y);
    if (chord > 0.8 * span || chord < 520) continue;
    const m = chord * randRange(rng, 0.4, 0.95);
    const dense = hermite(A.x, A.y, A.tx, A.ty, B.x, B.y, B.tx, B.ty, m, 600);
    const points = resample(dense, false, SPACING);
    const path = new TrackPath({ points, closed: false, width: bWidth, shoulder: bShoulder, join: { from, to } });
    if (path.length > 0.86 * span || path.length < 0.68 * span) continue;
    if (maxCurv(path) > 1 / minRad) continue;

    // Distance of every branch sample to the main centreline.
    const dist = new Float64Array(path.n);
    for (let k = 0; k < path.n; k++) {
      const d = mainHash.minDist(path.xs[k], path.ys[k]);
      dist[k] = d;
    }
    // Junction zones: from each end inwards until the corridors separate.
    let k0 = 0;
    while (k0 < path.n && dist[k0] < req) k0++;
    let k1 = path.n - 1;
    while (k1 > 0 && dist[k1] < req) k1--;
    if (k0 >= k1) continue;
    const zone0 = path.cum[k0];
    const zone1 = path.length - path.cum[k1];
    if (zone0 > 0.36 * path.length || zone1 > 0.36 * path.length) continue;
    let ok = true;
    for (let k = k0; k <= k1 && ok; k++) if (dist[k] < req) ok = false;
    // In the junction zones the branch must stay close to its own junction on the main loop.
    for (let k = 0; k < k0 && ok; k++) {
      const near = mainHash.minDist(path.xs[k], path.ys[k], (i) => arcGap(main.cum[i], from, L) < path.cum[k] * 1.6 + 400);
      if (near < req) ok = false;
    }
    for (let k = k1 + 1; k < path.n && ok; k++) {
      const near = mainHash.minDist(path.xs[k], path.ys[k], (i) => arcGap(main.cum[i], to, L) < (path.length - path.cum[k]) * 1.6 + 400);
      if (near < req) ok = false;
    }
    for (const o of others) {
      for (let k = 0; k < path.n && ok; k += 2) {
        for (let q = 0; q < o.path.n; q += 2) {
          if (Math.hypot(o.path.xs[q] - path.xs[k], o.path.ys[q] - path.ys[k]) < 2 * bLimit + 60) {
            ok = false;
            break;
          }
        }
      }
    }
    if (!ok) continue;
    return { spec: { points, closed: false, width: bWidth, shoulder: bShoulder, join: { from, to } }, path, clearFrom: zone0, clearTo: path.length - zone1 };
  }
  return null;
}

function pointAt(path: TrackPath, s: number, lateral: number): { x: number; y: number; rot: number } {
  const a = path.at(s);
  return { x: a.x - a.ty * lateral, y: a.y + a.tx * lateral, rot: Math.atan2(a.ty, a.tx) };
}

export function trackId(world: WorldId, index: number): string {
  return `${world}-${index + 1}`;
}

export function generateTrack(worldId: WorldId, index: number): TrackSpec {
  const world = WORLD_BY_ID[worldId];
  const diff = index / 6;
  const baseSeed = hashString(`${worldId}:${index}`);
  const width = Math.round(lerp(world.width[0], world.width[1], diff));
  const shoulder = world.shoulder;

  let loop: Loop | null = null;
  let rng: Rng = mulberry32(baseSeed);
  for (let attempt = 0; attempt < 400 && !loop; attempt++) {
    rng = mulberry32(baseSeed + attempt * 0x9e3779b1);
    // Relax the shape a little if the world/difficulty keeps failing.
    loop = makeLoop(world, diff * Math.max(0.4, 1 - attempt / 300), rng, width, shoulder);
  }
  if (!loop) throw new Error(`could not generate ${worldId} ${index}`);

  // Start line on the straightest stretch, random direction of travel.
  let points = loop.points;
  if (rng() < 0.5) points = reverse(points);
  {
    const p = new TrackPath({ points, closed: true, width, shoulder });
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < p.n; i += 3) {
      let score = 0;
      for (let k = -32; k <= 40; k++) score += Math.abs(p.curv[(i + k + p.n) % p.n]);
      if (score < best) {
        best = score;
        bi = i;
      }
    }
    points = rotate(points, bi);
  }
  const mainSpec: PathSpec = { points, closed: true, width, shoulder };
  const main = new TrackPath(mainSpec);
  const L = main.length;
  const mainHash = new SampleHash(main, 2 * main.limit + 120);

  const reserve = new Reserve(L);
  reserve.add(-450, 520); // start/finish straight and the grid

  // Shortcuts.
  const branches: Branch[] = [];
  const wantBranches = index === 0 ? 0 : index >= 4 && rng() < 0.6 ? 2 : 1;
  for (let b = 0; b < wantBranches; b++) {
    const br = makeBranch(main, mainHash, branches, rng, width, shoulder);
    if (br) branches.push(br);
  }

  const sections: SectionSpec[] = [];
  const patches: PatchSpec[] = [];
  const ramps: RampSpec[] = [];
  const tunnels: TunnelSpec[] = [];
  const pickups: PickupSpec[] = [];
  const cones: ConeSpec[] = [];

  const placeOnMain = (len: number, tries = 60, pred?: (s: number) => boolean): number | null => {
    for (let t = 0; t < tries; t++) {
      const s = randRange(rng, 500, L - 500 - len);
      if (reserve.free(s - 60, s + len + 60) && (!pred || pred(s))) {
        reserve.add(s - 60, s + len + 60);
        return s;
      }
    }
    return null;
  };

  // Risky shortcut content.
  branches.forEach((br, bi) => {
    const pi = bi + 1;
    const bp = br.path;
    const a = Math.max(br.clearFrom, bp.length * 0.18);
    const b = Math.min(br.clearTo, bp.length * 0.82);
    if (world.shortcut.surface !== null) sections.push({ path: pi, from: a, to: b, surface: world.shortcut.surface });
    const kinds = world.shortcut.patches;
    const count = randInt(rng, 1, 2) + (index >= 4 ? 1 : 0);
    for (let k = 0; k < count && kinds.length; k++) {
      const s = lerp(a, b, (k + 0.5) / count) + randRange(rng, -40, 40);
      const kind = kinds[k % kinds.length];
      const full = kind === "water";
      const lat = full ? 0 : randRange(rng, -0.35, 0.35) * bp.halfW;
      const at = pointAt(bp, s, lat);
      patches.push({ kind, x: at.x, y: at.y, rot: at.rot, rx: full ? randRange(rng, 45, 70) : kind === "boost" ? 26 : randRange(rng, 34, 60), ry: full ? bp.limit * 0.95 : kind === "boost" ? bp.halfW * 0.55 : randRange(rng, 26, 44) });
    }
    if (world.shortcut.ramp && bp.length > 900) {
      const s = lerp(a, b, 0.35);
      if (bp.turning(s - 100, s + 650) < 0.45) {
        const at = pointAt(bp, s, 0);
        ramps.push({ x: at.x, y: at.y, rot: at.rot, w: bp.halfW * 2 - 10, len: 46 });
      }
    }
    // Cash rewards the risk.
    for (let k = 0; k < 2; k++) {
      const at = pointAt(bp, lerp(a, b, 0.25 + k * 0.5), randRange(rng, -0.4, 0.4) * bp.halfW);
      pickups.push({ kind: "cash", x: at.x, y: at.y });
    }
  });
  // Junction zones on the main loop stay free of hazards.
  for (const br of branches) {
    reserve.add(br.path.join!.from - 150, br.path.join!.from + 450);
    reserve.add(br.path.join!.to - 450, br.path.join!.to + 150);
  }

  // Ramps need a straight run-out for the flight.
  const rampCount = randInt(rng, world.ramps[0], world.ramps[1]);
  for (let k = 0; k < rampCount; k++) {
    const flight = 900;
    const s = placeOnMain(flight, 80, (s0) => main.turning(s0 - 120, s0 + flight) < 0.42);
    if (s === null) continue;
    const at = pointAt(main, s, 0);
    ramps.push({ x: at.x, y: at.y, rot: at.rot, w: width - 12, len: 50 });
  }

  // Tunnels (visibility).
  const tunnelCount = randInt(rng, world.tunnels[0], world.tunnels[1]);
  for (let k = 0; k < tunnelCount; k++) {
    const len = randRange(rng, 380, 850);
    const s = placeOnMain(len);
    if (s !== null) tunnels.push({ path: 0, from: s, to: s + len });
  }

  // Whole-width surface sections on the main route.
  if (world.sections.length) {
    const count = randInt(rng, world.sectionCount[0], world.sectionCount[1]);
    for (let k = 0; k < count; k++) {
      const len = randRange(rng, 420, 1100);
      const s = placeOnMain(len);
      if (s !== null) sections.push({ path: 0, from: s, to: s + len, surface: pickWeighted(rng, world.sections) });
    }
  }

  // Fords: water across the full width.
  const fords = randInt(rng, world.fords[0], world.fords[1]);
  for (let k = 0; k < fords; k++) {
    const s = placeOnMain(140);
    if (s === null) continue;
    const at = pointAt(main, s + 70, 0);
    patches.push({ kind: "water", x: at.x, y: at.y, rot: at.rot, rx: randRange(rng, 45, 70), ry: main.limit * 0.98 });
  }

  // Patches on the main route (never across the full width, so there is always a way round).
  const patchCount = randInt(rng, world.patchCount[0], world.patchCount[1]) + Math.round(diff * 2);
  for (let k = 0; k < patchCount; k++) {
    const kind: PatchKind = pickWeighted(rng, world.patches);
    const s = placeOnMain(120);
    if (s === null) continue;
    const rx = randRange(rng, 36, 75);
    const ry = randRange(rng, 24, Math.min(52, main.halfW * 0.45));
    const lat = (rng() < 0.5 ? -1 : 1) * randRange(rng, 0.1, 0.55) * (main.halfW - ry * 0.5);
    const at = pointAt(main, s + 60, lat);
    patches.push({ kind, x: at.x, y: at.y, rot: at.rot + randRange(rng, -0.3, 0.3), rx, ry });
  }

  // Boost pads.
  const boosts = randInt(rng, world.boostPads[0], world.boostPads[1]);
  for (let k = 0; k < boosts; k++) {
    const s = placeOnMain(80, 60, (s0) => main.turning(s0 - 50, s0 + 300) < 0.5);
    if (s === null) continue;
    const at = pointAt(main, s + 40, randRange(rng, -0.35, 0.35) * main.halfW);
    patches.push({ kind: "boost", x: at.x, y: at.y, rot: at.rot, rx: 26, ry: main.halfW * 0.38 });
  }

  // Cones on the inside of the tightest corners (Sports).
  const coneClusters = randInt(rng, world.cones[0], world.cones[1]);
  if (coneClusters > 0) {
    const corners: { s: number; k: number }[] = [];
    for (let i = 0; i < main.n; i += 4) corners.push({ s: main.cum[i], k: main.curv[i] });
    corners.sort((a, b) => Math.abs(b.k) - Math.abs(a.k));
    let placed = 0;
    for (const c of corners) {
      if (placed >= coneClusters) break;
      if (!reserve.free(c.s - 120, c.s + 120)) continue;
      reserve.add(c.s - 200, c.s + 200);
      const side = c.k > 0 ? 1 : -1; // inside of a right turn is to the right
      for (let q = -2; q <= 2; q++) {
        const at = pointAt(main, c.s + q * 34, side * (main.halfW - 14 - Math.abs(q) * 4));
        cones.push({ x: at.x, y: at.y });
      }
      placed++;
    }
  }

  // Pickups along the main route.
  const addPickups = (kind: PickupKind, count: number) => {
    for (let k = 0; k < count; k++) {
      const s = randRange(rng, 600, L - 300);
      const at = pointAt(main, s, randRange(rng, -0.55, 0.55) * main.halfW);
      pickups.push({ kind, x: at.x, y: at.y });
    }
  };
  addPickups("turbo", 2 + Math.round(diff * 2));
  addPickups("cash", randInt(rng, 4, 6));
  addPickups("shield", 1);
  addPickups("brakes", 1);
  addPickups("repair", 1);
  addPickups("weapon", 4);

  const spec: TrackSpec = {
    id: trackId(worldId, index),
    name: world.trackNames[index],
    world: worldId,
    index,
    laps: DEFAULT_LAPS,
    trackSurface: world.trackSurface,
    shoulderSurface: world.shoulderSurface,
    paths: [mainSpec, ...branches.map((b) => b.spec)],
    sections,
    patches,
    ramps,
    tunnels,
    pickups,
    cones,
    decor: [],
  };
  spec.decor = placeDecor(spec, world, rng);
  return spec;
}

/** Scenery outside the walls; sports tracks also get grandstands along the start straight. */
function placeDecor(spec: TrackSpec, world: WorldDef, rng: Rng): DecorSpec[] {
  const track = new Track(spec, { pad: 420 });
  const decor: DecorSpec[] = [];
  const bucket = new Map<number, DecorSpec[]>();
  const B = 64;
  const key = (x: number, y: number) => Math.floor(x / B) * 100003 + Math.floor(y / B);
  const fits = (x: number, y: number, r: number): boolean => {
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) {
        const list = bucket.get(key(x + dx * B, y + dy * B));
        if (list) for (const d of list) if (Math.hypot(d.x - x, d.y - y) < d.r + r + 4) return false;
      }
    return true;
  };
  const add = (d: DecorSpec) => {
    decor.push(d);
    const k = key(d.x, d.y);
    let list = bucket.get(k);
    if (!list) bucket.set(k, (list = []));
    list.push(d);
  };

  if (world.id === "sports") {
    for (const side of [-1, 1]) {
      const at = track.pointOnMain(140, side * (track.main.limit + 70));
      let ok = true;
      for (let u = -130; u <= 130 && ok; u += 26)
        for (const w of [-40, 40]) {
          const x = at.x + Math.cos(at.angle) * u - Math.sin(at.angle) * w;
          const y = at.y + Math.sin(at.angle) * u + Math.cos(at.angle) * w;
          if (track.marginAt(x, y) > -16) ok = false;
        }
      if (ok) add({ kind: "stand", x: at.x, y: at.y, r: 130, rot: at.angle + (side > 0 ? 0 : Math.PI), v: rng() });
    }
  }

  const band = 360;
  const bandArea = track.length * 2 * band;
  const target = Math.round((bandArea / 10000) * world.decorDensity);
  const w = track.maxX - track.minX;
  const h = track.maxY - track.minY;
  let tries = 0;
  while (decor.length < target && tries < target * 60) {
    tries++;
    const kind = pickWeighted(rng, world.decor);
    const r = decorRadius(kind, rng);
    const x = track.minX + rng() * w;
    const y = track.minY + rng() * h;
    const m = track.marginAt(x, y);
    if (m > -(r + 10) || m < -band) continue;
    if (!fits(x, y, r)) continue;
    add({ kind, x, y, r, rot: rng() * TAU, v: rng() });
  }
  return decor;
}

function decorRadius(kind: string, rng: Rng): number {
  switch (kind) {
    case "pine":
    case "snowpine":
      return randRange(rng, 16, 28);
    case "tree":
      return randRange(rng, 18, 30);
    case "bush":
      return randRange(rng, 10, 18);
    case "tyres":
      return 12;
    case "flag":
      return 8;
    case "rock":
    case "moonrock":
      return randRange(rng, 10, 24);
    case "boulder":
      return randRange(rng, 24, 40);
    case "mesa":
      return randRange(rng, 50, 90);
    case "cactus":
      return 12;
    case "log":
      return 22;
    case "crater":
      return randRange(rng, 26, 70);
    case "lander":
      return 34;
    case "beacon":
      return 10;
    case "antenna":
      return 16;
    case "panel":
      return 30;
    case "pod":
      return randRange(rng, 14, 24);
    case "crystal":
      return randRange(rng, 12, 26);
    case "tendril":
      return randRange(rng, 14, 22);
    case "egg":
      return randRange(rng, 9, 14);
    default:
      return 14;
  }
}

/** Small LRU cache: building a Track rasterises a few MB of grid. */
const cache = new Map<string, Track>();
export function getTrack(world: WorldId, index: number): Track {
  const id = trackId(world, index);
  let t = cache.get(id);
  if (t) {
    cache.delete(id);
    cache.set(id, t);
    return t;
  }
  t = new Track(generateTrack(world, index));
  cache.set(id, t);
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  return t;
}
