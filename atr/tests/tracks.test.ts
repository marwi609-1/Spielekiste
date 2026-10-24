import { describe, expect, test } from "bun:test";
import { Surface } from "../src/core/surfaces";
import { Track } from "../src/core/track";
import { generateTrack } from "../src/core/trackgen";
import { TRACKS_PER_WORLD, WORLDS } from "../src/core/worlds";

const all = WORLDS.flatMap((w) => Array.from({ length: TRACKS_PER_WORLD }, (_, i) => ({ w: w.id, i })));

describe("track generator", () => {
  test("is deterministic", () => {
    expect(JSON.stringify(generateTrack("canyon", 3))).toBe(JSON.stringify(generateTrack("canyon", 3)));
  });

  test("42 tracks, most with shortcuts", () => {
    let withBranch = 0;
    for (const { w, i } of all) if (generateTrack(w, i).paths.length > 1) withBranch++;
    expect(all.length).toBe(42);
    expect(withBranch).toBeGreaterThanOrEqual(30);
  });

  for (const { w, i } of all) {
    test(`${w}-${i + 1} is a valid circuit`, () => {
      const spec = generateTrack(w, i);
      const t = new Track(spec);
      const m = t.main;
      expect(m.closed).toBe(true);
      expect(t.length).toBeGreaterThan(6000);
      expect(t.length).toBeLessThan(15000);

      // No corner tighter than the corridor half-width.
      for (let k = 0; k < m.n; k++) expect(Math.abs(m.curv[k])).toBeLessThan(1 / (m.halfW + 10));

      // Distant parts of the loop never share a corridor.
      const sep = 2 * m.limit + 40;
      for (let a = 0; a < m.n; a += 4) {
        for (let b = a + 4; b < m.n; b += 4) {
          const gap = Math.min(Math.abs(m.cum[a] - m.cum[b]), t.length - Math.abs(m.cum[a] - m.cum[b]));
          if (gap < 2.4 * (2 * m.limit + 60)) continue;
          expect(Math.hypot(m.xs[a] - m.xs[b], m.ys[a] - m.ys[b])).toBeGreaterThan(sep);
        }
      }

      // Shortcuts are shorter than the stretch of main loop they bypass.
      for (const p of t.paths.slice(1)) {
        let span = p.join!.to - p.join!.from;
        if (span < 0) span += t.length;
        expect(p.length).toBeLessThan(span * 0.9);
      }

      // Everything on the track is reachable; scenery stays behind the walls.
      for (const pk of spec.pickups) expect(t.surfaceAt(pk.x, pk.y)).not.toBe(Surface.Wall);
      for (const r of spec.ramps) expect(t.surfaceAt(r.x, r.y)).not.toBe(Surface.Wall);
      for (const c of spec.cones) expect(t.surfaceAt(c.x, c.y)).not.toBe(Surface.Wall);
      for (let k = 0; k < 6; k++) {
        const g = t.gridSlot(k);
        expect(t.nearest(g.x, g.y).margin).toBeGreaterThan(t.main.shoulder + 20);
      }
      for (const d of spec.decor) expect(t.marginAt(d.x, d.y)).toBeLessThan(0);
    });
  }
});

describe("track queries", () => {
  const t = new Track(generateTrack("sports", 2));
  test("nearest point and progress on the centreline", () => {
    for (const s of [0, 1234, 5000, t.length - 50]) {
      const a = t.pointOnMain(s, 30);
      const h = t.nearest(a.x, a.y);
      expect(h.path).toBe(0);
      expect(Math.abs(h.lateral - 30)).toBeLessThan(1.5);
      const ds = Math.abs(h.sMain - t.main.wrapS(s));
      expect(Math.min(ds, t.length - ds)).toBeLessThan(2);
    }
  });

  test("surfaces: track, shoulder, wall", () => {
    const at = (lat: number) => {
      const p = t.pointOnMain(2000, lat);
      return t.surfaceAt(p.x, p.y);
    };
    expect(at(0)).not.toBe(Surface.Wall);
    expect(at(t.main.halfW + t.main.shoulder / 2)).toBe(Surface.Grass);
    expect(at(t.main.limit + 60)).toBe(Surface.Wall);
  });
});
