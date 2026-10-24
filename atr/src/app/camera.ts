/**
 * Smooth follow camera with look-ahead along the velocity, and a zoom that shows more of the track
 * at speed. Zoom is in CSS pixels per world pixel.
 */

import { clamp } from "../core/math";

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  private lookX = 0;
  private lookY = 0;
  viewW = 800;
  viewH = 600;

  /** Base zoom for the current viewport: about 1.3 k × 0.7 k world px on a 1080p screen. */
  baseZoom(wide = false): number {
    const z = Math.sqrt(this.viewW * this.viewH) / (wide ? 1080 : 880);
    return clamp(z, 0.42, 1.7);
  }

  snap(x: number, y: number, wide = false): void {
    this.x = x;
    this.y = y;
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = this.baseZoom(wide);
  }

  update(dt: number, tx: number, ty: number, vx: number, vy: number, speedFrac: number, wide = false): void {
    const maxLook = (0.34 * Math.min(this.viewW, this.viewH)) / this.zoom;
    let lx = vx * 0.42;
    let ly = vy * 0.42;
    const l = Math.hypot(lx, ly);
    if (l > maxLook) {
      lx *= maxLook / l;
      ly *= maxLook / l;
    }
    const kl = 1 - Math.exp(-dt * 2.2);
    this.lookX += (lx - this.lookX) * kl;
    this.lookY += (ly - this.lookY) * kl;
    const kp = 1 - Math.exp(-dt * 7);
    this.x += (tx + this.lookX - this.x) * kp;
    this.y += (ty + this.lookY - this.y) * kp;
    const zt = this.baseZoom(wide) * (1 - 0.14 * clamp(speedFrac, 0, 1.2));
    this.zoom += (zt - this.zoom) * (1 - Math.exp(-dt * 1.5));
  }

  /** Visible world rectangle (centre and half extents). */
  view(): { cx: number; cy: number; hw: number; hh: number } {
    return { cx: this.x, cy: this.y, hw: this.viewW / 2 / this.zoom, hh: this.viewH / 2 / this.zoom };
  }
}
