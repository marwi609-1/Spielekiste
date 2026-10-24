/**
 * Arcade vehicle model. Each step splits the velocity into a forward and a lateral part in the car's
 * frame: the engine, brakes and drag act on the forward part, grip bleeds off the lateral part, and the
 * yaw rate chases a target set by the steering input. Because the velocity is rebuilt in the car's old
 * frame while the heading has already turned, the car slides until grip catches up; holding the throttle
 * through a fast corner lowers grip progressively (the drift) and adds oversteer.
 */

import { approach, clamp } from "./math";
import { surfaceProps, type SurfaceId, Surface } from "./surfaces";
import type { CarStats } from "./vehicles";

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, then reverse when stopped)
  steer: number; // -1 (left) .. 1 (right)
  fire: boolean;
}

export const NO_INPUT: DriveInput = { throttle: 0, brake: 0, steer: 0, fire: false };

export interface CarState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angVel: number;
  /** Height above ground (jumps) and its vertical speed. */
  z: number;
  vz: number;
  /** Smoothed steering for drawing the front wheels. */
  steerVis: number;
  /** 0..1 drift intensity. */
  drift: number;
  /** Remaining lateral speed after grip (px/s): drives skid marks and tyre noise. */
  slip: number;
  /** 0..100. */
  damage: number;
  /** Seconds of oil spin left. */
  spin: number;
  spinDir: number;
  turbo: number;
  shield: number;
  powerBrakes: number;
  surface: SurfaceId;
  /** Multiplier on top speed set by the race (AI rubber-banding). */
  rubber: number;
  /** Throttle and brake of the last step (engine sound, brake lights). */
  throttle: number;
  braking: boolean;
  /** Vertical speed at touchdown in the last step, 0 otherwise. */
  landImpact: number;
}

export function createCar(x: number, y: number, angle: number): CarState {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle,
    angVel: 0,
    z: 0,
    vz: 0,
    steerVis: 0,
    drift: 0,
    slip: 0,
    damage: 0,
    spin: 0,
    spinDir: 1,
    turbo: 0,
    shield: 0,
    powerBrakes: 0,
    surface: Surface.Asphalt,
    rubber: 1,
    throttle: 0,
    braking: false,
    landImpact: 0,
  };
}

export function carSpeed(c: CarState): number {
  return Math.hypot(c.vx, c.vy);
}

/** Forward component of the velocity. */
export function forwardSpeed(c: CarState): number {
  return c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle);
}

const PAVED = new Set<number>([Surface.Asphalt, Surface.Concrete, Surface.Metal, Surface.Boost]);

/** Effective grip of a car on a surface (before drift and spin). */
export function effectiveGrip(stats: CarStats, surface: SurfaceId): number {
  const p = surfaceProps(surface);
  if (p.loose) return (p.grip + (1 - p.grip) * stats.offroad * 0.5) * (0.9 + 0.1 * stats.grip);
  if (PAVED.has(surface)) return p.grip * stats.grip;
  return p.grip * (0.85 + 0.15 * stats.grip);
}

/** Speed drag of a surface for a car: off-road ability helps most on loose ground, less in water. */
export function surfaceDrag(stats: CarStats, surface: SurfaceId): number {
  const p = surfaceProps(surface);
  const f = p.loose ? 1 - 0.75 * stats.offroad : p.splash ? 1 - 0.35 * stats.offroad : p.rough > 0 ? 1 - 0.5 * stats.offroad : 1;
  return p.drag * f;
}

/** Top speed a car can reach on a surface, ignoring turbo and rubber-banding. */
export function surfaceTopSpeed(stats: CarStats, surface: SurfaceId, damage = 0): number {
  const p = surfaceProps(surface);
  const rough = p.rough * (1 - stats.offroad) * (1 - stats.roughResist);
  const vmax = stats.vmax * (1 - 0.45 * clamp(damage / 100, 0, 1)) * (1 - 0.45 * rough);
  const grip = effectiveGrip(stats, surface);
  const accel = stats.accel * clamp(0.35 + grip * 0.75, 0.3, 1);
  const drag = surfaceDrag(stats, surface);
  // Equilibrium of engine force (full until 40 % of vmax, then linear to 0) and drag.
  // a(v) = accel * min(1, 1.6 (1 - v/vmax) + 0.05) = drag * v  → solve on the linear part.
  const k = 1.65 * accel;
  const v = k / (1.6 * accel / vmax + drag + 1e-9);
  return Math.min(vmax * (1 + 0.05 / 1.6), v);
}

export interface PhysicsEnv {
  gravity: number;
  /** Random source for road bumps (seeded in tests, Math.random in play). */
  rng: () => number;
}

