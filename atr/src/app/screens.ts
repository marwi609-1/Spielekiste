/**
 * Menu screens (DOM): title, arcade career (dealer, world select, pre-race, results, shop), quick
 * race, battle, league, how to play, settings and the pause menu. Each screen is an HTML template
 * plus a map of `data-act` handlers; arrow keys and the gamepad move focus between buttons.
 */

import {
  activeCar,
  applyRaceResult,
  buySpecial,
  buyUpgrade,
  buyVehicle,
  choosableWorlds,
  newCareer,
  nextUpgradeCost,
  parseCareer,
  pickWorld,
  prizeFor,
  repair,
  repairCost,
  resaleValue,
  rivalField,
  sellVehicle,
  serializeCareer,
  setActive,
  unlockedWorlds,
  RIVALS,
  type Career,
  type CareerReport,
} from "../core/career";
import { applyLeagueRound, leagueOver, leagueStandings, newLeague, LEAGUE_POINTS, type LeagueState } from "../core/league";
import { formatTime, mulberry32 } from "../core/math";
import { Race, type EntrantSetup } from "../core/race";
import { getTrack } from "../core/trackgen";
import {
  computeStats,
  MAX_UPGRADE_LEVEL,
  noUpgrades,
  SPECIALS,
  uniformUpgrades,
  UPGRADES,
  VEHICLE_KINDS,
  VEHICLES,
  type UpgradeLevels,
  type VehicleKind,
} from "../core/vehicles";
import { LATE_WORLDS, START_WORLDS, TRACKS_PER_WORLD, WORLD_BY_ID, WORLDS, type WorldId } from "../core/worlds";
import type { Theme } from "./audio";
import { ordinal, saveSettings, type Game, type HumanSlot } from "./game";

type Actions = Record<string, (el: HTMLElement) => void>;

const CAREER_KEY = "overdrift:career";
const PLAYER_COLORS = ["#ffd23f", "#3ddcff", "#ff3d7f", "#5ee07a"];
const EXTRA_AI = [
  { name: "Dusty Rhodes", color: "#e8e8f0" },
  { name: "Max Grip", color: "#ff6fb5" },
];

let game: Game;
let career: Career | null = null;
let league: LeagueState | null = null;

const quick = { world: "sports" as WorldId, track: 0, kind: "buggy" as VehicleKind, laps: 6, opponents: 4, difficulty: 1 };
const battle = { players: 1, kinds: ["buggy", "jeep"] as VehicleKind[], world: "sports" as WorldId, track: 0, target: 10, weapons: true, cones: true };
const leagueCfg = { drivers: 4, humans: 1, kinds: ["buggy", "jeep", "formula", "buggy"] as VehicleKind[], rounds: 3, target: 8, weapons: true };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function money(n: number): string {
  return `${n.toLocaleString("en-GB")} Cr`;
}

function loadCareer(): Career | null {
  try {
    return parseCareer(localStorage.getItem(CAREER_KEY));
  } catch {
    return null;
  }
}

function saveCareer(): void {
  try {
    if (career) localStorage.setItem(CAREER_KEY, serializeCareer(career));
    else localStorage.removeItem(CAREER_KEY);
  } catch {
    /* storage unavailable: the career lives for this session only */
  }
}

function show(html: string, actions: Actions, back: () => void, opts: { clear?: boolean; music?: Theme } = {}): void {
  const sc = game.screen;
  sc.hidden = false;
  game.overlay(true);
  sc.className = opts.clear ? "clear" : "";
  sc.innerHTML = `<div class="wrap">${html}</div>`;
  sc.onclick = (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el || (el as HTMLButtonElement).disabled) return;
    const fn = actions[el.dataset.act!];
    if (!fn) return;
    game.sound.play("select");
    fn(el);
  };
  game.onBack = () => {
    game.sound.play("tick");
    back();
  };
  game.music(opts.music ?? "menu");
  sc.scrollTop = 0;
  requestAnimationFrame(() => game.nav.focusFirst());
  for (const c of Array.from(sc.querySelectorAll<HTMLCanvasElement>("canvas[data-track]"))) {
    const [w, i] = c.dataset.track!.split(":");
    game.preview(c, getTrack(w as WorldId, Number(i)));
  }
}

function hide(): void {
  game.screen.hidden = true;
  game.screen.innerHTML = "";
  game.overlay(false);
}

/** A computer-only race behind the menus. */
function attract(): void {
  if (game.session?.kind === "attract") return;
  const worlds = unlockedWorlds(game.settings.unlockAll ? fullCareer() : career);
  const rng = mulberry32(Date.now() & 0xffff);
  const w = worlds[Math.floor(rng() * worlds.length)];
  const track = getTrack(w, Math.floor(rng() * TRACKS_PER_WORLD));
  const entrants: EntrantSetup[] = RIVALS.map((r, i) => ({ name: r.name, color: r.color, kind: VEHICLE_KINDS[(i + 1) % 3], levels: uniformUpgrades(2), human: null, skill: 0.85 - i * 0.05 }));
  entrants.push({ name: "Max Grip", color: "#ffd23f", kind: WORLD_BY_ID[w].favourite, levels: uniformUpgrades(2), human: null, skill: 0.8 });
  const race = new Race({ track, world: WORLD_BY_ID[w], mode: "race", laps: 2, entrants, noCountdown: true, seed: Math.floor(rng() * 1e6) });
  game.start({ kind: "attract", race, humans: [], follow: "leader", onFinish: () => attract() });
  game.resetMinimap();
}

function fullCareer(): Career {
  const c = newCareer();
  c.worldsDone = [...START_WORLDS, ...LATE_WORLDS];
  return c;
}

function availableWorlds(): WorldId[] {
  return unlockedWorlds(game.settings.unlockAll ? fullCareer() : career);
}

// --- shared bits --------------------------------------------------------------------------------

