/**
 * Synthesised sound (Web Audio, no samples): engine loops with pitch from a simulated gearbox, tyre
 * screech, one-shot effects and a small four-channel tracker-style music sequencer with a loop per world.
 */

import { clamp, mulberry32 } from "../core/math";

type Sfx = "beep" | "go" | "pickup" | "cash" | "turbo" | "hit" | "bump" | "splash" | "explode" | "missile" | "land" | "lap" | "final" | "finish" | "point" | "teleport" | "tick" | "select" | "buy" | "deny" | "spin" | "cone" | "wreck";

interface EngineVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  skidGain: GainNode;
  skidFilter: BiquadFilterNode;
}

export type Theme = "menu" | "sports" | "canyon" | "forest" | "space" | "moon" | "alien" | "results";

interface ThemeDef {
  bpm: number;
  root: number; // MIDI note
  scale: number[];
  chords: number[]; // scale degrees per bar
  swing: number;
  lead: OscillatorType;
  seed: number;
  drums: "rock" | "four" | "half" | "shuffle";
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];

const THEMES: Record<Theme, ThemeDef> = {
  menu: { bpm: 128, root: 57, scale: MINOR, chords: [0, 5, 2, 6], swing: 0, lead: "square", seed: 3, drums: "four" },
  sports: { bpm: 142, root: 60, scale: MAJOR, chords: [0, 4, 5, 3], swing: 0, lead: "square", seed: 11, drums: "rock" },
  canyon: { bpm: 118, root: 52, scale: DORIAN, chords: [0, 3, 0, 4], swing: 0.12, lead: "sawtooth", seed: 21, drums: "shuffle" },
  forest: { bpm: 132, root: 62, scale: MIXO, chords: [0, 6, 3, 0], swing: 0, lead: "triangle", seed: 31, drums: "rock" },
  space: { bpm: 136, root: 54, scale: MINOR, chords: [0, 5, 3, 4], swing: 0, lead: "sawtooth", seed: 41, drums: "four" },
  moon: { bpm: 108, root: 59, scale: MINOR, chords: [0, 3, 5, 4], swing: 0, lead: "triangle", seed: 51, drums: "half" },
  alien: { bpm: 124, root: 61, scale: PHRYGIAN, chords: [0, 1, 0, 6], swing: 0.08, lead: "square", seed: 61, drums: "four" },
  results: { bpm: 100, root: 60, scale: MAJOR, chords: [0, 5, 3, 4], swing: 0.1, lead: "triangle", seed: 71, drums: "half" },
};

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private engines: EngineVoice[] = [];
  sfxOn = true;
  musicOn = true;
  private theme: Theme | null = null;
  private nextStep = 0;
  private stepIndex = 0;
  private timer: number | null = null;
  private melody: number[] = [];

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
    this.sfxBus.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
    this.musicBus.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.theme) this.startSequencer();
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.05);
  }

  // --- engines ------------------------------------------------------------------------------

  /** Engine voices wanted; created once audio is unlocked. */
  private wantEngines = 0;

  setEngines(n: number): void {
    this.wantEngines = n;
    if (!this.ctx) return;
    const c = this.ctx;
    while (this.engines.length > n) {
      const v = this.engines.pop()!;
      v.gain.gain.setTargetAtTime(0, c.currentTime, 0.05);
      v.skidGain.gain.setTargetAtTime(0, c.currentTime, 0.05);
      const stopAt = c.currentTime + 0.3;
      v.osc1.stop(stopAt);
      v.osc2.stop(stopAt);
    }
    while (this.engines.length < n) {
      const osc1 = c.createOscillator();
      osc1.type = "sawtooth";
      const osc2 = c.createOscillator();
      osc2.type = "square";
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 4;
      const gain = c.createGain();
      gain.gain.value = 0;
      const pan = c.createStereoPanner();
      const g2 = c.createGain();
      g2.gain.value = 0.45;
      osc1.connect(filter);
      osc2.connect(g2).connect(filter);
      filter.connect(gain).connect(pan).connect(this.sfxBus);
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const skidFilter = c.createBiquadFilter();
      skidFilter.type = "bandpass";
      skidFilter.frequency.value = 1100;
      skidFilter.Q.value = 1.5;
      const skidGain = c.createGain();
      skidGain.gain.value = 0;
      src.connect(skidFilter).connect(skidGain).connect(pan);
      osc1.start();
      osc2.start();
      src.start();
      this.engines.push({ osc1, osc2, filter, gain, pan, skidGain, skidFilter });
    }
  }

  /** speedFrac = |v| / vmax. */
  engine(i: number, speedFrac: number, throttle: number, slip: number, loose: boolean, pan: number, turbo: boolean): void {
    if (this.ctx && this.engines.length !== this.wantEngines) this.setEngines(this.wantEngines);
    const v = this.engines[i];
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = clamp(speedFrac, 0, 1.3);
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor(sp * gears));
    const within = sp * gears - g;
    const rpm = 0.22 + within * 0.7 + throttle * 0.08 + (sp < 0.05 ? throttle * 0.3 : 0);
    const f = 38 + rpm * 120 + g * 7 + (turbo ? 25 : 0);
    v.osc1.frequency.setTargetAtTime(f, t, 0.03);
    v.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    v.filter.frequency.setTargetAtTime(280 + rpm * 1400 + throttle * 700, t, 0.05);
    v.gain.gain.setTargetAtTime(0.035 + throttle * 0.05 + sp * 0.02, t, 0.05);
    v.pan.pan.setTargetAtTime(clamp(pan, -0.8, 0.8), t, 0.1);
    const skid = clamp((slip - 45) / 260, 0, 1);
    v.skidFilter.frequency.setTargetAtTime(loose ? 520 : 1300, t, 0.05);
    v.skidGain.gain.setTargetAtTime(skid * (loose ? 0.12 : 0.1), t, 0.04);
  }

  silenceEngines(): void {
    if (!this.ctx) return;
    for (const v of this.engines) {
      v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      v.skidGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  // --- effects ------------------------------------------------------------------------------

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0, bus: GainNode = this.sfxBus): void {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, freq: number, at = 0, f1?: number, bus: GainNode = this.sfxBus): void {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(freq, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  play(name: Sfx, strength = 1): void {
    if (!this.ctx || !this.sfxOn) return;
    const s = clamp(strength, 0.1, 1.5);
    switch (name) {
      case "beep":
        this.tone("square", 520, 520, 0.18, 0.12);
        break;
      case "go":
        this.tone("square", 1040, 1040, 0.45, 0.14);
        break;
      case "pickup":
        [660, 880, 1320].forEach((f, i) => this.tone("square", f, f, 0.08, 0.06, i * 0.05));
        break;
      case "cash":
        this.tone("triangle", 1320, 1320, 0.07, 0.12);
        this.tone("triangle", 1760, 1760, 0.18, 0.12, 0.06);
        break;
      case "turbo":
        this.burst(0.7, 0.25, "bandpass", 400, 0, 3000);
        this.tone("sawtooth", 120, 420, 0.6, 0.05);
        break;
      case "hit":
        this.burst(0.18, 0.4 * s, "lowpass", 900);
        this.tone("sine", 140, 50, 0.15, 0.25 * s);
        break;
      case "bump":
        this.tone("sine", 110, 45, 0.18, 0.3 * s);
        this.burst(0.08, 0.2 * s, "lowpass", 1400);
        break;
      case "cone":
        this.tone("triangle", 380, 240, 0.1, 0.12);
        break;
      case "splash":
        this.burst(0.35, 0.18, "highpass", 1400);
        break;
      case "explode":
        this.burst(0.9, 0.55, "lowpass", 700, 0, 120);
        this.tone("sine", 90, 30, 0.6, 0.4);
        break;
      case "missile":
        this.tone("sawtooth", 260, 900, 0.35, 0.07);
        this.burst(0.4, 0.15, "bandpass", 2000, 0, 600);
        break;
      case "land":
        this.tone("sine", 90, 40, 0.16, 0.25 * s);
        break;
      case "spin":
        this.burst(0.5, 0.12, "bandpass", 1800, 0, 900);
        break;
      case "lap":
        this.tone("square", 784, 784, 0.1, 0.08);
        this.tone("square", 1046, 1046, 0.16, 0.08, 0.1);
        break;
      case "final":
        [784, 988, 1175, 1568].forEach((f, i) => this.tone("square", f, f, 0.12, 0.08, i * 0.09));
        break;
      case "finish":
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone("square", f, f, 0.16, 0.09, i * 0.12));
        break;
      case "point":
        this.tone("triangle", 988, 988, 0.08, 0.12);
        this.tone("triangle", 1480, 1480, 0.2, 0.12, 0.07);
        break;
      case "teleport":
        this.tone("sawtooth", 1400, 180, 0.35, 0.06);
        break;
      case "tick":
        this.tone("square", 1200, 1200, 0.03, 0.04);
        break;
      case "select":
        this.tone("square", 880, 1320, 0.09, 0.07);
        break;
      case "buy":
        this.tone("triangle", 1046, 1046, 0.06, 0.1);
        this.tone("triangle", 1568, 1568, 0.14, 0.1, 0.05);
        break;
      case "deny":
        this.tone("square", 180, 140, 0.2, 0.08);
        break;
      case "wreck":
        this.burst(1.2, 0.5, "lowpass", 500, 0, 100);
        this.tone("sawtooth", 200, 40, 1.0, 0.15);
        break;
    }
  }

  // --- music --------------------------------------------------------------------------------

  music(theme: Theme | null): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (theme && this.ctx) this.startSequencer();
  }

  private startSequencer(): void {
    const def = THEMES[this.theme!];
    const rng = mulberry32(def.seed);
    // A two-bar melody over the scale, reused with variation every other phrase.
    this.melody = [];
    let deg = 4;
    for (let i = 0; i < 32; i++) {
      const rest = rng() < 0.3 || i % 8 === 7;
      deg = Math.max(0, Math.min(11, deg + Math.round((rng() - 0.5) * 4)));
      this.melody.push(rest ? -1 : deg);
    }
    this.stepIndex = 0;
    this.nextStep = this.ctx!.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule(): void {
    if (!this.ctx || !this.theme) return;
    const def = THEMES[this.theme];
    const stepDur = 60 / def.bpm / 4;
    while (this.nextStep < this.ctx.currentTime + 0.15) {
      const swing = this.stepIndex % 2 === 1 ? def.swing * stepDur : 0;
      this.playStep(def, this.stepIndex, this.nextStep + swing, stepDur);
      this.nextStep += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 256;
    }
  }

  private note(type: OscillatorType, midi: number, t: number, dur: number, vol: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = midiHz(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.setTargetAtTime(vol * 0.6, t + 0.02, dur * 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private drum(kind: "kick" | "snare" | "hat", t: number): void {
    const c = this.ctx!;
    if (kind === "kick") {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = c.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.22);
      return;
    }
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = kind === "hat" ? "highpass" : "bandpass";
    f.frequency.value = kind === "hat" ? 7000 : 1800;
    const g = c.createGain();
    const len = kind === "hat" ? 0.04 : 0.14;
    g.gain.setValueAtTime(kind === "hat" ? 0.22 : 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t, Math.random());
    src.stop(t + len + 0.02);
  }

  private playStep(def: ThemeDef, step: number, t: number, sd: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % def.chords.length;
    const chord = def.chords[bar];
    const deg = (d: number) => {
      const oct = Math.floor(d / 7);
      return def.root + def.scale[((d % 7) + 7) % 7] + 12 * oct;
    };
    // Drums.
    if (def.drums === "four") {
      if (s16 % 4 === 0) this.drum("kick", t);
      if (s16 % 8 === 4) this.drum("snare", t);
      if (s16 % 2 === 1) this.drum("hat", t);
    } else if (def.drums === "rock") {
      if (s16 === 0 || s16 === 6 || s16 === 10) this.drum("kick", t);
      if (s16 === 4 || s16 === 12) this.drum("snare", t);
      if (s16 % 2 === 0) this.drum("hat", t);
    } else if (def.drums === "shuffle") {
      if (s16 === 0 || s16 === 8 || s16 === 11) this.drum("kick", t);
      if (s16 === 4 || s16 === 12) this.drum("snare", t);
      if (s16 % 4 !== 1) this.drum("hat", t);
    } else {
      if (s16 === 0) this.drum("kick", t);
      if (s16 === 8) this.drum("snare", t);
      if (s16 % 4 === 2) this.drum("hat", t);
    }
    // Bass: root on the beat, fifth on the offbeat.
    if (s16 % 4 === 0) this.note("triangle", deg(chord) - 24, t, sd * 2.2, 0.5);
    if (s16 % 4 === 2) this.note("triangle", deg(chord + 4) - 24, t, sd * 1.2, 0.32);
    // Arpeggio.
    const arp = [0, 2, 4, 7][s16 % 4];
    this.note("square", deg(chord + arp) - 12, t, sd * 0.8, 0.045);
    // Lead every eighth, after the intro.
    if (step >= 32 && s16 % 2 === 0) {
      const m = this.melody[(step / 2) % 32 | 0];
      if (m >= 0) this.note(def.lead, deg(m + chord) , t, sd * 1.8, 0.07);
    }
  }
}
