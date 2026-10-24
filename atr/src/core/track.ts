/**
 * Track data model (data-driven, JSON-serialisable `TrackSpec`) and the built `Track` used at run time.
 *
 * A track is a closed main centreline plus optional open branches (shortcuts) that leave and rejoin it.
 * Each path is a corridor: the driving surface out to `width / 2`, a shoulder beyond that, and a wall at
 * `width / 2 + shoulder`. On build every path is stamped into a grid (8 px cells) that stores, per cell,
 * the best "margin" (distance left before the wall) and the nearest centreline sample, and the final
 * surface after sections and patches are applied. Surface lookups read the grid; wall collision and race
 * progress refine the nearest sample to an exact point on the polyline.
 */

import { pointSegment, wrapAngle } from "./math";
import { PATCH_SURFACE, Surface, type PatchKind, type SurfaceId } from "./surfaces";
import type { WorldId } from "./worlds";

export interface PathSpec {
  /** Flat [x0, y0, x1, y1, ...] centreline, roughly evenly spaced (~10 px). */
  points: number[];
  closed: boolean;
  width: number;
  shoulder: number;
  /** For branches: arc positions on the main path where the branch leaves and rejoins it. */
  join?: { from: number; to: number };
}

export interface SectionSpec {
  path: number;
  from: number;
  to: number;
  surface: SurfaceId;
}

/** Ellipse (or rectangle for boost pads) aligned with `rot`; rx along, ry across. */
export interface PatchSpec {
  kind: PatchKind;
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
}

export interface RampSpec {
  x: number;
  y: number;
  rot: number;
  /** Across the track. */
  w: number;
  /** Along the track. */
  len: number;
}

export interface TunnelSpec {
  path: number;
  from: number;
  to: number;
}

export type PickupKind = "turbo" | "cash" | "shield" | "brakes" | "repair" | "weapon";

export interface PickupSpec {
  kind: PickupKind;
  x: number;
  y: number;
}

export interface ConeSpec {
  x: number;
  y: number;
}

export interface DecorSpec {
  kind: string;
  x: number;
  y: number;
  r: number;
  rot: number;
  /** 0..1 variant for drawing. */
  v: number;
}

export interface TrackSpec {
  id: string;
  name: string;
  world: WorldId;
  index: number;
  laps: number;
  trackSurface: SurfaceId;
  shoulderSurface: SurfaceId;
  paths: PathSpec[];
  sections: SectionSpec[];
  patches: PatchSpec[];
  ramps: RampSpec[];
  tunnels: TunnelSpec[];
  pickups: PickupSpec[];
  cones: ConeSpec[];
  decor: DecorSpec[];
}

export class TrackPath {
  readonly n: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Arc length at each sample. */
  readonly cum: Float64Array;
  /** Length of the segment that starts at each sample. */
  readonly seg: Float64Array;
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  /** Signed curvature (1/px), smoothed; positive turns right (clockwise on screen). */
  readonly curv: Float64Array;
  readonly length: number;
  readonly closed: boolean;
  readonly halfW: number;
  readonly shoulder: number;
  /** Distance from the centreline to the wall. */
  readonly limit: number;
  readonly join?: { from: number; to: number };