function statBars(kind: VehicleKind, levels: UpgradeLevels = noUpgrades()): string {
  const s = computeStats(kind, levels);
  const rows: [string, number][] = [
    ["Top speed", (s.vmax - 380) / 420],
    ["Acceleration", (s.accel - 250) / 400],
    ["Tarmac grip", (s.grip - 0.75) / 0.75],
    ["Off-road", s.offroad],
    ["Toughness", (s.armor - 0.5) / 2],
  ];
  return rows.map(([l, v]) => `<div class="stat"><span>${l}</span><div class="bar"><i style="width:${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%"></i></div></div>`).join("");
}

function kmh(px: number): string {
  return `${Math.round(px * 0.36)} km/h`;
}

function seg(act: string, options: [string | number, string][], current: string | number): string {
  return `<div class="seg">${options.map(([v, l]) => `<button data-act="${act}" data-v="${v}" class="${String(v) === String(current) ? "sel" : ""}">${l}</button>`).join("")}</div>`;
}

function lvlPips(n: number): string {
  let s = '<span class="lvl">';
  for (let i = 0; i < MAX_UPGRADE_LEVEL; i++) s += `<i class="${i < n ? "on" : ""}"></i>`;
  return s + "</span>";
}

function trackCard(world: WorldId, index: number): string {
  const t = getTrack(world, index);
  const branches = t.paths.length - 1;
  const feats = [
    `${(t.length / 10 / 1000).toFixed(2)} km`,
    branches ? `${branches} shortcut${branches > 1 ? "s" : ""}` : "no shortcuts",
    t.spec.ramps.length ? `${t.spec.ramps.length} jump${t.spec.ramps.length > 1 ? "s" : ""}` : "",
    t.spec.tunnels.length ? `${t.spec.tunnels.length} tunnel${t.spec.tunnels.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  return `<div class="card"><div class="title"><h3>${esc(t.spec.name)}</h3><span class="tag sun">${WORLD_BY_ID[world].name} ${index + 1}/7</span></div><canvas class="map" width="400" height="300" data-track="${world}:${index}"></canvas><div class="note">${feats.join(" · ")}</div></div>`;
}

function humanSlot(entrant: number, player: number, label: string): HumanSlot {
  return { entrant, player, pad: player, label, color: PLAYER_COLORS[player] };
}

// --- title --------------------------------------------------------------------------------------

export function initScreens(g: Game): void {
  game = g;
  career = loadCareer();
  game.onPauseMenu = () => pauseMenu();
  title();
}

function title(): void {
  attract();
  const c = career;
  show(
    `<div class="chequer"></div>
    <h1 class="logo">OVER<span>DRIFT</span></h1>
    <p class="tagline">All-terrain arcade racing · 3 vehicles · 6 worlds · 42 tracks</p>
    <div class="big-menu">
      <button class="primary" data-act="arcade" data-autofocus>Arcade <small>${c && c.garage.length ? `${money(c.money)} · ${c.world ? WORLD_BY_ID[c.world].name + " " + (c.track + 1) + "/7" : "pick a world"}` : "career with upgrades"}</small></button>
      <button data-act="quick">Quick race <small>any unlocked track</small></button>
      <button data-act="battle">Battle <small>1–2 players</small></button>
      <button data-act="league">League <small>3–6 drivers</small></button>
      <button data-act="howto">How to play <small>controls &amp; rules</small></button>
      <button data-act="settings">Settings <small>sound, touch, unlocks</small></button>
    </div>
    <p class="note">A fan-made homage to <em>ATR: All Terrain Racing</em> (Team17, 1995). Not affiliated with Team17. All graphics, tracks and music are generated in your browser.</p>`,
    {
      arcade: () => arcadeMenu(),
      quick: () => quickSetup(),
      battle: () => battleSetup(),
      league: () => leagueSetup(),
      howto: () => howTo(),
      settings: () => settingsScreen(),
    },
    () => {},
    { clear: true },
  );
}

// --- arcade -------------------------------------------------------------------------------------

function arcadeMenu(): void {
  const c = career;
  if (!c || c.garage.length === 0) {
    career = newCareer();
    saveCareer();
    return dealer(true);
  }
  let confirm = false;
  const progress = c.worldsDone.length * 7 + (c.world ? c.track : 0);
  show(
    `<h2>Arcade</h2>
    <div class="card"><div class="title"><h3>Your career</h3><span class="money">${money(c.money)}</span></div>
      <div class="note">${progress} of 42 tracks qualified · ${c.wins} win${c.wins === 1 ? "" : "s"} · ${c.continues} continue${c.continues === 1 ? "" : "s"} left · driving the ${VEHICLES[activeCar(c)!.kind].name}</div>
      <div class="note">Worlds done: ${c.worldsDone.length ? c.worldsDone.map((w) => WORLD_BY_ID[w].name).join(", ") : "none yet"}</div>
    </div>
    <div class="row">
      <button class="primary" data-act="continue" data-autofocus>Continue</button>
      <button data-act="new" id="newcareer">New career</button>
      <button class="ghost" data-act="back">Back</button>
    </div>`,
    {
      continue: () => (c.world ? preRace() : worldPick()),
      new: (el) => {
        if (!confirm) {
          confirm = true;
          el.textContent = "Press again to wipe your career";
          el.classList.add("hot");
          return;
        }
        career = newCareer();
        saveCareer();
        dealer(true);
      },
      back: () => title(),
    },
    () => title(),
  );
}

function dealer(first: boolean): void {
  const c = career!;
  const cards = VEHICLE_KINDS.map((k) => {
    const d = VEHICLES[k];
    const owned = c.garage.some((g) => g.kind === k);
    const afford = c.money >= d.price;
    return `<div class="card"><div class="title"><h3>${d.name}</h3><span class="tag ${owned ? "dim" : "sun"}">${owned ? "owned" : money(d.price)}</span></div>
      <p class="note">${esc(d.blurb)}</p>${statBars(k)}
      <div class="note">Top speed ${kmh(d.vmax)}</div>
      <button data-act="buy" data-v="${k}" ${owned || !afford ? "disabled" : ""}>${owned ? "In your garage" : afford ? "Buy" : "Not enough credits"}</button></div>`;
  }).join("");
  show(
    `<div class="row spread"><h2>${first ? "Pick your first car" : "Car dealer"}</h2><span class="money">${money(c.money)}</span></div>
    <p class="sub">${first ? "You start with " + money(c.money) + ". Whatever you don't spend on the car goes into upgrades later. Each world suits a different car, and you can buy more cars as the prize money comes in." : "Each car keeps its own upgrades. Switch cars in the garage before a race."}</p>
    <div class="grid">${cards}</div>
    ${first ? "" : `<div class="row"><button class="ghost" data-act="back">Back to garage</button></div>`}`,
    {
      buy: (el) => {
        if (buyVehicle(c, el.dataset.v as VehicleKind)) {
          game.sound.play("buy");
          saveCareer();
          if (first) worldPick();
          else shop();
        } else game.sound.play("deny");
      },
      back: () => shop(),
    },
    () => (first ? title() : shop()),
  );
}

function worldPick(): void {
  const c = career!;
  const options = choosableWorlds(c);
  const cards = [...START_WORLDS, ...LATE_WORLDS]
    .map((w) => {
      const def = WORLD_BY_ID[w];
      const done = c.worldsDone.includes(w);
      const open = options.includes(w);
      return `<div class="card"><div class="title"><h3>${def.name}</h3><span class="tag ${done ? "dim" : open ? "sun" : "hot"}">${done ? "done" : open ? "open" : "locked"}</span></div>
        <p class="note">${def.tagline}. Favours the ${VEHICLES[def.favourite].name}.</p>
        <button data-act="pick" data-v="${w}" ${open ? "" : "disabled"}>${open ? "Race here" : done ? "Completed" : "Finish the earlier worlds"}</button></div>`;
    })
    .join("");
  show(
    `<h2>Choose a world</h2><p class="sub">Seven tracks per world, raced in order. Finish in the top three to go on. Complete Sports, Canyon and Forest to unlock Space, then Moon, then Alien.</p>
    <div class="grid">${cards}</div>
    <div class="row"><button class="ghost" data-act="back">Back</button></div>`,
    {
      pick: (el) => {
        if (pickWorld(c, el.dataset.v as WorldId)) {
          saveCareer();
          preRace();
        }
      },
      back: () => arcadeMenu(),
    },
    () => arcadeMenu(),
  );
}

function preRace(): void {
  const c = career!;
  const world = WORLD_BY_ID[c.world!];
  const car = activeCar(c)!;
  const rivals = rivalField(c);
  const stats = computeStats(car.kind, car.levels);
  show(
    `<div class="row spread"><h2>Race ${c.track + 1} of 7 · ${world.name}</h2><span class="money">${money(c.money)}</span></div>
    <div class="grid">
      ${trackCard(c.world!, c.track)}
      <div class="card"><h3>The field</h3>
        <div class="table-wrap"><table><thead><tr><th>Driver</th><th>Car</th><th>Tune</th></tr></thead><tbody>
        ${rivals.map((r) => `<tr><td><span class="swatch" style="background:${r.color}"></span>${esc(r.name)}</td><td>${VEHICLES[r.kind].name}</td><td>${lvlPips(r.levels.engine)}</td></tr>`).join("")}
        <tr class="me"><td><span class="swatch" style="background:${PLAYER_COLORS[0]}"></span>You</td><td>${VEHICLES[car.kind].name}</td><td>${lvlPips(Math.round(Object.values(car.levels).reduce((a, b) => a + b, 0) / 6))}</td></tr>
        </tbody></table></div>
        <div class="note">6 laps · top 3 qualify · prize for 1st: ${money(prizeFor(1, c.world!))} · top speed ${kmh(stats.vmax)}${car.damage > 0 ? ` · <span style="color:var(--warn)">car damage ${Math.round(car.damage)} %</span>` : ""}${c.specials.length ? ` · specials: ${c.specials.map((s) => SPECIALS.find((x) => x.id === s)!.name).join(", ")}` : ""}</div>
        <div class="note">This world favours the ${VEHICLES[world.favourite].name}.</div>
        ${car.damage >= 60 ? `<div class="note" style="color:var(--hot)">Your car is badly damaged and will be slow. Repair it in the garage.</div>` : ""}
      </div>
    </div>
    <div class="row"><button class="primary" data-act="go" data-autofocus>Start race</button><button data-act="shop">Garage &amp; shop</button><button class="ghost" data-act="back">Menu</button></div>`,
    { go: () => startArcadeRace(), shop: () => shop(), back: () => title() },
    () => title(),
  );
}

function startArcadeRace(): void {
  const c = career!;
  const world = WORLD_BY_ID[c.world!];
  const track = getTrack(c.world!, c.track);
  const car = activeCar(c)!;
  const entrants: EntrantSetup[] = [...rivalField(c), { name: "You", color: PLAYER_COLORS[0], kind: car.kind, levels: car.levels, specials: [...c.specials], human: 0, damage: car.damage }];
  const race = new Race({ track, world, mode: "race", laps: track.spec.laps, entrants, rubberBand: 1, seed: c.races + 1 });
  hide();
  game.start({ kind: "arcade", race, humans: [humanSlot(entrants.length - 1, 0, "YOU")], follow: "player", onFinish: (r) => arcadeFinished(r, false) });
  game.resetMinimap();
}

function arcadeFinished(race: Race, retired: boolean): void {
  const c = career!;
  if (retired) game.stop();
  const me = race.entrants.find((e) => e.setup.human === 0)!;
  race.finishRace();
  const place = retired ? race.entrants.length : me.place;
  const report = applyRaceResult(c, { place, cash: me.cash, damage: me.car.damage, wrecked: me.wrecked || retired });
  if (report.gameOver) {
    career = null;
    saveCareer();
  } else saveCareer();
  raceResults(race, report, retired);
}

function standingsTable(race: Race, prize?: (place: number) => number): string {
  const order = race.standings();
  return `<div class="table-wrap"><table><thead><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Time</th><th>Best lap</th>${prize ? "<th>Prize</th>" : ""}</tr></thead><tbody>
    ${order
      .map((e, i) => {
        const time = e.wrecked ? "wrecked" : e.finished ? formatTime(e.finishTime) : `${Math.max(0, e.finalProgress / race.track.length).toFixed(1)} laps`;
        return `<tr class="${e.setup.human !== null ? "me" : ""}"><td>${ordinal(i + 1)}</td><td><span class="swatch" style="background:${e.setup.color}"></span>${esc(e.setup.name)}</td><td>${VEHICLES[e.setup.kind].name}</td><td class="num">${time}</td><td class="num">${formatTime(e.bestLap)}</td>${prize ? `<td class="num">${e.setup.human !== null && !e.wrecked ? money(prize(i + 1)) : ""}</td>` : ""}</tr>`;
      })
      .join("")}</tbody></table></div>`;
}

function raceResults(race: Race, r: CareerReport, retired: boolean): void {
  const c = career;
  const world = race.world.id;
  const banner = r.careerComplete
    ? `<div class="banner">Champion of all six worlds!</div>`
    : r.worldComplete
      ? `<div class="banner">${WORLD_BY_ID[r.worldComplete].name} complete!${r.unlocked ? ` ${WORLD_BY_ID[r.unlocked].name} unlocked.` : ""} +1 continue</div>`
      : r.qualified
        ? `<div class="banner">Qualified</div>`
        : r.gameOver
          ? `<div class="banner bad">Game over</div>`
          : `<div class="banner bad">${retired ? "Retired" : "Not qualified"}: ${r.continuesLeft} continue${r.continuesLeft === 1 ? "" : "s"} left</div>`;
  show(
    `<h2>${esc(race.track.spec.name)} · results</h2>${banner}
    <div class="card">${standingsTable(race, (p) => prizeFor(p, world))}</div>
    <div class="card"><div class="title"><h3>Earnings</h3>${c ? `<span class="money">${money(c.money)}</span>` : ""}</div>
      <div class="note">Prize ${money(r.prize)} + cash pickups ${money(r.cash)} = ${money(r.prize + r.cash)}</div></div>
    <div class="row"><button class="primary" data-act="next" data-autofocus>${r.gameOver ? "Back to title" : r.careerComplete ? "Celebrate" : "Garage & shop"}</button></div>`,
    {
      next: () => {
        game.stop();
        if (r.gameOver) return gameOver();
        if (r.careerComplete) return careerDone();
        shop();
      },
    },
    () => {},
    { music: "results" },
  );
}

function gameOver(): void {
  show(
    `<h2>Game over</h2><p class="sub">Out of continues. The garage has been cleared; a new career starts with ${money(6000)}.</p>
    <div class="row"><button class="primary" data-act="title" data-autofocus>Title</button></div>`,
    { title: () => title() },
    () => title(),
    { music: "results" },
  );
}

function careerDone(): void {
  const c = career!;
  show(
    `<h2>All 42 tracks conquered</h2><p class="sub">${c.wins} wins in ${c.races} races, ${money(c.money)} in the bank. Every world is now open in Quick race, Battle and League.</p>
    <div class="row"><button class="primary" data-act="title" data-autofocus>Title</button></div>`,
    { title: () => title() },
    () => title(),
    { music: "results" },
  );
}

function shop(): void {
  game.stop();
  attract();
  const c = career!;
  const car = activeCar(c)!;
  const stats = computeStats(car.kind, car.levels);
  const rep = repairCost(c);
  const ups = UPGRADES.map((u) => {
    const cost = nextUpgradeCost(c, u.id);
    return `<div class="card"><div class="title"><h3>${u.name}</h3>${lvlPips(car.levels[u.id])}</div><div class="note">${u.effect}</div>
      <button data-act="up" data-v="${u.id}" ${cost === null || c.money < cost ? "disabled" : ""}>${cost === null ? "Maxed out" : `Upgrade · ${money(cost)}`}</button></div>`;
  }).join("");
  const specials = c.offers
    .map((id) => {
      const s = SPECIALS.find((x) => x.id === id)!;
      const have = c.specials.includes(id);
      return `<div class="card"><div class="title"><h3>${s.name}</h3><span class="tag">one race</span></div><div class="note">${s.effect}</div>
      <button data-act="special" data-v="${id}" ${have || c.money < s.cost ? "disabled" : ""}>${have ? "Fitted for next race" : `Buy · ${money(s.cost)}`}</button></div>`;
    })
    .join("");
  const garage = c.garage
    .map((g, i) => `<div class="card"><div class="title"><h3>${VEHICLES[g.kind].name}</h3>${i === c.active ? '<span class="tag sun">driving</span>' : ""}</div>${statBars(g.kind, g.levels)}
      <div class="note">Damage ${Math.round(g.damage)} % · trade-in ${money(resaleValue(g))}</div>
      <div class="row">${i === c.active ? "" : `<button data-act="use" data-v="${i}">Drive this</button>`}${c.garage.length > 1 ? `<button class="ghost" data-act="sell" data-v="${i}">Sell</button>` : ""}</div></div>`)
    .join("");
  show(
    `<div class="row spread"><h2>Garage &amp; shop</h2><span class="money">${money(c.money)}</span></div>
    <div class="row"><button class="primary" data-act="next" data-autofocus>${c.world ? `Next race: ${esc(getTrack(c.world, c.track).spec.name)}` : "Choose the next world"}</button><button class="ghost" data-act="menu">Menu</button></div>
    <div class="card"><div class="title"><h3>${VEHICLES[car.kind].name}</h3><span class="note">top speed ${kmh(stats.vmax)}</span></div>${statBars(car.kind, car.levels)}
      <div class="row"><span class="note">Damage ${Math.round(car.damage)} %: a damaged car loses top speed and acceleration.</span><button data-act="repair" ${car.damage <= 0 || c.money < rep ? "disabled" : ""}>${car.damage <= 0 ? "No damage" : `Repair · ${money(rep)}`}</button></div></div>
    <h3>Upgrades for this car</h3><div class="grid tight">${ups}</div>
    <h3>Specials on offer</h3><div class="grid">${specials}</div>
    <h3>Your garage</h3><div class="grid">${garage}</div>
    <div class="row"><button data-act="dealer">Car dealer</button></div>`,
    {
      up: (el) => {
        if (buyUpgrade(c, el.dataset.v as never)) game.sound.play("buy");
        saveCareer();
        shop();
      },
      special: (el) => {
        if (buySpecial(c, el.dataset.v as never)) game.sound.play("buy");
        saveCareer();
        shop();
      },
      repair: () => {
        if (repair(c)) game.sound.play("buy");
        saveCareer();
        shop();
      },
      use: (el) => {
        setActive(c, Number(el.dataset.v));
        saveCareer();
        shop();
      },
      sell: (el) => {
        sellVehicle(c, Number(el.dataset.v));
        saveCareer();
        shop();
      },
      dealer: () => dealer(false),
      next: () => (c.world ? preRace() : worldPick()),
      menu: () => title(),
    },
    () => title(),
  );
}

// --- quick race ---------------------------------------------------------------------------------

function quickSetup(): void {
  const worlds = availableWorlds();
  if (!worlds.includes(quick.world)) quick.world = worlds[0];
  show(
    `<h2>Quick race</h2>
    <div class="grid">
      <div class="card">
        <div class="field"><span>World</span>${seg("world", worlds.map((w) => [w, WORLD_BY_ID[w].name]), quick.world)}</div>
        <div class="field"><span>Track</span><div class="row">${seg("track", Array.from({ length: 7 }, (_, i) => [i, String(i + 1)]), quick.track)}<button data-act="random">Random</button></div></div>
        <div class="field"><span>Car</span>${seg("kind", VEHICLE_KINDS.map((k) => [k, VEHICLES[k].name]), quick.kind)}</div>
        <div class="field"><span>Laps</span>${seg("laps", [[1, "1"], [3, "3"], [6, "6"], [9, "9"]], quick.laps)}</div>
        <div class="field"><span>Opponents</span>${seg("opp", [[0, "Time trial"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]], quick.opponents)}</div>
        <div class="field"><span>Difficulty</span>${seg("diff", [[0, "Easy"], [1, "Normal"], [2, "Hard"]], quick.difficulty)}</div>
      </div>
      ${trackCard(quick.world, quick.track)}
    </div>
    <div class="row"><button class="primary" data-act="go" data-autofocus>Race</button><button class="ghost" data-act="back">Back</button></div>`,
    {
      world: (el) => ((quick.world = el.dataset.v as WorldId), quickSetup()),
      track: (el) => ((quick.track = Number(el.dataset.v)), quickSetup()),
      random: () => {
        quick.world = worlds[Math.floor(Math.random() * worlds.length)];
        quick.track = Math.floor(Math.random() * TRACKS_PER_WORLD);
        quickSetup();
      },
      kind: (el) => ((quick.kind = el.dataset.v as VehicleKind), quickSetup()),
      laps: (el) => ((quick.laps = Number(el.dataset.v)), quickSetup()),
      opp: (el) => ((quick.opponents = Number(el.dataset.v)), quickSetup()),
      diff: (el) => ((quick.difficulty = Number(el.dataset.v)), quickSetup()),
      go: () => startQuick(),
      back: () => title(),
    },
    () => title(),
  );
}

function startQuick(): void {
  const world = WORLD_BY_ID[quick.world];
  const track = getTrack(quick.world, quick.track);
  const level = [0, 1, 3][quick.difficulty];
  const base = [0.55, 0.75, 0.92][quick.difficulty];
  const kinds: VehicleKind[] = [world.favourite, "buggy", "jeep", "formula"];
  const entrants: EntrantSetup[] = RIVALS.slice(0, quick.opponents).map((r, i) => ({ name: r.name, color: r.color, kind: kinds[i], levels: uniformUpgrades(level), human: null, skill: base - i * 0.05 }));
  entrants.push({ name: "You", color: PLAYER_COLORS[0], kind: quick.kind, levels: uniformUpgrades(level), human: 0 });
  const race = new Race({ track, world, mode: "race", laps: quick.laps, entrants, rubberBand: quick.difficulty === 0 ? 1 : 0.6, seed: Date.now() & 0xffff });
  hide();
  game.start({
    kind: "quick",
    race,
    humans: [humanSlot(entrants.length - 1, 0, "YOU")],
    follow: "player",
    onFinish: (r) => {
      r.finishRace();
      show(
        `<h2>${esc(r.track.spec.name)} · results</h2><div class="card">${standingsTable(r)}</div>
        <div class="row"><button class="primary" data-act="again" data-autofocus>Race again</button><button data-act="setup">Change settings</button><button class="ghost" data-act="menu">Menu</button></div>`,
        { again: () => (game.stop(), startQuick()), setup: () => (game.stop(), quickSetup()), menu: () => (game.stop(), title()) },
        () => (game.stop(), title()),
        { music: "results" },
      );
    },
  });
  game.resetMinimap();
}

// --- battle -------------------------------------------------------------------------------------

function battleSetup(): void {
  const worlds = availableWorlds();
  if (!worlds.includes(battle.world)) battle.world = worlds[0];
  show(
    `<h2>Battle</h2><p class="sub">One screen follows the leader. Fall off the screen and you are dropped in behind the leader, who scores +1. Missile hit +1, leading a lap +2.</p>
    <div class="grid">
      <div class="card">
        <div class="field"><span>Players</span>${seg("players", [[1, "1 player vs CPU"], [2, "2 players"]], battle.players)}</div>
        <div class="field"><span>${battle.players === 2 ? "P1 car (WASD + Space)" : "Your car"}</span>${seg("k0", VEHICLE_KINDS.map((k) => [k, VEHICLES[k].name]), battle.kinds[0])}</div>
        <div class="field"><span>${battle.players === 2 ? "P2 car (arrows + Enter)" : "CPU car"}</span>${seg("k1", VEHICLE_KINDS.map((k) => [k, VEHICLES[k].name]), battle.kinds[1])}</div>
        <div class="field"><span>World</span>${seg("world", worlds.map((w) => [w, WORLD_BY_ID[w].name]), battle.world)}</div>
        <div class="field"><span>Track</span><div class="row">${seg("track", Array.from({ length: 7 }, (_, i) => [i, String(i + 1)]), battle.track)}<button data-act="random">Random</button></div></div>
        <div class="field"><span>First to</span>${seg("target", [[5, "5"], [10, "10"], [15, "15"]], battle.target)}</div>
        <div class="field"><span>Weapons</span>${seg("weapons", [[1, "Missiles & mines"], [0, "Off"]], battle.weapons ? 1 : 0)}</div>
        <div class="field"><span>Cones</span>${seg("cones", [[1, "On"], [0, "Off"]], battle.cones ? 1 : 0)}</div>
      </div>
      ${trackCard(battle.world, battle.track)}
    </div>
    <div class="row"><button class="primary" data-act="go" data-autofocus>Start battle</button><button class="ghost" data-act="back">Back</button></div>`,
    {
      players: (el) => ((battle.players = Number(el.dataset.v)), battleSetup()),
      k0: (el) => ((battle.kinds[0] = el.dataset.v as VehicleKind), battleSetup()),
      k1: (el) => ((battle.kinds[1] = el.dataset.v as VehicleKind), battleSetup()),
      world: (el) => ((battle.world = el.dataset.v as WorldId), battleSetup()),
      track: (el) => ((battle.track = Number(el.dataset.v)), battleSetup()),
      random: () => {
        battle.world = worlds[Math.floor(Math.random() * worlds.length)];
        battle.track = Math.floor(Math.random() * TRACKS_PER_WORLD);
        battleSetup();
      },
      target: (el) => ((battle.target = Number(el.dataset.v)), battleSetup()),
      weapons: (el) => ((battle.weapons = el.dataset.v === "1"), battleSetup()),
      cones: (el) => ((battle.cones = el.dataset.v === "1"), battleSetup()),
      go: () => startBattle(),
      back: () => title(),
    },
    () => title(),
  );
}

function startBattle(): void {
  const world = WORLD_BY_ID[battle.world];
  const track = getTrack(battle.world, battle.track);
  const two = battle.players === 2;
  const entrants: EntrantSetup[] = [
    { name: two ? "P1" : "You", color: PLAYER_COLORS[0], kind: battle.kinds[0], levels: uniformUpgrades(1), human: 0 },
    two ? { name: "P2", color: PLAYER_COLORS[1], kind: battle.kinds[1], levels: uniformUpgrades(1), human: 1 } : { name: RIVALS[0].name, color: RIVALS[0].color, kind: battle.kinds[1], levels: uniformUpgrades(1), human: null, skill: 0.82 },
  ];
  const race = new Race({ track, world, mode: "battle", laps: 0, entrants, weapons: battle.weapons, cones: battle.cones, targetPoints: battle.target, seed: Date.now() & 0xffff });
  const humans = [humanSlot(0, 0, two ? "P1" : "YOU")];
  if (two) humans.push(humanSlot(1, 1, "P2"));
  hide();
  game.start({
    kind: "battle",
    race,
    humans,
    follow: "leader",
    onFinish: (r) => {
      const order = [...r.entrants].sort((a, b) => b.points - a.points);
      show(
        `<h2>${esc(order[0].setup.name)} wins the battle</h2>
        <div class="card"><div class="table-wrap"><table><thead><tr><th>Driver</th><th>Car</th><th>Points</th></tr></thead><tbody>
        ${order.map((e) => `<tr class="${e.setup.human !== null ? "me" : ""}"><td><span class="swatch" style="background:${e.setup.color}"></span>${esc(e.setup.name)}</td><td>${VEHICLES[e.setup.kind].name}</td><td class="num">${e.points}</td></tr>`).join("")}
        </tbody></table></div></div>
        <div class="row"><button class="primary" data-act="again" data-autofocus>Rematch</button><button data-act="setup">Change settings</button><button class="ghost" data-act="menu">Menu</button></div>`,
        { again: () => (game.stop(), startBattle()), setup: () => (game.stop(), battleSetup()), menu: () => (game.stop(), title()) },
        () => (game.stop(), title()),
        { music: "results" },
      );
    },
  });
  game.resetMinimap();
}

// --- league -------------------------------------------------------------------------------------

function leagueSetup(): void {
  leagueCfg.humans = Math.min(leagueCfg.humans, Math.min(4, leagueCfg.drivers));
  const humanRows = Array.from({ length: leagueCfg.humans }, (_, i) => {
    const ctl = i === 0 ? (leagueCfg.humans > 1 ? "WASD + Space / pad 1" : "arrows or WASD / pad 1") : i === 1 ? "arrows + Enter / pad 2" : `gamepad ${i + 1}`;
    return `<div class="field"><span>P${i + 1} car (${ctl})</span>${seg(`hk${i}`, VEHICLE_KINDS.map((k) => [k, VEHICLES[k].name]), leagueCfg.kinds[i])}</div>`;
  }).join("");
  show(
    `<h2>League</h2><p class="sub">Free-for-all battles on random tracks from the unlocked worlds. Each round is a battle to the target score; the round ranking earns league points ${LEAGUE_POINTS.slice(0, 4).join(" / ")} …</p>
    <div class="card">
      <div class="field"><span>Drivers</span>${seg("drivers", [[3, "3"], [4, "4"], [5, "5"], [6, "6"]], leagueCfg.drivers)}</div>
      <div class="field"><span>Human players</span>${seg("humans", Array.from({ length: Math.min(4, leagueCfg.drivers) + 1 }, (_, i) => [i, i === 0 ? "None (watch)" : String(i)]), leagueCfg.humans)}</div>
      ${humanRows}
      <div class="field"><span>Rounds</span>${seg("rounds", [[3, "3"], [5, "5"], [7, "7"]], leagueCfg.rounds)}</div>
      <div class="field"><span>Points per round</span>${seg("target", [[6, "6"], [8, "8"], [12, "12"]], leagueCfg.target)}</div>
      <div class="field"><span>Weapons</span>${seg("weapons", [[1, "Missiles & mines"], [0, "Off"]], leagueCfg.weapons ? 1 : 0)}</div>
      ${leagueCfg.humans > 2 ? `<p class="note">Players 3 and 4 need a connected gamepad each.</p>` : ""}
    </div>
    <div class="row"><button class="primary" data-act="go" data-autofocus>Start league</button><button class="ghost" data-act="back">Back</button></div>`,
    {
      drivers: (el) => ((leagueCfg.drivers = Number(el.dataset.v)), leagueSetup()),
      humans: (el) => ((leagueCfg.humans = Number(el.dataset.v)), leagueSetup()),
      hk0: (el) => ((leagueCfg.kinds[0] = el.dataset.v as VehicleKind), leagueSetup()),
      hk1: (el) => ((leagueCfg.kinds[1] = el.dataset.v as VehicleKind), leagueSetup()),
      hk2: (el) => ((leagueCfg.kinds[2] = el.dataset.v as VehicleKind), leagueSetup()),
      hk3: (el) => ((leagueCfg.kinds[3] = el.dataset.v as VehicleKind), leagueSetup()),
      rounds: (el) => ((leagueCfg.rounds = Number(el.dataset.v)), leagueSetup()),
      target: (el) => ((leagueCfg.target = Number(el.dataset.v)), leagueSetup()),
      weapons: (el) => ((leagueCfg.weapons = el.dataset.v === "1"), leagueSetup()),
      go: () => {
        const ai = [...RIVALS, ...EXTRA_AI];
        const drivers: EntrantSetup[] = [];
        for (let i = 0; i < leagueCfg.drivers; i++) {
          if (i < leagueCfg.humans) drivers.push({ name: `P${i + 1}`, color: PLAYER_COLORS[i], kind: leagueCfg.kinds[i], levels: uniformUpgrades(1), human: i });
          else {
            const r = ai[i - leagueCfg.humans];
            drivers.push({ name: r.name, color: r.color, kind: VEHICLE_KINDS[i % 3], levels: uniformUpgrades(1), human: null, skill: 0.88 - (i - leagueCfg.humans) * 0.04 });
          }
        }
        league = newLeague(drivers, leagueCfg.rounds, availableWorlds(), { targetPoints: leagueCfg.target, weapons: leagueCfg.weapons, cones: true, seed: Date.now() & 0xffff });
        leagueTable();
      },
      back: () => title(),
    },
    () => title(),
  );
}

function leagueTable(): void {
  const l = league!;
  const order = leagueStandings(l);
  const over = leagueOver(l);
  const next = l.rounds[l.round];
  show(
    `<h2>${over ? `${esc(l.drivers[order[0]].name)} wins the league` : `League · round ${l.round + 1} of ${l.rounds.length}`}</h2>
    <div class="grid">
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Wins</th><th>Points</th></tr></thead><tbody>
      ${order.map((d, i) => `<tr class="${l.drivers[d].human !== null ? "me" : ""}"><td>${ordinal(i + 1)}</td><td><span class="swatch" style="background:${l.drivers[d].color}"></span>${esc(l.drivers[d].name)}</td><td>${VEHICLES[l.drivers[d].kind].name}</td><td class="num">${l.table[d].wins}</td><td class="num">${l.table[d].points}</td></tr>`).join("")}
      </tbody></table></div></div>
      ${over ? "" : trackCard(next.world, next.index)}
    </div>
    <div class="row">${over ? `<button class="primary" data-act="menu" data-autofocus>Menu</button>` : `<button class="primary" data-act="go" data-autofocus>Start round ${l.round + 1}</button><button class="ghost" data-act="menu">Abandon league</button>`}</div>`,
    { go: () => startLeagueRound(), menu: () => ((league = null), title()) },
    () => title(),
    { music: over ? "results" : "menu" },
  );
}

function startLeagueRound(): void {
  const l = league!;
  const rd = l.rounds[l.round];
  const world = WORLD_BY_ID[rd.world];
  const track = getTrack(rd.world, rd.index);
  const race = new Race({ track, world, mode: "battle", laps: 0, entrants: l.drivers, weapons: l.weapons, cones: l.cones, targetPoints: l.targetPoints, seed: (Date.now() & 0xffff) + l.round });
  const humans = l.drivers.flatMap((d, i) => (d.human !== null ? [humanSlot(i, d.human, d.name)] : []));
  hide();
  game.start({
    kind: "league",
    race,
    humans,
    follow: "leader",
    onFinish: (r) => {
      const order = [...r.entrants].sort((a, b) => b.points - a.points || b.progress - a.progress).map((e) => e.index);
      applyLeagueRound(l, order);
      game.stop();
      leagueTable();
    },
  });
  game.resetMinimap();
}

// --- info ---------------------------------------------------------------------------------------

function howTo(): void {
  const k = (s: string) => s.split(" ").map((x) => `<span class="kbd">${x}</span>`).join(" ");
  show(
    `<h2>How to play</h2>
    <div class="grid">
      <div class="card"><h3>Controls</h3><div class="table-wrap"><table><tbody>
        <tr><td>Accelerate</td><td>${k("↑ W")} · RT / A</td></tr>
        <tr><td>Brake / reverse</td><td>${k("↓ S")} · LT / X</td></tr>
        <tr><td>Steer</td><td>${k("← → A D")} · stick / d-pad</td></tr>
        <tr><td>Fire (battle)</td><td>${k("Space Enter")} · B / RB</td></tr>
        <tr><td>Pause</td><td>${k("Esc P")} · Start</td></tr>
      </tbody></table></div>
      <p class="note">Two players on one keyboard: P1 ${k("W A S D")} + ${k("Space")}, P2 arrows + ${k("Enter")}. Gamepad 1 and 2 drive P1 and P2; players 3 and 4 in a league use gamepads 3 and 4. On a touch screen, on-screen pedals appear.</p></div>
      <div class="card"><h3>Driving</h3>
        <p class="note">Hold the throttle through a fast corner and the car starts to drift: grip drops and the tail swings out, so you turn tighter but scrub speed. Lift to tidy it up.</p>
        <p class="note">Every car reacts to the ground. The Formula flies on tarmac and metal but wallows on grass, sand and snow; the Jeep barely notices them. Ice and crystal have almost no grip; water and goo slow everyone; oil spins you round.</p>
        <p class="note">Most tracks fork: the shortcut is shorter but rougher and full of hazards. Hitting walls and cars damages the car, and a damaged car is slower.</p></div>
      <div class="card"><h3>Pickups</h3><div class="table-wrap"><table><tbody>
        <tr><td><span class="kbd">N</span> Turbo</td><td>speed burst</td></tr>
        <tr><td><span class="kbd">$</span> Cash</td><td>+100 Cr in the arcade</td></tr>
        <tr><td><span class="kbd">S</span> Shield</td><td>no damage, no spins</td></tr>
        <tr><td><span class="kbd">B</span> Power brakes</td><td>harder brakes, sharper steering</td></tr>
        <tr><td><span class="kbd">+</span> Repair</td><td>fixes 35 % damage</td></tr>
        <tr><td><span class="kbd">!</span> Weapon</td><td>missile or mine (battle)</td></tr>
      </tbody></table></div></div>
      <div class="card"><h3>Modes</h3>
        <p class="note"><b>Arcade:</b> 6 laps against four rivals, top 3 qualify. Prize money and cash pickups buy upgrades, repairs, specials and more cars. Three continues; finishing a world earns another.</p>
        <p class="note"><b>Battle:</b> one screen follows the leader. Drop off the screen and you are put back behind the leader, who scores +1. Missile hit +1, leading a lap +2.</p>
        <p class="note"><b>League:</b> the same battle rules for 3–6 drivers over several rounds, with a league table.</p></div>
    </div>
    <div class="row"><button class="primary" data-act="back" data-autofocus>Back</button></div>`,
    { back: () => title() },
    () => title(),
  );
}

function settingsScreen(): void {
  const s = game.settings;
  let confirmReset = false;
  show(
    `<h2>Settings</h2>
    <div class="card">
      <div class="field"><span>Music</span>${seg("music", [[1, "On"], [0, "Off"]], s.music ? 1 : 0)}</div>
      <div class="field"><span>Sound effects</span>${seg("sfx", [[1, "On"], [0, "Off"]], s.sfx ? 1 : 0)}</div>
      <div class="field"><span>Touch controls</span>${seg("touch", [["auto", "Automatic"], ["on", "Always"], ["off", "Never"]], s.touch)}</div>
      <div class="field"><span>Unlock all worlds for Quick race, Battle and League</span>${seg("unlock", [[0, "No"], [1, "Yes"]], s.unlockAll ? 1 : 0)}</div>
      <p class="note">Settings and your arcade career are kept in this browser only.</p>
      <div class="row"><button data-act="reset" ${career ? "" : "disabled"}>Delete arcade career</button></div>
    </div>
    <div class="row"><button class="primary" data-act="back" data-autofocus>Back</button></div>`,
    {
      music: (el) => {
        s.music = el.dataset.v === "1";
        game.sound.setMusic(s.music);
        saveSettings(s);
        settingsScreen();
      },
      sfx: (el) => {
        s.sfx = el.dataset.v === "1";
        game.sound.setSfx(s.sfx);
        saveSettings(s);
        settingsScreen();
      },
      touch: (el) => {
        s.touch = el.dataset.v as never;
        saveSettings(s);
        settingsScreen();
      },
      unlock: (el) => {
        s.unlockAll = el.dataset.v === "1";
        saveSettings(s);
        settingsScreen();
      },
      reset: (el) => {
        if (!confirmReset) {
          confirmReset = true;
          el.textContent = "Press again to delete";
          el.classList.add("hot");
          return;
        }
        career = null;
        saveCareer();
        settingsScreen();
      },
      back: () => title(),
    },
    () => title(),
  );
}

function pauseMenu(): void {
  const s = game.session;
  if (!s) return;
  game.setPaused(true);
  const arcade = s.kind === "arcade";
  const resume = () => {
    hide();
    game.setPaused(false);
    game.input.clearPressed();
  };
  show(
    `<h2>Paused</h2><p class="sub">${esc(s.race.track.spec.name)} · ${s.race.world.name}</p>
    <div class="big-menu">
      <button class="primary" data-act="resume" data-autofocus>Resume</button>
      ${arcade ? `<button data-act="retire">Retire <small>counts as not qualified</small></button>` : `<button data-act="restart">Restart</button>`}
      <button data-act="quit">${arcade ? "Retire and quit" : "Quit to menu"}</button>
    </div>`,
    {
      resume,
      retire: () => {
        game.setPaused(false);
        arcadeFinished(s.race, true);
      },
      restart: () => {
        game.stop();
        if (s.kind === "quick") startQuick();
        else if (s.kind === "battle") startBattle();
        else if (s.kind === "league") startLeagueRound();
      },
      quit: () => {
        game.setPaused(false);
        if (arcade) {
          arcadeFinished(s.race, true);
          return;
        }
        game.stop();
        league = null;
        title();
      },
    },
    resume,
    { clear: true, music: s.race.world.id },
  );
}
