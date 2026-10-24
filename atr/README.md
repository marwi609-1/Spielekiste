# Overdrift — all-terrain arcade racing

A top-down arcade racer in the spirit of *ATR: All Terrain Racing* (Team17, Amiga, 1995): three vehicle
classes, six worlds with seven tracks each (42 tracks, most with a risky shortcut), an arcade career with
prize money and upgrades, and Battle and League modes for up to six drivers on one screen. It is a
fan-made homage, not affiliated with Team17; graphics, tracks, sound and music are all generated in code.

One HTML file, no assets, no backend. TypeScript, built with Bun.

```bash
bun install
bun test               # core: track generator, vehicle model, race rules, career, league (110 tests)
bun run typecheck
bun run build          # dist/index.html (full page) and dist/overdrift.html (claude.ai artifact fragment)
bun run check:browser  # Chromium: menus on phone/desktop, every mode played through, one frame per world → out/
```

Open `dist/index.html` in a browser (double-click works). Append `#autopilot` to the URL to let the computer
drive your car, `#autopilot-fast` to do so at four times the speed (used by the browser check).

## Controls

| | Keyboard | Gamepad |
|---|---|---|
| Accelerate | ↑ or W | RT or A |
| Brake / reverse | ↓ or S | LT or X |
| Steer | ← → or A D | stick or d-pad |
| Fire (battle) | Space or Enter | B or RB |
| Pause | Esc or P | Start |

Two players on one keyboard: P1 = WASD + Space, P2 = arrows + Enter. Gamepad *n* drives player *n*
(players 3 and 4 in a league need gamepads). Touch screens get on-screen pedals. Menus work with arrows,
Enter and Esc, or the d-pad, A and B.

## Game

- **Vehicles**: 4×4 Jeep (slow, tough, best off-road), Buggy (all-rounder, quickest off the line),
  Formula (fastest on tarmac and metal, fragile, lost on grass, sand and snow). Measured with the computer
  driver at equal skill the Formula is fastest in Sports and Space, the Jeep in Canyon and Moon, Jeep and
  Buggy are level in Forest.
- **Worlds**: Sports, Canyon, Forest (open from the start), then Space, Moon and Alien, unlocked in that
  order once the first three are done.
- **Arcade**: buy a car with 6 000 Cr, pick a starting world, race its seven tracks in order against four
  rivals over 6 laps. Top 3 qualify; otherwise a continue is spent (3 to start, +1 per finished world).
  Prize money and cash pickups pay for upgrades (engine, gears, tyres, shell, suspension, power brakes,
  four levels each), repairs, one-race specials and further cars. Rivals get better tuned and sharper as
  the career goes on. The career is kept in `localStorage`.
- **Battle** (1–2 players, or one against the computer): the camera follows the leader; dropping off the
  screen puts you back behind the leader (+1 for the leader), a missile hit is +1, leading a lap +2. First
  to the target wins. Missiles, mines and cones can be switched off.
- **League**: 3–6 drivers, any mix of humans and computer, free-for-all battles on random tracks; round
  rankings earn 10/6/4/3/2/1 league points.
- **Pickups**: turbo, cash, shield, power brakes, repair, weapons (battle only).
- **Hazards**: oil (spin), ice and crystal (almost no grip), water and goo (heavy drag), sand, gravel and
  snow (hard on cars with little off-road ability), jumps (gravity differs per world), cones, tunnels
  (the roof hides the cars; headlights shine through), walls (bounce, damage, lost speed).

## Code

| Path | Contents |
|---|---|
| `src/core/` | Pure simulation, no DOM, unit-tested |
| `core/physics.ts` | Arcade vehicle model: forward/lateral split, grip by surface and car, progressive drift, yaw-rate steering, jumps, damage |
| `core/surfaces.ts`, `core/vehicles.ts` | Surface table; vehicle classes, upgrades, specials, derived stats |
| `core/track.ts` | Data model (`TrackSpec`, JSON-serialisable) and built `Track`: corridors per path, 8 px grid with wall margin, nearest sample and final surface; exact nearest-point queries for collision and race progress |
| `core/trackgen.ts` | Deterministic generator: polar loop + smooth warp, curvature and self-proximity checks, Hermite shortcuts, placement of sections, patches, fords, ramps, tunnels, boost pads, cones, pickups, scenery |
| `core/worlds.ts` | The six worlds: surfaces, widths, hazards, gravity, scenery, track names |
| `core/collide.ts` | Wall and car-to-car impulses (two circles per car) |
| `core/ai.ts` | Computer driver: own route tracking with shortcut choice by estimated time, look-ahead target with racing line, hazard avoidance, braking for the slowest corner in reach, mistakes, unsticking, weapons |
| `core/race.ts` | Race session: fixed 120 Hz step, laps from unwrapped progress, positions, pickups, cones, missiles, mines, rubber-banding, race and battle rules, event queue |
| `core/career.ts`, `core/league.ts` | Arcade career and shop; league table |
| `src/app/` | Browser layer |
| `app/renderer.ts` | Canvas renderer: static track cached in 512 px tiles (skid marks stamped into them), moving objects, perspective-leaning scenery, tunnel roofs |
| `app/sprites.ts`, `app/style.ts` | Procedural sprites and per-world colours/textures |
| `app/game.ts` | Frame loop, sessions, camera, HUD, effects, sound hooks |
| `app/screens.ts` | Menus, career screens, shop, setup screens, pause |
| `app/audio.ts` | Web Audio: engine voices with simulated gearbox, tyre noise, effects, a small tracker-style music sequencer per world |
| `app/input.ts` | Keyboard (one or two players), gamepads, touch, menu navigation |

Units: 10 px ≈ 1 m, so 600 px/s ≈ 216 km/h. The simulation is deterministic for a given seed and input
sequence; rendering never feeds back into it except for the visible rectangle used by battle teleports.