  constructor(spec: PathSpec) {
    const n = spec.points.length / 2;
    this.n = n;
    this.closed = spec.closed;
    this.halfW = spec.width / 2;
    this.shoulder = spec.shoulder;
    this.limit = this.halfW + spec.shoulder;
    this.join = spec.join;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = spec.points[i * 2];
      this.ys[i] = spec.points[i * 2 + 1];
    }
    this.cum = new Float64Array(n);
    this.seg = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.cum[i] = acc;
      const j = this.closed ? (i + 1) % n : i + 1;
      if (j < n) {
        this.seg[i] = Math.hypot(this.xs[j] - this.xs[i], this.ys[j] - this.ys[i]);
        if (this.closed || i < n - 1) acc += this.seg[i];
      }
    }
    this.length = acc;

    const heading = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = this.closed ? (i + 1) % n : Math.min(i + 1, n - 1);
      const k = j === i ? i - 1 : i;
      const jj = j === i ? i : j;
      heading[i] = Math.atan2(this.ys[jj] - this.ys[k], this.xs[jj] - this.xs[k]);
    }
    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.prev(i);
      // Tangent at a sample: average of the adjoining segment headings.
      const a = heading[p];
      const b = heading[i];
      const mid = p === i ? b : a + wrapAngle(b - a) / 2;
      this.tx[i] = Math.cos(mid);
      this.ty[i] = Math.sin(mid);
      const ds = p === i ? 1 : (this.seg[p] + this.seg[i]) / 2 || 1;
      raw[i] = p === i || (!this.closed && i === n - 1) ? 0 : wrapAngle(b - a) / ds;
    }
    this.curv = new Float64Array(n);
    const W = 3;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -W; k <= W; k++) {
        const j = i + k;
        if (this.closed) {
          sum += raw[(j + n) % n];
          cnt++;
        } else if (j >= 0 && j < n) {
          sum += raw[j];
          cnt++;
        }
      }
      this.curv[i] = sum / cnt;
    }
  }

  prev(i: number): number {
    if (this.closed) return (i - 1 + this.n) % this.n;
    return Math.max(0, i - 1);
  }

  next(i: number): number {
    if (this.closed) return (i + 1) % this.n;
    return Math.min(this.n - 1, i + 1);
  }

  wrapS(s: number): number {
    if (!this.closed) return Math.max(0, Math.min(this.length, s));
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }

  /** Index of the sample at or before arc position s. */
  indexAt(s: number): number {
    s = this.wrapS(s);
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Point and unit tangent at arc position s. */
  at(s: number): { x: number; y: number; tx: number; ty: number; i: number } {
    s = this.wrapS(s);
    const i = this.indexAt(s);
    const j = this.next(i);
    const segLen = this.seg[i] || 1;
    const t = j === i ? 0 : Math.min(1, (s - this.cum[i]) / segLen);
    const x = this.xs[i] + (this.xs[j] - this.xs[i]) * t;
    const y = this.ys[i] + (this.ys[j] - this.ys[i]) * t;
    const ax = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    const ay = this.ty[i] + (this.ty[j] - this.ty[i]) * t;
    const l = Math.hypot(ax, ay) || 1;
    return { x, y, tx: ax / l, ty: ay / l, i };
  }

  /** Total absolute turning (rad) over the arc window [s0, s1]. */
  turning(s0: number, s1: number): number {
    let sum = 0;
    const step = 10;
    for (let s = s0; s <= s1; s += step) sum += Math.abs(this.curv[this.indexAt(s)]) * step;
    return sum;
  }
}

export interface NearestHit {
  path: number;
  /** Index of the segment start sample. */
  seg: number;
  t: number;
  dist: number;
  /** Closest point on the centreline. */
  px: number;
  py: number;
  /** Distance left before the wall (negative: inside the wall). */
  margin: number;
  /** Arc position on that path. */
  s: number;
  /** Equivalent arc position on the main path. */
  sMain: number;
  /** Signed offset from the centreline, positive to the right of the direction of travel. */
  lateral: number;
}

export function emptyHit(): NearestHit {
  return { path: 0, seg: 0, t: 0, dist: 0, px: 0, py: 0, margin: 0, s: 0, sMain: 0, lateral: 0 };
}

const CELL = 8;
const NONE = 255;

export class Track {
  readonly spec: TrackSpec;
  readonly paths: TrackPath[];
  readonly main: TrackPath;
  readonly length: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly cols: number;
  readonly rows: number;
  readonly cell = CELL;
  /** Per cell: best margin to the wall over all paths. */
  readonly margin: Float32Array;
  /** Per cell: (path << 20) | sample index of the path that gives the best margin, -1 if none. */
  readonly code: Int32Array;
  /** Per cell: resolved surface. */
  readonly surf: Uint8Array;

