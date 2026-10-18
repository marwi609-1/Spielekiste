/*
 * render.js — all Canvas drawing. Reads the game state, never changes it.
 * Characters are drawn with vector paths; (x, y) is always the point where the feet are.
 */
(function () {
  'use strict';

  const QB = window.QB;
  const { GEOM, cubeTop, cellPos } = QB;
  const FONT = '"Courier New", Courier, monospace';

  const C = {
    bg: '#000000',
    orange: '#f7931e', orangeLight: '#ffc46b', orangeDark: '#b4500e', shoe: '#d2491a', hole: '#3d1503',
    purple: '#9b30d0', purpleLight: '#dc96ff', purpleDark: '#4b0d6b',
    red: '#e8202a', redLight: '#ff9a8a', redDark: '#7a0a10',
    green: '#2fd64a', greenLight: '#b8ffb0', greenDark: '#0d6a1c',
    hud: '#f7931e', hudText: '#ffffff',
  };

  /* ---------------------------------------------------------- path helpers */

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  function ellipse(ctx, x, y, rx, ry, rot = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  }

  function shadeSphere(ctx, x, y, r, light, base, dark) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, light);
    g.addColorStop(0.45, base);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    circle(ctx, x, y, r);
    ctx.fill();
  }

  /** Isometric cube with its top vertex at (x, y); `k` scales the cube. */
  function drawCube(ctx, x, y, top, left, right, flash = 0, k = 1) {
    const hw = (GEOM.CW / 2) * k;
    const ct = GEOM.CT * k;
    const cs = GEOM.CS * k;
    const ht = ct / 2;

    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';

    // left face
    ctx.beginPath();
    ctx.moveTo(x - hw, y + ht);
    ctx.lineTo(x, y + ct);
    ctx.lineTo(x, y + ct + cs);
    ctx.lineTo(x - hw, y + ht + cs);
    ctx.closePath();
    ctx.fillStyle = left;
    ctx.fill();
    ctx.stroke();

    // right face
    ctx.beginPath();
    ctx.moveTo(x + hw, y + ht);
    ctx.lineTo(x, y + ct);
    ctx.lineTo(x, y + ct + cs);
    ctx.lineTo(x + hw, y + ht + cs);
    ctx.closePath();
    ctx.fillStyle = right;
    ctx.fill();
    ctx.stroke();

    // top face
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + hw, y + ht);
    ctx.lineTo(x, y + ct);
    ctx.lineTo(x - hw, y + ht);
    ctx.closePath();
    ctx.fillStyle = top;
    ctx.fill();
    ctx.stroke();

    // inner bevel for the arcade look
    ctx.beginPath();
    ctx.moveTo(x, y + 3 * k);
    ctx.lineTo(x + hw - 6 * k, y + ht);
    ctx.lineTo(x, y + ct - 3 * k);
    ctx.lineTo(x - hw + 6 * k, y + ht);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();

    if (flash > 0) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + hw, y + ht);
      ctx.lineTo(x, y + ct);
      ctx.lineTo(x - hw, y + ht);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,255,255,${(flash * 0.85).toFixed(3)})`;
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------- sprites */

  /** Q*bert's tubular snout from (x1,y1) to the opening at (x2,y2). */
  function drawSnout(ctx, x1, y1, x2, y2) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.orangeDark;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = C.orange;
    ctx.lineWidth = 7.5;
    ctx.stroke();
    // opening at the tip
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ellipse(ctx, x2, y2, 3.2, 4.8, ang);
    ctx.fillStyle = C.orangeDark;
    ctx.fill();
    ellipse(ctx, x2 + Math.cos(ang) * 0.6, y2 + Math.sin(ang) * 0.6, 2, 3.4, ang);
    ctx.fillStyle = C.hole;
    ctx.fill();
  }

  /** Q*bert facing (fx, fy): fx ±1 = right/left, fy +1 = towards the viewer, -1 = away. */
  function drawQbert(ctx, x, y, fx, fy, squash = 0) {
    const back = fy < 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(fx * (1 + squash * 0.2), 1 - squash * 0.2);

    // shoes and legs
    ctx.strokeStyle = C.orangeDark;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -9); ctx.lineTo(-5, -3);
    ctx.moveTo(5, -9); ctx.lineTo(5, -3);
    ctx.stroke();
    ctx.fillStyle = C.shoe;
    ellipse(ctx, -3, -2.5, 6, 3.2);
    ctx.fill();
    ellipse(ctx, 7, -2.5, 6, 3.2);
    ctx.fill();

    if (back) drawSnout(ctx, 4, -22, 15, -31); // behind the body

    shadeSphere(ctx, 0, -18, 12.5, C.orangeLight, C.orange, C.orangeDark);

    if (back) {
      // eye tops peeking over the head
      ctx.fillStyle = '#fff';
      ellipse(ctx, 0, -29, 3.6, 2.6);
      ctx.fill();
      ellipse(ctx, 7, -28, 3.4, 2.4);
      ctx.fill();
    } else {
      // big eyes
      for (const [ex, ey] of [[0, -23], [8, -22]]) {
        ellipse(ctx, ex, ey, 4.6, 5.8);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        circle(ctx, ex + 1.8, ey + 1.2, 2.2);
        ctx.fillStyle = '#000';
        ctx.fill();
      }
      drawSnout(ctx, 6, -14, 18, -6);
    }
    ctx.restore();
  }

  function drawBall(ctx, x, y, colors, squash = 0, radius = 9) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + squash * 0.3, 1 - squash * 0.3);
    shadeSphere(ctx, 0, -radius, radius, colors[0], colors[1], colors[2]);
    ctx.restore();
  }

  function drawCoily(ctx, x, y, fx, fy, t) {
    const back = fy < 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(fx, 1);
    const sway = Math.sin(t * 8) * 1.2;

    // tail
    ctx.strokeStyle = C.purpleDark;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, -3);
    ctx.quadraticCurveTo(-15, -2, -13, -9);
    ctx.stroke();

    // coils from bottom to top
    const coils = [[0, -5, 10, 5.5], [-2 + sway, -13, 9, 5], [1 - sway, -21, 8, 4.6], [3 + sway, -28, 6, 4]];
    for (const [cx, cy, rx, ry] of coils) {
      ellipse(ctx, cx, cy, rx, ry);
      ctx.fillStyle = C.purple;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.purpleDark;
      ctx.stroke();
      ellipse(ctx, cx - rx * 0.3, cy - ry * 0.35, rx * 0.45, ry * 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill();
    }

    // head
    shadeSphere(ctx, 5 + sway, -37, 9, C.purpleLight, C.purple, C.purpleDark);
    if (!back) {
      ctx.fillStyle = C.hole;
      ellipse(ctx, 11 + sway, -31, 4, 2.4);
      ctx.fill();
      for (const [ex, ey] of [[5, -40], [11, -39]]) {
        ellipse(ctx, ex + sway, ey, 3.4, 4);
        ctx.fillStyle = '#fff';
        ctx.fill();
        circle(ctx, ex + sway + 1.2, ey + 0.8, 1.7);
        ctx.fillStyle = '#000';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Slick (sunglasses) and Sam. */
  function drawGreenie(ctx, x, y, fx, kind, squash) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(fx * (1 + squash * 0.2), 1 - squash * 0.2);
    ctx.fillStyle = '#ffffff';
    ellipse(ctx, -4, -2, 4.5, 2.4);
    ctx.fill();
    ellipse(ctx, 5, -2, 4.5, 2.4);
    ctx.fill();
    shadeSphere(ctx, 0, -12, 9, C.greenLight, C.green, C.greenDark);
    if (kind === 'slick') {
      ctx.fillStyle = '#000';
      ctx.fillRect(-3, -17, 13, 4);
      ctx.fillRect(-6, -16, 3, 1.5);
    } else {
      for (const ex of [1, 7]) {
        ellipse(ctx, ex, -15, 2.6, 3.2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        circle(ctx, ex + 1, -14.5, 1.3);
        ctx.fillStyle = '#000';
        ctx.fill();
      }
    }
    ctx.fillStyle = C.greenDark;
    ellipse(ctx, 9, -9, 3, 2.2);
    ctx.fill();
    ctx.restore();
  }

  /** Ugg / Wrong-Way, rotated so their feet stick to the side face. */
  function drawSideWalker(ctx, x, y, side, kind) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(side < 0 ? -Math.PI / 2 : Math.PI / 2);
    const ugg = kind === 'ugg';
    const base = ugg ? '#b03cd0' : '#6a4cff';
    const light = ugg ? '#f0a8ff' : '#c4b8ff';
    const dark = ugg ? '#4e0f6b' : '#241070';

    ctx.fillStyle = dark;
    ellipse(ctx, -5, -2, 4.5, 2.6);
    ctx.fill();
    ellipse(ctx, 5, -2, 4.5, 2.6);
    ctx.fill();
    shadeSphere(ctx, 0, -13, 11, light, base, dark);

    if (ugg) {
      // snout and fangs
      ellipse(ctx, 0, -10, 6, 4);
      ctx.fillStyle = '#e070ff';
      ctx.fill();
      ctx.fillStyle = '#000';
      circle(ctx, -2, -10, 1.2); ctx.fill();
      circle(ctx, 2, -10, 1.2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(-5, -6); ctx.lineTo(-3, -2); ctx.lineTo(-1.5, -6);
      ctx.moveTo(5, -6); ctx.lineTo(3, -2); ctx.lineTo(1.5, -6);
      ctx.fill();
      for (const ex of [-4, 4]) {
        circle(ctx, ex, -18, 2.6);
        ctx.fillStyle = '#ffeb3b';
        ctx.fill();
        circle(ctx, ex, -18, 1.2);
        ctx.fillStyle = '#000';
        ctx.fill();
      }
    } else {
      // Wrong-Way: huge eyes and a red nose
      for (const ex of [-4.5, 4.5]) {
        ellipse(ctx, ex, -17, 4, 5);
        ctx.fillStyle = '#fff';
        ctx.fill();
        circle(ctx, ex, -15.5, 2);
        ctx.fillStyle = '#000';
        ctx.fill();
      }
      circle(ctx, 0, -9, 3.2);
      ctx.fillStyle = '#ff3b3b';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDisc(ctx, x, y, t) {
    const hue = (t * 240) % 360;
    ctx.save();
    ctx.translate(x, y + 3);
    ellipse(ctx, 0, 0, 17, 6.5);
    ctx.fillStyle = `hsl(${hue},95%,55%)`;
    ctx.fill();
    ellipse(ctx, 0, 0, 11, 4);
    ctx.fillStyle = `hsl(${(hue + 120) % 360},95%,60%)`;
    ctx.fill();
    ellipse(ctx, 0, 0, 5, 2);
    ctx.fillStyle = `hsl(${(hue + 240) % 360},95%,65%)`;
    ctx.fill();
    ctx.restore();
  }

  /** "@!#?@!" speech balloon next to Q*bert. */
  function drawBalloon(ctx, qx, qy) {
    const left = qx > 150;
    const w = 86;
    const h = 30;
    const bx = left ? qx - w - 8 : qx + 8;
    const by = qy - 82;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    const tx = left ? bx + w - 22 : bx + 22;
    ctx.moveTo(tx - 7, by + h - 1);
    ctx.lineTo(left ? qx - 4 : qx + 4, qy - 36);
    ctx.lineTo(tx + 7, by + h - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `bold 18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('@!#?@!', bx + w / 2, by + h / 2 + 1);
    ctx.restore();
  }

  /* ------------------------------------------------------------ renderer */

  class Renderer {
    constructor(ctx) {
      this.ctx = ctx;
      this.scale = 1;
    }

    setScale(s) {
      this.scale = s;
    }

    draw(g) {
      const ctx = this.ctx;
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, GEOM.W, GEOM.H);

      const actors = g.enemies.concat([g.q]);
      // 1. actors that fell off an upper edge disappear behind the pyramid
      for (const a of actors) if (a.fall && a.fall.behind) this.drawActor(a, g);
      // 2. pyramid and discs
      this.drawPyramid(g);
      for (const d of g.discs) drawDisc(ctx, d.x, d.y, g.t);
      // 3. everything else, back to front
      this.drawShadows(g);
      const front = actors.filter((a) => !(a.fall && a.fall.behind)).sort((a, b) => a.y - b.y);
      for (const a of front) this.drawActor(a, g);

      this.drawParticles(g);
      if (g.state === 'dying' && g.dyingReason === 'hit') drawBalloon(ctx, g.q.x, g.q.y);
      if (g.state !== 'title') this.drawHud(g);
      if (g.state === 'intro') this.drawIntro(g);
      if (g.state === 'roundClear') this.drawRoundClear(g);
      if (g.freezeT > 0 && g.state === 'play') this.drawFreeze(g);
    }

    drawPyramid(g) {
      const ctx = this.ctx;
      const pal = g.cfg.palette;
      const clearing = g.state === 'roundClear';
      const cycle = [pal.target, pal.start, pal.mid, '#ffffff'];
      for (let r = 0; r < GEOM.ROWS; r++) {
        for (let c = 0; c <= r; c++) {
          const cube = g.cubes[r][c];
          const top = clearing ? cycle[Math.floor(g.t * 12) % cycle.length] : g.colorFor(cube.step);
          const p = cubeTop(r, c);
          drawCube(ctx, p.x, p.y, top, pal.left, pal.right, cube.flash);
        }
      }
    }

    /** Landing shadows for enemies dropping in from the sky. */
    drawShadows(g) {
      const ctx = this.ctx;
      for (const e of g.enemies) {
        if (!e.drop) continue;
        const p = cellPos(e.r, e.c);
        const k = e.drop.t;
        ctx.fillStyle = `rgba(0,0,0,${(0.2 + k * 0.35).toFixed(3)})`;
        ellipse(ctx, p.x, p.y, 4 + 7 * k, 2 + 3 * k);
        ctx.fill();
      }
    }

    drawActor(a, g) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = a.alpha;
      const frozen = g.freezeT > 0 && a.kind !== 'qbert';
      if (frozen) ctx.globalAlpha *= 0.7 + 0.3 * Math.sin(g.t * 18);

      switch (a.kind) {
        case 'qbert':
          if (a.blink > 0 && Math.floor(a.blink * 12) % 2 === 0) break;
          drawQbert(ctx, a.x, a.y, a.fx, a.fy, a.squash);
          break;
        case 'red':
          drawBall(ctx, a.x, a.y, [C.redLight, C.red, C.redDark], a.squash);
          break;
        case 'green':
          drawBall(ctx, a.x, a.y, [C.greenLight, C.green, C.greenDark], a.squash);
          break;
        case 'coily':
          if (a.phase === 'snake') {
            drawCoily(ctx, a.x, a.y, a.fx, a.fy, g.t);
          } else {
            // the purple egg trembles before it hatches
            const shake = a.phase === 'hatch' ? Math.sin(g.t * 60) * 1.5 : 0;
            drawBall(ctx, a.x + shake, a.y, [C.purpleLight, C.purple, C.purpleDark], a.squash, 10);
          }
          break;
        case 'slick':
        case 'sam':
          drawGreenie(ctx, a.x, a.y, a.fx, a.kind, a.squash);
          break;
        case 'ugg':
        case 'wrongway':
          drawSideWalker(ctx, a.x, a.y, a.side, a.kind);
          break;
        default:
          break;
      }

      if (frozen) {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#9ff4ff';
        ctx.lineWidth = 2;
        circle(ctx, a.x, a.y - 13, 15);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawParticles(g) {
      const ctx = this.ctx;
      for (const p of g.particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold 16px ${FONT}`;
      for (const p of g.popups) {
        ctx.globalAlpha = Math.max(0, 1 - p.t / p.dur);
        ctx.fillStyle = '#000';
        ctx.fillText(p.text, p.x + 1, p.y + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    }

    drawHud(g) {
      const ctx = this.ctx;
      ctx.textBaseline = 'top';

      // left: player, score, lives, target colour
      ctx.textAlign = 'left';
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillStyle = `hsl(${(g.t * 90) % 360},90%,62%)`;
      ctx.fillText('PLAYER 1', 16, 12);
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = C.hud;
      ctx.fillText(String(g.score), 16, 30);

      const shown = Math.min(g.lives - 1, 6); // reserve lives, as in the arcade
      for (let i = 0; i < shown; i++) {
        ctx.save();
        ctx.translate(26 + i * 20, 76);
        ctx.scale(0.55, 0.55);
        drawQbert(ctx, 0, 0, 1, 1);
        ctx.restore();
      }

      ctx.font = `bold 12px ${FONT}`;
      ctx.fillStyle = C.hudText;
      ctx.fillText('CHANGE TO:', 16, 88);
      const blink = Math.floor(g.t * 3) % 2 === 0;
      ctx.fillStyle = blink ? C.hud : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(22, 116); ctx.lineTo(30, 121); ctx.lineTo(22, 126);
      ctx.moveTo(78, 116); ctx.lineTo(70, 121); ctx.lineTo(78, 126);
      ctx.fill();
      drawCube(ctx, 50, 106, g.cfg.palette.target, g.cfg.palette.left, g.cfg.palette.right, 0, 0.5);

      // right: level, round, high score
      ctx.textAlign = 'right';
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillStyle = C.hudText;
      ctx.fillText(`LEVEL ${g.level}`, GEOM.W - 16, 12);
      ctx.fillStyle = C.hud;
      ctx.fillText(`ROUND ${g.round}`, GEOM.W - 16, 32);
      ctx.font = `bold 12px ${FONT}`;
      ctx.fillStyle = '#9aa0ff';
      ctx.fillText(`HI ${g.highScore}`, GEOM.W - 16, 54);
    }

    /** Colour sequence of the current rule, drawn as mini cubes with arrows. */
    drawSequence(g, cy) {
      const ctx = this.ctx;
      const pal = g.cfg.palette;
      const seq = g.rule.steps === 2 ? [pal.start, pal.mid, pal.target] : [pal.start, pal.target];
      const gap = 74;
      const x0 = GEOM.W / 2 - ((seq.length - 1) * gap) / 2;
      ctx.font = `bold 20px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      seq.forEach((col, i) => {
        drawCube(ctx, x0 + i * gap, cy - 16, col, pal.left, pal.right, 0, 0.55);
        if (i < seq.length - 1) {
          ctx.fillStyle = '#fff';
          ctx.fillText(g.cfg.rule === 'toggle' ? '<>' : '>', x0 + i * gap + gap / 2, cy);
        }
      });
    }

    drawIntro(g) {
      const ctx = this.ctx;
      const big = g.introLevel;
      const h = big ? 210 : 140;
      const y = 175;
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.strokeStyle = C.hud;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(120, y, 400, h, 14);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let ty = y + 34;
      if (big) {
        ctx.font = `bold 40px ${FONT}`;
        ctx.fillStyle = C.hud;
        ctx.fillText(`LEVEL ${g.level}`, GEOM.W / 2, ty);
        ty += 40;
      }
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`ROUND ${g.round}`, GEOM.W / 2, ty);
      this.drawSequence(g, ty + 50);
      if (big) {
        ctx.font = `bold 15px ${FONT}`;
        ctx.fillStyle = '#ffe36b';
        ctx.fillText(g.rule.hint, GEOM.W / 2, ty + 98);
        ctx.font = `12px ${FONT}`;
        ctx.fillStyle = '#9aa0ff';
        ctx.fillText('press a direction key to start', GEOM.W / 2, ty + 124);
      }
    }

    drawRoundClear(g) {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 486, GEOM.W, 48);
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = `hsl(${(g.t * 300) % 360},95%,65%)`;
      ctx.fillText('ROUND COMPLETE!', GEOM.W / 2, 500);
      ctx.font = `bold 16px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`BONUS ${g.clearBonus}`, GEOM.W / 2, 522);
    }

    drawFreeze(g) {
      const ctx = this.ctx;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(g.t * 10);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold 18px ${FONT}`;
      ctx.fillStyle = '#9ff4ff';
      ctx.fillText('FREEZE!', GEOM.W / 2, 505);
      ctx.globalAlpha = 1;
    }
  }

  QB.Renderer = Renderer;
  QB.drawQbert = drawQbert;
})();
