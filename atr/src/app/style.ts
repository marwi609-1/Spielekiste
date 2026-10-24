/**
 * Visual style per world: colours and procedurally generated textures (noise canvases used as
 * CanvasPatterns, so every surface is world-aligned and tiles seamlessly).
 */

import { mulberry32 } from "../core/math";
import { Surface, type SurfaceId } from "../core/surfaces";
import type { WorldId } from "../core/worlds";

export interface WorldStyle {
  /** Ground outside the walls; null = transparent (space shows the starfield). */
  ground: string | null;
  groundSpeck: string[];
  groundStripes?: string;
  wall: string;
  wallAlt: string | null;
  wallGlow?: string;
  edge: string;
  kerbs: boolean;
  centreLine: string | null;
  tunnelRoof: string;
  tunnelEdge: string;
  ambient: string;
  /** Skid mark colour. */
  skid: string;
  sky?: { planet: string; ring?: string };
}

export const WORLD_STYLES: Record<WorldId, WorldStyle> = {
  sports: {
    ground: "#3f8f3a",
    groundSpeck: ["#3a8535", "#46993f", "#367e31"],
    groundStripes: "rgba(255,255,255,0.045)",
    wall: "#f2f2f2",
    wallAlt: "#e0302b",
    edge: "#f4f4f4",
    kerbs: true,
    centreLine: "rgba(255,255,255,0.5)",
    tunnelRoof: "#3c4048",
    tunnelEdge: "#ffd23f",
    ambient: "#ffffff",
    skid: "rgba(20,20,24,0.32)",
  },
  canyon: {
    ground: "#a14e2b",
    groundSpeck: ["#8f4324", "#b35d34", "#7c3a20", "#c06a3c"],
    wall: "#5e2512",
    wallAlt: "#7d351c",
    edge: "rgba(90,40,18,0.55)",
    kerbs: false,
    centreLine: null,
    tunnelRoof: "#5a2a16",
    tunnelEdge: "#2d1309",
    ambient: "#ffe2c4",
    skid: "rgba(70,32,12,0.3)",
  },
  forest: {
    ground: "#e6edf5",
    groundSpeck: ["#d8e2ee", "#f4f8fc", "#cfdbe8"],
    wall: "#9fb4cc",
    wallAlt: "#ffffff",
    edge: "rgba(255,255,255,0.65)",
    kerbs: false,
    centreLine: null,
    tunnelRoof: "#5b4634",
    tunnelEdge: "#3a2b1f",
    ambient: "#eef6ff",
    skid: "rgba(60,72,96,0.3)",
  },
  space: {
    ground: null,
    groundSpeck: [],
    wall: "#16244a",
    wallAlt: null,
    wallGlow: "#3ddcff",
    edge: "#3ddcff",
    kerbs: false,
    centreLine: "rgba(255,210,63,0.55)",
    tunnelRoof: "#1d2742",
    tunnelEdge: "#3ddcff",
    ambient: "#c8e6ff",
    skid: "rgba(0,0,0,0.35)",
    sky: { planet: "#e0784f", ring: "rgba(255,220,180,0.5)" },
  },
  moon: {
    ground: "#6f7078",
    groundSpeck: ["#666770", "#7b7c84", "#5f6068", "#85868d"],
    wall: "#4a4b53",
    wallAlt: "#5a5b63",
    edge: "rgba(255,255,255,0.25)",
    kerbs: false,
    centreLine: null,
    tunnelRoof: "#3b3c44",
    tunnelEdge: "#ffd23f",
    ambient: "#f0f0ff",
    skid: "rgba(40,40,48,0.35)",
  },
  alien: {
    ground: "#3a1b4c",
    groundSpeck: ["#341843", "#432258", "#2e1440", "#4d2a63"],
    wall: "#1d0b28",
    wallAlt: "#2a1238",
    wallGlow: "#ff3d9a",
    edge: "rgba(255,90,190,0.6)",
    kerbs: false,
    centreLine: null,
    tunnelRoof: "#2a1035",
    tunnelEdge: "#9cff57",
    ambient: "#f3d9ff",
    skid: "rgba(20,0,30,0.35)",
  },
};

