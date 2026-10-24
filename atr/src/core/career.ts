/**
 * Arcade career: money, garage (each owned car keeps its own upgrades and damage), world progress,
 * continues and the shop. Pure data + functions so it serialises to localStorage and is unit-testable.
 *
 * Flow: buy a car → pick one of the three starting worlds → race its seven tracks in order (top 3 to
 * advance, otherwise spend a continue and retry) → shop after every race. After all three starting
 * worlds: Space, then Moon, then Alien.
 */

import { mulberry32 } from "./math";
import type { EntrantSetup } from "./race";
import {
  MAX_UPGRADE_LEVEL,
  SPECIALS,
  UPGRADES,
  VEHICLES,
  noUpgrades,
  uniformUpgrades,
  upgradeCost,
  type SpecialId,
  type UpgradeId,
  type UpgradeLevels,
  type VehicleKind,
} from "./vehicles";
import { LATE_WORLDS, START_WORLDS, TRACKS_PER_WORLD, WORLD_BY_ID, type WorldId } from "./worlds";

export interface GarageCar {
  kind: VehicleKind;
  levels: UpgradeLevels;
  damage: number;
}

export interface Career {
  v: 1;
  money: number;
  garage: GarageCar[];
  active: number;
  worldsDone: WorldId[];
  world: WorldId | null;
  track: number;
  continues: number;
  races: number;
  wins: number;
  /** Specials bought for the next race. */
  specials: SpecialId[];
  /** Specials on offer in the shop right now. */
  offers: SpecialId[];
  done: boolean;
}

export const START_MONEY = 6000;
export const START_CONTINUES = 3;
export const PRIZES = [1500, 1000, 600, 300, 150, 80];
export const CASH_PICKUP_VALUE = 100;

export function newCareer(): Career {
  return {
    v: 1,
    money: START_MONEY,
    garage: [],
    active: 0,
    worldsDone: [],
    world: null,
    track: 0,
    continues: START_CONTINUES,
    races: 0,
    wins: 0,
    specials: [],
    offers: rollOffers(0),
    done: false,
  };
}

