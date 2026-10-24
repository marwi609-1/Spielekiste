import { describe, expect, test } from "bun:test";
import {
  activeCar,
  applyRaceResult,
  buySpecial,
  buyUpgrade,
  buyVehicle,
  choosableWorlds,
  newCareer,
  parseCareer,
  pickWorld,
  prizeFor,
  repair,
  repairCost,
  rivalField,
  sellVehicle,
  serializeCareer,
  START_MONEY,
  unlockedWorlds,
} from "../src/core/career";
import { applyLeagueRound, leagueOver, leagueStandings, newLeague } from "../src/core/league";
import { noUpgrades, upgradeCost, VEHICLES } from "../src/core/vehicles";
import type { WorldId } from "../src/core/worlds";

const win = { place: 1, cash: 200, damage: 10, wrecked: false };
const lose = { place: 5, cash: 0, damage: 30, wrecked: false };

describe("arcade career", () => {
  test("buy a car, pick a world, race in order", () => {
    const c = newCareer();
    expect(buyVehicle(c, "buggy")).toBe(true);
    expect(c.money).toBe(START_MONEY - VEHICLES.buggy.price);
    expect(choosableWorlds(c)).toEqual(["sports", "canyon", "forest"]);
    expect(pickWorld(c, "space")).toBe(false);
    expect(pickWorld(c, "canyon")).toBe(true);
    const before = c.money;
    const r = applyRaceResult(c, win);
    expect(r.qualified).toBe(true);
    expect(c.money).toBe(before + prizeFor(1, "canyon") + 200);
    expect(c.track).toBe(1);
    expect(activeCar(c)!.damage).toBe(10);
  });

  test("missing the top 3 costs a continue; running out ends the career", () => {
    const c = newCareer();
    buyVehicle(c, "jeep");
    pickWorld(c, "forest");
    for (let k = 0; k < 3; k++) expect(applyRaceResult(c, lose).gameOver).toBe(false);
    expect(c.track).toBe(0);
    expect(applyRaceResult(c, lose).gameOver).toBe(true);
  });

  test("worlds unlock in order: three starting worlds, then Space, Moon, Alien", () => {
    const c = newCareer();
    buyVehicle(c, "buggy");
    const done: WorldId[] = [];
    for (const w of ["sports", "canyon", "forest"] as const) {
      expect(pickWorld(c, w)).toBe(true);
      for (let k = 0; k < 7; k++) applyRaceResult(c, win);
      done.push(w);
      expect(c.worldsDone).toEqual(done);
    }
    // After the third starting world the career goes straight on to Space.
    expect(c.world).toBe("space");
    expect(unlockedWorlds(c)).toContain("space");
    expect(unlockedWorlds(c)).not.toContain("moon");
    for (let k = 0; k < 7; k++) applyRaceResult(c, win);
    expect(c.world).toBe("moon");
    for (let k = 0; k < 7; k++) applyRaceResult(c, win);
    expect(c.world).toBe("alien");
    let last = applyRaceResult(c, win);
    for (let k = 1; k < 7; k++) last = applyRaceResult(c, win);
    expect(last.careerComplete).toBe(true);
    expect(c.done).toBe(true);
  });

  test("shop: upgrades, repair, specials, second car and selling", () => {
    const c = newCareer();
    buyVehicle(c, "jeep");
    c.money = 20000;
    const cost = upgradeCost("engine", 0, "jeep");
    expect(buyUpgrade(c, "engine")).toBe(true);
    expect(c.money).toBe(20000 - cost);
    expect(activeCar(c)!.levels.engine).toBe(1);
    for (let k = 0; k < 5; k++) buyUpgrade(c, "engine");
    expect(activeCar(c)!.levels.engine).toBe(4);
    activeCar(c)!.damage = 40;
    expect(repairCost(c)).toBeGreaterThan(0);
    expect(repair(c)).toBe(true);
    expect(activeCar(c)!.damage).toBe(0);
    expect(buySpecial(c, c.offers[0])).toBe(true);
    expect(c.specials).toEqual([c.offers[0]]);
    expect(buyVehicle(c, "formula")).toBe(true);
    expect(c.active).toBe(1);
    expect(buyVehicle(c, "formula")).toBe(false);
    const money = c.money;
    expect(sellVehicle(c, 0)).toBe(true);
    expect(c.money).toBeGreaterThan(money);
    expect(c.garage.map((g) => g.kind)).toEqual(["formula"]);
    expect(sellVehicle(c, 0)).toBe(false);
  });

  test("rivals get stronger as the career goes on", () => {
    const c = newCareer();
    buyVehicle(c, "buggy");
    pickWorld(c, "sports");
    const early = rivalField(c);
    c.worldsDone = ["sports", "canyon", "forest", "space"];
    c.world = "moon";
    c.track = 5;
    const late = rivalField(c);
    expect(late[0].levels.engine).toBeGreaterThan(early[0].levels.engine);
    expect(late[0].skill!).toBeGreaterThan(early[0].skill!);
  });

  test("save and load", () => {
    const c = newCareer();
    buyVehicle(c, "formula");
    pickWorld(c, "sports");
    applyRaceResult(c, win);
    const back = parseCareer(serializeCareer(c))!;
    expect(back).toEqual(c);
    expect(parseCareer("{broken")).toBeNull();
    expect(parseCareer(JSON.stringify({ v: 2 }))).toBeNull();
    const old = JSON.parse(serializeCareer(c));
    old.garage[0].levels = { engine: 2 };
    expect(parseCareer(JSON.stringify(old))!.garage[0].levels).toEqual({ ...noUpgrades(), engine: 2 });
  });
});

describe("league", () => {
  test("points by placing, winner after the last round", () => {
    const drivers = ["A", "B", "C"].map((name) => ({ name, color: "#fff", kind: "buggy" as const, levels: noUpgrades(), human: null }));
    const l = newLeague(drivers, 3, ["sports", "canyon"], { targetPoints: 8, weapons: true, cones: true, seed: 3 });
    expect(l.rounds.length).toBe(3);
    applyLeagueRound(l, [2, 0, 1]);
    applyLeagueRound(l, [2, 1, 0]);
    expect(leagueOver(l)).toBe(false);
    applyLeagueRound(l, [0, 2, 1]);
    expect(leagueOver(l)).toBe(true);
    expect(leagueStandings(l)[0]).toBe(2);
    expect(l.table[2]).toEqual({ points: 26, wins: 2 });
  });
});
