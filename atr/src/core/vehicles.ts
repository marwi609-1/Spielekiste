/**
 * Vehicle classes, shop upgrades and the derived driving stats.
 * Speeds are px/s (10 px ≈ 1 m, so 600 px/s ≈ 216 km/h), accelerations px/s².
 */

export type VehicleKind = "jeep" | "buggy" | "formula";

export interface VehicleDef {
  kind: VehicleKind;
  name: string;
  blurb: string;
  price: number;
  vmax: number;
  accel: number;
  /** Grip on paved surfaces, 1 = reference. */
  grip: number;
  /** 0..1: how well the car copes with loose and rough ground. */
  offroad: number;
  /** Peak yaw rate in rad/s. */
  steer: number;
  brake: number;
  mass: number;
  /** Damage divisor: 1 = reference. */
  armor: number;
  length: number;
  width: number;
}

export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  jeep: {
    kind: "jeep",
    name: "4×4 Jeep",
    blurb: "Slow but unstoppable off the tarmac. Heavy, tough, sure-footed on snow, dirt and grass.",
    price: 2000,
    vmax: 485,
    accel: 330,
    grip: 0.92,
    offroad: 1.0,
    steer: 2.7,
    brake: 760,
    mass: 1.45,
    armor: 1.35,
    length: 40,
    width: 24,
  },
  buggy: {
    kind: "buggy",
    name: "Buggy",
    blurb: "The all-rounder. Punchy off the line and happy on most surfaces.",
    price: 3500,
    vmax: 540,
    accel: 430,
    grip: 0.98,
    offroad: 0.6,
    steer: 3.0,
    brake: 800,
    mass: 1.0,
    armor: 1.0,
    length: 36,
    width: 23,
  },
  formula: {
    kind: "formula",
    name: "Formula",
    blurb: "Fastest car on tarmac and metal decks. Fragile, and helpless once the wheels leave the track.",
    price: 5500,
    vmax: 650,
    accel: 350,
    grip: 1.15,
    offroad: 0.12,
    steer: 3.05,
    brake: 900,
    mass: 0.85,
    armor: 0.75,
    length: 44,
    width: 21,
  },
};

export const VEHICLE_KINDS: VehicleKind[] = ["jeep", "buggy", "formula"];

export type UpgradeId = "engine" | "gears" | "tyres" | "shell" | "suspension" | "brakes";

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  effect: string;
  baseCost: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: "engine", name: "Engine", effect: "Top speed +6 %", baseCost: 600 },
  { id: "gears", name: "Gears", effect: "Acceleration +10 %", baseCost: 450 },
  { id: "tyres", name: "Tyres", effect: "Grip +6 %, off-road +0.06", baseCost: 400 },
  { id: "shell", name: "Shell", effect: "Damage taken −17 %", baseCost: 350 },
  { id: "suspension", name: "Suspension", effect: "Handling, bumps and landings", baseCost: 350 },
  { id: "brakes", name: "Power Brakes", effect: "Braking +15 %, sharper steering", baseCost: 300 },
];

export const MAX_UPGRADE_LEVEL = 4;

export type UpgradeLevels = Record<UpgradeId, number>;

export function noUpgrades(): UpgradeLevels {
  return { engine: 0, gears: 0, tyres: 0, shell: 0, suspension: 0, brakes: 0 };
}

export function uniformUpgrades(level: number): UpgradeLevels {
  const l = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Math.round(level)));
  return { engine: l, gears: l, tyres: l, shell: l, suspension: l, brakes: l };
}

/** Price of the next level (level = current level, 0-based). Pricier cars cost more to tune. */
export function upgradeCost(id: UpgradeId, level: number, kind: VehicleKind): number {
  const def = UPGRADES.find((u) => u.id === id)!;
  const carFactor = kind === "formula" ? 1.25 : kind === "buggy" ? 1.1 : 1;
  return Math.round((def.baseCost * (level + 1) * carFactor) / 50) * 50;
}

/** One-race shop specials. */
export type SpecialId = "nitro" | "shield" | "magnet" | "rally" | "slicks";

export interface SpecialDef {
  id: SpecialId;
  name: string;
  effect: string;
  cost: number;
}

export const SPECIALS: SpecialDef[] = [
  { id: "nitro", name: "Nitro Start", effect: "4 s turbo when the lights go green", cost: 350 },
  { id: "shield", name: "Start Shield", effect: "12 s shield from the start", cost: 300 },
  { id: "magnet", name: "Cash Magnet", effect: "Pick up cash from three times as far", cost: 250 },
  { id: "rally", name: "Rally Tyres", effect: "Off-road +0.3 for one race", cost: 400 },
  { id: "slicks", name: "Racing Slicks", effect: "Grip on paved surfaces +12 % for one race", cost: 400 },
];

/** Stats the physics model actually uses. */
export interface CarStats {
  vmax: number;
  accel: number;
  grip: number;
  offroad: number;
  steer: number;
  /** Multiplier on how quickly the yaw rate follows the steering input. */
  response: number;
  brake: number;
  mass: number;
  armor: number;
  /** 0..0.6: how much of the rough-surface penalty the suspension absorbs. */
  roughResist: number;
  length: number;
  width: number;
}

export function computeStats(kind: VehicleKind, levels: UpgradeLevels, specials: readonly SpecialId[] = []): CarStats {
  const d = VEHICLES[kind];
  const s: CarStats = {
    vmax: d.vmax * (1 + 0.06 * levels.engine),
    accel: d.accel * (1 + 0.1 * levels.gears),
    grip: d.grip * (1 + 0.06 * levels.tyres),
    offroad: Math.min(1, d.offroad + 0.06 * levels.tyres),
    steer: d.steer * (1 + 0.04 * levels.brakes),
    response: 1 + 0.06 * levels.suspension + 0.04 * levels.brakes,
    brake: d.brake * (1 + 0.15 * levels.brakes),
    mass: d.mass,
    armor: d.armor * (1 + 0.2 * levels.shell),
    roughResist: 0.15 * levels.suspension,
    length: d.length,
    width: d.width,
  };
  if (specials.includes("rally")) s.offroad = Math.min(1, s.offroad + 0.3);
  if (specials.includes("slicks")) s.grip *= 1.12;
  return s;
}
