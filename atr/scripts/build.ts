/**
 * Builds the game as one HTML file (CSS and JS inline):
 *   dist/overdrift.html  fragment for the claude.ai artifact (the platform adds the document skeleton)
 *   dist/index.html      complete document for any static web server or opening locally
 * Fonts come from Google Fonts; without them the system fallbacks are used.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BUDGET_BYTES = 400 * 1024;

const result = await Bun.build({
  entrypoints: ["src/app/main.ts"],
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "none",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const js = (await result.outputs[0].text()).replaceAll("</script", "<\\/script");
const shell = readFileSync("src/app/shell.html", "utf8");
const fragment = `${shell.trimEnd()}\n<script type="module">${js}</script>\n`;
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${fragment}</body>
</html>
`;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/overdrift.html", fragment);
writeFileSync("dist/index.html", page);
const bytes = Buffer.byteLength(fragment);
console.log(`dist/overdrift.html: ${(bytes / 1024).toFixed(0)} KiB (budget ${(BUDGET_BYTES / 1024).toFixed(0)} KiB)`);
if (bytes > BUDGET_BYTES) {
  console.error("size budget exceeded");
  process.exit(1);
}
