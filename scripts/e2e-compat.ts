// CSS output in browsers from before 2023 (Safari 17.1, Chrome 112, Firefox 111), which can't read
// linear() timing functions: simulated in Edge by making "linear(" unreadable. Every animation a
// current browser runs must still run (keyframes.ts writes a classic timing before each linear()).
// Usage: node scripts/e2e-compat.ts
import { chromium } from "playwright-core";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { compileScene } from "../src/core/compile.ts";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
let worse = 0,
	total = 0;
for (const f of readdirSync("tests/out").filter((d) => /^f\d\d-/.test(d))) {
	const dir = join("tests/out", f, "model");
	if (!existsSync(join(dir, "scene.json"))) continue;
	const model = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	const files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) };
	const svg = compileScene(model, files, { format: "css" }).files[0]!.svg;
	if (!svg.includes("linear(")) continue;
	total++;
	const count = async (s: string) => {
		await page.setContent(`<!doctype html><body>${s}</body>`);
		await page.waitForTimeout(50);
		return page.evaluate(() => document.getAnimations().length);
	};
	const now = await count(svg);
	const old = await count(svg.replaceAll("linear(", "linearx("));
	// without the fallbacks: drop the classic declaration written before each linear() one
	const bare = svg.replace(/(animation(?:-timing-function)?:)[^;{}]*;(?=animation(?:-timing-function)?:[^;{}]*linear\()/g, "");
	const oldBare = await count(bare.replaceAll("linear(", "linearx("));
	if (old < now) worse++;
	console.log(`${f.padEnd(22)} ${old < now ? "FAIL" : "ok  "} animations: current browser ${now}, older browser ${old} (without the fallbacks ${oldBare})`);
}
await browser.close();
console.log(`
${total} CSS exports use linear(); ${worse ? worse + " lose animations in older browsers: FAILED" : "older browsers run all their animations: all good"}`);
process.exitCode = worse ? 1 : 0;
