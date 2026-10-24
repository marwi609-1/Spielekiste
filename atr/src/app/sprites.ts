/**
 * Procedural sprites: cars, scenery, pickups, cones, mines and missiles, drawn with canvas paths.
 *
 * Forced perspective: the camera looks straight down, but anything with height leans away from the
 * centre of the screen (scenery) or has its upper layers shifted towards the top of the screen (cars),
 * which gives the slightly three-dimensional overhead look of the original.
 */

import type { VehicleKind } from "../core/vehicles";
import type { DecorSpec } from "../core/track";
import type { WorldId } from "../core/worlds";
import { PICKUP_COLORS } from "./style";

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

export interface CarLook {
  kind: VehicleKind;
  color: string;
  length: number;
  width: number;
}

export interface CarPose {
  x: number;
  y: number;
  angle: number;
  z: number;
  steer: number;
  braking: boolean;
  damage: number;
  shield: number;
  turbo: number;
  time: number;
}

function wheel(g: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, rot: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = "#15161a";
  rr(g, -len / 2, -wid / 2, len, wid, 2);
  g.fill();
  g.fillStyle = "#3a3c44";
  for (let k = -len / 2 + 2; k < len / 2 - 1; k += 3) g.fillRect(k, -wid / 2, 1.2, wid);
  g.restore();
}

/** Shadow of a car on the ground (drawn before all cars). */
export function drawCarShadow(g: CanvasRenderingContext2D, look: CarLook, pose: CarPose): void {
  const off = 5 + pose.z * 0.55;
  g.save();
  g.translate(pose.x + off * 0.6, pose.y + off);
  g.rotate(pose.angle);
  g.globalAlpha = Math.max(0.12, 0.38 - pose.z / 400);
  g.fillStyle = "#000";
  rr(g, -look.length / 2, -look.width / 2, look.length, look.width, 6);
  g.fill();
  g.restore();
}

