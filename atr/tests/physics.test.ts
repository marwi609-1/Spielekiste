import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../src/core/math";
import { createCar, forwardSpeed, stepCar, surfaceTopSpeed, type CarState } from "../src/core/physics";
import { Surface, type SurfaceId } from "../src/core/surfaces";
import { computeStats, noUpgrades, uniformUpgrades, type VehicleKind } from "../src/core/vehicles";

const env = { gravity: 950, rng: mulberry32(1) };
const DT = 1 / 120;

function drive(kind: VehicleKind, surface: SurfaceId, secs: number, input = { throttle: 1, brake: 0, steer: 0, fire: false }, car?: CarState) {
  const stats = computeStats(kind, noUpgrades());
  const c = car ?? createCar(0, 0, 0);
  for (let t = 0; t < secs; t += DT) {
    c.surface = surface;
    stepCar(c, stats, input, env, DT);
  }
  return { car: c, stats };
}

describe("vehicle model", () => {
  test("reaches the predicted top speed on tarmac", () => {
    const { car, stats } = drive("buggy", Surface.Asphalt, 15);
    const v = forwardSpeed(car);
    expect(Math.abs(v - surfaceTopSpeed(stats, Surface.Asphalt)) / v).toBeLessThan(0.08);
  });

  test("Formula is fastest on tarmac, Jeep fastest on grass, sand and snow", () => {
    const top = (k: VehicleKind, s: SurfaceId) => forwardSpeed(drive(k, s, 15).car);
    expect(top("formula", Surface.Asphalt)).toBeGreaterThan(top("buggy", Surface.Asphalt));
    expect(top("buggy", Surface.Asphalt)).toBeGreaterThan(top("jeep", Surface.Asphalt));
    for (const s of [Surface.Grass, Surface.Sand, Surface.Snow] as SurfaceId[]) expect(top("jeep", s)).toBeGreaterThan(top("formula", s));
  });

  test("water slows everyone down hard", () => {
    expect(forwardSpeed(drive("buggy", Surface.Water, 10).car)).toBeLessThan(0.4 * forwardSpeed(drive("buggy", Surface.Asphalt, 10).car));
  });

  test("Buggy accelerates hardest", () => {
    const v = (k: VehicleKind) => forwardSpeed(drive(k, Surface.Asphalt, 1).car);
    expect(v("buggy")).toBeGreaterThan(v("formula"));
    expect(v("buggy")).toBeGreaterThan(v("jeep"));
  });

  test("ice keeps a sideways slide going much longer than tarmac", () => {
    const slide = (s: SurfaceId) => {
      const c = createCar(0, 0, 0);
      c.vy = 300; // purely sideways
      return Math.abs(drive("buggy", s, 0.3, { throttle: 0, brake: 0, steer: 0, fire: false }, c).car.vy);
    };
    expect(slide(Surface.Ice)).toBeGreaterThan(10 * slide(Surface.Asphalt));
  });

  test("throttle through a fast corner builds up a drift", () => {
    const { car } = drive("buggy", Surface.Asphalt, 6);
    for (let t = 0; t < 1.2; t += DT) {
      car.surface = Surface.Asphalt;
      stepCar(car, computeStats("buggy", noUpgrades()), { throttle: 1, brake: 0, steer: 0.7, fire: false }, env, DT);
    }
    expect(car.drift).toBeGreaterThan(0.6);
    expect(car.slip).toBeGreaterThan(40);
    // Lifting off tidies it up again.
    for (let t = 0; t < 1; t += DT) stepCar(car, computeStats("buggy", noUpgrades()), { throttle: 0, brake: 0, steer: 0, fire: false }, env, DT);
    expect(car.drift).toBe(0);
  });

  test("oil spins the car unless shielded", () => {
    const fast = drive("buggy", Surface.Asphalt, 4).car;
    fast.surface = Surface.Oil;
    stepCar(fast, computeStats("buggy", noUpgrades()), { throttle: 1, brake: 0, steer: 0, fire: false }, env, DT);
    expect(fast.spin).toBeGreaterThan(0);
    const shielded = drive("buggy", Surface.Asphalt, 4).car;
    shielded.shield = 5;
    shielded.surface = Surface.Oil;
    stepCar(shielded, computeStats("buggy", noUpgrades()), { throttle: 1, brake: 0, steer: 0, fire: false }, env, DT);
    expect(shielded.spin).toBe(0);
  });

  test("brakes stop the car and then it reverses", () => {
    const { car, stats } = drive("jeep", Surface.Asphalt, 4);
    for (let t = 0; t < 3; t += DT) stepCar(car, stats, { throttle: 0, brake: 1, steer: 0, fire: false }, env, DT);
    expect(forwardSpeed(car)).toBeLessThan(-20);
  });

  test("damage costs top speed; upgrades add it", () => {
    const top = (dmg: number, lvl: number) => surfaceTopSpeed(computeStats("buggy", uniformUpgrades(lvl)), Surface.Asphalt, dmg);
    expect(top(80, 0)).toBeLessThan(top(0, 0) * 0.8);
    expect(top(0, 4)).toBeGreaterThan(top(0, 0) * 1.15);
  });
});
