/**
 * The six worlds. Each world sets the ground the tracks are made of, the hazards the generator may
 * place, gravity for jumps and the names of its seven tracks. Visual styling lives in app/style.ts.
 */

import type { PatchKind, SurfaceId } from "./surfaces";
import { Surface } from "./surfaces";
import type { VehicleKind } from "./vehicles";

export type WorldId = "sports" | "canyon" | "forest" | "space" | "moon" | "alien";

export interface WorldDef {
  id: WorldId;
  name: string;
  tagline: string;
  /** 0 for the three starting worlds, then 1..3 (prize money and AI strength scale with it). */
  tier: number;
  gravity: number;
  trackSurface: SurfaceId;
  shoulderSurface: SurfaceId;
  /** Track width (px) for the first and the seventh track. */
  width: [number, number];
  shoulder: number;
  /** Base radius of the loop (px). */
  radius: [number, number];
  /** Shape amplitude for the first and the seventh track (relative to the radius). */
  wiggle: [number, number];
  /** Whole-width sections of another surface on the main route. */
  sections: [SurfaceId, number][];
  sectionCount: [number, number];
  patches: [PatchKind, number][];
  patchCount: [number, number];
  /** Water crossings that span the full width (fords). */
  fords: [number, number];
  /** What makes the shortcut risky. */
  shortcut: { surface: SurfaceId | null; patches: PatchKind[]; ramp: boolean };
  ramps: [number, number];
  tunnels: [number, number];
  cones: [number, number];
  boostPads: [number, number];
  decor: [string, number][];
  /** Decor items per 100×100 px of the band around the track. */
  decorDensity: number;
  /** What the AI mostly drives here. */
  favourite: VehicleKind;
  trackNames: string[];
}