export function drawCar(g: CanvasRenderingContext2D, look: CarLook, pose: CarPose): void {
  const { length: L, width: W, color, kind } = look;
  const a = pose.angle;
  const scale = 1 + pose.z / 230;
  g.save();
  g.translate(pose.x, pose.y);
  g.scale(scale, scale);
  g.rotate(a);
  // Screen "up" in the car's frame: higher layers shift this way.
  const ux = -Math.sin(a);
  const uy = -Math.cos(a);
  const lift = (h: number) => g.translate(ux * h * 0.55, uy * h * 0.55);
  const dark = shade(color, -0.45);
  const light = shade(color, 0.35);
  const steer = pose.steer * 0.45;

  if (pose.braking) {
    const grd = g.createRadialGradient(-L / 2, 0, 0, -L / 2, 0, 18);
    grd.addColorStop(0, "rgba(255,40,40,0.55)");
    grd.addColorStop(1, "rgba(255,40,40,0)");
    g.fillStyle = grd;
    g.fillRect(-L / 2 - 18, -18, 30, 36);
  }

  if (kind === "formula") {
    wheel(g, -L * 0.32, -W * 0.42, 11, 6.5, 0);
    wheel(g, -L * 0.32, W * 0.42, 11, 6.5, 0);
    wheel(g, L * 0.27, -W * 0.4, 9, 5.5, steer);
    wheel(g, L * 0.27, W * 0.4, 9, 5.5, steer);
    g.fillStyle = "#22242a";
    rr(g, -L * 0.42, -4.5, L * 0.78, 9, 3);
    g.fill();
    g.save();
    lift(2);
    // Sidepods and nose.
    g.fillStyle = color;
    rr(g, -L * 0.3, -W * 0.33, L * 0.42, W * 0.66, 4);
    g.fill();
    g.beginPath();
    g.moveTo(L * 0.1, -4.5);
    g.lineTo(L * 0.5, -2);
    g.lineTo(L * 0.5, 2);
    g.lineTo(L * 0.1, 4.5);
    g.closePath();
    g.fill();
    g.fillStyle = "#fff";
    g.fillRect(L * 0.18, -1, L * 0.3, 2);
    // Wings.
    g.fillStyle = dark;
    rr(g, L * 0.4, -W * 0.48, 5, W * 0.96, 1.5);
    g.fill();
    g.fillStyle = "#1b1c21";
    rr(g, -L * 0.5, -W * 0.42, 6, W * 0.84, 1.5);
    g.fill();
    g.fillStyle = color;
    g.fillRect(-L * 0.5 + 1, -W * 0.42, 2.5, W * 0.84);
    g.restore();
    g.save();
    lift(4);
    g.fillStyle = "#111318";
    g.beginPath();
    g.ellipse(-L * 0.06, 0, 6, 4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = light;
    g.beginPath();
    g.arc(-L * 0.08, 0, 2.8, 0, Math.PI * 2);
    g.fill();
    g.restore();
  } else if (kind === "buggy") {
    wheel(g, -L * 0.32, -W * 0.43, 11, 7, 0);
    wheel(g, -L * 0.32, W * 0.43, 11, 7, 0);
    wheel(g, L * 0.3, -W * 0.43, 10, 6.5, steer);
    wheel(g, L * 0.3, W * 0.43, 10, 6.5, steer);
    g.fillStyle = "#2a2c33";
    rr(g, -L * 0.44, -W * 0.3, L * 0.86, W * 0.6, 4);
    g.fill();
    g.save();
    lift(2);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(L * 0.5, -W * 0.18);
    g.lineTo(L * 0.5, W * 0.18);
    g.lineTo(L * 0.12, W * 0.3);
    g.lineTo(L * 0.12, -W * 0.3);
    g.closePath();
    g.fill();
    rr(g, -L * 0.2, -W * 0.36, L * 0.3, W * 0.16, 2);
    g.fill();
    rr(g, -L * 0.2, W * 0.2, L * 0.3, W * 0.16, 2);
    g.fill();
    // Engine block.
    g.fillStyle = "#5b5e66";
    rr(g, -L * 0.46, -W * 0.2, L * 0.2, W * 0.4, 2);
    g.fill();
    g.fillStyle = "#8a8d96";
    g.fillRect(-L * 0.44, -W * 0.12, L * 0.14, 2);
    g.fillRect(-L * 0.44, W * 0.06, L * 0.14, 2);
    g.restore();
    g.save();
    lift(4);
    g.fillStyle = light;
    g.beginPath();
    g.arc(-L * 0.04, 0, 3.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.save();
    lift(7);
    g.strokeStyle = "#1c1d22";
    g.lineWidth = 2;
    g.strokeRect(-L * 0.2, -W * 0.3, L * 0.32, W * 0.6);
    g.beginPath();
    g.moveTo(-L * 0.2, 0);
    g.lineTo(L * 0.12, 0);
    g.stroke();
    g.restore();
  } else {
    wheel(g, -L * 0.3, -W * 0.46, 11, 6, 0);
    wheel(g, -L * 0.3, W * 0.46, 11, 6, 0);
    wheel(g, L * 0.3, -W * 0.46, 11, 6, steer);
    wheel(g, L * 0.3, W * 0.46, 11, 6, steer);
    g.save();
    lift(2);
    g.fillStyle = dark;
    rr(g, -L * 0.48, -W * 0.44, L * 0.96, W * 0.88, 5);
    g.fill();
    g.fillStyle = color;
    rr(g, -L * 0.46, -W * 0.4, L * 0.92, W * 0.8, 4);
    g.fill();
    g.fillStyle = shade(color, -0.2);
    g.fillRect(L * 0.18, -W * 0.08, L * 0.28, W * 0.16);
    // Spare wheel.
    g.fillStyle = "#18191d";
    g.beginPath();
    g.arc(-L * 0.5, 0, 5, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.save();
    lift(4);
    g.fillStyle = "#1d3550";
    rr(g, L * 0.04, -W * 0.36, L * 0.12, W * 0.72, 2);
    g.fill();
    g.restore();
    g.save();
    lift(7);
    g.fillStyle = light;
    rr(g, -L * 0.36, -W * 0.36, L * 0.4, W * 0.72, 3);
    g.fill();
    g.fillStyle = "#ffe27a";
    g.fillRect(L * 0.0, -W * 0.3, 2, 4);
    g.fillRect(L * 0.0, W * 0.3 - 4, 2, 4);
    g.restore();
  }

  // Lights.
  g.fillStyle = "#fff6c8";
  g.fillRect(L / 2 - 2.5, -W * 0.36, 2.5, 3.5);
  g.fillRect(L / 2 - 2.5, W * 0.36 - 3.5, 2.5, 3.5);
  g.fillStyle = pose.braking ? "#ff2a2a" : "#7a1010";
  g.fillRect(-L / 2, -W * 0.36, 2, 3);
  g.fillRect(-L / 2, W * 0.36 - 3, 2, 3);

  // Dents and soot.
  if (pose.damage > 25) {
    g.fillStyle = `rgba(20,20,20,${Math.min(0.45, (pose.damage - 25) / 160)})`;
    g.beginPath();
    g.ellipse(L * 0.25, -W * 0.15, 5, 3, 0.6, 0, Math.PI * 2);
    g.ellipse(-L * 0.15, W * 0.2, 4, 3, -0.4, 0, Math.PI * 2);
    g.fill();
  }

  if (pose.turbo > 0) {
    const f = 8 + Math.sin(pose.time * 60) * 3;
    const grd = g.createLinearGradient(-L / 2, 0, -L / 2 - f - 8, 0);
    grd.addColorStop(0, "rgba(255,240,160,0.95)");
    grd.addColorStop(0.4, "rgba(255,140,30,0.8)");
    grd.addColorStop(1, "rgba(255,60,0,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-L / 2, -4);
    g.lineTo(-L / 2 - f - 8, 0);
    g.lineTo(-L / 2, 4);
    g.closePath();
    g.fill();
  }
  g.restore();

  if (pose.shield > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(pose.time * 10);
    g.save();
    g.globalAlpha = pose.shield < 1.5 ? (Math.sin(pose.time * 30) > 0 ? 0.8 : 0.2) : 0.75;
    g.strokeStyle = "#3ddcff";
    g.lineWidth = 2 + pulse;
    g.beginPath();
    g.arc(pose.x, pose.y, L * 0.62 * scale, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha *= 0.18;
    g.fillStyle = "#3ddcff";
    g.fill();
    g.restore();
  }
}

/** Marker above a human player's car. */
export function drawPlayerTag(g: CanvasRenderingContext2D, x: number, y: number, label: string, color: string, zoom: number): void {
  g.save();
  g.translate(x, y - 34);
  g.scale(1 / zoom, 1 / zoom);
  g.font = "700 13px 'Chakra Petch', system-ui, sans-serif";
  const w = g.measureText(label).width + 10;
  g.fillStyle = "rgba(10,8,30,0.75)";
  rr(g, -w / 2, -10, w, 18, 4);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 0, 0);
  g.beginPath();
  g.moveTo(-5, 8);
  g.lineTo(5, 8);
  g.lineTo(0, 14);
  g.closePath();
  g.fill();
  g.restore();
}

// --- scenery ------------------------------------------------------------------------------------

/** Height (px) used for the perspective lean. */
export function decorHeight(kind: string, r: number): number {
  switch (kind) {
    case "pine":
    case "snowpine":
      return r * 2.6;
    case "tree":
      return r * 1.8;
    case "stand":
      return 34;
    case "mesa":
      return r * 0.8;
    case "boulder":
      return r * 0.9;
    case "rock":
    case "moonrock":
      return r * 0.7;
    case "cactus":
      return 34;
    case "flag":
    case "beacon":
      return 48;
    case "lander":
      return 30;
    case "antenna":
      return 36;
    case "crystal":
      return r * 1.6;
    case "pod":
      return r * 1.1;
    case "tendril":
      return 30;
    default:
      return 8;
  }
}

/** Flat scenery is baked into the ground tiles. */
export function isFlatDecor(kind: string): boolean {
  return kind === "crater" || kind === "panel";
}

export function drawDecorShadow(g: CanvasRenderingContext2D, d: DecorSpec): void {
  if (isFlatDecor(d.kind)) return;
  const h = decorHeight(d.kind, d.r);
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath();
  if (d.kind === "stand") {
    g.save();
    g.translate(d.x + 10, d.y + 14);
    g.rotate(d.rot);
    g.fillRect(-d.r, -36, d.r * 2, 72);
    g.restore();
    return;
  }
  g.ellipse(d.x + h * 0.25, d.y + h * 0.35, d.r * 1.05, d.r * 0.85, 0, 0, Math.PI * 2);
  g.fill();
}

export function drawFlatDecor(g: CanvasRenderingContext2D, d: DecorSpec): void {
  if (d.kind === "crater") {
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.beginPath();
    g.ellipse(d.x, d.y, d.r, d.r * 0.92, d.rot, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.beginPath();
    g.ellipse(d.x + d.r * 0.12, d.y + d.r * 0.12, d.r * 0.82, d.r * 0.76, d.rot, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.16)";
    g.beginPath();
    g.ellipse(d.x - d.r * 0.08, d.y - d.r * 0.08, d.r * 0.7, d.r * 0.64, d.rot, 0, Math.PI * 2);
    g.fill();
  } else if (d.kind === "panel") {
    g.save();
    g.translate(d.x, d.y);
    g.rotate(d.rot);
    g.fillStyle = "#1b2b6b";
    g.fillRect(-d.r, -d.r * 0.5, d.r * 2, d.r);
    g.strokeStyle = "#4f78ff";
    g.lineWidth = 1;
    for (let k = -d.r; k <= d.r; k += d.r / 3) {
      g.beginPath();
      g.moveTo(k, -d.r * 0.5);
      g.lineTo(k, d.r * 0.5);
      g.stroke();
    }
    g.strokeRect(-d.r, -d.r * 0.5, d.r * 2, d.r);
    g.restore();
  }
}

/** Draws n stacked layers from ground to height h, each `shape` call fills one layer. */
function stack(g: CanvasRenderingContext2D, x: number, y: number, lx: number, ly: number, n: number, shape: (t: number, k: number) => void): void {
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 1 : k / (n - 1);
    g.save();
    g.translate(x + lx * t, y + ly * t);
    shape(t, k);
    g.restore();
  }
}

/**
 * Draws a scenery item; (lx, ly) is the lean of its top relative to its base, in px.
 */
export function drawDecor(g: CanvasRenderingContext2D, d: DecorSpec, lx: number, ly: number, time: number, world: WorldId): void {
  const r = d.r;
  switch (d.kind) {
    case "pine":
    case "snowpine": {
      g.fillStyle = "#4b3322";
      g.beginPath();
      g.arc(d.x, d.y, r * 0.18, 0, Math.PI * 2);
      g.fill();
      const base = world === "forest" ? ["#1f4d33", "#286040", "#33734d", "#3f8659"] : ["#1e4a2c", "#265a36", "#2f6b40", "#3a7d4b"];
      stack(g, d.x, d.y, lx, ly, 4, (t, k) => {
        const rad = r * (1 - t * 0.72);
        g.fillStyle = base[k];
        g.beginPath();
        for (let q = 0; q < 9; q++) {
          const ang = d.rot + (q / 9) * Math.PI * 2;
          const rq = q % 2 === 0 ? rad : rad * 0.78;
          if (q === 0) g.moveTo(Math.cos(ang) * rq, Math.sin(ang) * rq);
          else g.lineTo(Math.cos(ang) * rq, Math.sin(ang) * rq);
        }
        g.closePath();
        g.fill();
        if (d.kind === "snowpine") {
          g.fillStyle = "rgba(255,255,255,0.82)";
          g.beginPath();
          g.arc(-rad * 0.25, -rad * 0.25, rad * 0.45, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    }
    case "tree":
      stack(g, d.x, d.y, lx, ly, 3, (t, k) => {
        g.fillStyle = ["#2e6e2a", "#3b8433", "#4f9c41"][k];
        g.beginPath();
        g.arc(0, 0, r * (1 - t * 0.35), 0, Math.PI * 2);
        g.arc(r * 0.45 * (1 - t * 0.5), r * 0.2, r * 0.6 * (1 - t * 0.4), 0, Math.PI * 2);
        g.fill();
      });
      break;
    case "bush":
      stack(g, d.x, d.y, lx, ly, 2, (_t, k) => {
        g.fillStyle = k ? "#5fae45" : "#3d7f30";
        g.beginPath();
        g.arc(0, 0, r * (k ? 0.7 : 1), 0, Math.PI * 2);
        g.arc(r * 0.5, r * 0.3, r * 0.6, 0, Math.PI * 2);
        g.fill();
      });
      break;
    case "tyres":
      stack(g, d.x, d.y, lx, ly, 4, () => {
        g.fillStyle = "#18191d";
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#3b3d44";
        g.lineWidth = 2;
        g.stroke();
      });
      g.fillStyle = d.v > 0.5 ? "#e0302b" : "#f2f2f2";
      g.beginPath();
      g.arc(d.x + lx, d.y + ly, r * 0.45, 0, Math.PI * 2);
      g.fill();
      break;
    case "flag": {
      g.strokeStyle = "#ddd";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + lx, d.y + ly);
      g.stroke();
      const wave = Math.sin(time * 4 + d.v * 10) * 3;
      g.fillStyle = world === "moon" ? "#3d6bff" : d.v > 0.5 ? "#ffd23f" : "#e0302b";
      g.beginPath();
      g.moveTo(d.x + lx, d.y + ly);
      g.lineTo(d.x + lx + 16, d.y + ly + 2 + wave);
      g.lineTo(d.x + lx + 1, d.y + ly + 9);
      g.closePath();
      g.fill();
      break;
    }
    case "stand": {
      g.save();
      g.translate(d.x, d.y);
      g.rotate(d.rot);
      const crowd = ["#ffd23f", "#ff5146", "#3ddcff", "#ffffff", "#4be16a", "#ff9b3d", "#b77bff"];
      for (let k = 0; k < 4; k++) {
        const t = k / 3;
        g.save();
        // Lean in screen space: rotate the lean into the stand's frame.
        const c = Math.cos(-d.rot);
        const s = Math.sin(-d.rot);
        g.translate((lx * c - ly * s) * t, (lx * s + ly * c) * t);
        g.fillStyle = k === 3 ? "#cfd3db" : ["#59606e", "#666d7b", "#737a88"][k];
        g.fillRect(-r, -34 + k * 14, r * 2, 68 - k * 14);
        if (k < 3) {
          for (let q = -r + 4; q < r - 4; q += 6) {
            g.fillStyle = crowd[Math.abs(Math.floor(q * 7 + k * 13 + d.v * 100)) % crowd.length];
            g.fillRect(q, -30 + k * 14, 3, 3);
          }
        }
        g.restore();
      }
      g.restore();
      break;
    }
    case "rock":
    case "moonrock":
    case "boulder":
    case "mesa": {
      const cols =
        d.kind === "moonrock"
          ? ["#505158", "#62636b", "#75767e", "#8d8e95"]
          : d.kind === "mesa"
            ? ["#6d2c15", "#83391d", "#9a4826", "#c26a3e"]
            : world === "forest"
              ? ["#6b7280", "#7c8391", "#8e95a3", "#e8eef5"]
              : ["#6d3a22", "#82472b", "#985637", "#b06a47"];
      const pts = 7;
      stack(g, d.x, d.y, lx, ly, 4, (t, k) => {
        const s = 1 - t * (d.kind === "mesa" ? 0.08 : 0.3);
        g.fillStyle = cols[k];
        g.beginPath();
        for (let q = 0; q < pts; q++) {
          const ang = d.rot + (q / pts) * Math.PI * 2;
          const rq = r * s * (0.8 + 0.2 * Math.sin(q * 2.3 + d.v * 9));
          if (q === 0) g.moveTo(Math.cos(ang) * rq, Math.sin(ang) * rq);
          else g.lineTo(Math.cos(ang) * rq, Math.sin(ang) * rq);
        }
        g.closePath();
        g.fill();
      });
      break;
    }
    case "cactus":
      stack(g, d.x, d.y, lx, ly, 5, (t) => {
        g.fillStyle = shade("#3f8f3a", t * 0.25 - 0.1);
        g.beginPath();
        g.arc(0, 0, 5, 0, Math.PI * 2);
        g.fill();
        if (t > 0.4 && t < 0.9) {
          g.beginPath();
          g.arc(Math.cos(d.rot) * 8, Math.sin(d.rot) * 8, 3, 0, Math.PI * 2);
          g.arc(-Math.cos(d.rot) * 7, -Math.sin(d.rot) * 7, 3, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case "log":
      g.save();
      g.translate(d.x + lx * 0.5, d.y + ly * 0.5);
      g.rotate(d.rot);
      g.fillStyle = "#6b4a2f";
      rr(g, -r, -6, r * 2, 12, 6);
      g.fill();
      g.fillStyle = "#c79b6a";
      g.beginPath();
      g.ellipse(r - 1, 0, 3, 6, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.8)";
      g.fillRect(-r + 4, -6, r * 1.4, 3);
      g.restore();
      break;
    case "lander": {
      g.strokeStyle = "#b9b9c2";
      g.lineWidth = 2;
      for (let q = 0; q < 4; q++) {
        const ang = d.rot + (q * Math.PI) / 2 + Math.PI / 4;
        g.beginPath();
        g.moveTo(d.x + Math.cos(ang) * r, d.y + Math.sin(ang) * r);
        g.lineTo(d.x + lx * 0.5, d.y + ly * 0.5);
        g.stroke();
      }
      stack(g, d.x, d.y, lx, ly, 3, (_t, k) => {
        g.fillStyle = ["#a07a1c", "#c99b24", "#e8c34a"][k];
        g.fillRect(-r * 0.45, -r * 0.45, r * 0.9, r * 0.9);
      });
      break;
    }
    case "beacon": {
      g.strokeStyle = "#7f8aa8";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + lx, d.y + ly);
      g.stroke();
      const on = Math.sin(time * 3 + d.v * 6) > 0;
      g.fillStyle = on ? "#ff3d3d" : "#5a1515";
      g.beginPath();
      g.arc(d.x + lx, d.y + ly, 5, 0, Math.PI * 2);
      g.fill();
      if (on) {
        g.fillStyle = "rgba(255,61,61,0.25)";
        g.beginPath();
        g.arc(d.x + lx, d.y + ly, 14, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case "antenna":
      g.strokeStyle = "#9aa3bb";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + lx * 0.7, d.y + ly * 0.7);
      g.stroke();
      g.fillStyle = "#d9deea";
      g.beginPath();
      g.ellipse(d.x + lx, d.y + ly, r, r * 0.55, d.rot + time * 0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#8f98b0";
      g.beginPath();
      g.arc(d.x + lx, d.y + ly, 3, 0, Math.PI * 2);
      g.fill();
      break;
    case "pod":
      stack(g, d.x, d.y, lx, ly, 3, (t, k) => {
        g.fillStyle = ["#5d1f6e", "#7c2c8f", "#a046b5"][k];
        g.beginPath();
        g.arc(0, 0, r * (1 - t * 0.3), 0, Math.PI * 2);
        g.fill();
      });
      g.fillStyle = `rgba(156,255,87,${0.5 + 0.4 * Math.sin(time * 2 + d.v * 7)})`;
      g.beginPath();
      g.arc(d.x + lx - r * 0.2, d.y + ly - r * 0.2, r * 0.22, 0, Math.PI * 2);
      g.arc(d.x + lx + r * 0.25, d.y + ly + r * 0.1, r * 0.15, 0, Math.PI * 2);
      g.fill();
      break;
    case "crystal": {
      const shards = 3 + Math.floor(d.v * 3);
      for (let q = 0; q < shards; q++) {
        const ang = d.rot + (q / shards) * Math.PI * 2;
        const bx = d.x + Math.cos(ang) * r * 0.4;
        const by = d.y + Math.sin(ang) * r * 0.4;
        const h = 0.6 + 0.4 * Math.sin(q * 3.1 + d.v * 5);
        g.fillStyle = q % 2 ? "#7fe7ff" : "#c6f6ff";
        g.beginPath();
        g.moveTo(bx - Math.sin(ang) * 6, by + Math.cos(ang) * 6);
        g.lineTo(bx + lx * h + Math.cos(ang) * 4, by + ly * h + Math.sin(ang) * 4);
        g.lineTo(bx + Math.sin(ang) * 6, by - Math.cos(ang) * 6);
        g.closePath();
        g.fill();
      }
      g.fillStyle = "rgba(127,231,255,0.18)";
      g.beginPath();
      g.arc(d.x, d.y, r * 1.2, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "tendril": {
      g.lineCap = "round";
      for (let q = 0; q < 3; q++) {
        const ang = d.rot + q * 2.1;
        const sway = Math.sin(time * 1.6 + q + d.v * 6) * 8;
        g.strokeStyle = q === 1 ? "#ff5ab4" : "#c43c8c";
        g.lineWidth = 5 - q;
        g.beginPath();
        g.moveTo(d.x + Math.cos(ang) * r * 0.4, d.y + Math.sin(ang) * r * 0.4);
        g.quadraticCurveTo(d.x + lx * 0.5 + sway, d.y + ly * 0.5 - sway, d.x + lx + Math.cos(ang) * 6 + sway, d.y + ly + Math.sin(ang) * 6);
        g.stroke();
      }
      g.lineCap = "butt";
      break;
    }
    case "egg":
      for (let q = 0; q < 3; q++) {
        const ang = d.rot + q * 2.1;
        g.fillStyle = q % 2 ? "#e9e2c8" : "#f6f0da";
        g.beginPath();
        g.ellipse(d.x + Math.cos(ang) * r * 0.7 + lx * 0.5, d.y + Math.sin(ang) * r * 0.7 + ly * 0.5, r * 0.55, r * 0.75, ang, 0, Math.PI * 2);
        g.fill();
      }
      break;
    default:
      break;
  }
}

// --- track objects ------------------------------------------------------------------------------

const GLYPH: Record<string, string> = { turbo: "N", cash: "$", shield: "S", brakes: "B", repair: "+", weapon: "!" };

export function drawPickup(g: CanvasRenderingContext2D, kind: string, x: number, y: number, time: number): void {
  const bob = Math.sin(time * 4 + x * 0.01) * 2.5;
  const col = PICKUP_COLORS[kind] ?? "#fff";
  g.save();
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.beginPath();
  g.ellipse(x + 5, y + 7, 11, 8, 0, 0, Math.PI * 2);
  g.fill();
  g.translate(x, y - 4 + bob);
  g.rotate(Math.sin(time * 2 + y) * 0.15);
  const grd = g.createRadialGradient(0, 0, 2, 0, 0, 20);
  grd.addColorStop(0, col);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = 0.45;
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, 20, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = shade(col, -0.35);
  rr(g, -11, -11, 22, 22, 5);
  g.fill();
  g.fillStyle = col;
  rr(g, -11, -13, 22, 22, 5);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = "#1a1033";
  g.font = "16px 'Bungee', 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(GLYPH[kind] ?? "?", 0, -1);
  g.restore();
}

export function drawCone(g: CanvasRenderingContext2D, x: number, y: number, z: number, rot: number): void {
  const s = 1 + z / 60;
  g.save();
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.beginPath();
  g.ellipse(x + 3 + z * 0.4, y + 4 + z * 0.6, 7, 6, 0, 0, Math.PI * 2);
  g.fill();
  g.translate(x, y - z * 0.3);
  g.scale(s, s);
  g.rotate(rot);
  g.fillStyle = "#e85d10";
  g.fillRect(-7, -7, 14, 14);
  g.fillStyle = "#ff7a1a";
  g.beginPath();
  g.arc(0, 0, 5.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#fff";
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(0, 0, 3.2, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#ffb070";
  g.beginPath();
  g.arc(-0.8, -0.8, 1.4, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function drawMine(g: CanvasRenderingContext2D, x: number, y: number, age: number): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = "#2b2d33";
  g.beginPath();
  for (let q = 0; q < 8; q++) {
    const ang = (q / 8) * Math.PI * 2;
    g.lineTo(Math.cos(ang) * 9, Math.sin(ang) * 9);
    g.lineTo(Math.cos(ang + 0.39) * 6, Math.sin(ang + 0.39) * 6);
  }
  g.closePath();
  g.fill();
  const on = age < 0.5 || Math.sin(age * 9) > 0;
  g.fillStyle = on ? "#ff2d2d" : "#5d0d0d";
  g.beginPath();
  g.arc(0, 0, 3, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function drawMissile(g: CanvasRenderingContext2D, x: number, y: number, angle: number, time: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  const f = 10 + Math.sin(time * 70) * 4;
  g.fillStyle = "rgba(255,170,40,0.9)";
  g.beginPath();
  g.moveTo(-8, -3);
  g.lineTo(-8 - f, 0);
  g.lineTo(-8, 3);
  g.closePath();
  g.fill();
  g.fillStyle = "#e9edf5";
  g.beginPath();
  g.roundRect(-8, -3, 16, 6, 3);
  g.fill();
  g.fillStyle = "#ff3b3b";
  g.beginPath();
  g.moveTo(8, -3);
  g.lineTo(12, 0);
  g.lineTo(8, 3);
  g.closePath();
  g.fill();
  g.fillRect(-8, -6, 4, 12);
  g.restore();
}
