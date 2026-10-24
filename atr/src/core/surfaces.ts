/**
 * Surface types. Every point of a track resolves to one of these; the vehicle model reads the
 * properties below and combines them with the vehicle's own grip and off-road rating.
 */

export const Surface = {
  Asphalt: 0,
  Concrete: 1,
  Metal: 2,
  Dirt: 3,
  Gravel: 4,
  Grass: 5,
  Sand: 6,
  Snow: 7,
  Dust: 8,
  Goo: 9,
  Crystal: 10,
  Ice: 11,
  Water: 12,
  Oil: 13,
  Boost: 14,
  Wall: 15,
} as const;

export type SurfaceId = (typeof Surface)[keyof typeof Surface];

export interface SurfaceProps {
  name: string;
  /** Lateral/traction grip, 1 = dry asphalt. */
  grip: number;
  /** Linear speed drag in 1/s (water and sand slow you down hard). */
  drag: number;
  /** 0..1 bumpiness: caps top speed and jolts the steering of cars with little off-road ability. */
  rough: number;
  /** Loose surface: off-road vehicles (high `offroad`) keep much more grip and speed on it. */
  loose: boolean;
  /** Oil: the car spins out on contact. */
  spin?: boolean;
  /** Boost pad: a short turbo burst. */
  boost?: boolean;
  /** Throws up spray (particles and sound). */
  splash?: boolean;
  /** Particle colour for dust/spray kicked up by wheels. */
  dust: string | null;
}

export const SURFACES: Record<SurfaceId, SurfaceProps> = {
  [Surface.Asphalt]: { name: "Asphalt", grip: 1.0, drag: 0.04, rough: 0, loose: false, dust: null },
  [Surface.Concrete]: { name: "Concrete", grip: 0.95, drag: 0.05, rough: 0, loose: false, dust: null },
  [Surface.Metal]: { name: "Metal deck", grip: 0.92, drag: 0.04, rough: 0, loose: false, dust: null },
  [Surface.Dirt]: { name: "Dirt", grip: 0.74, drag: 0.22, rough: 0.35, loose: true, dust: "#b98a55" },
  [Surface.Gravel]: { name: "Gravel", grip: 0.66, drag: 0.42, rough: 0.55, loose: true, dust: "#a89c88" },
  [Surface.Grass]: { name: "Grass", grip: 0.6, drag: 0.55, rough: 0.6, loose: true, dust: "#5f8f3a" },
  [Surface.Sand]: { name: "Sand", grip: 0.55, drag: 0.85, rough: 0.75, loose: true, dust: "#e0c38a" },
  [Surface.Snow]: { name: "Snow", grip: 0.48, drag: 0.32, rough: 0.45, loose: true, dust: "#f4f8ff" },
  [Surface.Dust]: { name: "Regolith", grip: 0.6, drag: 0.3, rough: 0.4, loose: true, dust: "#c9c9c4" },
  [Surface.Goo]: { name: "Goo", grip: 0.5, drag: 1.25, rough: 0.2, loose: false, splash: true, dust: "#9cff57" },
  [Surface.Crystal]: { name: "Crystal", grip: 0.22, drag: 0.03, rough: 0, loose: false, dust: null },
  [Surface.Ice]: { name: "Ice", grip: 0.14, drag: 0.02, rough: 0, loose: false, dust: null },
  [Surface.Water]: { name: "Water", grip: 0.52, drag: 2.1, rough: 0.35, loose: false, splash: true, dust: "#bfe6ff" },
  [Surface.Oil]: { name: "Oil", grip: 0.06, drag: 0.02, rough: 0, loose: false, spin: true, dust: null },
  [Surface.Boost]: { name: "Boost pad", grip: 1.0, drag: 0.0, rough: 0, loose: false, boost: true, dust: null },
  [Surface.Wall]: { name: "Wall", grip: 0.5, drag: 1.0, rough: 0.5, loose: false, dust: null },
};

export function surfaceProps(id: number): SurfaceProps {
  return SURFACES[id as SurfaceId] ?? SURFACES[Surface.Asphalt];
}

/** Surfaces drawn as blobs on top of the track (oil slick, ice patch, puddle, ...). */
export type PatchKind = "oil" | "ice" | "water" | "goo" | "sand" | "crystal" | "boost" | "dust" | "gravel" | "snow" | "grass";

export const PATCH_SURFACE: Record<PatchKind, SurfaceId> = {
  oil: Surface.Oil,
  ice: Surface.Ice,
  water: Surface.Water,
  goo: Surface.Goo,
  sand: Surface.Sand,
  crystal: Surface.Crystal,
  boost: Surface.Boost,
  dust: Surface.Dust,
  gravel: Surface.Gravel,
  snow: Surface.Snow,
  grass: Surface.Grass,
};
