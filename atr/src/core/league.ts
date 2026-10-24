/**
 * League: 3–6 drivers (any mix of humans and computer) play a series of free-for-all battles on
 * random tracks. Each round ranks the drivers by battle points; the league table adds league points.
 */

import { mulberry32 } from "./math";
import type { EntrantSetup } from "./race";
import { TRACKS_PER_WORLD, type WorldId } from "./worlds";

export const LEAGUE_POINTS = [10, 6, 4, 3, 2, 1];

export interface LeagueRound {
  world: WorldId;
  index: number;
}

export interface LeagueState {
  drivers: EntrantSetup[];
  rounds: LeagueRound[];
  round: number;
  targetPoints: number;
  weapons: boolean;
  cones: boolean;
  table: { points: number; wins: number }[];
}

export function newLeague(drivers: EntrantSetup[], rounds: number, worlds: WorldId[], opts: { targetPoints: number; weapons: boolean; cones: boolean; seed: number }): LeagueState {
  const rng = mulberry32(opts.seed);
  const list: LeagueRound[] = [];
  const used = new Set<string>();
  while (list.length < rounds) {
    const world = worlds[Math.floor(rng() * worlds.length)];
    const index = Math.floor(rng() * TRACKS_PER_WORLD);
    const key = `${world}-${index}`;
    if (used.has(key) && used.size < worlds.length * TRACKS_PER_WORLD) continue;
    used.add(key);
    list.push({ world, index });
  }
  return {
    drivers,
    rounds: list,
    round: 0,
    targetPoints: opts.targetPoints,
    weapons: opts.weapons,
    cones: opts.cones,
    table: drivers.map(() => ({ points: 0, wins: 0 })),
  };
}

/** Records a round. `order` lists driver indices from winner to last. */
export function applyLeagueRound(l: LeagueState, order: number[]): void {
  order.forEach((d, place) => {
    l.table[d].points += LEAGUE_POINTS[place] ?? 0;
    if (place === 0) l.table[d].wins++;
  });
  l.round++;
}

export function leagueOver(l: LeagueState): boolean {
  return l.round >= l.rounds.length;
}

/** Driver indices sorted by league points, then wins. */
export function leagueStandings(l: LeagueState): number[] {
  return l.drivers.map((_, i) => i).sort((a, b) => l.table[b].points - l.table[a].points || l.table[b].wins - l.table[a].wins || a - b);
}