interface SurfaceLook {
  base: string;
  specks: string[];
  density: number;
  /** Extra drawing for the tile (panel lines, ripples, ...). */
  extra?: "panels" | "ripples" | "streaks" | "bubbles" | "facets" | "pebbles" | "tracks";
  alpha?: number;
}

/** Surface colours depend a little on the world (dirt in the canyon is redder than in the forest). */
export function surfaceLook(world: WorldId, s: SurfaceId): SurfaceLook {
  switch (s) {
    case Surface.Asphalt:
      return world === "forest" ? { base: "#4c5058", specks: ["#555a63", "#43474e", "#5d626b"], density: 0.5 } : { base: "#585c64", specks: ["#61656e", "#4f535a", "#6a6e77"], density: 0.5 };
    case Surface.Concrete:
      return world === "alien"
        ? { base: "#7a5a90", specks: ["#86659c", "#6c4f80", "#906fa8"], density: 0.4, extra: "facets" }
        : world === "space"
          ? { base: "#2c3550", specks: ["#323c5a", "#273048"], density: 0.3, extra: "panels" }
          : { base: "#c4c4c8", specks: ["#cdcdd2", "#b8b8bd"], density: 0.35 };
    case Surface.Metal:
      return { base: "#5d667b", specks: ["#667086", "#566074"], density: 0.25, extra: "panels" };
    case Surface.Dirt:
      return world === "forest"
        ? { base: "#8d7457", specks: ["#9b8163", "#7f674c", "#a68c6d"], density: 0.55, extra: "tracks" }
        : world === "alien"
          ? { base: "#8b4f6e", specks: ["#9a5b7c", "#7b4461", "#a86888"], density: 0.5 }
          : { base: "#bd7d49", specks: ["#c98a55", "#ad6f3e", "#d29660"], density: 0.55, extra: "tracks" };
    case Surface.Gravel:
      return world === "moon" ? { base: "#8a8a8f", specks: ["#9a9a9f", "#77777c", "#aaaab0"], density: 0.8, extra: "pebbles" } : { base: "#b6a98f", specks: ["#c6b9a0", "#a39780", "#d3c7ae", "#8f846e"], density: 0.85, extra: "pebbles" };
    case Surface.Grass:
      return { base: "#5daa45", specks: ["#67b64e", "#529a3c", "#71bf57"], density: 0.6 };
    case Surface.Sand:
      return world === "moon" ? { base: "#9d9ea4", specks: ["#a8a9af", "#909197"], density: 0.5 } : { base: "#e3bd82", specks: ["#ecc994", "#d6ae72", "#f2d4a4"], density: 0.5 };
    case Surface.Snow:
      return { base: "#f3f7fc", specks: ["#e6eef7", "#ffffff", "#dde7f2"], density: 0.5, extra: "tracks" };
    case Surface.Dust:
      return { base: "#bdbdb8", specks: ["#c8c8c3", "#b1b1ac", "#a6a6a1"], density: 0.5 };
    case Surface.Goo:
      return { base: "#5cc93c", specks: ["#6fdc4c", "#4fb531", "#8cf06a"], density: 0.35, extra: "bubbles" };
    case Surface.Crystal:
      return { base: "#9fe9ff", specks: ["#c4f4ff", "#86dcf5"], density: 0.3, extra: "facets" };
    case Surface.Ice:
      return { base: "#bfe7fb", specks: ["#d9f3ff", "#a9dcf4"], density: 0.25, extra: "streaks" };
    case Surface.Water:
      return { base: "#3a8bd1", specks: ["#4a9be0", "#2f7dc2"], density: 0.25, extra: "ripples" };
    case Surface.Oil:
      return { base: "#14151a", specks: ["#20222a", "#0c0d10"], density: 0.3 };
    case Surface.Boost:
      return { base: "#ffb020", specks: [], density: 0 };
    default:
      return { base: "#555", specks: [], density: 0 };
  }
}

