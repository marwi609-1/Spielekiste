/**
 * Game runtime: the frame loop, the active race session, camera, HUD, effects and sound.
 * Menus (screens.ts) start sessions and receive the finished race back through `onFinish`.
 */

import { AIDriver } from "../core/ai";
import { formatTime } from "../core/math";
import { carSpeed, forwardSpeed } from "../core/physics";
import { Race, STEP, type RaceEvent } from "../core/race";
import { surfaceProps } from "../core/surfaces";
import type { Track } from "../core/track";
import { Sound, type Theme } from "./audio";
import { Camera } from "./camera";
import { Input, MenuNav } from "./input";
import { Particles } from "./particles";
import { Renderer } from "./renderer";
import { PICKUP_COLORS } from "./style";

export interface HumanSlot {
  entrant: number;
  player: number;
  pad: number | null;
  label: string;
  color: string;
}

export type SessionKind = "arcade" | "quick" | "battle" | "league" | "attract";

export interface Session {
  kind: SessionKind;
  race: Race;
  humans: HumanSlot[];
  follow: "player" | "leader";
  onFinish: (race: Race) => void;
}

export interface Settings {
  music: boolean;
  sfx: boolean;
  touch: "auto" | "on" | "off";
  unlockAll: boolean;
}

const SETTINGS_KEY = "overdrift:settings";