export function stepCar(car: CarState, stats: CarStats, input: DriveInput, env: PhysicsEnv, dt: number): void {
  car.landImpact = 0;
  car.steerVis = approach(car.steerVis, input.steer, dt * 6);
  car.turbo = Math.max(0, car.turbo - dt);
  car.shield = Math.max(0, car.shield - dt);
  car.powerBrakes = Math.max(0, car.powerBrakes - dt);
  car.throttle = input.throttle;

  // Airborne: ballistic flight, no traction.
  if (car.z > 0 || car.vz > 0) {
    car.vz -= env.gravity * dt;
    car.z += car.vz * dt;
    if (car.z <= 0) {
      car.landImpact = -car.vz;
      car.z = 0;
      car.vz = 0;
    }
    car.angle += car.angVel * dt * 0.5;
    car.angVel *= 1 - dt * 1.5;
    car.vx *= 1 - dt * 0.03;
    car.vy *= 1 - dt * 0.03;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.braking = false;
    return;
  }

  const p = surfaceProps(car.surface);
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const rx = -fy;
  const ry = fx;
  let vf = car.vx * fx + car.vy * fy;
  const vr = car.vx * rx + car.vy * ry;

  const dmgF = 1 - 0.45 * clamp(car.damage / 100, 0, 1);
  const grip = effectiveGrip(stats, car.surface);
  const rough = p.rough * (1 - stats.offroad) * (1 - stats.roughResist);
  const turbo = car.turbo > 0;
  const vmax = stats.vmax * dmgF * (1 - 0.45 * rough) * car.rubber * (turbo ? 1.3 : 1);
  const accel = stats.accel * dmgF * (turbo ? 1.9 : 1) * clamp(0.35 + grip * 0.75, 0.3, 1);
  const drag = surfaceDrag(stats, car.surface);

  // Surface triggers.
  if (p.boost) car.turbo = Math.max(car.turbo, 0.9);
  if (p.spin && car.spin <= 0 && car.shield <= 0 && Math.abs(vf) > 110) {
    car.spin = 0.85;
    car.spinDir = car.angVel >= 0 ? 1 : -1;
  }

  let throttle = input.throttle;
  const brake = input.brake;
  if (car.spin > 0) throttle *= 0.3;

  // Longitudinal.
  let a = 0;
  let braking = false;
  if (throttle > 0) {
    if (vf < -10) {
      a += stats.brake * throttle;
      braking = true;
    } else {
      const f = 1 - vf / vmax;
      a += f > 0 ? accel * throttle * Math.min(1, f * 1.6 + 0.05) : f * 400;
    }
  }
  if (brake > 0) {
    if (vf > 10) {
      a -= stats.brake * brake * clamp(0.3 + grip * 0.8, 0.3, 1) * (car.powerBrakes > 0 ? 1.4 : 1);
      braking = true;
    } else if (throttle <= 0 && vf > -vmax * 0.3) {
      a -= accel * 0.55 * brake;
    }
  }
  if (throttle <= 0 && brake <= 0) a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 90);
  a -= drag * vf + 0.00008 * vf * Math.abs(vf);
  const before = vf;
  vf += a * dt;
  if (braking && Math.sign(vf) !== Math.sign(before)) vf = 0;
  car.braking = braking;

  // Lateral grip and drift.
  const driftTarget = throttle > 0.5 && Math.abs(input.steer) > 0.35 && vf > 0.4 * vmax ? Math.min(1, Math.abs(input.steer)) : 0;
  car.drift = approach(car.drift, driftTarget, (driftTarget > car.drift ? 1.6 : 2.5) * dt);
  const latGrip = 16 * grip * (1 - 0.55 * car.drift) * (car.spin > 0 ? 0.08 : 1);
  const vrNew = vr * Math.exp(-latGrip * dt);
  const scrub = Math.abs(vr - vrNew) * 0.12;
  vf = vf > 0 ? Math.max(0, vf - scrub) : Math.min(0, vf + scrub);
  car.slip = Math.abs(vrNew);

  // Yaw.
  const sp = Math.abs(vf);
  if (car.spin > 0) {
    car.angVel = car.spinDir * (6 + 6 * car.spin);
    car.spin = Math.max(0, car.spin - dt);
  } else {
    const dir = vf >= -5 ? 1 : -1;
    const lowF = clamp(sp / 140, 0, 1);
    const highF = 1 - 0.3 * clamp((sp - 350) / 400, 0, 1);
    const gripF = 0.45 + 0.55 * clamp(grip, 0, 1);
    let target = input.steer * stats.steer * lowF * highF * gripF * dir * (car.powerBrakes > 0 ? 1.15 : 1);
    target += input.steer * car.drift * dir;
    const resp = 9 * stats.response * (0.35 + 0.65 * clamp(grip, 0, 1));
    car.angVel += (target - car.angVel) * Math.min(1, resp * dt);
    if (rough > 0.05 && sp > 80) car.angVel += (env.rng() - 0.5) * rough * sp * 0.012;
  }
  car.angle += car.angVel * dt;

  // Rebuild in the old frame: the heading has turned, the velocity has not (yet).
  car.vx = vf * fx + vrNew * rx;
  car.vy = vf * fy + vrNew * ry;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
}

/** Applies damage scaled by armour; returns the damage actually dealt. */
export function applyDamage(car: CarState, stats: CarStats, amount: number): number {
  if (car.shield > 0 || amount <= 0) return 0;
  const d = amount / stats.armor;
  car.damage = Math.min(100, car.damage + d);
  return d;
}
