/**
 * Keyboard, gamepad and touch input → one DriveInput per player.
 *
 * One player: arrows or WASD, fire Space / Enter / Ctrl.
 * Two players on one keyboard: P1 = WASD + Space/Left Shift, P2 = arrows + Enter/Right Shift/Right Ctrl.
 * Gamepad n (standard mapping) drives player n: RT or A accelerate, LT or X brake, stick or d-pad
 * steer, B or RB fire, Start pauses. Touch: on-screen pedals and steering buttons for player 1.
 */

import type { DriveInput } from "../core/physics";

const P1_KEYS = { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"], fire: ["Space", "ShiftLeft", "ControlLeft"] };
const P2_KEYS = { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"], fire: ["Enter", "ShiftRight", "ControlRight", "NumpadEnter"] };
const SOLO_KEYS = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  fire: ["Space", "Enter", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight"],
};

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private touch = { up: false, down: false, left: false, right: false, fire: false };
  /** Number of humans sharing the keyboard (changes the key split). */
  keyboardPlayers = 1;
  /** Returns true when the key opened the pause menu (the event then stops here). */
  onPause: (() => boolean) | null = null;
  private padPausePrev: boolean[] = [];

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if ((e.code === "Escape" || e.code === "KeyP") && this.onPause?.()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
  }

  private capturing = false;

  /** Game keys must not scroll the page while racing. */
  captureKeys(on: boolean): void {
    this.capturing = on;
  }

  installKeyGuard(): void {
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.capturing) return;
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      },
      { capture: true },
    );
  }

  /** Was this key pressed since the last call (menus)? */
  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  clearPressed(): void {
    this.pressed.clear();
  }

  setTouch(state: Partial<typeof this.touch>): void {
    Object.assign(this.touch, state);
  }

  private any(codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  private keys(player: number) {
    if (this.keyboardPlayers <= 1) return player === 0 ? SOLO_KEYS : null;
    if (player === 0) return P1_KEYS;
    if (player === 1) return P2_KEYS;
    return null;
  }

  /** Gamepads in slot order (only connected ones). */
  pads(): Gamepad[] {
    try {
      const list = navigator.getGamepads ? navigator.getGamepads() : [];
      return Array.from(list).filter((p): p is Gamepad => !!p && p.connected);
    } catch {
      // Gamepads can be blocked by the embedding frame's permissions policy.
      return [];
    }
  }

  read(player: number, padIndex: number | null): DriveInput {
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let fire = false;
    const k = this.keys(player);
    if (k) {
      if (this.any(k.up)) throttle = 1;
      if (this.any(k.down)) brake = 1;
      if (this.any(k.left)) steer -= 1;
      if (this.any(k.right)) steer += 1;
      if (this.any(k.fire)) fire = true;
    }
    if (player === 0) {
      if (this.touch.up) throttle = 1;
      if (this.touch.down) brake = 1;
      if (this.touch.left) steer -= 1;
      if (this.touch.right) steer += 1;
      if (this.touch.fire) fire = true;
    }
    if (padIndex !== null) {
      const pad = this.pads()[padIndex];
      if (pad) {
        const b = (i: number) => pad.buttons[i]?.value ?? 0;
        const pr = (i: number) => !!pad.buttons[i]?.pressed;
        throttle = Math.max(throttle, b(7), pr(0) ? 1 : 0);
        brake = Math.max(brake, b(6), pr(2) ? 1 : 0);
        const ax = pad.axes[0] ?? 0;
        if (Math.abs(ax) > 0.15) steer = Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.15) / 0.75);
        if (pr(14)) steer = -1;
        if (pr(15)) steer = 1;
        if (pr(1) || pr(5)) fire = true;
      }
    }
    steer = Math.max(-1, Math.min(1, steer));
    return { throttle, brake, steer, fire };
  }

  /** Polls Start on all pads for pause. */
  pollPadPause(): void {
    this.pads().forEach((p, i) => {
      const now = !!p.buttons[9]?.pressed;
      if (now && !this.padPausePrev[i]) this.onPause?.();
      this.padPausePrev[i] = now;
    });
  }

  anyThrottle(): boolean {
    return this.any(SOLO_KEYS.up) || this.touch.up;
  }
}

/** Menu navigation with arrows / d-pad between focusable buttons. */
export class MenuNav {
  private prevPad: Record<string, boolean> = {};
  private repeatT = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly back: () => void,
  ) {
    window.addEventListener("keydown", (e) => {
      if (this.root.hidden) return;
      if (e.code === "Escape" || e.code === "Backspace") {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === "INPUT" && e.code === "Backspace") return;
        e.preventDefault();
        this.back();
        return;
      }
      const dir = e.code === "ArrowDown" || e.code === "ArrowRight" ? 1 : e.code === "ArrowUp" || e.code === "ArrowLeft" ? -1 : 0;
      if (dir) {
        const active = document.activeElement as HTMLElement | null;
        if (active?.tagName === "INPUT" && (active as HTMLInputElement).type === "range") return;
        e.preventDefault();
        this.move(dir, e.code);
      }
    });
  }

  focusables(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>("button:not([disabled]), [data-nav]:not([disabled])")).filter((el) => el.offsetParent !== null);
  }

  focusFirst(): void {
    const pref = this.root.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ?? this.focusables()[0];
    pref?.focus({ preventScroll: true });
  }

  /** Spatial navigation: nearest element in the pressed direction, falling back to list order. */
  private move(dir: number, code: string): void {
    const list = this.focusables();
    if (!list.length) return;
    const cur = document.activeElement as HTMLElement;
    const i = list.indexOf(cur);
    if (i < 0) {
      list[0].focus();
      return;
    }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const horizontal = code === "ArrowLeft" || code === "ArrowRight";
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const q = el.getBoundingClientRect();
      const dx = q.left + q.width / 2 - cx;
      const dy = q.top + q.height / 2 - cy;
      const main = horizontal ? dx * dir : dy * dir;
      const cross = horizontal ? Math.abs(dy) : Math.abs(dx);
      if (main <= 4) continue;
      const score = main + cross * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) best = list[(i + dir + list.length) % list.length];
    best.focus();
    best.scrollIntoView({ block: "nearest" });
  }

  /** Gamepad d-pad / stick / A / B for menus. */
  pollPad(input: Input, dt: number): void {
    if (this.root.hidden) return;
    const pad = input.pads()[0];
    if (!pad) return;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const state: Record<string, boolean> = {
      up: !!pad.buttons[12]?.pressed || ay < -0.6,
      down: !!pad.buttons[13]?.pressed || ay > 0.6,
      left: !!pad.buttons[14]?.pressed || ax < -0.6,
      right: !!pad.buttons[15]?.pressed || ax > 0.6,
      a: !!pad.buttons[0]?.pressed,
      b: !!pad.buttons[1]?.pressed,
    };
    this.repeatT -= dt;
    const map: Record<string, string> = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
    for (const k of ["up", "down", "left", "right"]) {
      if (state[k] && (!this.prevPad[k] || this.repeatT <= 0)) {
        this.move(k === "down" || k === "right" ? 1 : -1, map[k]);
        this.repeatT = this.prevPad[k] ? 0.12 : 0.35;
      }
    }
    if (state.a && !this.prevPad.a) (document.activeElement as HTMLElement | null)?.click();
    if (state.b && !this.prevPad.b) this.back();
    this.prevPad = state;
  }
}
