/**
 * Collision response. A car is two circles (front and rear axle) of radius width/2; the response is an
 * impulse at the contact point, so a glancing hit with the nose also rotates the car.
 */

import type { CarState } from "./physics";
import { emptyHit, type NearestHit, type Track } from "./track";
import type { CarStats } from "./vehicles";

const tmpHit: NearestHit = emptyHit();

function circleOffset(stats: CarStats): number {
  return Math.max(0, stats.length / 2 - stats.width / 2);
}

function invInertia(stats: CarStats): number {
  return 12 / (stats.length * stats.length + stats.width * stats.width);
}

/** Applies an impulse j·n (per unit mass) at offset (ox, oy) from the centre. */
function impulse(car: CarState, stats: CarStats, ox: number, oy: number, nx: number, ny: number, j: number): void {
  car.vx += nx * j;
  car.vy += ny * j;
  car.angVel += (ox * ny - oy * nx) * j * invInertia(stats);
}

/**
 * Keeps the car inside the corridor. Returns the strongest normal impact speed (px/s), 0 if no contact.
 * Also reports the contact point for sparks.
 */
export function collideWalls(car: CarState, stats: CarStats, track: Track, contact?: { x: number; y: number }): number {
  const off = circleOffset(stats);
  const r = stats.width / 2;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let worst = 0;
  for (const sgn of [1, -1]) {
    const ox = fx * off * sgn;
    const oy = fy * off * sgn;
    const qx = car.x + ox;
    const qy = car.y + oy;
    const hit = track.nearest(qx, qy, tmpHit);
    if (hit.margin >= r) continue;
    const pen = r - hit.margin;
    const d = hit.dist || 1;
    const nx = (hit.px - qx) / d;
    const ny = (hit.py - qy) / d;
    car.x += nx * pen;
    car.y += ny * pen;
    // Velocity of the contact point.
    const pvx = car.vx - car.angVel * oy;
    const pvy = car.vy + car.angVel * ox;
    const vn = pvx * nx + pvy * ny;
    if (vn >= 0) continue;
    const rn = ox * ny - oy * nx;
    const e = 0.3;
    const j = (-(1 + e) * vn) / (1 + rn * rn * invInertia(stats));
    impulse(car, stats, ox, oy, nx, ny, j);
    // Friction along the wall.
    const tx = -ny;
    const ty = nx;
    const vt = pvx * tx + pvy * ty;
    const rt = ox * ty - oy * tx;
    let jt = -vt / (1 + rt * rt * invInertia(stats));
    const maxT = 0.35 * j;
    jt = Math.max(-maxT, Math.min(maxT, jt));
    impulse(car, stats, ox, oy, tx, ty, jt);
    if (-vn > worst) {
      worst = -vn;
      if (contact) {
        contact.x = qx - nx * r;
        contact.y = qy - ny * r;
      }
    }
  }
  return worst;
}

export interface Body {
  car: CarState;
  stats: CarStats;
}

/** Car-to-car contact. Returns the relative normal speed of the hit (0 if none). */
export function collideCars(a: Body, b: Body, contact?: { x: number; y: number }): number {
  const ca = a.car;
  const cb = b.car;
  if (Math.abs(ca.z - cb.z) > 18) return 0;
  const reach = (a.stats.length + b.stats.length) / 2 + 4;
  const dx0 = cb.x - ca.x;
  const dy0 = cb.y - ca.y;
  if (dx0 * dx0 + dy0 * dy0 > reach * reach) return 0;
  const offA = circleOffset(a.stats);
  const offB = circleOffset(b.stats);
  const ra = a.stats.width / 2;
  const rb = b.stats.width / 2;
  const fax = Math.cos(ca.angle);
  const fay = Math.sin(ca.angle);
  const fbx = Math.cos(cb.angle);
  const fby = Math.sin(cb.angle);
  let worst = 0;
  for (const sa of [1, -1]) {
    for (const sb of [1, -1]) {
      const oax = fax * offA * sa;
      const oay = fay * offA * sa;
      const obx = fbx * offB * sb;
      const oby = fby * offB * sb;
      const dx = cb.x + obx - (ca.x + oax);
      const dy = cb.y + oby - (ca.y + oay);
      const dist = Math.hypot(dx, dy);
      const minD = ra + rb;
      if (dist >= minD || dist < 1e-6) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const ma = a.stats.mass;
      const mb = b.stats.mass;
      const pen = minD - dist;
      ca.x -= nx * pen * (mb / (ma + mb));
      ca.y -= ny * pen * (mb / (ma + mb));
      cb.x += nx * pen * (ma / (ma + mb));
      cb.y += ny * pen * (ma / (ma + mb));
      const vax = ca.vx - ca.angVel * oay;
      const vay = ca.vy + ca.angVel * oax;
      const vbx = cb.vx - cb.angVel * oby;
      const vby = cb.vy + cb.angVel * obx;
      const vn = (vbx - vax) * nx + (vby - vay) * ny;
      if (vn >= 0) continue;
      const e = 0.35;
      const rna = oax * ny - oay * nx;
      const rnb = obx * ny - oby * nx;
      const k = 1 / ma + 1 / mb + (rna * rna * invInertia(a.stats)) / ma + (rnb * rnb * invInertia(b.stats)) / mb;
      const j = (-(1 + e) * vn) / k;
      impulse(ca, a.stats, oax, oay, nx, ny, -j / ma);
      impulse(cb, b.stats, obx, oby, nx, ny, j / mb);
      if (-vn > worst) {
        worst = -vn;
        if (contact) {
          contact.x = ca.x + oax + nx * ra;
          contact.y = ca.y + oay + ny * ra;
        }
      }
    }
  }
  return worst;
}