function noiseCanvas(size: number, base: string | null, specks: string[], density: number, seed: number, extra?: SurfaceLook["extra"]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const rng = mulberry32(seed);
  if (base) {
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
  }
  const count = Math.round(size * size * density * 0.02);
  for (let i = 0; i < count; i++) {
    g.fillStyle = specks[Math.floor(rng() * specks.length)];
    const x = rng() * size;
    const y = rng() * size;
    const r = 0.6 + rng() * 1.8;
    // Wrap around the edges so the pattern tiles seamlessly.
    for (const ox of [0, -size, size])
      for (const oy of [0, -size, size]) {
        if (x + ox < -4 || x + ox > size + 4 || y + oy < -4 || y + oy > size + 4) continue;
        g.fillRect(x + ox - r / 2, y + oy - r / 2, r, r);
      }
  }
  if (extra === "panels") {
    g.strokeStyle = "rgba(0,0,0,0.22)";
    g.lineWidth = 2;
    for (let k = 0; k <= size; k += size / 4) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, size);
      g.moveTo(0, k);
      g.lineTo(size, k);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.08)";
    for (let k = 0; k < size; k += size / 4) for (let q = 0; q < size; q += size / 4) g.fillRect(k + 4, q + 4, 3, 3);
  } else if (extra === "ripples") {
    g.strokeStyle = "rgba(255,255,255,0.22)";
    g.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      const x = rng() * size;
      const y = rng() * size;
      g.beginPath();
      g.ellipse(x, y, 8 + rng() * 10, 2 + rng() * 2, 0, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (extra === "streaks") {
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const x = rng() * size;
      const y = rng() * size;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 10 + rng() * 20, y - 4 - rng() * 8);
      g.stroke();
    }
  } else if (extra === "bubbles") {
    for (let i = 0; i < 16; i++) {
      g.strokeStyle = "rgba(220,255,200,0.5)";
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.beginPath();
      g.arc(rng() * size, rng() * size, 2 + rng() * 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  } else if (extra === "facets") {
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const x = rng() * size;
      const y = rng() * size;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rng() - 0.5) * 40, y + (rng() - 0.5) * 40);
      g.lineTo(x + (rng() - 0.5) * 40, y + (rng() - 0.5) * 40);
      g.closePath();
      g.stroke();
    }
  } else if (extra === "pebbles") {
    for (let i = 0; i < 70; i++) {
      g.fillStyle = specks[Math.floor(rng() * specks.length)];
      g.beginPath();
      g.arc(rng() * size, rng() * size, 1 + rng() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  } else if (extra === "tracks") {
    g.strokeStyle = "rgba(0,0,0,0.05)";
    g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const y = rng() * size;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(size / 3, y + 6, (2 * size) / 3, y - 6, size, y);
      g.stroke();
    }
  }
  return c;
}

/** Pattern cache per world/surface. */
export class Patterns {
  private readonly cache = new Map<string, CanvasPattern>();
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    readonly world: WorldId,
  ) {}

  surface(s: SurfaceId): CanvasPattern {
    const key = `s${s}`;
    let p = this.cache.get(key);
    if (!p) {
      const look = surfaceLook(this.world, s);
      p = this.ctx.createPattern(noiseCanvas(128, look.base, look.specks, look.density, 1000 + s * 31, look.extra), "repeat")!;
      this.cache.set(key, p);
    }
    return p;
  }

  ground(): CanvasPattern | null {
    const st = WORLD_STYLES[this.world];
    if (!st.ground) return null;
    let p = this.cache.get("ground");
    if (!p) {
      const c = noiseCanvas(256, st.ground, st.groundSpeck, 0.7, 77);
      if (st.groundStripes) {
        const g = c.getContext("2d")!;
        g.fillStyle = st.groundStripes;
        g.fillRect(0, 0, 256, 64);
        g.fillRect(0, 128, 256, 64);
      }
      p = this.ctx.createPattern(c, "repeat")!;
      this.cache.set("ground", p);
    }
    return p;
  }

  tunnel(): CanvasPattern {
    let p = this.cache.get("tunnel");
    if (!p) {
      const st = WORLD_STYLES[this.world];
      const c = noiseCanvas(128, st.tunnelRoof, ["rgba(0,0,0,0.25)", "rgba(255,255,255,0.06)"], 0.6, 5, this.world === "space" ? "panels" : undefined);
      p = this.ctx.createPattern(c, "repeat")!;
      this.cache.set("tunnel", p);
    }
    return p;
  }
}

export const PICKUP_COLORS: Record<string, string> = {
  turbo: "#ff7a1a",
  cash: "#ffd23f",
  shield: "#3ddcff",
  brakes: "#ff4f8b",
  repair: "#62e36b",
  weapon: "#ff3b3b",
};
