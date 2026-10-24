/**
 * Canvas renderer. The static track (ground, walls, shoulders, surfaces, kerbs, patches, ramps,
 * scenery shadows) is drawn once into 512 px tiles on demand and cached; skid marks are stamped into
 * those tiles. Every frame then draws the visible tiles plus the moving and the tall things: pickups,
 * cones, cars, particles, scenery with perspective lean and tunnel roofs.
 */

import type { Race } from "../core/race";
import { Surface, surfaceProps } from "../core/surfaces";
import type { Track, TrackPath } from "../core/track";
import type { WorldId } from "../core/worlds";
import { mulberry32 } from "../core/math";
import type { Camera } from "./camera";
import type { Particles } from "./particles";
import { decorHeight, drawCar, drawCarShadow, drawCone, drawDecor, drawDecorShadow, drawFlatDecor, drawMine, drawMissile, drawPickup, drawPlayerTag, isFlatDecor, type CarLook } from "./sprites";
import { Patterns, WORLD_STYLES, type WorldStyle } from "./style";

const TS = 512;
const MAX_TILES = 40;
const LEAN = 0.0009;

function polyPath(p: TrackPath): Path2D {
  const path = new Path2D();
  path.moveTo(p.xs[0], p.ys[0]);
  for (let i = 1; i < p.n; i++) path.lineTo(p.xs[i], p.ys[i]);
  if (p.closed) path.closePath();
  return path;
}

function subPath(p: TrackPath, s0: number, s1: number): Path2D {
  const path = new Path2D();
  const len = s1 >= s0 ? s1 - s0 : s1 + p.length - s0;
  const a = p.at(s0);
  path.moveTo(a.x, a.y);
  for (let d = 8; d < len; d += 8) {
    const q = p.at(s0 + d);
    path.lineTo(q.x, q.y);
  }
  const b = p.at(s0 + len);
  path.lineTo(b.x, b.y);
  return path;
}

interface Tile {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  dpr = 1;
  private track: Track | null = null;
  private world: WorldId = "sports";
  private style: WorldStyle = WORLD_STYLES.sports;
  private patterns: Patterns | null = null;
  private tiles = new Map<string, Tile>();
  private tileRes = 1;
  private pathShapes: Path2D[] = [];
  private kerbShapes: Path2D[] = [];
  private sectionShapes: { shape: Path2D; surface: number; halfW: number }[] = [];
  private tunnelShapes: { shape: Path2D; limit: number; from: number; to: number }[] = [];
  private stars: HTMLCanvasElement | null = null;
  /** Previous rear wheel positions per car for skid marks. */
  private skidPrev: ({ lx: number; ly: number; rx: number; ry: number } | null)[] = [];
  looks: CarLook[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d", { alpha: false })!;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setTrack(track: Track, looks: CarLook[], zoom: number): void {
    const sameTrack = this.track === track;
    this.track = track;
    this.looks = looks;
    this.skidPrev = looks.map(() => null);
    // Tile resolution follows the screen's pixel density, capped to keep tile memory in check on phones.
    const res = Math.min(1.5, Math.max(1, Math.round(this.dpr * zoom * 4) / 4));
    if (sameTrack && res === this.tileRes) {
      // Fresh race on the same track: wipe the skid marks.
      this.tiles.clear();
      return;
    }
    this.tileRes = res;
    this.world = track.spec.world;
    this.style = WORLD_STYLES[this.world];
    this.patterns = new Patterns(this.g, this.world);
    this.tiles.clear();
    this.pathShapes = track.paths.map(polyPath);
    this.kerbShapes = [];
    if (this.style.kerbs) {
      const m = track.main;
      let start = -1;
      for (let i = 0; i <= m.n; i++) {
        const corner = i < m.n && Math.abs(m.curv[i]) > 1 / 420;
        if (corner && start < 0) start = i;
        if (!corner && start >= 0) {
          const s0 = m.cum[start] - 40;
          const s1 = m.cum[Math.min(i, m.n - 1)] + 40;
          if (s1 - s0 > 120) this.kerbShapes.push(subPath(m, s0, s1));
          start = -1;
        }
      }
    }
    this.sectionShapes = track.spec.sections.map((s) => ({ shape: subPath(track.paths[s.path], s.from, s.to), surface: s.surface, halfW: track.paths[s.path].halfW }));
    this.tunnelShapes = track.spec.tunnels.map((t) => ({ shape: subPath(track.paths[t.path], t.from, t.to), limit: track.paths[t.path].limit, from: t.from, to: t.to }));
    if (this.world === "space" && !this.stars) this.stars = this.makeStars();
  }