export const WORLDS: WorldDef[] = [
  {
    id: "sports",
    name: "Sports",
    tagline: "Grand-prix tarmac, kerbs, oil and cones",
    tier: 0,
    gravity: 950,
    trackSurface: Surface.Asphalt,
    shoulderSurface: Surface.Grass,
    width: [210, 175],
    shoulder: 60,
    radius: [1150, 1450],
    wiggle: [0.14, 0.3],
    sections: [],
    sectionCount: [0, 0],
    patches: [["oil", 1]],
    patchCount: [2, 5],
    fords: [0, 0],
    shortcut: { surface: Surface.Gravel, patches: ["oil"], ramp: false },
    ramps: [0, 0],
    tunnels: [0, 1],
    cones: [3, 6],
    boostPads: [0, 0],
    decor: [["tyres", 4], ["bush", 4], ["tree", 3], ["flag", 1]],
    decorDensity: 0.16,
    favourite: "formula",
    trackNames: ["Pole Position", "Chicane Alley", "Grand Prix Ring", "Pit Lane Dash", "Hairpin Heaven", "Speedbowl", "Champions' Circuit"],
  },
  {
    id: "canyon",
    name: "Canyon",
    tagline: "Red dirt, fords, rock walls and dark tunnels",
    tier: 0,
    gravity: 950,
    trackSurface: Surface.Dirt,
    shoulderSurface: Surface.Sand,
    width: [180, 150],
    shoulder: 45,
    radius: [1100, 1400],
    wiggle: [0.2, 0.36],
    sections: [[Surface.Gravel, 1]],
    sectionCount: [1, 3],
    patches: [["sand", 2], ["water", 1]],
    patchCount: [2, 5],
    fords: [1, 2],
    shortcut: { surface: Surface.Sand, patches: ["water"], ramp: true },
    ramps: [0, 2],
    tunnels: [1, 2],
    cones: [0, 0],
    boostPads: [0, 0],
    decor: [["rock", 5], ["boulder", 3], ["cactus", 2], ["mesa", 1]],
    decorDensity: 0.14,
    favourite: "jeep",
    trackNames: ["Dust Devil", "Rattlesnake Pass", "Red Rock Run", "Gully Wash", "Mesa Loop", "Dead Man's Gulch", "Eagle's Nest"],
  },
  {
    id: "forest",
    name: "Forest",
    tagline: "Alpine pines, snow drifts and black ice",
    tier: 0,
    gravity: 950,
    trackSurface: Surface.Dirt,
    shoulderSurface: Surface.Snow,
    width: [195, 160],
    shoulder: 55,
    radius: [1100, 1400],
    wiggle: [0.18, 0.34],
    sections: [[Surface.Snow, 3], [Surface.Asphalt, 1]],
    sectionCount: [2, 4],
    patches: [["ice", 3], ["snow", 1]],
    patchCount: [3, 7],
    fords: [0, 1],
    shortcut: { surface: Surface.Grass, patches: ["ice"], ramp: false },
    ramps: [0, 1],
    tunnels: [0, 1],
    cones: [0, 0],
    boostPads: [0, 0],
    decor: [["pine", 8], ["snowpine", 4], ["log", 1], ["rock", 1]],
    decorDensity: 0.3,
    favourite: "jeep",
    trackNames: ["Pine Ridge", "Frostbite Hollow", "Black Ice Bend", "Alpine Loop", "Timberline", "Snowdrift Trail", "Avalanche Run"],
  },
  {
    id: "space",
    name: "Space",
    tagline: "Metal decks in orbit, boost pads and low gravity",
    tier: 1,
    gravity: 560,
    trackSurface: Surface.Metal,
    shoulderSurface: Surface.Concrete,
    width: [200, 165],
    shoulder: 35,
    radius: [1200, 1500],
    wiggle: [0.18, 0.34],
    sections: [],
    sectionCount: [0, 0],
    patches: [["oil", 2], ["ice", 1]],
    patchCount: [2, 5],
    fords: [0, 0],
    shortcut: { surface: null, patches: ["oil", "boost"], ramp: true },
    ramps: [1, 2],
    tunnels: [1, 2],
    cones: [0, 0],
    boostPads: [2, 4],
    decor: [["beacon", 3], ["antenna", 2], ["panel", 2]],
    decorDensity: 0.05,
    favourite: "formula",
    trackNames: ["Orbital One", "Docking Ring", "Gravity Well", "Nova Strip", "Ion Drift", "Starport", "Event Horizon"],
  },
  {
    id: "moon",
    name: "Moon",
    tagline: "Regolith, craters and huge low-g jumps",
    tier: 2,
    gravity: 340,
    trackSurface: Surface.Dust,
    shoulderSurface: Surface.Sand,
    width: [195, 160],
    shoulder: 50,
    radius: [1150, 1450],
    wiggle: [0.2, 0.36],
    sections: [[Surface.Gravel, 1], [Surface.Concrete, 1]],
    sectionCount: [1, 2],
    patches: [["sand", 3], ["ice", 1]],
    patchCount: [3, 6],
    fords: [0, 0],
    shortcut: { surface: Surface.Sand, patches: ["sand"], ramp: true },
    ramps: [2, 3],
    tunnels: [0, 1],
    cones: [0, 0],
    boostPads: [0, 2],
    decor: [["crater", 4], ["moonrock", 4], ["flag", 1], ["lander", 1]],
    decorDensity: 0.1,
    favourite: "buggy",
    trackNames: ["Tranquility Base", "Crater Rim", "Dark Side", "Regolith Rally", "Low-G Leap", "Sea of Storms", "Earthrise"],
  },
  {
    id: "alien",
    name: "Alien",
    tagline: "Living rock, crystal ice, goo and hive tunnels",
    tier: 3,
    gravity: 800,
    trackSurface: Surface.Concrete,
    shoulderSurface: Surface.Goo,
    width: [185, 150],
    shoulder: 45,
    radius: [1150, 1450],
    wiggle: [0.22, 0.38],
    sections: [[Surface.Dirt, 3], [Surface.Crystal, 1]],
    sectionCount: [2, 4],
    patches: [["goo", 3], ["crystal", 2], ["oil", 1]],
    patchCount: [3, 7],
    fords: [0, 0],
    shortcut: { surface: Surface.Goo, patches: ["crystal"], ramp: false },
    ramps: [0, 2],
    tunnels: [1, 2],
    cones: [0, 0],
    boostPads: [1, 2],
    decor: [["pod", 3], ["crystal", 3], ["tendril", 3], ["egg", 2]],
    decorDensity: 0.16,
    favourite: "buggy",
    trackNames: ["Hive Mind", "Spore Fields", "Ooze Canal", "Crystal Spire", "Xeno Loop", "Brood Chamber", "Mothership"],
  },
];

export const WORLD_BY_ID: Record<WorldId, WorldDef> = Object.fromEntries(WORLDS.map((w) => [w.id, w])) as Record<WorldId, WorldDef>;

export const START_WORLDS: WorldId[] = ["sports", "canyon", "forest"];
/** Unlock chain after the three starting worlds. */
export const LATE_WORLDS: WorldId[] = ["space", "moon", "alien"];

export const TRACKS_PER_WORLD = 7;