function rollOffers(seed: number): SpecialId[] {
  const rng = mulberry32(seed * 7919 + 17);
  const ids = SPECIALS.map((s) => s.id);
  const out: SpecialId[] = [];
  while (out.length < 2) {
    const id = ids[Math.floor(rng() * ids.length)];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function activeCar(c: Career): GarageCar | null {
  return c.garage[c.active] ?? null;
}

/** Worlds the player may pick next (only when not in the middle of one). */
export function choosableWorlds(c: Career): WorldId[] {
  if (c.world !== null || c.done) return [];
  const start = START_WORLDS.filter((w) => !c.worldsDone.includes(w));
  if (start.length) return start;
  const late = LATE_WORLDS.find((w) => !c.worldsDone.includes(w));
  return late ? [late] : [];
}

/** All worlds unlocked for free play (starting worlds plus late worlds whose predecessor is done). */
export function unlockedWorlds(c: Career | null): WorldId[] {
  const out: WorldId[] = [...START_WORLDS];
  if (!c) return out;
  const startDone = START_WORLDS.every((w) => c.worldsDone.includes(w));
  if (!startDone) return out;
  for (const w of LATE_WORLDS) {
    out.push(w);
    if (!c.worldsDone.includes(w)) break;
  }
  return out;
}

export function pickWorld(c: Career, w: WorldId): boolean {
  if (!choosableWorlds(c).includes(w)) return false;
  c.world = w;
  c.track = 0;
  return true;
}

export function prizeFor(place: number, world: WorldId): number {
  const base = PRIZES[place - 1] ?? 0;
  return Math.round((base * (1 + 0.35 * WORLD_BY_ID[world].tier)) / 10) * 10;
}

export interface RaceOutcome {
  place: number;
  cash: number;
  damage: number;
  wrecked: boolean;
}

export interface CareerReport {
  prize: number;
  cash: number;
  qualified: boolean;
  worldComplete: WorldId | null;
  unlocked: WorldId | null;
  gameOver: boolean;
  careerComplete: boolean;
  continuesLeft: number;
}

export function applyRaceResult(c: Career, r: RaceOutcome): CareerReport {
  const world = c.world!;
  const prize = r.wrecked ? 0 : prizeFor(r.place, world);
  c.money += prize + r.cash;
  const car = activeCar(c);
  // A wrecked car is towed back and patched up just enough to start the next race.
  if (car) car.damage = Math.min(r.wrecked ? 85 : 95, r.damage);
  c.races++;
  if (r.place === 1 && !r.wrecked) c.wins++;
  c.specials = [];
  c.offers = rollOffers(c.races);
  const qualified = !r.wrecked && r.place <= 3;
  const report: CareerReport = { prize, cash: r.cash, qualified, worldComplete: null, unlocked: null, gameOver: false, careerComplete: false, continuesLeft: c.continues };
  if (qualified) {
    c.track++;
    if (c.track >= TRACKS_PER_WORLD) {
      c.worldsDone.push(world);
      report.worldComplete = world;
      c.world = null;
      c.track = 0;
      c.continues++;
      const next = choosableWorlds(c);
      if (next.length === 0) {
        c.done = true;
        report.careerComplete = true;
      } else if (START_WORLDS.every((w) => c.worldsDone.includes(w))) {
        // Late worlds come in a fixed order: go straight on.
        report.unlocked = next[0];
        c.world = next[0];
      }
    }
  } else {
    c.continues--;
    if (c.continues < 0) report.gameOver = true;
  }
  report.continuesLeft = c.continues;
  return report;
}

// --- shop ---------------------------------------------------------------------------------------

export function vehiclePrice(kind: VehicleKind): number {
  return VEHICLES[kind].price;
}

/** Trade-in value: 70 % of the car plus half of what went into it. */
export function resaleValue(car: GarageCar): number {
  let spent = 0;
  for (const u of UPGRADES) for (let l = 0; l < car.levels[u.id]; l++) spent += upgradeCost(u.id, l, car.kind);
  return Math.round((VEHICLES[car.kind].price * 0.7 + spent * 0.5) * (1 - car.damage / 250) / 10) * 10;
}

export function buyVehicle(c: Career, kind: VehicleKind): boolean {
  const price = vehiclePrice(kind);
  if (c.money < price || c.garage.some((g) => g.kind === kind)) return false;
  c.money -= price;
  c.garage.push({ kind, levels: noUpgrades(), damage: 0 });
  c.active = c.garage.length - 1;
  return true;
}

export function sellVehicle(c: Career, index: number): boolean {
  if (c.garage.length <= 1 || !c.garage[index]) return false;
  c.money += resaleValue(c.garage[index]);
  c.garage.splice(index, 1);
  if (c.active >= c.garage.length) c.active = c.garage.length - 1;
  else if (c.active > index) c.active--;
  return true;
}

export function setActive(c: Career, index: number): boolean {
  if (!c.garage[index]) return false;
  c.active = index;
  return true;
}

export function nextUpgradeCost(c: Career, id: UpgradeId): number | null {
  const car = activeCar(c);
  if (!car || car.levels[id] >= MAX_UPGRADE_LEVEL) return null;
  return upgradeCost(id, car.levels[id], car.kind);
}

export function buyUpgrade(c: Career, id: UpgradeId): boolean {
  const cost = nextUpgradeCost(c, id);
  if (cost === null || c.money < cost) return false;
  c.money -= cost;
  activeCar(c)!.levels[id]++;
  return true;
}

export function repairCost(c: Career): number {
  const car = activeCar(c);
  if (!car) return 0;
  const tier = c.world ? WORLD_BY_ID[c.world].tier : 0;
  return Math.round((car.damage * 10 * (1 + 0.25 * tier)) / 10) * 10;
}

export function repair(c: Career): boolean {
  const car = activeCar(c);
  const cost = repairCost(c);
  if (!car || car.damage <= 0 || c.money < cost) return false;
  c.money -= cost;
  car.damage = 0;
  return true;
}

export function buySpecial(c: Career, id: SpecialId): boolean {
  const def = SPECIALS.find((s) => s.id === id);
  if (!def || !c.offers.includes(id) || c.specials.includes(id) || c.money < def.cost) return false;
  c.money -= def.cost;
  c.specials.push(id);
  return true;
}

// --- opponents ----------------------------------------------------------------------------------

export const RIVALS = [
  { name: "Rusty Bolt", color: "#ff5146" },
  { name: "Nina Nitro", color: "#4be16a" },
  { name: "Gravel Gus", color: "#b77bff" },
  { name: "Vix Vortex", color: "#ff9b3d" },
];

/** 0..41: races qualified so far in the career. */
export function careerProgress(c: Career): number {
  return c.worldsDone.length * TRACKS_PER_WORLD + c.track;
}

/** The four AI rivals for the next race: they upgrade and sharpen up as the career goes on. */
export function rivalField(c: Career): EntrantSetup[] {
  const world = WORLD_BY_ID[c.world!];
  const prog = careerProgress(c);
  const level = Math.min(MAX_UPGRADE_LEVEL, Math.floor(prog / 8) + (c.track >= 5 ? 1 : 0));
  const kinds: VehicleKind[] = [world.favourite, "buggy", world.favourite === "jeep" ? "formula" : "jeep", world.favourite];
  return RIVALS.map((r, i) => ({
    name: r.name,
    color: r.color,
    kind: kinds[i],
    levels: uniformUpgrades(level - (i === 3 ? 1 : 0)),
    human: null,
    skill: Math.min(1, [0.8, 0.72, 0.64, 0.56][i] + prog * 0.004 + c.track * 0.004),
  }));
}

// --- persistence --------------------------------------------------------------------------------

export function serializeCareer(c: Career): string {
  return JSON.stringify(c);
}

export function parseCareer(json: string | null): Career | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json) as Career;
    if (c.v !== 1 || typeof c.money !== "number" || !Array.isArray(c.garage)) return null;
    for (const g of c.garage) {
      if (!VEHICLES[g.kind]) return null;
      g.levels = { ...noUpgrades(), ...g.levels };
      g.damage = Number(g.damage) || 0;
    }
    c.specials ??= [];
    c.offers ??= rollOffers(c.races ?? 0);
    c.wins ??= 0;
    return c;
  } catch {
    return null;
  }
}