  private makeStars(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const g = c.getContext("2d")!;
    g.fillStyle = "#050817";
    g.fillRect(0, 0, 1024, 1024);
    const rng = mulberry32(99);
    for (let i = 0; i < 700; i++) {
      const b = rng();
      g.fillStyle = b > 0.97 ? "#ffd9a0" : b > 0.94 ? "#a8d8ff" : `rgba(255,255,255,${0.25 + rng() * 0.6})`;
      const s = b > 0.94 ? 2 : 1;
      g.fillRect(rng() * 1024, rng() * 1024, s, s);
    }
    for (let i = 0; i < 6; i++) {
      const grd = g.createRadialGradient(rng() * 1024, rng() * 1024, 0, 512, 512, 400);
      grd.addColorStop(0, "rgba(120,60,200,0.05)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 1024, 1024);
    }
    return c;
  }

  private tile(tx: number, ty: number, allowCreate: boolean): Tile | null {
    const key = `${tx},${ty}`;
    let t = this.tiles.get(key);
    if (t) {
      this.tiles.delete(key);
      this.tiles.set(key, t);
      return t;
    }
    if (!allowCreate) return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.round(TS * this.tileRes);
    const g = canvas.getContext("2d")!;
    g.setTransform(this.tileRes, 0, 0, this.tileRes, -tx * TS * this.tileRes, -ty * TS * this.tileRes);
    this.drawStatic(g, tx * TS, ty * TS, TS, TS);
    t = { canvas, g };
    this.tiles.set(key, t);
    while (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value!);
    return t;
  }

  private drawStatic(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
    const track = this.track!;
    const st = this.style;
    const pat = this.patterns!;
    const ground = pat.ground();
    if (ground) {
      g.fillStyle = ground;
      g.fillRect(x0, y0, w, h);
    }
    g.lineJoin = "round";
    g.lineCap = "round";

    for (const d of track.spec.decor) {
      const m = d.r + 80;
      if (d.x < x0 - m || d.x > x0 + w + m || d.y < y0 - m || d.y > y0 + h + m) continue;
      if (isFlatDecor(d.kind)) drawFlatDecor(g, d);
      else drawDecorShadow(g, d);
    }

    // Walls / barriers.
    const rim = 12;
    track.paths.forEach((p, i) => {
      const shape = this.pathShapes[i];
      if (st.wallGlow) {
        g.strokeStyle = st.wallGlow;
        g.globalAlpha = 0.25;
        g.lineWidth = 2 * p.limit + rim * 2 + 14;
        g.stroke(shape);
        g.globalAlpha = 1;
      }
      g.strokeStyle = st.wallAlt ?? st.wall;
      g.lineWidth = 2 * p.limit + rim * 2;
      g.stroke(shape);
      if (st.wallAlt && this.world === "sports") {
        g.setLineDash([16, 16]);
        g.lineCap = "butt";
        g.strokeStyle = st.wall;
        g.stroke(shape);
        g.setLineDash([]);
        g.lineCap = "round";
      }
      if (st.wallGlow) {
        g.strokeStyle = st.wallGlow;
        g.lineWidth = 2 * p.limit + 5;
        g.stroke(shape);
      }
    });

    // Shoulders.
    g.strokeStyle = pat.surface(track.spec.shoulderSurface);
    track.paths.forEach((p, i) => {
      g.lineWidth = 2 * p.limit;
      g.stroke(this.pathShapes[i]);
    });

    // Track edges (a band just wider than the surface) and kerbs.
    g.strokeStyle = st.edge;
    track.paths.forEach((p, i) => {
      g.lineWidth = 2 * p.halfW + 6;
      g.stroke(this.pathShapes[i]);
    });
    if (this.kerbShapes.length) {
      g.lineCap = "butt";
      g.lineWidth = 2 * track.main.halfW + 18;
      g.strokeStyle = "#f4f4f4";
      for (const k of this.kerbShapes) g.stroke(k);
      g.setLineDash([14, 14]);
      g.strokeStyle = "#e0302b";
      for (const k of this.kerbShapes) g.stroke(k);
      g.setLineDash([]);
      g.lineCap = "round";
    }

    // Driving surface and sections.
    g.strokeStyle = pat.surface(track.spec.trackSurface);
    track.paths.forEach((p, i) => {
      g.lineWidth = 2 * p.halfW;
      g.stroke(this.pathShapes[i]);
    });
    g.lineCap = "butt";
    for (const s of this.sectionShapes) {
      g.strokeStyle = pat.surface(s.surface as never);
      g.lineWidth = 2 * s.halfW;
      g.stroke(s.shape);
    }
    g.lineCap = "round";
    if (st.centreLine) {
      g.setLineDash([26, 30]);
      g.lineCap = "butt";
      g.strokeStyle = st.centreLine;
      g.lineWidth = 4;
      g.stroke(this.pathShapes[0]);
      g.setLineDash([]);
      g.lineCap = "round";
    }
    if (this.world === "space") {
      // Neon lane edges.
      g.strokeStyle = "rgba(61,220,255,0.18)";
      track.paths.forEach((p, i) => {
        g.lineWidth = 2 * p.halfW - 10;
        g.setLineDash([]);
        g.globalAlpha = 1;
        g.stroke(this.pathShapes[i]);
      });
      g.strokeStyle = pat.surface(track.spec.trackSurface);
      track.paths.forEach((p, i) => {
        g.lineWidth = 2 * p.halfW - 14;
        g.stroke(this.pathShapes[i]);
      });
      if (st.centreLine) {
        g.setLineDash([26, 30]);
        g.lineCap = "butt";
        g.strokeStyle = st.centreLine;
        g.lineWidth = 4;
        g.stroke(this.pathShapes[0]);
        g.setLineDash([]);
        g.lineCap = "round";
      }
    }

    this.drawStartLine(g);

    for (const pa of track.spec.patches) {
      const R = Math.max(pa.rx, pa.ry) + 6;
      if (pa.x < x0 - R || pa.x > x0 + w + R || pa.y < y0 - R || pa.y > y0 + h + R) continue;
      g.save();
      g.translate(pa.x, pa.y);
      g.rotate(pa.rot);
      if (pa.kind === "boost") {
        g.fillStyle = "#2a1a08";
        g.fillRect(-pa.rx, -pa.ry, pa.rx * 2, pa.ry * 2);
        g.strokeStyle = "#ffd23f";
        g.lineWidth = 5;
        g.lineCap = "butt";
        g.lineJoin = "miter";
        for (let k = -1; k <= 1; k++) {
          g.beginPath();
          g.moveTo(k * 14 - 6, -pa.ry + 6);
          g.lineTo(k * 14 + 6, 0);
          g.lineTo(k * 14 - 6, pa.ry - 6);
          g.stroke();
        }
        g.strokeStyle = "rgba(255,210,63,0.6)";
        g.lineWidth = 2;
        g.strokeRect(-pa.rx, -pa.ry, pa.rx * 2, pa.ry * 2);
        g.lineJoin = "round";
        g.lineCap = "round";
      } else {
        const sid = pa.kind === "water" ? Surface.Water : pa.kind === "oil" ? Surface.Oil : pa.kind === "ice" ? Surface.Ice : pa.kind === "goo" ? Surface.Goo : pa.kind === "crystal" ? Surface.Crystal : pa.kind === "sand" ? Surface.Sand : pa.kind === "snow" ? Surface.Snow : pa.kind === "gravel" ? Surface.Gravel : pa.kind === "grass" ? Surface.Grass : Surface.Dust;
        g.beginPath();
        // Slightly irregular blob.
        const N = 18;
        for (let q = 0; q <= N; q++) {
          const a = (q / N) * Math.PI * 2;
          const wob = 1 + 0.07 * Math.sin(a * 3 + pa.x * 0.01) + 0.05 * Math.sin(a * 5 + pa.y * 0.01);
          const px = Math.cos(a) * pa.rx * wob;
          const py = Math.sin(a) * pa.ry * wob;
          if (q === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fillStyle = pat.surface(sid as never);
        g.globalAlpha = pa.kind === "water" ? 0.92 : 1;
        g.fill();
        g.globalAlpha = 1;
        if (pa.kind === "oil") {
          // Petrol sheen: a soft rainbow ring and a highlight.
          const r = Math.max(pa.rx, pa.ry);
          const grd = g.createRadialGradient(-r * 0.2, -r * 0.15, r * 0.1, 0, 0, r);
          grd.addColorStop(0, "rgba(255,255,255,0.10)");
          grd.addColorStop(0.45, "rgba(120,60,255,0.16)");
          grd.addColorStop(0.65, "rgba(0,220,200,0.14)");
          grd.addColorStop(0.85, "rgba(255,200,0,0.10)");
          grd.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = grd;
          g.fill();
        }
        if (pa.kind === "water" || pa.kind === "ice" || pa.kind === "crystal") {
          g.strokeStyle = "rgba(255,255,255,0.45)";
          g.lineWidth = 2;
          g.stroke();
        } else if (pa.kind === "goo") {
          g.strokeStyle = "rgba(40,120,20,0.8)";
          g.lineWidth = 3;
          g.stroke();
        }
      }
      g.restore();
    }

    for (const r of track.spec.ramps) {
      g.save();
      g.translate(r.x, r.y);
      g.rotate(r.rot);
      const grd = g.createLinearGradient(-r.len / 2, 0, r.len / 2, 0);
      grd.addColorStop(0, "#4b4f58");
      grd.addColorStop(1, "#c9ccd4");
      g.fillStyle = grd;
      g.fillRect(-r.len / 2, -r.w / 2, r.len, r.w);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(r.len / 2, -r.w / 2, 10, r.w);
      g.save();
      g.beginPath();
      g.rect(-r.len / 2, -r.w / 2, 10, r.w);
      g.clip();
      for (let k = -r.w / 2 - 20; k < r.w / 2; k += 16) {
        g.fillStyle = "#ffd23f";
        g.beginPath();
        g.moveTo(-r.len / 2, k);
        g.lineTo(-r.len / 2 + 10, k + 8);
        g.lineTo(-r.len / 2 + 10, k + 16);
        g.lineTo(-r.len / 2, k + 8);
        g.closePath();
        g.fill();
      }
      g.restore();
      g.strokeStyle = "rgba(255,255,255,0.7)";
      g.lineWidth = 3;
      for (const k of [-r.w / 4, r.w / 4]) {
        g.beginPath();
        g.moveTo(-6, k - 8);
        g.lineTo(6, k);
        g.lineTo(-6, k + 8);
        g.stroke();
      }
      g.restore();
    }
  }

  private drawStartLine(g: CanvasRenderingContext2D): void {
    const track = this.track!;
    const a = track.main.at(0);
    const ang = Math.atan2(a.ty, a.tx);
    g.save();
    g.translate(a.x, a.y);
    g.rotate(ang);
    const hw = track.main.halfW;
    const sq = 9;
    for (let row = 0; row < 2; row++) {
      for (let k = -hw; k < hw; k += sq) {
        g.fillStyle = (Math.round((k + hw) / sq) + row) % 2 ? "#111" : "#f4f4f4";
        g.fillRect(row * sq - sq, k, sq, Math.min(sq, hw - k));
      }
    }
    g.restore();
    // Grid boxes.
    g.strokeStyle = "rgba(255,255,255,0.7)";
    g.lineWidth = 3;
    g.lineCap = "butt";
    for (let k = 0; k < 6; k++) {
      const slot = track.gridSlot(k);
      g.save();
      g.translate(slot.x, slot.y);
      g.rotate(slot.angle);
      g.beginPath();
      g.moveTo(26, -15);
      g.lineTo(30, -15);
      g.lineTo(30, 15);
      g.lineTo(26, 15);
      g.stroke();
      g.restore();
    }
    g.lineCap = "round";
  }

  /** Paints a skid mark segment into every cached tile it touches. */
  private stamp(x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
    const minX = Math.min(x1, x2) - width;
    const maxX = Math.max(x1, x2) + width;
    const minY = Math.min(y1, y2) - width;
    const maxY = Math.max(y1, y2) + width;
    for (let tx = Math.floor(minX / TS); tx <= Math.floor(maxX / TS); tx++) {
      for (let ty = Math.floor(minY / TS); ty <= Math.floor(maxY / TS); ty++) {
        const t = this.tiles.get(`${tx},${ty}`);
        if (!t) continue;
        t.g.strokeStyle = color;
        t.g.lineWidth = width;
        t.g.lineCap = "round";
        t.g.beginPath();
        t.g.moveTo(x1, y1);
        t.g.lineTo(x2, y2);
        t.g.stroke();
      }
    }
  }

  /** Lays skid marks and ruts for every car (call once per frame). */
  updateSkids(race: Race): void {
    race.entrants.forEach((e, i) => {
      const c = e.car;
      const L = e.stats.length;
      const W = e.stats.width;
      const fx = Math.cos(c.angle);
      const fy = Math.sin(c.angle);
      const bx = c.x - fx * L * 0.32;
      const by = c.y - fy * L * 0.32;
      const cur = { lx: bx + fy * W * 0.42, ly: by - fx * W * 0.42, rx: bx - fy * W * 0.42, ry: by + fx * W * 0.42 };
      const sp = Math.hypot(c.vx, c.vy);
      const p = surfaceProps(c.surface);
      const loose = p.loose && sp > 60;
      const skidding = c.slip > 55 || (c.braking && sp > 180) || c.spin > 0 || (c.throttle > 0.9 && sp < 120 && c.turbo > 0);
      const prev = this.skidPrev[i];
      if (prev && c.z <= 0 && (skidding || loose) && !p.splash && c.surface !== Surface.Wall) {
        const d = Math.hypot(cur.lx - prev.lx, cur.ly - prev.ly);
        if (d > 3 && d < 80) {
          const color = loose && !skidding ? "rgba(0,0,0,0.06)" : this.style.skid;
          this.stamp(prev.lx, prev.ly, cur.lx, cur.ly, color, 4);
          this.stamp(prev.rx, prev.ry, cur.rx, cur.ry, color, 4);
          this.skidPrev[i] = cur;
        } else if (d >= 80) this.skidPrev[i] = cur;
      } else {
        this.skidPrev[i] = cur;
      }
    });
  }

  render(race: Race, cam: Camera, particles: Particles, time: number, tags: { index: number; label: string; color: string }[]): void {
    const g = this.g;
    const track = this.track!;
    const W = cam.viewW;
    const H = cam.viewH;
    const z = cam.zoom;
    const dpr = this.dpr;
    const view = cam.view();

    // Background.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.world === "space" && this.stars) {
      const pat = g.createPattern(this.stars, "repeat")!;
      pat.setTransform(new DOMMatrix().translate(-cam.x * 0.12, -cam.y * 0.12));
      g.fillStyle = pat;
      g.fillRect(0, 0, W, H);
      const sky = this.style.sky!;
      const px = W * 0.78 - cam.x * 0.03;
      const py = H * 0.25 - cam.y * 0.03;
      g.fillStyle = sky.planet;
      g.beginPath();
      g.arc(((px % (W * 2)) + W * 2) % (W * 2) - W * 0.3, ((py % (H * 2)) + H * 2) % (H * 2) - H * 0.3, 70, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = this.style.ground ?? "#000";
      g.fillRect(0, 0, W, H);
    }

    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cam.x * z), dpr * (H / 2 - cam.y * z));

    // Tiles (create at most a few new ones per frame to keep frames smooth).
    let budget = this.tiles.size === 0 ? 64 : 3;
    const tx0 = Math.floor((view.cx - view.hw) / TS);
    const tx1 = Math.floor((view.cx + view.hw) / TS);
    const ty0 = Math.floor((view.cy - view.hh) / TS);
    const ty1 = Math.floor((view.cy + view.hh) / TS);
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const t = this.tile(tx, ty, budget > 0);
        if (!t) continue;
        if (!this.tiles.has(`${tx},${ty}`)) continue;
        if (t.canvas.dataset.fresh !== "0") {
          t.canvas.dataset.fresh = "0";
          budget--;
        }
        g.drawImage(t.canvas, tx * TS, ty * TS, TS, TS);
      }
    }
    // Pre-build the ring of tiles around the view while there is budget left.
    for (let tx = tx0 - 1; tx <= tx1 + 1 && budget > 0; tx++) {
      for (let ty = ty0 - 1; ty <= ty1 + 1 && budget > 0; ty++) {
        if (this.tiles.has(`${tx},${ty}`)) continue;
        this.tile(tx, ty, true);
        budget--;
      }
    }

