/**
 * Browser check of dist/index.html in Chromium (external requests blocked):
 *   - title and menus on phone and desktop width: no console errors, no sideways scrolling
 *   - every mode played through with the `#autopilot-fast` hash (the computer drives the human cars at
 *     4× speed): quick race to the results, an arcade race to the shop and the next pre-race screen,
 *     a battle to the winner, a league round to the table; pause and resume
 *   - one race frame per world
 * Screenshots go to out/.
 *   node scripts/check-browser.mjs
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

if (!existsSync("dist/index.html")) {
  console.error("run `bun run build` first");
  process.exit(1);
}
const html = readFileSync("dist/index.html");
const server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html)).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;
mkdirSync("out", { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });
let failed = 0;
const check = (ok, label, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? " " + extra : ""}`);
};

async function open(vp, hash = "") {
  const phone = vp === "phone";
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone });
  await ctx.route((u) => !u.href.startsWith(base), (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && !m.text().includes("net::ERR_FAILED") && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("overdrift:settings", JSON.stringify({ music: false, sfx: false, touch: "auto", unlockAll: true }));
  });
  await page.goto(base + hash);
  await page.reload(); // a hash-only navigation does not reload the page
  await page.waitForSelector(".big-menu");
  return { ctx, page, errors };
}

const noSideScroll = (page) => page.evaluate(() => document.getElementById("screen").scrollWidth <= window.innerWidth);
const act = (page, a, v) => page.click(v === undefined ? `#screen [data-act="${a}"]` : `#screen [data-act="${a}"][data-v="${v}"]`);
const waitText = (page, text, timeout = 120000) => page.waitForFunction((t) => !document.getElementById("screen").hidden && document.getElementById("screen").textContent.includes(t), text, { timeout });

for (const vp of ["phone", "desktop"]) {
  const { ctx, page, errors } = await open(vp, "#autopilot-fast");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `out/${vp}-title.png` });
  check(await noSideScroll(page), `${vp} title fits the width`);

  for (const [a, label] of [["howto", "how to play"], ["settings", "settings"], ["quick", "quick race setup"], ["battle", "battle setup"], ["league", "league setup"]]) {
    await act(page, a);
    await page.waitForTimeout(150);
    check(await noSideScroll(page), `${vp} ${label} fits the width`);
    await page.screenshot({ path: `out/${vp}-${a}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".big-menu");
  }

  // Quick race, one lap, to the results.
  await act(page, "quick");
  await act(page, "laps", 1);
  await act(page, "go");
  await page.waitForTimeout(4500);
  check(await page.evaluate(() => !document.getElementById("hud").hidden), `${vp} race HUD visible`);
  check(vp !== "phone" || (await page.evaluate(() => !document.getElementById("touch").hidden)), `${vp} touch controls shown on touch screens`);
  await page.screenshot({ path: `out/${vp}-race.png` });
  // Pause and resume.
  await page.keyboard.press("Escape");
  await waitText(page, "Paused", 3000).catch(() => {});
  check(await page.evaluate(() => document.getElementById("screen").textContent.includes("Paused")), `${vp} pause menu opens`);
  await act(page, "resume");
  await waitText(page, "results");
  check(await page.evaluate(() => document.querySelectorAll("#screen tbody tr").length === 5), `${vp} quick race results list five drivers`);
  await page.screenshot({ path: `out/${vp}-quick-results.png`, fullPage: true });
  await act(page, "menu");
  await page.waitForSelector(".big-menu");

  // Arcade: first car, world, race, shop, next race.
  await act(page, "arcade");
  await act(page, "buy", "buggy");
  await act(page, "pick", "sports");
  await waitText(page, "Race 1 of 7");
  await page.screenshot({ path: `out/${vp}-prerace.png`, fullPage: true });
  await act(page, "go");
  await waitText(page, "Earnings", 180000);
  await page.screenshot({ path: `out/${vp}-arcade-results.png`, fullPage: true });
  const qualified = await page.evaluate(() => document.querySelector("#screen .banner")?.textContent ?? "");
  await act(page, "next");
  await waitText(page, "Garage & shop");
  check(await noSideScroll(page), `${vp} shop fits the width`);
  const before = await page.evaluate(() => document.querySelector("#screen .money").textContent);
  await page.click('#screen [data-act="up"][data-v="tyres"]');
  const after = await page.evaluate(() => document.querySelector("#screen .money").textContent);
  check(before !== after, `${vp} upgrade bought`, `${before} → ${after}`);
  await page.screenshot({ path: `out/${vp}-shop.png`, fullPage: true });
  await act(page, "next");
  await waitText(page, qualified.includes("Qualified") ? "Race 2 of 7" : "Race 1 of 7");
  check(true, `${vp} arcade flow back to the pre-race screen`, `(${qualified.trim()})`);
  await act(page, "back");
  await page.waitForSelector(".big-menu");

  // Battle to the winner.
  await act(page, "battle");
  await act(page, "target", 5);
  await act(page, "go");
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `out/${vp}-battle.png` });
  await waitText(page, "wins the battle");
  check(true, `${vp} battle finished`);
  await act(page, "menu");
  await page.waitForSelector(".big-menu");

  // League: three computer drivers, one round.
  await act(page, "league");
  await act(page, "drivers", 3);
  await act(page, "humans", 0);
  await act(page, "go");
  await waitText(page, "round 1 of");
  await act(page, "go");
  await waitText(page, "round 2 of");
  check(await page.evaluate(() => document.querySelectorAll("#screen tbody tr").length === 3), `${vp} league table after round 1`);
  await page.screenshot({ path: `out/${vp}-league.png`, fullPage: true });
  await act(page, "menu");

  check(errors.length === 0, `${vp} no console errors`, errors.join(" | "));
  await ctx.close();
}

// One race frame per world (desktop, driven by the autopilot at normal speed).
{
  const { ctx, page, errors } = await open("desktop", "#autopilot");
  for (const w of ["sports", "canyon", "forest", "space", "moon", "alien"]) {
    await act(page, "quick");
    await act(page, "world", w);
    await act(page, "track", 4);
    await act(page, "go");
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `out/world-${w}.png` });
    await page.keyboard.press("Escape");
    await waitText(page, "Paused", 3000);
    await act(page, "quit");
    await page.waitForSelector(".big-menu");
  }
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(n / 1.5); }; requestAnimationFrame(f); }));
  console.log(`info desktop menu frame rate ${fps.toFixed(0)} fps`);
  check(errors.length === 0, "world frames without console errors", errors.join(" | "));
  await ctx.close();
}

await browser.close();
server.close();
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all browser checks passed");
