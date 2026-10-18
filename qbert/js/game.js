/*
 * game.js — Q*bert clone: game logic (no drawing, no DOM).
 *
 * Contents
 *   1. Geometry      – isometric projection of the logical cube grid
 *   2. Rules/levels  – colour rules, palettes and per-round difficulty
 *   3. Actors        – Q*bert and all enemies
 *   4. Game          – state machine, spawning, collisions, scoring
 *
 * Logical grid: row r = 0..6 (top to bottom), column c = 0..r.
 * Hop vectors:  UL (-1,-1)  UR (-1,0)  DL (+1,0)  DR (+1,+1).
 * Cells outside the pyramid are valid positions too (discs, falling actors).
 */
(function () {
  'use strict';

  const QB = (window.QB = window.QB || {});

  /* ======================================================================
   * 1. Geometry
   * ==================================================================== */

  const GEOM = {
    W: 640, H: 540,   // logical canvas size (scaled to the window by main.js)
    ROWS: 7,
    CW: 64,           // cube width
    CT: 32,           // height of the top rhombus
    CS: 34,           // height of the side faces
    OX: 320, OY: 92,  // top vertex of the apex cube
  };
  GEOM.ROW_DY = GEOM.CT / 2 + GEOM.CS;

  /** Screen position of the top vertex of cube (r, c). */
  function cubeTop(r, c) {
    return { x: GEOM.OX + (c - r / 2) * GEOM.CW, y: GEOM.OY + r * GEOM.ROW_DY };
  }

  /** Point where a character's feet touch the top face of cube (r, c). */
  function cellPos(r, c) {
    const t = cubeTop(r, c);
    return { x: t.x, y: t.y + GEOM.CT / 2 };
  }

  /** Centre of the left (side = -1) or right (side = +1) face of cube (r, c). */
  function facePos(r, c, side) {
    const t = cubeTop(r, c);
    return { x: t.x + side * GEOM.CW / 4, y: t.y + GEOM.CT * 0.75 + GEOM.CS / 2 };
  }

  function onPyramid(r, c) {
    return r >= 0 && r < GEOM.ROWS && c >= 0 && c <= r;
  }

  const sameCell = (a, b) => a.r === b.r && a.c === b.c;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const DIRS = {
    UL: { dr: -1, dc: -1, fx: -1, fy: -1 },
    UR: { dr: -1, dc: 0, fx: 1, fy: -1 },
    DL: { dr: 1, dc: 0, fx: -1, fy: 1 },
    DR: { dr: 1, dc: 1, fx: 1, fy: 1 },
  };

  /* All durations in seconds. */
  const T = {
    QBERT_HOP: 0.3,
    QBERT_REST: 0.03,   // tiny pause after landing
    ENEMY_HOP: 0.32,
    DROP: 0.55,         // enemies dropping in from the sky
    RIDE: 1.6,          // disc ride to the top
    RIDE_DROP: 0.38,    // drop from the disc onto the apex cube
    HATCH: 1.0,         // Coily ball → snake
    FREEZE: 3.5,        // green ball effect
    DIE_HIT: 2.0,
    DIE_FALL: 0.7,
    INTRO_LEVEL: 3.4,
    INTRO_ROUND: 1.6,
    CLEAR: 2.6,
    LURE_GRACE: 1.2,    // Coily keeps heading for the disc this long after the ride
  };
  const GRAVITY = 1500; // px/s² for falling actors

  /* ======================================================================
   * 2. Rules, palettes, difficulty
   * ==================================================================== */

  /** Cube colour rules. `next(step)` returns the step after Q*bert lands. */
  const RULES = {
    single: {
      steps: 1,
      hint: 'Hop on every cube once',
      next: () => 1,
    },
    double: {
      steps: 2,
      hint: 'Every cube needs two hops',
      next: (s) => Math.min(s + 1, 2),
    },
    toggle: {
      steps: 1,
      hint: 'Careful! Finished cubes flip back',
      next: (s) => (s === 1 ? 0 : 1),
    },
    doubleRevert: {
      steps: 2,
      hint: 'Two hops each - finished cubes drop back',
      next: (s) => (s === 2 ? 1 : s + 1),
    },
  };

  /** Top colours per step plus the two side-face shades. */
  const PALETTES = [
    { start: '#2f5fd0', mid: '#d64fc4', target: '#f4e04d', left: '#c9a46c', right: '#6e5738' },
    { start: '#d8d8d8', mid: '#3fbf6f', target: '#2a52cc', left: '#3c9a96', right: '#1f514f' },
    { start: '#c8342a', mid: '#f4e04d', target: '#36c6ec', left: '#a0a0a0', right: '#585858' },
    { start: '#6a3fd0', mid: '#36d88c', target: '#f58a2a', left: '#4a73b4', right: '#243f6e' },
    { start: '#2e9a4c', mid: '#ececec', target: '#e0406e', left: '#b77c3a', right: '#6b4420' },
    { start: '#f4e04d', mid: '#e64a3a', target: '#3a5ce8', left: '#8150b8', right: '#43266c' },
    { start: '#e0406e', mid: '#36c6ec', target: '#7cf04a', left: '#d4b06a', right: '#7a5a2c' },
    { start: '#3a3ad0', mid: '#f58a2a', target: '#ffffff', left: '#c04848', right: '#6a2020' },
  ];

  /** Difficulty and content for a given level / round. */
  function roundConfig(level, round) {
    const n = (level - 1) * 4 + (round - 1); // overall round index, 0-based
    const order = ['single', 'double', 'toggle', 'doubleRevert'];
    const rule = level <= 4 ? order[level - 1] : (level % 2 ? 'toggle' : 'doubleRevert');
    return {
      n,
      rule,
      palette: PALETTES[n % PALETTES.length],
      ballWait: Math.max(0.1, 0.55 - n * 0.025),    // pause between ball hops
      coilyWait: Math.max(0.06, 0.48 - n * 0.025),  // pause between Coily hops
      sideWait: Math.max(0.15, 0.6 - n * 0.025),
      spawnEvery: Math.max(1.3, 3.6 - n * 0.14),
      maxEnemies: Math.min(2 + Math.floor(n / 3), 6), // including Coily
      firstSpawn: 2.2,
      coilyDelay: Math.max(2.5, 6.5 - n * 0.3),
      discs: Math.min(2 + Math.floor((level - 1) / 2), 4),
      allow: { green: n >= 1, greenies: n >= 2, side: n >= 3 },
    };
  }

  function loadHighScore() {
    try {
      return parseInt(localStorage.getItem('qbert.highscore'), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveHighScore(v) {
    try {
      localStorage.setItem('qbert.highscore', String(v));
    } catch (e) { /* storage blocked */ }
  }

  /* ======================================================================
   * 3. Actors
   * ==================================================================== */

  /**
   * Base class: hop movement on the logical grid plus free fall.
   * (r, c) is the cell the actor stands on; it switches to the target when a hop lands.
   * (x, y) is the screen position of the feet, recomputed every update.
   */
  class Actor {
    constructor(r, c) {
      this.r = r; this.c = c;
      this.fr = r; this.fc = c;
      this.tr = r; this.tc = c;
      this.hopping = false;
      this.t = 0;
      this.dur = 0.3;
      this.arc = 20;
      this.x = 0; this.y = 0;
      this.fall = null;
      this.dead = false;
      this.squash = 0;
      this.alpha = 1;
      this.fx = 1; this.fy = 1; // facing
    }

    anchor(r, c) {
      return cellPos(r, c);
    }

    hop(tr, tc, dur, arc) {
      this.fr = this.r; this.fc = this.c;
      this.tr = tr; this.tc = tc;
      this.t = 0;
      this.dur = dur;
      this.arc = arc;
      this.hopping = true;
    }

    /** Advance the current hop; returns true on the frame it lands. */
    stepHop(dt) {
      this.t += dt / this.dur;
      if (this.t < 1) return false;
      this.t = 1;
      this.hopping = false;
      this.r = this.tr; this.c = this.tc;
      this.squash = 1;
      return true;
    }

    /** Cell used for collisions: switches to the target cell halfway through a hop. */
    occupied() {
      return this.hopping && this.t >= 0.5 ? { r: this.tr, c: this.tc } : { r: this.r, c: this.c };
    }

    /** Continue the hop's momentum into a free fall. */
    beginFall(behind) {
      const a = this.anchor(this.fr, this.fc);
      const b = this.anchor(this.tr, this.tc);
      this.fall = {
        x: this.x, y: this.y,
        vx: ((b.x - a.x) / this.dur) * 0.35,
        vy: (b.y - a.y + 4 * this.arc) / this.dur, // derivative of the hop parabola at t = 1
        behind,                                    // fell off an upper edge → behind the pyramid
      };
    }

    /** Returns true once the actor has left the screen. */
    stepFall(dt) {
      const f = this.fall;
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      this.x = f.x; this.y = f.y;
      return f.y > GEOM.H + 80;
    }

    updatePos() {
      if (this.fall) return;
      if (this.hopping) {
        const a = this.anchor(this.fr, this.fc);
        const b = this.anchor(this.tr, this.tc);
        const k = this.t;
        this.x = a.x + (b.x - a.x) * k;
        this.y = a.y + (b.y - a.y) * k - this.arc * 4 * k * (1 - k);
      } else {
        const p = this.anchor(this.r, this.c);
        this.x = p.x; this.y = p.y;
      }
    }

    decaySquash(dt) {
      if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6);
    }
  }

  /* ---------------------------------------------------------------- Q*bert */

  class Qbert extends Actor {
    constructor(r, c) {
      super(r, c);
      this.kind = 'qbert';
      // idle | hop | fall | disc | drop
      this.state = 'idle';
      this.cool = 0;
      this.dropT = 0;
      this.blink = 0; // respawn blink timer (visual only)
      this.updatePos();
    }

    get vulnerable() {
      return this.state === 'idle' || this.state === 'hop';
    }

    tryHop(dirName, g) {
      const d = DIRS[dirName];
      this.fx = d.fx; this.fy = d.fy;
      this.hop(this.r + d.dr, this.c + d.dc, T.QBERT_HOP, d.dr < 0 ? 30 : 18);
      this.state = 'hop';
      g.sound.play('hop');
    }

    update(dt, g) {
      this.decaySquash(dt);
      if (this.blink > 0) this.blink -= dt;
      switch (this.state) {
        case 'idle': {
          this.cool -= dt;
          if (this.cool <= 0) {
            const dir = g.input.consume();
            if (dir) this.tryHop(dir, g);
          }
          break;
        }
        case 'hop':
          if (this.stepHop(dt)) g.qbertLanded();
          break;
        case 'fall':
          if (this.stepFall(dt)) g.qbertGone();
          return;
        case 'disc':
          return; // position is driven by Game.updateRide()
        case 'drop': {
          this.dropT = Math.min(1, this.dropT + dt / T.RIDE_DROP);
          const from = Game.hoverPos();
          const to = cellPos(0, 0);
          const k = this.dropT * this.dropT; // accelerate downwards
          this.x = from.x;
          this.y = from.y + (to.y - from.y) * k;
          if (this.dropT >= 1) {
            this.squash = 1;
            g.qbertLanded();
          }
          return;
        }
        default:
          break;
      }
      this.updatePos();
    }
  }

  /* --------------------------------------------------------------- Enemies */

  class Enemy extends Actor {
    constructor(kind, r, c) {
      super(r, c);
      this.kind = kind;
      this.wait = 0.4;
      this.drop = null;
      this.exiting = false;
    }

    /** Fall in from above onto the current cell. */
    startDrop() {
      this.drop = { t: 0, h: 320 };
      this.updatePos();
      this.y -= this.drop.h;
    }

    collidable() {
      return !this.dead && !this.fall && !this.exiting && this.alpha >= 0.99 &&
        (!this.drop || this.drop.t > 0.85);
    }

    /** Map an actor cell to the Q*bert cell it collides with (identity for top-walkers). */
    mapCell(cell) {
      return cell;
    }

    update(dt, g) {
      this.decaySquash(dt);
      if (this.fall) {
        if (this.stepFall(dt)) this.dead = true;
        return;
      }
      if (this.drop) {
        this.drop.t += dt / T.DROP;
        if (this.drop.t >= 1) {
          this.drop = null;
          this.squash = 1;
          this.landed(g);
        }
      } else if (this.hopping) {
        if (this.stepHop(dt)) this.landed(g);
      } else {
        this.wait -= dt;
        if (this.wait <= 0) this.think(g);
      }
      if (!this.fall) {
        this.updatePos();
        if (this.drop) this.y -= this.drop.h * (1 - this.drop.t) ** 2;
      }
    }

    landed(g) {
      if (!onPyramid(this.r, this.c)) {
        this.beginFall(this.tr < this.fr);
        this.onLeave(g);
        return;
      }
      this.wait = this.waitTime(g);
      this.onLand(g);
    }

    /** Random hop down-left or down-right (balls, Slick & Sam, Coily as a ball). */
    hopDown() {
      const d = Math.random() < 0.5 ? DIRS.DL : DIRS.DR;
      this.fx = d.fx; this.fy = 1;
      this.hop(this.r + d.dr, this.c + d.dc, T.ENEMY_HOP, 16);
    }

    // Hooks for subclasses
    think() { this.hopDown(); }
    waitTime(g) { return g.cfg.ballWait; }
    onLand(g) {}
    onLeave(g) {}
    touch(g) {}
  }

  /** Red (lethal) and green (freeze) balls. */
  class Ball extends Enemy {
    onLand(g) {
      g.sound.play('thud');
    }

    touch(g) {
      if (this.kind === 'green') g.freezeEnemies(this);
      else g.killQbert();
    }
  }

  /** Coily: purple ball until the bottom row, then a snake that chases Q*bert. */
  class Coily extends Enemy {
    constructor(r, c) {
      super('coily', r, c);
      this.phase = 'ball'; // ball | hatch | snake
    }

    think(g) {
      if (this.phase === 'ball') {
        this.hopDown();
      } else if (this.phase === 'hatch') {
        this.phase = 'snake';
        this.wait = 0.15;
      } else {
        this.chase(g);
      }
    }

    /** Greedy pursuit: pick the hop that ends closest (on screen) to the target. */
    chase(g) {
      const lure = g.lure;
      let target = null;
      if (lure) {
        target = cellPos(lure.r, lure.c);
      } else if (g.q.vulnerable) {
        const qc = g.q.occupied();
        if (onPyramid(qc.r, qc.c)) target = cellPos(qc.r, qc.c);
      }
      if (!target) {
        this.wait = 0.2;
        return;
      }
      let best = null;
      let bestD = Infinity;
      for (const key of Object.keys(DIRS)) {
        const d = DIRS[key];
        const nr = this.r + d.dr;
        const nc = this.c + d.dc;
        if (!onPyramid(nr, nc) && !lure) continue; // only a lure makes Coily leave the pyramid
        const p = cellPos(nr, nc);
        const dist = (p.x - target.x) ** 2 + (p.y - target.y) ** 2 + Math.random();
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      this.fx = best.fx; this.fy = best.fy;
      this.hop(this.r + best.dr, this.c + best.dc, T.ENEMY_HOP, best.dr < 0 ? 26 : 16);
    }

    waitTime(g) {
      return this.phase === 'snake' ? g.cfg.coilyWait : g.cfg.ballWait;
    }

    onLand(g) {
      if (this.phase === 'ball' && this.r === GEOM.ROWS - 1) {
        this.phase = 'hatch';
        this.wait = T.HATCH;
        g.sound.play('hatch');
      } else {
        g.sound.play(this.phase === 'snake' ? 'coily' : 'thud');
      }
    }

    onLeave(g) {
      if (this.phase === 'snake') g.coilyLured(this);
    }

    touch(g) {
      g.killQbert();
    }
  }

  /** Slick & Sam: hop down and revert cube colours; Q*bert can catch them. */
  class Greenie extends Enemy {
    waitTime(g) {
      return g.cfg.ballWait * 1.1;
    }

    onLand(g) {
      g.revertCube(this.r, this.c);
    }

    touch(g) {
      g.catchGreenie(this);
    }
  }

  /**
   * Ugg and Wrong-Way walk along the side faces of the cubes.
   * Wrong-Way uses left faces (side = -1) and moves right / up-right,
   * Ugg uses right faces (side = +1) and moves left / up-left.
   * In 3D, standing on the left face of cube (r, c) occupies the same space as standing
   * on top of cube (r+1, c) — that is the cell used for collisions with Q*bert.
   */
  class SideWalker extends Enemy {
    constructor(kind) {
      const side = kind === 'ugg' ? 1 : -1;
      // Start on the face of a virtual cube just outside the bottom corner.
      super(kind, GEOM.ROWS, side > 0 ? GEOM.ROWS : 0);
      this.side = side;
      this.moves = side > 0 ? [{ dr: 0, dc: -1 }, { dr: -1, dc: -1 }] : [{ dr: 0, dc: 1 }, { dr: -1, dc: 0 }];
      this.alpha = 0;
      this.wait = 0.6;
      this.fx = -side;
      this.updatePos();
    }

    anchor(r, c) {
      return facePos(r, c, this.side);
    }

    mapCell(cell) {
      return this.side < 0 ? { r: cell.r + 1, c: cell.c } : { r: cell.r + 1, c: cell.c + 1 };
    }

    updatePos() {
      if (this.hopping) {
        const a = this.anchor(this.fr, this.fc);
        const b = this.anchor(this.tr, this.tc);
        const k = this.t;
        const bump = 4 * k * (1 - k);
        this.x = a.x + (b.x - a.x) * k + this.side * this.arc * bump; // jump away from the face
        this.y = a.y + (b.y - a.y) * k - 6 * bump;
      } else {
        super.updatePos();
      }
    }

    update(dt, g) {
      if (this.exiting) this.alpha = Math.max(0, 1 - this.t);
      else if (this.alpha < 1) this.alpha = Math.min(1, this.alpha + dt * 2.5);
      super.update(dt, g);
    }

    think(g) {
      const m = pick(this.moves);
      const nr = this.r + m.dr;
      const nc = this.c + m.dc;
      this.exiting = !onPyramid(nr, nc); // walking off the pyramid: fade out
      this.hop(nr, nc, T.ENEMY_HOP, 14);
      if (!this.exiting) g.sound.play('side');
    }

    landed(g) {
      if (this.exiting) {
        this.dead = true;
        return;
      }
      this.wait = g.cfg.sideWait;
    }

    touch(g) {
      g.killQbert();
    }
  }

  /* ======================================================================
   * 4. Game
   * ==================================================================== */

  class Game {
    /**
     * @param {QB.Sound} sound
     * @param {{consume: function(): (string|null), clear: function()}} input
     */
    constructor(sound, input) {
      this.sound = sound;
      this.input = input;
      this.highScore = loadHighScore();
      this.t = 0;
      this.paused = false;
      this.particles = [];
      this.popups = [];
      this.resetStats();
      this.prepareRound();
      // title | intro | play | dying | roundClear | gameover
      this.state = 'title';
    }

    static hoverPos() {
      const p = cellPos(0, 0);
      return { x: p.x, y: p.y - 64 };
    }

    resetStats() {
      this.score = 0;
      this.lives = 3;
      this.level = 1;
      this.round = 1;
      this.nextLife = 8000;
    }

    newGame() {
      this.resetStats();
      this.startHigh = this.highScore;
      this.paused = false;
      this.particles = [];
      this.popups = [];
      this.prepareRound();
      this.enterIntro();
      this.sound.play('start');
    }

    /** Build the pyramid, discs and actors for the current level / round. */
    prepareRound() {
      this.cfg = roundConfig(this.level, this.round);
      this.rule = RULES[this.cfg.rule];
      this.cubes = [];
      for (let r = 0; r < GEOM.ROWS; r++) {
        this.cubes.push(Array.from({ length: r + 1 }, () => ({ step: 0, flash: 0 })));
      }
      this.discs = this.makeDiscs(this.cfg.discs);
      this.enemies = [];
      this.q = new Qbert(0, 0);
      this.spawnT = this.cfg.firstSpawn;
      this.coilyT = this.cfg.coilyDelay;
      this.freezeT = 0;
      this.lure = null;
      this.lureT = 0;
      this.ride = null;
    }

    /** Discs sit beside the pyramid; alternate sides, distinct rows per side. */
    makeDiscs(count) {
      const discs = [];
      const rows = { '-1': [1, 2, 3, 4, 5], 1: [1, 2, 3, 4, 5] };
      for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const pool = rows[side];
        const row = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        // left disc is reached by UL from (row+1, 0); right disc by UR from (row+1, row+1)
        const c = side < 0 ? -1 : row + 1;
        const p = cellPos(row, c);
        discs.push({ r: row, c, side, x: p.x, y: p.y });
      }
      return discs;
    }

    enterIntro() {
      this.state = 'intro';
      this.introLevel = this.round === 1;
      this.stateT = this.introLevel ? T.INTRO_LEVEL : T.INTRO_ROUND;
      this.stateDur = this.stateT;
      this.input.clear();
    }

    skipIntro() {
      if (this.state === 'intro' && this.stateDur - this.stateT > 0.4) this.stateT = 0;
    }

    togglePause() {
      if (this.state === 'title' || this.state === 'gameover') return;
      this.paused = !this.paused;
      this.input.clear();
    }

    /** Colour for a cube step under the current rule. */
    colorFor(step) {
      const p = this.cfg.palette;
      if (step >= this.rule.steps) return p.target;
      return step === 0 ? p.start : p.mid;
    }

    /* ------------------------------------------------------------ update */

    update(dt) {
      if (this.paused) return;
      this.t += dt;
      this.updateEffects(dt);
      switch (this.state) {
        case 'intro':
          if ((this.stateT -= dt) <= 0) this.state = 'play';
          break;
        case 'play':
          this.updatePlay(dt);
          break;
        case 'dying':
          if ((this.stateT -= dt) <= 0) this.loseLife();
          break;
        case 'roundClear':
          if ((this.stateT -= dt) <= 0) this.nextRound();
          break;
        default:
          break;
      }
    }

    updatePlay(dt) {
      const q = this.q;
      q.update(dt, this);
      if (this.state !== 'play') return; // round finished or Q*bert gone

      if (this.ride) this.updateRide(dt);
      if (this.lure && q.state !== 'disc' && q.state !== 'drop') {
        this.lureT -= dt;
        if (this.lureT <= 0) this.lure = null;
      }

      if (this.freezeT > 0) {
        this.freezeT -= dt;
      } else {
        this.updateSpawner(dt);
        for (const e of this.enemies) e.update(dt, this);
      }
      this.enemies = this.enemies.filter((e) => !e.dead);
      this.checkCollisions();
    }

    updateEffects(dt) {
      for (const row of this.cubes) {
        for (const cube of row) if (cube.flash > 0) cube.flash = Math.max(0, cube.flash - dt * 3);
      }
      for (const p of this.particles) {
        p.life -= dt;
        p.vy += 420 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const p of this.popups) {
        p.t += dt;
        p.y -= 28 * dt;
      }
      this.popups = this.popups.filter((p) => p.t < p.dur);
    }

    /* ---------------------------------------------------------- spawning */

    updateSpawner(dt) {
      if (!this.enemies.some((e) => e.kind === 'coily')) {
        this.coilyT -= dt;
        if (this.coilyT <= 0) this.spawn('coily');
      }
      this.spawnT -= dt;
      if (this.spawnT > 0) return;
      this.spawnT = this.cfg.spawnEvery * rand(0.75, 1.25);
      const others = this.enemies.filter((e) => e.kind !== 'coily').length;
      if (others >= this.cfg.maxEnemies - 1) return;
      const kind = this.pickKind();
      if (kind) this.spawn(kind);
    }

    /** Weighted choice among enabled enemy types; special enemies appear once at a time. */
    pickKind() {
      const a = this.cfg.allow;
      const present = (k) => this.enemies.some((e) => e.kind === k);
      const table = [['red', 5]];
      if (a.green && !present('green')) table.push(['green', 1.2]);
      if (a.greenies && !present('slick')) table.push(['slick', 1]);
      if (a.greenies && !present('sam')) table.push(['sam', 1]);
      if (a.side && !present('ugg')) table.push(['ugg', 1.1]);
      if (a.side && !present('wrongway')) table.push(['wrongway', 1.1]);
      let total = 0;
      for (const [, w] of table) total += w;
      let roll = Math.random() * total;
      for (const [k, w] of table) {
        roll -= w;
        if (roll <= 0) return k;
      }
      return 'red';
    }

    spawn(kind) {
      let e;
      if (kind === 'ugg' || kind === 'wrongway') {
        e = new SideWalker(kind);
      } else {
        // Drop onto the second row, never directly onto Q*bert.
        const qc = this.q.occupied();
        const cells = [{ r: 1, c: 0 }, { r: 1, c: 1 }].filter((cell) => !sameCell(cell, qc));
        const cell = pick(cells);
        if (kind === 'coily') e = new Coily(cell.r, cell.c);
        else if (kind === 'slick' || kind === 'sam') e = new Greenie(kind, cell.r, cell.c);
        else e = new Ball(kind, cell.r, cell.c);
        e.startDrop();
      }
      this.enemies.push(e);
    }

    /* -------------------------------------------------------- Q*bert events */

    qbertLanded() {
      const q = this.q;
      if (onPyramid(q.r, q.c)) {
        q.state = 'idle';
        q.cool = T.QBERT_REST;
        this.hitCube(q.r, q.c);
        return;
      }
      const disc = this.discs.find((d) => d.r === q.r && d.c === q.c);
      if (disc) {
        this.boardDisc(disc);
        return;
      }
      q.state = 'fall';
      q.beginFall(q.tr < q.fr);
      this.input.clear();
      this.sound.play('fall');
    }

    hitCube(r, c) {
      const cube = this.cubes[r][c];
      const before = cube.step;
      const after = this.rule.next(before);
      if (after !== before) {
        cube.step = after;
        cube.flash = 1;
        const p = cellPos(r, c);
        this.burst(p.x, p.y, this.colorFor(after), 12);
        if (after > before) this.addScore(25);
        this.sound.play('change');
      }
      if (this.isComplete()) this.roundComplete();
    }

    revertCube(r, c) {
      const cube = this.cubes[r][c];
      if (cube.step === 0) return;
      cube.step -= 1;
      cube.flash = 0.7;
      const p = cellPos(r, c);
      this.burst(p.x, p.y, this.colorFor(cube.step), 6);
      this.sound.play('revert');
    }

    isComplete() {
      return this.cubes.every((row) => row.every((cube) => cube.step === this.rule.steps));
    }

    boardDisc(disc) {
      const q = this.q;
      q.state = 'disc';
      this.ride = { disc, t: 0, from: { x: disc.x, y: disc.y } };
      this.lure = { r: disc.r, c: disc.c };
      this.lureT = T.LURE_GRACE;
      this.input.clear();
      this.sound.play('disc');
    }

    updateRide(dt) {
      const ride = this.ride;
      ride.t = Math.min(1, ride.t + dt / T.RIDE);
      const k = ride.t < 0.5 ? 2 * ride.t * ride.t : 1 - (-2 * ride.t + 2) ** 2 / 2; // ease in-out
      const to = Game.hoverPos();
      ride.disc.x = ride.from.x + (to.x - ride.from.x) * k;
      ride.disc.y = ride.from.y + (to.y - ride.from.y) * k + Math.sin(ride.t * Math.PI) * -30;
      this.q.x = ride.disc.x;
      this.q.y = ride.disc.y;
      if (ride.t < 1) return;

      // Arrived at the top: disc disappears, Q*bert drops onto the apex cube.
      this.discs = this.discs.filter((d) => d !== ride.disc);
      this.ride = null;
      const q = this.q;
      q.r = q.c = q.fr = q.fc = q.tr = q.tc = 0;
      q.hopping = false;
      q.state = 'drop';
      q.dropT = 0;
      q.fx = 1; q.fy = 1;
      // every enemy except Coily vanishes
      for (const e of this.enemies) {
        if (e.kind !== 'coily' && !e.fall) {
          this.burst(e.x, e.y - 10, '#ffffff', 8);
          e.dead = true;
        }
      }
    }

    checkCollisions() {
      const q = this.q;
      if (!q.vulnerable) return;
      const qc = q.occupied();
      if (!onPyramid(qc.r, qc.c)) return;
      for (const e of this.enemies) {
        if (!e.collidable()) continue;
        const ec = e.mapCell(e.occupied());
        let hit = sameCell(ec, qc);
        if (!hit && q.hopping && e.hopping) {
          // head-on swap in the middle of both hops
          const ef = e.mapCell({ r: e.fr, c: e.fc });
          const et = e.mapCell({ r: e.tr, c: e.tc });
          hit = ef.r === q.tr && ef.c === q.tc && et.r === q.fr && et.c === q.fc;
        }
        if (hit) {
          e.touch(this);
          if (this.state !== 'play') return;
        }
      }
    }

    killQbert() {
      if (this.state !== 'play') return;
      this.state = 'dying';
      this.dyingReason = 'hit';
      this.stateT = T.DIE_HIT;
      this.input.clear();
      this.sound.play('curse');
    }

    qbertGone() {
      this.state = 'dying';
      this.dyingReason = 'fall';
      this.stateT = T.DIE_FALL;
    }

    loseLife() {
      this.lives -= 1;
      if (this.lives <= 0) {
        this.gameOver();
        return;
      }
      // Respawn: after a hit on the current cube, after a fall on the cube he jumped from.
      const q = this.q;
      let cell = this.dyingReason === 'hit' ? q.occupied() : { r: q.fr, c: q.fc };
      if (!onPyramid(cell.r, cell.c)) cell = { r: q.fr, c: q.fc };
      this.q = new Qbert(cell.r, cell.c);
      this.q.blink = 1.0;
      this.enemies = [];
      this.spawnT = 2.0;
      this.coilyT = this.cfg.coilyDelay;
      this.freezeT = 0;
      this.lure = null;
      this.ride = null;
      this.state = 'play';
    }

    gameOver() {
      this.state = 'gameover';
      this.newHigh = this.score > (this.startHigh || 0);
      saveHighScore(this.highScore);
      this.sound.play('gameover');
    }

    freezeEnemies(ball) {
      ball.dead = true;
      this.freezeT = T.FREEZE;
      this.addScore(100, ball.x, ball.y - 20);
      this.sound.play('freeze');
    }

    catchGreenie(e) {
      e.dead = true;
      this.burst(e.x, e.y - 10, '#7cf04a', 10);
      this.addScore(300, e.x, e.y - 20);
      this.sound.play('catch');
    }

    coilyLured(e) {
      this.lure = null;
      this.coilyT = this.cfg.coilyDelay + 1;
      this.addScore(500, e.x, e.y - 30);
      this.sound.play('coilyFall');
    }

    /* ---------------------------------------------------- round handling */

    roundComplete() {
      this.state = 'roundClear';
      this.stateT = T.CLEAR;
      for (const e of this.enemies) this.burst(e.x, e.y - 10, '#ffffff', 8);
      this.enemies = [];
      const roundBonus = Math.min(1000 + 250 * this.cfg.n, 5000);
      const discBonus = this.discs.length * 50;
      this.clearBonus = roundBonus + discBonus;
      this.addScore(this.clearBonus);
      saveHighScore(this.highScore);
      this.input.clear();
      this.sound.play('clear');
    }

    nextRound() {
      this.round += 1;
      if (this.round > 4) {
        this.round = 1;
        this.level += 1;
      }
      this.prepareRound();
      this.enterIntro();
    }

    /* ---------------------------------------------------------- scoring/fx */

    addScore(points, x, y) {
      this.score += points;
      if (x !== undefined) {
        this.popups.push({ x, y, text: String(points), color: '#ffffff', t: 0, dur: 1.1 });
      }
      while (this.score >= this.nextLife) {
        this.lives += 1;
        this.nextLife += 14000;
        this.popups.push({ x: 80, y: 90, text: '1UP!', color: '#7cf04a', t: 0, dur: 1.6 });
        this.sound.play('extra');
      }
      if (this.score > this.highScore) this.highScore = this.score;
    }

    burst(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(Math.PI * 1.05, Math.PI * 1.95); // upward fan
        const v = rand(50, 150);
        const life = rand(0.35, 0.75);
        this.particles.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: rand(2, 4),
        });
      }
    }
  }

  /* Public API */
  Object.assign(QB, {
    GEOM, DIRS, RULES, PALETTES, T,
    cubeTop, cellPos, facePos, onPyramid, roundConfig,
    Game,
  });
})();
