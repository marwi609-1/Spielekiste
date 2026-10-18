/*
 * main.js — browser glue: canvas sizing, keyboard/pointer input, fixed-timestep loop,
 * DOM overlays (title, pause, game over).
 */
(function () {
  'use strict';

  const QB = window.QB;
  const { GEOM } = QB;
  const STEP = 1 / 120; // fixed simulation step → identical speed on every refresh rate

  /* --------------------------------------------------------------- input */

  /** Physical key positions (KeyboardEvent.code), so QWERTZ/AZERTY work too. */
  const KEYMAP = {
    ArrowUp: 'UR', KeyW: 'UR', KeyE: 'UR', Numpad9: 'UR',
    ArrowLeft: 'UL', KeyA: 'UL', KeyQ: 'UL', Numpad7: 'UL',
    ArrowDown: 'DL', KeyS: 'DL', KeyZ: 'DL', Numpad1: 'DL',
    ArrowRight: 'DR', KeyD: 'DR', KeyC: 'DR', Numpad3: 'DR',
  };

  /**
   * Holds pressed directions. A fresh press is buffered briefly so that a key tapped
   * during a hop is executed on landing; a held key keeps Q*bert hopping.
   */
  class Input {
    constructor() {
      this.held = new Map(); // dir → press timestamp
      this.buffer = null;
      this.bufferTime = 0;
    }

    press(dir) {
      this.held.set(dir, performance.now());
      this.buffer = dir;
      this.bufferTime = performance.now();
    }

    release(dir) {
      this.held.delete(dir);
    }

    consume() {
      if (this.buffer && performance.now() - this.bufferTime < 350) {
        const d = this.buffer;
        this.buffer = null;
        return d;
      }
      this.buffer = null;
      let best = null;
      let bestT = -1;
      for (const [d, t] of this.held) {
        if (t > bestT) {
          best = d;
          bestT = t;
        }
      }
      return best;
    }

    clear() {
      this.held.clear();
      this.buffer = null;
    }
  }

  /* ---------------------------------------------------------------- setup */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const footer = document.querySelector('footer');
  const screens = {
    title: document.getElementById('title-screen'),
    pause: document.getElementById('pause-screen'),
    gameover: document.getElementById('gameover-screen'),
  };
  const muteBtn = document.getElementById('btn-mute');

  const sound = new QB.Sound();
  const input = new Input();
  const game = new QB.Game(sound, input);
  const renderer = new QB.Renderer(ctx);
  QB.instance = game; // handy for debugging in the console

  /** Fit the stage into the window, keep the aspect ratio, render at device resolution. */
  function resize() {
    const availW = window.innerWidth - 16;
    const availH = window.innerHeight - footer.offsetHeight - 24;
    const scale = Math.max(0.3, Math.min(availW / GEOM.W, availH / GEOM.H));
    const cssW = Math.floor(GEOM.W * scale);
    const cssH = Math.floor(GEOM.H * scale);
    const dpr = window.devicePixelRatio || 1;
    stage.style.width = `${cssW}px`;
    stage.style.height = `${cssH}px`;
    stage.style.setProperty('--u', `${cssW / GEOM.W}px`);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    renderer.setScale(canvas.width / GEOM.W);
  }

  function startGame() {
    sound.unlock();
    input.clear();
    game.newGame();
  }

  function updateMuteButton() {
    muteBtn.textContent = sound.muted ? 'Sound: off (M)' : 'Sound: on (M)';
  }

  /* -------------------------------------------------------------- events */

  window.addEventListener('keydown', (e) => {
    sound.unlock();
    const dir = KEYMAP[e.code];
    if (dir) {
      e.preventDefault();
      if (e.repeat) return;
      if (game.paused) return;
      if (game.state === 'intro') game.skipIntro();
      else if (game.state === 'play') input.press(dir);
      return;
    }
    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        // Buttons handle Enter/Space themselves when focused.
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
        e.preventDefault();
        if (game.state === 'title' || game.state === 'gameover') startGame();
        else if (game.paused) game.togglePause();
        break;
      case 'KeyP':
      case 'Escape':
        game.togglePause();
        break;
      case 'KeyM':
        sound.toggleMute();
        updateMuteButton();
        break;
      default:
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    const dir = KEYMAP[e.code];
    if (dir) input.release(dir);
  });

  // Touch / mouse: tap the quadrant around Q*bert to hop that way.
  canvas.addEventListener('pointerdown', (e) => {
    sound.unlock();
    if (game.state === 'intro') {
      game.skipIntro();
      return;
    }
    if (game.state !== 'play' || game.paused) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * GEOM.W;
    const y = ((e.clientY - rect.top) / rect.height) * GEOM.H;
    const dx = x - game.q.x;
    const dy = y - (game.q.y - 16);
    const dir = dy < 0 ? (dx < 0 ? 'UL' : 'UR') : (dx < 0 ? 'DL' : 'DR');
    input.press(dir);
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.dir = dir;
  });
  const pointerUp = () => {
    if (canvas.dataset.dir) input.release(canvas.dataset.dir);
    delete canvas.dataset.dir;
  };
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  // Auto-pause when the player leaves the tab/window.
  const autoPause = () => {
    input.clear();
    if (!game.paused && game.state !== 'title' && game.state !== 'gameover') game.togglePause();
  };
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autoPause();
  });

  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart').addEventListener('click', startGame);
  document.getElementById('btn-resume').addEventListener('click', () => game.togglePause());
  muteBtn.addEventListener('click', () => {
    sound.unlock();
    sound.toggleMute();
    updateMuteButton();
    muteBtn.blur();
  });
  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------ overlays */

  let shown = null;
  function syncOverlays() {
    let key = '';
    if (game.state === 'title') key = 'title';
    else if (game.state === 'gameover') key = 'gameover';
    else if (game.paused) key = 'pause';
    if (key === shown) return;
    shown = key;
    for (const [name, el] of Object.entries(screens)) el.classList.toggle('hidden', name !== key);
    if (key === 'gameover') {
      document.getElementById('final-score').textContent = String(game.score);
      document.getElementById('final-high').textContent = String(game.highScore);
      document.getElementById('final-level').textContent = `Level ${game.level} / Round ${game.round}`;
      document.getElementById('new-high').classList.toggle('hidden', !game.newHigh);
      document.getElementById('btn-restart').focus();
    } else if (key === 'title') {
      document.getElementById('btn-start').focus();
    } else if (key === 'pause') {
      document.getElementById('btn-resume').focus();
    } else if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }

  /* ---------------------------------------------------------------- loop */

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); // clamp after tab switches / hiccups
    last = now;
    if (!game.paused) {
      acc += dt;
      while (acc >= STEP) {
        game.update(STEP);
        acc -= STEP;
      }
    } else {
      acc = 0;
    }
    renderer.draw(game);
    syncOverlays();
    requestAnimationFrame(frame);
  }

  updateMuteButton();
  resize();
  requestAnimationFrame(frame);
})();
