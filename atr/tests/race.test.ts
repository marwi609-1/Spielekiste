import { describe, expect, test } from "bun:test";
import { Race, STEP, type EntrantSetup } from "../src/core/race";
import { Track } from "../src/core/track";
import { generateTrack } from "../src/core/trackgen";
import { noUpgrades, VEHICLE_KINDS } from "../src/core/vehicles";
import { TRACKS_PER_WORLD, WORLD_BY_ID, WORLDS } from "../src/core/worlds";

function field(n: number, human = false): EntrantSetup[] {
  return Array.from({ length: n }, (_, i) => ({ name: `D${i}`, color: "#fff", kind: VEHICLE_KINDS[i % 3], levels: noUpgrades(), human: human && i === 0 ? 0 : null, skill: 0.9 - i * 0.08 }));
}

describe("every track can be raced by the computer", () => {
  for (const w of WORLDS) {
    for (let i = 0; i < TRACKS_PER_WORLD; i++) {
      test(`${w.id}-${i + 1}`, () => {
        const track = new Track(generateTrack(w.id, i));
        const race = new Race({ track, world: w, mode: "race", laps: 1, entrants: field(3), noCountdown: true });
        let steps = 0;
        while (race.phase !== "done" && steps < 120 * 90) {
          race.step(STEP, []);
          steps++;
        }
        for (const e of race.entrants) {
          expect(e.finished || e.wrecked).toBe(true);
          if (e.finished) expect(e.finishTime).toBeLessThan(60);
        }
        expect(race.entrants.filter((e) => e.finished).length).toBeGreaterThanOrEqual(2);
      });
    }
  }
});

describe("race rules", () => {
  const track = new Track(generateTrack("sports", 1));
  const world = WORLD_BY_ID.sports;

  test("countdown, laps and positions", () => {
    const race = new Race({ track, world, mode: "race", laps: 2, entrants: field(4) });
    const seen = new Set<string>();
    let laps = 0;
    while (race.phase !== "done" && race.time < 120) {
      race.step(STEP, []);
      for (const ev of race.takeEvents()) {
        seen.add(ev.type);
        if (ev.type === "lap") laps++;
      }
    }
    expect(seen.has("countdown")).toBe(true);
    expect(seen.has("go")).toBe(true);
    expect(laps).toBeGreaterThanOrEqual(6);
    const order = race.standings();
    expect(order.map((e) => e.place)).toEqual([1, 2, 3, 4]);
    for (let k = 1; k < order.length; k++) if (order[k].finished) expect(order[k].finishTime).toBeGreaterThanOrEqual(order[k - 1].finishTime);
  });

  test("a parked human finishes last and the race still ends", () => {
    const race = new Race({ track, world, mode: "race", laps: 1, entrants: field(3, true), noCountdown: true });
    while (race.phase !== "done" && race.time < 120) race.step(STEP, [{ throttle: 0, brake: 0, steer: 0, fire: false }]);
    expect(race.phase).toBe("done");
    expect(race.entrants[0].place).toBe(3);
  });

  test("100 % damage wrecks a car in a race", () => {
    const race = new Race({ track, world, mode: "race", laps: 1, entrants: field(2), noCountdown: true });
    race.entrants[0].car.damage = 100;
    race.step(STEP, []);
    expect(race.entrants[0].wrecked).toBe(true);
    expect(race.takeEvents().some((e) => e.type === "wreck")).toBe(true);
  });

  test("battle: pulling away scores, the lagging car is put back behind the leader", () => {
    const race = new Race({ track, world, mode: "battle", laps: 0, entrants: field(2, true), weapons: false, targetPoints: 3, noCountdown: true });
    // The human (car 0) stays parked: the computer car pulls away again and again.
    let teleports = 0;
    while (race.phase !== "done" && race.time < 120) {
      race.step(STEP, [{ throttle: 0, brake: 0, steer: 0, fire: false }]);
      for (const ev of race.takeEvents()) if (ev.type === "teleport") {
        teleports++;
        const lag = race.entrants[0];
        const lead = race.entrants[1];
        expect(lead.progress - lag.progress).toBeGreaterThan(50);
        expect(lead.progress - lag.progress).toBeLessThan(400);
      }
    }
    expect(race.winner?.index).toBe(1);
    expect(race.entrants[1].points).toBeGreaterThanOrEqual(3);
    expect(teleports).toBeGreaterThanOrEqual(1);
  });

  test("battle with weapons: missiles are fired and hits score", () => {
    const race = new Race({ track, world, mode: "battle", laps: 0, entrants: field(4), weapons: true, targetPoints: 30, noCountdown: true, seed: 7 });
    const reasons = new Set<string>();
    let fired = 0;
    while (race.phase !== "done" && race.time < 150) {
      race.step(STEP, []);
      for (const ev of race.takeEvents()) {
        if (ev.type === "point") reasons.add(ev.reason);
        if (ev.type === "fire") fired++;
      }
    }
    expect(fired).toBeGreaterThan(0);
    expect(reasons.has("pulled away")).toBe(true);
    expect(reasons.has("led a lap")).toBe(true);
  });

  test("pickups: cash only in races, weapons only in battles with weapons", () => {
    const r = new Race({ track, world, mode: "race", laps: 1, entrants: field(2) });
    expect(r.pickups.some((p) => p.spec.kind === "cash")).toBe(true);
    expect(r.pickups.some((p) => p.spec.kind === "weapon")).toBe(false);
    const b = new Race({ track, world, mode: "battle", laps: 0, entrants: field(2), weapons: true });
    expect(b.pickups.some((p) => p.spec.kind === "cash")).toBe(false);
    expect(b.pickups.some((p) => p.spec.kind === "weapon")).toBe(true);
  });
});