export function loadSettings(): Settings {
  const def: Settings = { music: true, sfx: true, touch: "auto", unlockAll: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return def;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

const ORD = ["th", "st", "nd", "rd"];
export function ordinal(n: number): string {
  const v = n % 100;
  return n + (ORD[(v - 20) % 10] || ORD[v] || ORD[0]);
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Game {
  readonly renderer: Renderer;
  readonly cam = new Camera();
  readonly particles = new Particles();
  readonly input = new Input();
  readonly sound = new Sound();
  readonly nav: MenuNav;
  readonly screen = $<HTMLDivElement>("screen");
  private readonly hud = $<HTMLDivElement>("hud");
  private readonly touch = $<HTMLDivElement>("touch");
  private readonly minimap = $<HTMLCanvasElement>("minimap");
  private minimapXf: { scale: number; ox: number; oy: number } | null = null;
  settings: Settings = loadSettings();
  session: Session | null = null;
  paused = false;
  onPauseMenu: (() => void) | null = null;
  onBack: () => void = () => {};
  private acc = 0;
  private last = 0;
  private time = 0;
  private doneTimer = -1;
  private toastTimer = 0;
  private centerTimer = 0;
  private hudCache = new Map<string, string>();
  /** `#autopilot` (computer drives you) and `#autopilot-fast` (4× simulation) for demos and checks. */
  private readonly autopilot = location.hash.startsWith("#autopilot");
  private readonly simSpeed = location.hash === "#autopilot-fast" ? 4 : 1;
  private dustAcc: number[] = [];

  constructor() {
    this.renderer = new Renderer($<HTMLCanvasElement>("view"));
    this.nav = new MenuNav(this.screen, () => this.onBack());
    this.input.installKeyGuard();
    this.input.onPause = () => {
      if (!this.session || this.session.kind === "attract" || !this.screen.hidden || !this.onPauseMenu) return false;
      this.onPauseMenu();
      return true;
    };
    this.sound.sfxOn = this.settings.sfx;
    this.sound.musicOn = this.settings.music;
    const unlock = () => this.sound.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.bindTouch();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.cam.viewW = w;
    this.cam.viewH = h;
    this.renderer.resize(w, h);
  }

  private bindTouch(): void {
    const map: [string, "left" | "right" | "up" | "down" | "fire"][] = [
      ["t-left", "left"],
      ["t-right", "right"],
      ["t-gas", "up"],
      ["t-brake", "down"],
      ["t-fire", "fire"],
    ];
    for (const [id, key] of map) {
      const el = $<HTMLButtonElement>(id);
      const set = (on: boolean) => {
        this.input.setTouch({ [key]: on });
        el.classList.toggle("on", on);
      };
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        set(true);
      });
      el.addEventListener("pointerup", () => set(false));
      el.addEventListener("pointercancel", () => set(false));
      el.addEventListener("lostpointercapture", () => set(false));
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  private touchWanted(): boolean {
    if (this.settings.touch === "on") return true;
    if (this.settings.touch === "off") return false;
    return matchMedia("(pointer: coarse)").matches;
  }

  music(theme: Theme | null): void {
    this.sound.music(this.settings.music ? theme : null);
  }

  // --- sessions -----------------------------------------------------------------------------

  start(session: Session): void {
    this.session = session;
    this.paused = false;
    this.doneTimer = -1;
    this.acc = 0;
    this.particles.clear();
    this.hudCache.clear();
    this.dustAcc = session.race.entrants.map(() => 0);
    const race = session.race;
    race.autopilotHumans = this.autopilot;
    if (this.autopilot) for (const h of session.humans) race.entrants[h.entrant].autopilot = new AIDriver(0.97, h.entrant + 1);
    const wide = session.follow === "leader";
    this.cam.viewW = window.innerWidth;
    this.cam.viewH = window.innerHeight;
    const lead = race.entrants[session.humans[0]?.entrant ?? 0];
    this.cam.snap(lead.car.x + Math.cos(lead.car.angle) * 120, lead.car.y + Math.sin(lead.car.angle) * 120, wide);
    this.renderer.setTrack(
      race.track,
      race.entrants.map((e) => ({ kind: e.setup.kind, color: e.setup.color, length: e.stats.length, width: e.stats.width })),
      this.cam.zoom,
    );
    this.input.keyboardPlayers = Math.max(1, session.humans.filter((h) => h.player < 2).length);
    const attract = session.kind === "attract";
    this.hud.hidden = attract;
    this.input.captureKeys(!attract);
    this.minimapXf = attract ? null : Renderer.drawOverview(this.minimap, race.track, { pad: 10 });
    this.minimapBase = null;
    this.sound.setEngines(attract ? 0 : session.humans.length);
    const showTouch = !attract && session.humans.some((h) => h.player === 0) && this.touchWanted();
    this.touch.hidden = !showTouch;
    $("app").classList.toggle("touch-on", showTouch);
    $<HTMLButtonElement>("t-fire").hidden = !race.weapons;
    $("center").textContent = "";
    $("toast").textContent = "";
    this.music(attract ? "menu" : race.world.id);
  }

  stop(): void {
    this.session = null;
    this.hud.hidden = true;
    this.touch.hidden = true;
    $("app").classList.remove("touch-on");
    this.input.captureKeys(false);
    this.sound.setEngines(0);
  }

  /** HUD and touch controls hide while a menu covers the race. */
  overlay(menuShown: boolean): void {
    const s = this.session;
    const racing = !!s && s.kind !== "attract";
    this.hud.hidden = !racing || menuShown;
    this.touch.hidden = !racing || menuShown || !(s!.humans.some((h) => h.player === 0) && this.touchWanted());
    $("app").classList.toggle("touch-on", !this.touch.hidden);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.sound.silenceEngines();
  }

  // --- frame loop ---------------------------------------------------------------------------

  private frame(t: number): void {
    const dt = Math.min(0.05, this.last ? (t - this.last) / 1000 : 0.016);
    this.last = t;
    this.time += dt;
    this.input.pollPadPause();
    this.nav.pollPad(this.input, dt);
    const s = this.session;
    if (s) {
      const race = s.race;
      if (!this.paused) {
        const inputs = this.readInputs(s);
        this.acc += dt * (s.kind === "attract" ? 1 : this.simSpeed);
        let n = 0;
        while (this.acc >= STEP && n < 10 * this.simSpeed) {
          race.step(STEP, inputs);
          this.acc -= STEP;
          n++;
        }
        if (n === 10 * this.simSpeed) this.acc = 0;
        this.handleEvents(s, race.takeEvents());
        this.spawnEffects(race, dt);
        this.particles.update(dt);
        if (race.phase === "done") {
          if (this.doneTimer < 0) this.doneTimer = s.kind === "attract" ? 1.5 : 2.6;
          this.doneTimer -= dt;
          if (this.doneTimer <= 0 && this.session === s) {
            this.doneTimer = 1e9;
            s.onFinish(race);
          }
        }
      }
      this.updateCamera(s, dt);
      race.view = this.cam.view();
      this.renderer.updateSkids(race);
      this.renderer.render(race, this.cam, this.particles, this.time, this.tags(s));
      if (s.kind !== "attract") {
        this.updateHud(s, dt);
        if (!this.paused) this.updateEngines(s);
      }
    } else {
      const g = this.renderer.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = "#120c2e";
      g.fillRect(0, 0, this.renderer.canvas.width, this.renderer.canvas.height);
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private readInputs(s: Session) {
    const out = [];
    for (const h of s.humans) out[h.player] = this.screen.hidden ? this.input.read(h.player, h.pad) : { throttle: 0, brake: 0, steer: 0, fire: false };
    return out;
  }

  private tags(s: Session) {
    if (s.kind === "attract") return [];
    return s.humans.map((h) => ({ index: h.entrant, label: h.label, color: h.color }));
  }

  private updateCamera(s: Session, dt: number): void {
    const race = s.race;
    let target = race.entrants[s.humans[0]?.entrant ?? 0];
    if (s.follow === "leader" || s.humans.length === 0) target = race.leader();
    if (race.mode === "race" && s.humans.length === 1) {
      target = race.entrants[s.humans[0].entrant];
    }
    const c = target.car;
    this.cam.update(dt, c.x, c.y, c.vx, c.vy, carSpeed(c) / target.stats.vmax, s.follow === "leader");
  }

  private spawnEffects(race: Race, dt: number): void {
    race.entrants.forEach((e, i) => {
      const c = e.car;
      const sp = carSpeed(c);
      const p = surfaceProps(c.surface);
      const fx = Math.cos(c.angle);
      const fy = Math.sin(c.angle);
      const bx = c.x - fx * e.stats.length * 0.4;
      const by = c.y - fy * e.stats.length * 0.4;
      if (c.z > 0) return;
      if (p.dust && sp > 70) {
        this.dustAcc[i] += dt * (sp / 18) * (p.splash ? 1.6 : 1) * (p.loose || p.splash ? 1 : 0.3);
        while (this.dustAcc[i] >= 1) {
          this.dustAcc[i] -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          const wx = bx - fy * side * e.stats.width * 0.45;
          const wy = by + fx * side * e.stats.width * 0.45;
          if (p.splash) this.particles.splash(wx, wy, p.dust, -c.vx * 0.2, -c.vy * 0.2);
          else this.particles.dust(wx, wy, p.dust, -c.vx * 0.15, -c.vy * 0.15, 4 + Math.random() * 3);
        }
      } else if (c.slip > 140 && sp > 150 && !p.dust) {
        if (Math.random() < dt * 30) this.particles.dust(bx, by, "#d8d8de", -c.vx * 0.1, -c.vy * 0.1, 5);
      }
      if (c.damage > 55 && Math.random() < dt * (c.damage > 80 ? 22 : 8)) this.particles.smoke(c.x + fx * e.stats.length * 0.3, c.y + fy * e.stats.length * 0.3, c.damage > 80);
      if (c.turbo > 0 && Math.random() < dt * 40) this.particles.add({ kind: 3, x: bx - fx * 6, y: by - fy * 6, vx: -fx * 120 + (Math.random() - 0.5) * 40, vy: -fy * 120 + (Math.random() - 0.5) * 40, life: 0.25, size: 4, grow: 6, color: "" });
    });
  }

  private toast(text: string, color = "#f4f1ff", secs = 1.6): void {
    const el = $("toast");
    el.textContent = text;
    el.style.color = color;
    el.style.opacity = "1";
    this.toastTimer = secs;
  }

  private center(text: string, small = false, secs = 1.2): void {
    const el = $("center");
    el.textContent = text;
    el.classList.toggle("small", small);
    this.centerTimer = secs;
  }

  private isHuman(s: Session, entrant: number): HumanSlot | undefined {
    return s.humans.find((h) => h.entrant === entrant);
  }

  private handleEvents(s: Session, events: RaceEvent[]): void {
    const race = s.race;
    const attract = s.kind === "attract";
    const near = (x: number, y: number) => {
      const v = this.cam.view();
      const dx = Math.abs(x - v.cx) / (v.hw + 200);
      const dy = Math.abs(y - v.cy) / (v.hh + 200);
      return Math.max(0, 1 - Math.max(dx, dy) * 0.7);
    };
    for (const ev of events) {
      switch (ev.type) {
        case "countdown":
          this.center(String(ev.n));
          this.sound.play("beep");
          break;
        case "go":
          this.center("GO!");
          this.sound.play("go");
          break;
        case "pickup": {
          const human = this.isHuman(s, ev.who);
          const col = PICKUP_COLORS[ev.kind];
          this.particles.sparkle(ev.x, ev.y, col);
          if (ev.kind === "cash") this.particles.text(ev.x, ev.y - 10, "+100", col);
          if (human && !attract) {
            this.sound.play(ev.kind === "cash" ? "cash" : ev.kind === "turbo" ? "turbo" : "pickup");
            const names: Record<string, string> = { turbo: "TURBO!", shield: "SHIELD", brakes: "POWER BRAKES", repair: "REPAIRED", weapon: ev.weapon === "mine" ? "MINE" : "MISSILE", cash: "" };
            if (names[ev.kind]) this.toast(`${s.humans.length > 1 ? human.label + " " : ""}${names[ev.kind]}`, col, 1.1);
          }
          break;
        }
        case "wall":
          if (ev.impact > 120) this.particles.sparks(ev.x, ev.y, Math.min(16, Math.round(ev.impact / 30)));
          if (!attract && ev.impact > 70) this.sound.play("hit", (ev.impact / 400) * near(ev.x, ev.y));
          break;
        case "bump":
          if (ev.impact > 120) this.particles.sparks(ev.x, ev.y, 6);
          if (!attract) this.sound.play("bump", (ev.impact / 300) * near(ev.x, ev.y));
          break;
        case "cone":
          if (!attract) this.sound.play("cone");
          break;
        case "spin":
          if (this.isHuman(s, ev.who) && !attract) {
            this.sound.play("spin");
            this.toast("OIL!", "#ff9b3d", 0.9);
          }
          break;
        case "land":
          if (!attract && ev.impact > 200) this.sound.play("land", ev.impact / 500);
          break;
        case "lap": {
          const h = this.isHuman(s, ev.who);
          if (h && !attract && race.mode === "race") {
            const left = race.laps - ev.lap;
            if (left === 1) {
              this.center("FINAL LAP", true, 1.6);
              this.sound.play("final");
            } else if (left > 1) {
              this.toast(`LAP ${formatTime(ev.time)}${ev.best ? "  BEST" : ""}`, ev.best ? "#5ee07a" : "#f4f1ff", 1.6);
              this.sound.play("lap");
            }
          }
          break;
        }
        case "finish": {
          const h = this.isHuman(s, ev.who);
          if (h && !attract) {
            this.center(`${s.humans.length > 1 ? h.label + " " : ""}${ordinal(ev.place).toUpperCase()}`, false, 3);
            this.sound.play("finish");
          }
          break;
        }
        case "wreck":
          this.particles.explosion(ev.x, ev.y);
          if (!attract) {
            this.sound.play("wreck");
            if (this.isHuman(s, ev.who)) this.center("WRECKED", false, 3);
          }
          break;
        case "fire":
          if (!attract && ev.weapon === "missile") this.sound.play("missile");
          break;
        case "explode":
          this.particles.explosion(ev.x, ev.y);
          if (!attract) this.sound.play("explode", near(ev.x, ev.y));
          break;
        case "teleport": {
          const e = race.entrants[ev.who];
          this.particles.sparkle(e.car.x, e.car.y, "#3ddcff");
          if (!attract) this.sound.play("teleport");
          break;
        }
        case "point": {
          const e = race.entrants[ev.who];
          this.particles.text(e.car.x, e.car.y - 30, `+${ev.points}`, e.setup.color);
          if (!attract) {
            this.sound.play("point");
            this.toast(`${e.setup.name} +${ev.points} ${ev.reason.toUpperCase()}`, e.setup.color, 1.4);
          }
          break;
        }
        case "win": {
          const e = race.entrants[ev.who];
          if (!attract) {
            this.center(`${e.setup.name.toUpperCase()} WINS`, true, 3);
            this.sound.play("finish");
          }
          break;
        }
        case "jump":
          break;
      }
    }
  }

  private set(id: string, html: string): void {
    if (this.hudCache.get(id) === html) return;
    this.hudCache.set(id, html);
    $(id).innerHTML = html;
  }

  private playerPanel(race: Race, h: HumanSlot, multi: boolean): string {
    const e = race.entrants[h.entrant];
    const c = e.car;
    const kmh = Math.round(Math.abs(forwardSpeed(c)) * 0.36);
    const dmg = Math.round(c.damage);
    const hp = Math.max(0, 100 - dmg);
    const col = hp > 50 ? "var(--go)" : hp > 25 ? "var(--warn)" : "var(--hot)";
    const fx: string[] = [];
    if (c.turbo > 0) fx.push(`<span style="background:#ff7a1a">TURBO</span>`);
    if (c.shield > 0) fx.push(`<span style="background:#3ddcff">SHIELD</span>`);
    if (c.powerBrakes > 0) fx.push(`<span style="background:#ff4f8b">BRAKES</span>`);
    if (e.weapon) fx.push(`<span style="background:#ff3b3b">${e.weapon === "missile" ? "MISSILE" : "MINE"} ×${e.ammo}</span>`);
    return `${multi ? `<div class="hud-line" style="color:${h.color}">${h.label}</div>` : ""}<div class="hud-fx">${fx.join("")}</div><div class="hud-big num">${kmh}<small> km/h</small></div><div class="hud-meter" title="Car condition"><i style="width:${hp}%;background:${col}"></i></div>`;
  }

  private updateHud(s: Session, dt: number): void {
    const race = s.race;
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) $("toast").style.opacity = "0";
    this.centerTimer -= dt;
    if (this.centerTimer <= 0 && race.phase !== "countdown") $("center").textContent = "";
    const multi = s.humans.length > 1;
    if (race.mode === "race") {
      const me = race.entrants[s.humans[0].entrant];
      const lap = Math.min(race.laps, Math.max(1, me.lapsDone + 1));
      this.set(
        "hud-tl",
        `<div class="hud-big">${me.wrecked ? "DNF" : ordinal(me.place).toUpperCase()}<small> / ${race.entrants.length}</small></div><div class="hud-line">LAP ${me.finished ? race.laps : lap}/${race.laps}</div><div class="hud-line dim num">${formatTime(me.finished ? me.finishTime : race.time)}</div>`,
      );
      this.set(
        "hud-tr",
        `${s.kind === "arcade" ? `<div class="hud-line" style="color:var(--sun)">+${me.cash} Cr</div>` : ""}<div class="hud-line dim num">BEST ${formatTime(me.bestLap)}</div><div class="hud-line dim">${race.track.spec.name}</div>`,
      );
      this.set("hud-scores", "");
      this.set("hud-br", this.playerPanel(race, s.humans[0], false));
    } else {
      const order = [...race.entrants].sort((a, b) => b.points - a.points);
      this.set(
        "hud-scores",
        order.map((e) => `<div style="border-color:${e.setup.color};color:${e.setup.color}">${e.setup.name.split(" ")[0]} ${e.points}</div>`).join(""),
      );
      this.set("hud-tl", `<div class="hud-line">FIRST TO ${race.targetPoints}</div><div class="hud-line dim">${race.track.spec.name}</div>`);
      this.set("hud-tr", "");
      if (s.humans.length) this.set("hud-br", s.humans.map((h) => this.playerPanel(race, h, multi)).join(`<div style="height:8px"></div>`));
      else this.set("hud-br", "");
    }
    if (race.phase === "countdown" && race.countdown > 3) $("center").textContent = "";

    // Minimap dots.
    if (this.minimapXf) {
      const g = this.minimap.getContext("2d")!;
      const xf = this.minimapXf;
      if (!this.minimapBase) {
        this.minimapBase = document.createElement("canvas");
        this.minimapBase.width = this.minimap.width;
        this.minimapBase.height = this.minimap.height;
        this.minimapBase.getContext("2d")!.drawImage(this.minimap, 0, 0);
      }
      g.clearRect(0, 0, this.minimap.width, this.minimap.height);
      g.drawImage(this.minimapBase, 0, 0);
      for (const e of race.entrants) {
        const x = e.car.x * xf.scale + xf.ox;
        const y = e.car.y * xf.scale + xf.oy;
        const human = this.isHuman(s, e.index);
        g.fillStyle = e.setup.color;
        g.beginPath();
        g.arc(x, y, human ? 5 : 3.5, 0, Math.PI * 2);
        g.fill();
        if (human) {
          g.strokeStyle = "#fff";
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
    }
  }
  private minimapBase: HTMLCanvasElement | null = null;

  /** Must be called whenever the minimap gets a new track. */
  resetMinimap(): void {
    this.minimapBase = null;
  }

  private updateEngines(s: Session): void {
    const race = s.race;
    s.humans.forEach((h, i) => {
      const e = race.entrants[h.entrant];
      const c = e.car;
      const pan = s.humans.length > 1 ? (i === 0 ? -0.5 : 0.5) : 0;
      const p = surfaceProps(c.surface);
      this.sound.engine(i, Math.abs(forwardSpeed(c)) / e.stats.vmax, e.wrecked ? 0 : c.throttle, c.z > 0 ? 0 : c.slip, p.loose, pan, c.turbo > 0);
    });
  }

  /** Builds a Track overview into a canvas (pre-race and setup screens). */
  preview(canvas: HTMLCanvasElement, track: Track): void {
    Renderer.drawOverview(canvas, track, { pad: 14 });
  }
}