  constructor(spec: TrackSpec, opts: { pad?: number } = {}) {
    this.spec = spec;
    this.paths = spec.paths.map((p) => new TrackPath(p));
    this.main = this.paths[0];
    this.length = this.main.length;
    const pad = opts.pad ?? 520;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.paths) {
      for (let i = 0; i < p.n; i++) {
        minX = Math.min(minX, p.xs[i] - p.limit);
        minY = Math.min(minY, p.ys[i] - p.limit);
        maxX = Math.max(maxX, p.xs[i] + p.limit);
        maxY = Math.max(maxY, p.ys[i] + p.limit);
      }
    }
    this.minX = Math.floor(minX - pad);
    this.minY = Math.floor(minY - pad);
    this.maxX = Math.ceil(maxX + pad);
    this.maxY = Math.ceil(maxY + pad);
    this.cols = Math.ceil((this.maxX - this.minX) / CELL);
    this.rows = Math.ceil((this.maxY - this.minY) / CELL);
    const cells = this.cols * this.rows;
    this.margin = new Float32Array(cells).fill(-1e6);
    this.code = new Int32Array(cells).fill(-1);
    this.surf = new Uint8Array(cells).fill(Surface.Wall);
    this.rasterize();
  }

  private rasterize(): void {
    const { cols, rows, margin, code } = this;
    this.paths.forEach((p, pi) => {
      const R = p.limit + CELL * 3;
      for (let i = 0; i < p.n; i++) {
        const x = p.xs[i];
        const y = p.ys[i];
        const c0 = Math.max(0, Math.floor((x - R - this.minX) / CELL));
        const c1 = Math.min(cols - 1, Math.floor((x + R - this.minX) / CELL));
        const r0 = Math.max(0, Math.floor((y - R - this.minY) / CELL));
        const r1 = Math.min(rows - 1, Math.floor((y + R - this.minY) / CELL));
        for (let r = r0; r <= r1; r++) {
          const cy = this.minY + (r + 0.5) * CELL - y;
          for (let c = c0; c <= c1; c++) {
            const cx = this.minX + (c + 0.5) * CELL - x;
            const m = p.limit - Math.sqrt(cx * cx + cy * cy);
            const k = r * cols + c;
            if (m > margin[k]) {
              margin[k] = m;
              code[k] = (pi << 20) | i;
            }
          }
        }
      }
    });

    // Whole-width sections, per path and sample.
    const sectionAt = this.paths.map((p) => new Uint8Array(p.n).fill(NONE));
    for (const sec of this.spec.sections) {
      const p = this.paths[sec.path];
      if (!p) continue;
      const len = sec.to >= sec.from ? sec.to - sec.from : sec.to + p.length - sec.from;
      for (let d = 0; d <= len; d += 5) sectionAt[sec.path][p.indexAt(sec.from + d)] = sec.surface;
    }

    for (let k = 0; k < margin.length; k++) {
      if (margin[k] < 0) continue;
      const pi = code[k] >> 20;
      const i = code[k] & 0xfffff;
      const p = this.paths[pi];
      const d = p.limit - margin[k];
      if (d <= p.halfW) {
        const sec = sectionAt[pi][i];
        this.surf[k] = sec !== NONE ? sec : this.spec.trackSurface;
      } else {
        this.surf[k] = this.spec.shoulderSurface;
      }
    }

    for (const pa of this.spec.patches) {
      const sid = PATCH_SURFACE[pa.kind];
      const rect = pa.kind === "boost";
      const R = Math.max(pa.rx, pa.ry);
      const cs = Math.cos(pa.rot);
      const sn = Math.sin(pa.rot);
      const c0 = Math.max(0, Math.floor((pa.x - R - this.minX) / CELL));
      const c1 = Math.min(cols - 1, Math.floor((pa.x + R - this.minX) / CELL));
      const r0 = Math.max(0, Math.floor((pa.y - R - this.minY) / CELL));
      const r1 = Math.min(rows - 1, Math.floor((pa.y + R - this.minY) / CELL));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const k = r * cols + c;
          if (this.surf[k] === Surface.Wall) continue;
          const dx = this.minX + (c + 0.5) * CELL - pa.x;
          const dy = this.minY + (r + 0.5) * CELL - pa.y;
          const u = dx * cs + dy * sn;
          const w = -dx * sn + dy * cs;
          const inside = rect ? Math.abs(u) <= pa.rx && Math.abs(w) <= pa.ry : (u / pa.rx) ** 2 + (w / pa.ry) ** 2 <= 1;
          if (inside) this.surf[k] = sid;
        }
      }
    }
  }

  private cellIndex(x: number, y: number): number {
    const c = Math.floor((x - this.minX) / CELL);
    const r = Math.floor((y - this.minY) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  surfaceAt(x: number, y: number): SurfaceId {
    const k = this.cellIndex(x, y);
    return (k < 0 ? Surface.Wall : this.surf[k]) as SurfaceId;
  }

  /** Approximate margin from the grid (cheap; used for placement and AI probing). */
  marginAt(x: number, y: number): number {
    const k = this.cellIndex(x, y);
    return k < 0 ? -1e6 : this.margin[k];
  }

  /** Exact nearest centreline point over all paths, choosing the path with the most room. */
  nearest(x: number, y: number, out: NearestHit = emptyHit()): NearestHit {
    const k0 = this.cellIndex(x, y);
    const cand: number[] = [];
    if (k0 >= 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = Math.floor(k0 / this.cols) + dr;
          const c = (k0 % this.cols) + dc;
          if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
          const code = this.code[r * this.cols + c];
          if (code < 0) continue;
          const pi = code >> 20;
          let seen = false;
          for (let q = 0; q < cand.length; q += 2) if (cand[q] === pi) seen = true;
          if (!seen) cand.push(pi, code & 0xfffff);
        }
      }
    }
    if (cand.length === 0) {
      // Far outside every corridor (should not happen in play): brute-force the main path.
      let best = Infinity;
      let bi = 0;
      const p = this.main;
      for (let i = 0; i < p.n; i++) {
        const d = (p.xs[i] - x) ** 2 + (p.ys[i] - y) ** 2;
        if (d < best) {
          best = d;
          bi = i;
        }
      }
      cand.push(0, bi);
    }

    let bestMargin = -Infinity;
    for (let q = 0; q < cand.length; q += 2) {
      const pi = cand[q];
      const p = this.paths[pi];
      const ci = cand[q + 1];
      let bd = Infinity;
      let bs = ci;
      let bt = 0;
      for (let o = -5; o <= 5; o++) {
        let i = ci + o;
        if (p.closed) i = (i + p.n) % p.n;
        else if (i < 0 || i >= p.n - 1) continue;
        const j = p.next(i);
        const r = pointSegment(x, y, p.xs[i], p.ys[i], p.xs[j], p.ys[j]);
        if (r.d2 < bd) {
          bd = r.d2;
          bs = i;
          bt = r.t;
        }
      }
      const dist = Math.sqrt(bd);
      const m = p.limit - dist;
      if (m > bestMargin) {
        bestMargin = m;
        const j = p.next(bs);
        out.path = pi;
        out.seg = bs;
        out.t = bt;
        out.dist = dist;
        out.px = p.xs[bs] + (p.xs[j] - p.xs[bs]) * bt;
        out.py = p.ys[bs] + (p.ys[j] - p.ys[bs]) * bt;
        out.margin = m;
        out.s = p.cum[bs] + p.seg[bs] * bt;
        const sx = p.xs[j] - p.xs[bs];
        const sy = p.ys[j] - p.ys[bs];
        // Right of travel direction (y down): cross(tangent, offset) > 0.
        const cross = sx * (y - out.py) - sy * (x - out.px);
        out.lateral = cross >= 0 ? dist : -dist;
      }
    }
    out.sMain = this.mainS(out.path, out.s);
    return out;
  }

  /** Local nearest point on one path, searching around a hint sample (route tracking for the AI). */
  nearestOnPath(pi: number, x: number, y: number, hint: number, window = 8): { idx: number; s: number; dist: number } {
    const p = this.paths[pi];
    let bd = Infinity;
    let bs = hint;
    let bt = 0;
    for (let o = -window; o <= window; o++) {
      let i = hint + o;
      if (p.closed) i = (i + p.n) % p.n;
      else if (i < 0 || i >= p.n - 1) continue;
      const j = p.next(i);
      const r = pointSegment(x, y, p.xs[i], p.ys[i], p.xs[j], p.ys[j]);
      if (r.d2 < bd) {
        bd = r.d2;
        bs = i;
        bt = r.t;
      }
    }
    return { idx: bs, s: p.cum[bs] + p.seg[bs] * bt, dist: Math.sqrt(bd) };
  }

  /** Maps an arc position on any path onto the main path. */
  mainS(path: number, s: number): number {
    if (path === 0) return this.main.wrapS(s);
    const p = this.paths[path];
    const j = p.join!;
    let span = j.to - j.from;
    if (span < 0) span += this.length;
    return this.main.wrapS(j.from + (span * s) / p.length);
  }

  /** Point on the main path at arc position s, offset laterally (positive = right). */
  pointOnMain(s: number, lateral = 0): { x: number; y: number; angle: number } {
    const a = this.main.at(s);
    return { x: a.x - a.ty * lateral, y: a.y + a.tx * lateral, angle: Math.atan2(a.ty, a.tx) };
  }

  /** Starting grid slot k (0 = pole), staggered two abreast behind the line. */
  gridSlot(k: number): { x: number; y: number; angle: number } {
    const row = Math.floor(k / 2);
    const col = k % 2;
    const s = -55 - row * 62 - col * 28;
    const lat = (col === 0 ? -1 : 1) * this.main.halfW * 0.42;
    return this.pointOnMain(s, lat);
  }

  /** Index of the ramp under (x, y), or -1. */
  rampAt(x: number, y: number): number {
    const ramps = this.spec.ramps;
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      const dx = x - r.x;
      const dy = y - r.y;
      const u = dx * Math.cos(r.rot) + dy * Math.sin(r.rot);
      const w = -dx * Math.sin(r.rot) + dy * Math.cos(r.rot);
      if (Math.abs(u) <= r.len / 2 && Math.abs(w) <= r.w / 2) return i;
    }
    return -1;
  }
}
