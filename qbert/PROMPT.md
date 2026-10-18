# Q*bert Clone – Optimized Specification

Optimized version of the original request. Changes relative to the original prompt:
added the missing core mechanics of the 1982 game (discs, Slick & Sam, green-ball freeze,
Level/Round structure), explicit control mapping, scoring table, timing architecture
(fixed timestep) and acceptance criteria.

---

Create a complete, immediately playable browser clone of the 1982 arcade game **Q*bert**
using plain HTML, CSS and JavaScript (Canvas 2D). No libraries, no build step, no external
assets – it must run by opening `index.html` directly from disk (`file://`).

## 1. Architecture

- Files: `index.html`, `style.css`, and classic (non-module) scripts sharing one namespace
  `window.QB`, so the game works from `file://`:
  - `js/audio.js` – WebAudio synthesizer (all sounds generated, no samples)
  - `js/game.js` – pure game logic: geometry, level rules, actors, state machine
  - `js/render.js` – all Canvas drawing; reads game state, never mutates it
  - `js/main.js` – browser glue: canvas sizing, input, game loop, DOM overlays
- **Logical model**: cubes addressed as `(row r = 0..6, col c = 0..r)`. Hop vectors:
  up-left `(-1,-1)`, up-right `(-1,0)`, down-left `(+1,0)`, down-right `(+1,+1)`.
  Off-pyramid cells are valid positions (discs, falling actors). Rendering projects
  logical cells isometrically; logic never depends on pixels.
- **Game loop**: `requestAnimationFrame` + fixed timestep (1/120 s) with an accumulator and a
  clamped frame delta, so speed is identical on 60/120/144 Hz displays and after tab switches.
- **State machine**: `title → intro → play ⇄ dying → roundClear → … → gameover`, plus a pause flag.
- Logical resolution 640×540, scaled to fit the window (aspect ratio kept, devicePixelRatio-aware
  backing store for sharp rendering).

## 2. Core gameplay

- Pyramid of 28 cubes in 7 rows. Q*bert starts on the apex cube.
- Q*bert hops diagonally in a parabolic arc (≈0.3 s per hop, no teleporting). Landing on a cube
  advances its colour according to the current rule.
- Hopping off the pyramid kills Q*bert: he falls in front of the pyramid (bottom edge) or behind
  it (upper edges), then respawns on the cube he jumped from.
- Round is won when every cube shows the target colour.
- **4 rounds per level**. The level defines the colour rule, each round increases speed/enemy
  density and uses a new colour palette.

| Level | Rule |
|---|---|
| 1 | start → target (one hop) |
| 2 | start → intermediate → target (two hops) |
| 3 | start ↔ target (hopping a finished cube flips it back) |
| 4 | start → intermediate → target, finished cubes revert to intermediate |
| 5+ | alternating rules 3/4 with ever higher speed |

## 3. Discs

- Rainbow-coloured spinning discs float beside the pyramid (2 in level 1–2, up to 4 later).
- Hopping onto a disc carries Q*bert to the top and drops him onto the apex cube. Each disc
  works once. While riding, Q*bert is invulnerable; all enemies except Coily vanish on arrival.
- If Coily is chasing, he follows Q*bert's last position and jumps off the pyramid → 500 points.
- Unused discs give 50 points each at the end of the round.

## 4. Enemies

| Enemy | Behaviour | Contact |
|---|---|---|
| Red ball | drops onto row 2, bounces randomly down, falls off the bottom | lethal |
| Green ball | like red ball | freezes all enemies ≈3.5 s, +100 |
| Coily | purple ball until it reaches the bottom row, hatches into a snake, then chases Q*bert (greedy pursuit, one hop at a time) | lethal |
| Slick & Sam | green gremlins hopping down, revert cubes they land on by one step | caught for +300 |
| Ugg / Wrong-Way | enter at the bottom corners and walk sideways along the side faces of the cubes (Ugg on right faces moving left/up-left, Wrong-Way on left faces moving right/up-right) | lethal |

- Spawning is driven by a per-round config: spawn interval, max enemies on screen, enabled types
  (round 1: red balls + Coily; then green ball, Slick/Sam, Ugg/Wrong-Way are added).
- Collision is cell-based (same logical cell, plus head-on swaps mid-hop), not pixel-based.
- When Q*bert is hit: everything freezes, a speech balloon with “@!#?@!” appears, then all enemies
  are cleared and play resumes (if lives remain).

## 5. Controls

| Direction | Keys |
|---|---|
| up-right | ↑, W, E, Numpad 9 |
| up-left | ←, A, Q, Numpad 7 |
| down-left | ↓, S, Z (Y on QWERTZ), Numpad 1 |
| down-right | →, D, C, Numpad 3 |

- Use `KeyboardEvent.code` (layout independent). Holding a key keeps hopping; a key pressed
  during a hop is buffered (≈350 ms) and executed on landing.
- P / Esc = pause (auto-pause when the tab loses focus), M = mute, Enter/Space = start/restart.
- Optional: tap/click the canvas relative to Q*bert to hop in that quadrant.

## 6. Scoring & progression

| Event | Points |
|---|---|
| Cube colour advanced | 25 |
| Catch green ball | 100 |
| Catch Slick / Sam | 300 |
| Lure Coily off the pyramid | 500 |
| Round bonus | 1000 + 250 per completed round (max 5000) |
| Unused disc at round end | 50 each |

- 3 lives, extra life at 8,000 points and every 14,000 thereafter.
- High score persisted in `localStorage` (wrapped in try/catch).

## 7. Presentation

- Black background, bright 80s palette, crisp isometric cubes (top colour = state, two shaded
  side faces per palette).
- Q*bert: round orange body, big white eyes, long tubular snout with an opening, small feet;
  sprite faces the hop direction (front view downwards, back view upwards).
- Effects: cube flash + particle burst on colour change, squash on landing, falling animation,
  speech balloon on death, flashing pyramid on round clear, floating score popups.
- HUD: score, lives (mini Q*berts), level, round, high score, “CHANGE TO” target-cube indicator.
- Screens: title (with controls), level intro card (shows the colour sequence and rule),
  pause overlay, game-over screen with final score, high score and restart button.
- Sound: synthesized hop, landing thuds, colour change, curse gibberish, falling whistle,
  disc ride, freeze, round-clear jingle, extra life. Audio is unlocked on first user input.

## 8. Acceptance criteria

- Opens from disk without console errors; playable with keyboard alone.
- Speed independent of monitor refresh rate.
- All four colour rules, discs + Coily lure, every enemy type, pause, game over and restart
  work as described.
- Code is commented, logic and rendering are separated.
