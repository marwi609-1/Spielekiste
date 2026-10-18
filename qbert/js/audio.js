/*
 * audio.js — tiny WebAudio synthesizer for retro sound effects.
 * Every sound is generated from oscillators / noise, so no audio files are needed.
 */
(function () {
  'use strict';

  const QB = (window.QB = window.QB || {});
  const STORAGE_KEY = 'qbert.muted';

  class Sound {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      try {
        this.muted = localStorage.getItem(STORAGE_KEY) === '1';
      } catch (e) { /* storage blocked – keep default */ }
    }

    /** Create / resume the AudioContext. Must run inside a user gesture (autoplay policy). */
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.22;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
      try {
        localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
      } catch (e) { /* ignore */ }
      return this.muted;
    }

    /** One oscillator note with exponential decay and optional pitch slide. */
    tone(freq, dur, { type = 'square', vol = 0.5, slide = 0, delay = 0 } = {}) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    /** Short burst of white noise (used for thumps and the hatching crackle). */
    noise(dur, { vol = 0.3, delay = 0, freq = 800 } = {}) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0);
    }

    /** Play a named sound effect. */
    play(name) {
      if (!this.ctx || this.muted) return;
      switch (name) {
        case 'hop':
          this.tone(560, 0.08, { slide: 260, vol: 0.28 });
          break;
        case 'change':
          this.tone(1046, 0.07, { type: 'triangle', vol: 0.3, delay: 0.03 });
          break;
        case 'thud':
          this.tone(150, 0.09, { type: 'triangle', slide: 60, vol: 0.45 });
          break;
        case 'coily':
          this.tone(230, 0.07, { type: 'sawtooth', slide: 110, vol: 0.18 });
          break;
        case 'hatch':
          this.noise(0.25, { vol: 0.35, freq: 1500 });
          this.tone(220, 0.35, { type: 'sawtooth', slide: 660, vol: 0.2, delay: 0.1 });
          break;
        case 'side':
          this.tone(330, 0.06, { type: 'square', slide: 200, vol: 0.12 });
          break;
        case 'revert':
          this.tone(420, 0.12, { type: 'triangle', slide: 180, vol: 0.35 });
          break;
        case 'curse':
          // Q*bert's famous synthesized gibberish
          for (let i = 0; i < 10; i++) {
            const f = 180 + Math.random() * 700;
            this.tone(f, 0.075, { type: 'square', vol: 0.3, delay: i * 0.075, slide: f * (0.6 + Math.random() * 0.8) });
          }
          break;
        case 'fall':
          this.tone(1100, 1.1, { type: 'triangle', slide: 90, vol: 0.4 });
          break;
        case 'coilyFall':
          this.tone(800, 1.0, { type: 'sawtooth', slide: 70, vol: 0.25 });
          break;
        case 'disc':
          for (let i = 0; i < 12; i++) {
            this.tone(400 + i * 70, 0.1, { type: 'triangle', vol: 0.25, delay: i * 0.11 });
          }
          break;
        case 'freeze':
          for (let i = 0; i < 6; i++) {
            this.tone(1400 + Math.random() * 900, 0.12, { type: 'sine', vol: 0.3, delay: i * 0.06 });
          }
          break;
        case 'catch':
          this.tone(660, 0.08, { vol: 0.3 });
          this.tone(990, 0.12, { vol: 0.3, delay: 0.08 });
          break;
        case 'clear':
          [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
            this.tone(f, 0.16, { type: 'square', vol: 0.25, delay: i * 0.12 }));
          break;
        case 'extra':
          [784, 988, 1175, 1568].forEach((f, i) =>
            this.tone(f, 0.12, { type: 'triangle', vol: 0.35, delay: i * 0.09 }));
          break;
        case 'start':
          [392, 523, 659, 784, 659, 784].forEach((f, i) =>
            this.tone(f, 0.14, { type: 'square', vol: 0.22, delay: i * 0.11 }));
          break;
        case 'gameover':
          [523, 440, 349, 262, 196].forEach((f, i) =>
            this.tone(f, 0.3, { type: 'square', vol: 0.25, delay: i * 0.25 }));
          break;
        default:
          break;
      }
    }
  }

  QB.Sound = Sound;
})();