    const inView = (x: number, y: number, m: number) => Math.abs(x - view.cx) < view.hw + m && Math.abs(y - view.cy) < view.hh + m;

    for (const mi of race.mines) if (inView(mi.x, mi.y, 20)) drawMine(g, mi.x, mi.y, mi.age);
    for (const pk of race.pickups) if (pk.active && inView(pk.spec.x, pk.spec.y, 30)) drawPickup(g, pk.spec.kind, pk.spec.x, pk.spec.y, time);
    particles.draw(g, z, "low");
    for (const c of race.cones) if (inView(c.x, c.y, 20)) drawCone(g, c.x, c.y, c.z, c.rot);

    const order = [...race.entrants].sort((a, b) => a.car.z - b.car.z);
    for (const e of order) {
      if (!inView(e.car.x, e.car.y, 80)) continue;
      drawCarShadow(g, this.looks[e.index], this.pose(e, time));
    }
    for (const e of order) {
      if (!inView(e.car.x, e.car.y, 80)) continue;
      drawCar(g, this.looks[e.index], this.pose(e, time));
    }
    for (const m of race.missiles) drawMissile(g, m.x, m.y, m.angle, time);
    particles.draw(g, z, "high");

    // Tall scenery leans away from the screen centre.
    for (const d of track.spec.decor) {
      if (isFlatDecor(d.kind) || !inView(d.x, d.y, d.r + 70)) continue;
      const h = decorHeight(d.kind, d.r);
      drawDecor(g, d, (d.x - cam.x) * LEAN * h, (d.y - cam.y) * LEAN * h, time, this.world);
    }

