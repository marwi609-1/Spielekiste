/**
 * Particle effects in world space: dust and spray from wheels, smoke from damaged cars, sparks,
 * explosions and floating score text.
 */

export const enum PKind {
  Dust,
  Spark,
  Smoke,
  Flame,
  Text,
  Ring,
  Drop,
}

export interface Particle {
  kind: PKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  text?: string;
}

export class Particles {
  readonly list: Particle[] = [];
  private readonly cap = 1200;

  add(p: Omit<Particle, "max">): void {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({ ...p, max: p.life });
  }

  clear(): void {
    this.list.length = 0;
  }

  dust(x: number, y: number, color: string, vx: number, vy: number, size = 5): void {
    this.add({ kind: PKind.Dust, x, y, vx: vx + (Math.random() - 0.5) * 40, vy: vy + (Math.random() - 0.5) * 40, life: 0.5 + Math.random() * 0.4, size, grow: 18, color });
  }

  smoke(x: number, y: number, dark: boolean): void {
    this.add({ kind: PKind.Smoke, x, y, vx: (Math.random() - 0.5) * 20, vy: -20 - Math.random() * 20, life: 1 + Math.random() * 0.6, size: 5, grow: 14, color: dark ? "#2a2a2e" : "#9a9aa2" });
  }

  sparks(x: number, y: number, n = 10): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 260;
      this.add({ kind: PKind.Spark, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.2 + Math.random() * 0.3, size: 2, grow: 0, color: Math.random() < 0.5 ? "#ffe27a" : "#ffffff" });
    }
  }

  splash(x: number, y: number, color: string, vx: number, vy: number): void {
    for (let i = 0; i < 3; i++) {
      this.add({ kind: PKind.Drop, x, y, vx: vx * 0.3 + (Math.random() - 0.5) * 140, vy: vy * 0.3 + (Math.random() - 0.5) * 140, life: 0.35 + Math.random() * 0.25, size: 2 + Math.random() * 2, grow: 0, color });
    }
  }

  explosion(x: number, y: number): void {
    this.add({ kind: PKind.Ring, x, y, vx: 0, vy: 0, life: 0.45, size: 6, grow: 160, color: "#ffd23f" });
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 220;
      this.add({ kind: PKind.Flame, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, size: 6 + Math.random() * 6, grow: 10, color: "" });
    }
    for (let i = 0; i < 8; i++) this.smoke(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, true);
    this.sparks(x, y, 14);
  }

  sparkle(x: number, y: number, color: string): void {
    this.add({ kind: PKind.Ring, x, y, vx: 0, vy: 0, life: 0.35, size: 8, grow: 90, color });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.add({ kind: PKind.Spark, x, y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, life: 0.35, size: 2.5, grow: 0, color });
    }
  }

  text(x: number, y: number, text: string, color: string): void {
    this.add({ kind: PKind.Text, x, y, vx: 0, vy: -46, life: 1.2, size: 18, grow: 0, color, text });
  }

  update(dt: number): void {
    const l = this.list;
    let w = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.kind === PKind.Spark ? 2 : p.kind === PKind.Text ? 0.5 : 3;
      p.vx *= 1 - Math.min(1, drag * dt);
      p.vy *= 1 - Math.min(1, drag * dt);
      p.size += p.grow * dt;
      l[w++] = p;
    }
    l.length = w;
  }

  /** Ground-level effects (dust, spray) are drawn under the cars, the rest above. */
  draw(g: CanvasRenderingContext2D, zoom: number, layer: "low" | "high"): void {
    for (const p of this.list) {
      const low = p.kind === PKind.Dust || p.kind === PKind.Drop;
      if (low !== (layer === "low")) continue;
      const t = p.life / p.max;
      switch (p.kind) {
        case PKind.Dust:
        case PKind.Smoke:
          g.globalAlpha = t * (p.kind === PKind.Dust ? 0.45 : 0.5);
          g.fillStyle = p.color;
          g.beginPath();
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          g.fill();
          break;
        case PKind.Drop:
          g.globalAlpha = Math.min(1, t * 1.5);
          g.fillStyle = p.color;
          g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        case PKind.Spark:
          g.globalAlpha = Math.min(1, t * 2);
          g.strokeStyle = p.color;
          g.lineWidth = p.size;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          g.stroke();
          break;
        case PKind.Flame: {
          g.globalAlpha = t;
          g.fillStyle = t > 0.6 ? "#fff3b0" : t > 0.3 ? "#ff9a2a" : "#c8341a";
          g.beginPath();
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case PKind.Ring:
          g.globalAlpha = t;
          g.strokeStyle = p.color;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          g.stroke();
          break;
        case PKind.Text:
          g.globalAlpha = Math.min(1, t * 2);
          g.save();
          g.translate(p.x, p.y);
          g.scale(1 / zoom, 1 / zoom);
          g.font = "20px 'Bungee', 'Arial Black', sans-serif";
          g.textAlign = "center";
          g.lineWidth = 4;
          g.strokeStyle = "rgba(10,6,30,0.85)";
          g.strokeText(p.text!, 0, 0);
          g.fillStyle = p.color;
          g.fillText(p.text!, 0, 0);
          g.restore();
          break;
      }
    }
    g.globalAlpha = 1;
  }
}