    // Tunnel roofs, with the cars inside showing faintly and their headlights cutting through.
    if (this.tunnelShapes.length) {
      const roof = this.patterns!.tunnel();
      g.lineCap = "butt";
      g.lineJoin = "round";
      for (const t of this.tunnelShapes) {
        g.globalAlpha = 0.9;
        g.strokeStyle = this.style.tunnelEdge;
        g.lineWidth = 2 * t.limit + 34;
        g.stroke(t.shape);
        g.strokeStyle = roof;
        g.lineWidth = 2 * t.limit + 22;
        g.stroke(t.shape);
        // Roof beams every 64 px and a lit ridge down the middle.
        g.setLineDash([10, 54]);
        g.strokeStyle = "rgba(0,0,0,0.28)";
        g.stroke(t.shape);
        g.setLineDash([]);
        g.strokeStyle = "rgba(255,255,255,0.07)";
        g.lineWidth = t.limit * 0.6;
        g.stroke(t.shape);
        g.globalAlpha = 1;
      }
      for (const e of race.entrants) {
        if (!this.inTunnel(race, e.index)) continue;
        const c = e.car;
        g.save();
        g.globalCompositeOperation = "lighter";
        const fx = Math.cos(c.angle);
        const fy = Math.sin(c.angle);
        const grd = g.createRadialGradient(c.x + fx * 30, c.y + fy * 30, 4, c.x + fx * 70, c.y + fy * 70, 110);
        grd.addColorStop(0, "rgba(255,240,190,0.35)");
        grd.addColorStop(1, "rgba(255,240,190,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(c.x + fx * 18, c.y + fy * 18);
        g.lineTo(c.x + fx * 170 - fy * 80, c.y + fy * 170 + fx * 80);
        g.lineTo(c.x + fx * 170 + fy * 80, c.y + fy * 170 - fx * 80);
        g.closePath();
        g.fill();
        g.restore();
        g.globalAlpha = 0.4;
        drawCar(g, this.looks[e.index], this.pose(e, time));
        g.globalAlpha = 1;
      }
      g.lineCap = "round";
    }

    for (const t of tags) {
      const e = race.entrants[t.index];
      if (inView(e.car.x, e.car.y, 40)) drawPlayerTag(g, e.car.x, e.car.y - e.car.z * 0.3, t.label, t.color, z);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  inTunnel(race: Race, index: number): boolean {
    const e = race.entrants[index];
    if (e.hit.path !== 0) return false;
    const s = e.hit.sMain;
    for (const t of this.tunnelShapes) {
      if (t.to <= race.track.length ? s >= t.from && s <= t.to : s >= t.from || s <= t.to - race.track.length) return true;
    }
    return false;
  }

  private pose(e: Race["entrants"][number], time: number) {
    const c = e.car;
    return { x: c.x, y: c.y, angle: c.angle, z: c.z, steer: c.steerVis, braking: c.braking, damage: c.damage, shield: c.shield, turbo: c.turbo, time };
  }

  /** Renders a whole-track overview into a small canvas (menus, minimap). */
  static drawOverview(canvas: HTMLCanvasElement, track: Track, opts: { pad?: number; colors?: { wall: string; road: string; branch: string } } = {}): { scale: number; ox: number; oy: number } {
    const g = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;
    const pad = opts.pad ?? 8;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of track.paths)
      for (let i = 0; i < p.n; i++) {
        minX = Math.min(minX, p.xs[i]);
        minY = Math.min(minY, p.ys[i]);
        maxX = Math.max(maxX, p.xs[i]);
        maxY = Math.max(maxY, p.ys[i]);
      }
    const scale = Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxY - minY));
    const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (h - (maxY - minY) * scale) / 2 - minY * scale;
    g.clearRect(0, 0, w, h);
    g.save();
    g.setTransform(scale, 0, 0, scale, ox, oy);
    g.lineJoin = "round";
    g.lineCap = "round";
    const col = opts.colors ?? { wall: "rgba(255,255,255,0.18)", road: "#f4f1ff", branch: "#ffd23f" };
    track.paths.forEach((p) => {
      g.strokeStyle = col.wall;
      g.lineWidth = Math.max(2 * p.limit, 6 / scale);
      g.stroke(polyPath(p));
    });
    track.paths.forEach((p, i) => {
      g.strokeStyle = i === 0 ? col.road : col.branch;
      g.lineWidth = Math.max(p.halfW * 0.9, 2.2 / scale);
      g.stroke(polyPath(p));
    });
    const a = track.main.at(0);
    g.fillStyle = "#ff3d7f";
    g.beginPath();
    g.arc(a.x, a.y, 5 / scale, 0, Math.PI * 2);
    g.fill();
    g.restore();
    return { scale, ox, oy };
  }
}
