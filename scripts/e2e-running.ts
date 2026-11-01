// E2E: running animations draw what paused ones draw. The other browser checks pause and seek
// the animation, and a paused frame is drawn by the browser's main thread; a running one may be
// drawn by the compositor, which has its own bugs (Chromium 156 dropped `translate`/`scale` while a
// separate `transform` animation of the same element ran: the guide's banner button sat at 0,0).
// For each sample time the CSS output is drawn paused at that time, then running at a playback rate
// so low that it doesn't move (the compositor takes it, the time stays) — the two must agree.
// Covers the test documents (tests/out) and the user guide's demos.
// Usage: node scripts/e2e-running.ts [name,...] [--browser=msedge|firefox|webkit] [--samples=6]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium, firefox, webkit } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";
import { withFonts } from "./lib/fonts.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const demos = join(repo, "docs", "guide", "demos", "models");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const samples = parseInt(opt("samples", "6"), 10);
const list = args.find((a) => !a.startsWith("--"))?.split(",");
// compositor rasters snap differently by a pixel at most: allow anti-aliasing, not a moved object
const LIMIT = 0.002;

const docs: { name: string; dir: string; work: string }[] = [
	...readdirSync(out)
		.filter((d) => existsSync(join(out, d, "model", "scene.json")))
		.map((d) => ({ name: d, dir: join(out, d, "model"), work: join(out, d, "running") })),
	...(existsSync(demos) ? readdirSync(demos) : [])
		.filter((d) => existsSync(join(demos, d, "scene.json")))
		.map((d) => ({ name: `guide:${d}`, dir: join(demos, d), work: join(out, "guide-demos", d) })),
].filter((d) => !list || list.includes(d.name));

const engine = opt("browser", "msedge");
const browser =
	engine === "firefox"
		? await firefox.launch({
				channel: "moz-firefox",
				headless: true,
				firefoxUserPrefs: { "security.sandbox.content.level": 0 },
				env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" },
			})
		: engine === "webkit"
			? await webkit.launch({ headless: true })
			: await chromium.launch({ channel: engine, headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** Videos hidden (not copied here; engines draw a missing one differently). */
const noVideo = (svg: string) => svg.replace(/<video ([^>]*?)style="/g, '<video $1style="visibility:hidden;');

async function shoot(width: number, height: number, ms: number, running: boolean): Promise<PNG> {
	await page.evaluate(
		({ ms, running }) => {
			for (const a of document.getAnimations()) {
				a.pause();
				a.currentTime = ms;
				// (play() on a finished animation would start it over: those just hold their end)
				if (running && ms < (a.effect?.getComputedTiming().endTime as number)) {
					a.playbackRate = 1e-6;
					a.play();
				}
			}
		},
		{ ms, running },
	);
	// two frames for the compositor to take the running animations over
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	await page.waitForTimeout(running ? 60 : 0);
	const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width, height } }));
	await page.evaluate(() => {
		for (const a of document.getAnimations()) {
			a.pause();
			a.playbackRate = 1;
		}
	});
	return png;
}

let failures = 0;
for (const d of docs) {
	const model: SceneModel = await withFonts(JSON.parse(readFileSync(join(d.dir, "scene.json"), "utf8")));
	const files = { readText: (r: string) => readFileSync(join(d.dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(d.dir, r)) };
	const res = compileScene(model, files, { format: "css", includeBackground: true });
	const svg = res.files[0]?.svg;
	if (!svg || !/@keyframes/.test(svg)) continue;
	mkdirSync(d.work, { recursive: true });
	const file = join(d.work, "css.svg");
	writeFileSync(file, noVideo(svg));
	const width = Math.ceil(model.doc.width),
		height = Math.ceil(model.doc.height);
	await page.setViewportSize({ width, height });
	await page.goto(pathToFileURL(file).href);
	await page.waitForLoadState("load");
	const dur = res.stats.durationSeconds * 1000 || 1000;
	let worst = 0,
		worstAt = 0;
	for (let i = 0; i < samples; i++) {
		// (off the even fractions where keyframes and steps sit: a step exactly at the sample time may
		// round either way)
		const ms = Math.round(((i + 0.43) / samples) * dur);
		const still = await shoot(width, height, ms, false);
		const run = await shoot(width, height, ms, true);
		const diff = new PNG({ width, height });
		const ratio = pixelmatch(still.data, run.data, diff.data, width, height, { threshold: 0.15, includeAA: false }) / (width * height);
		if (ratio > worst) {
			worst = ratio;
			worstAt = ms;
			if (ratio > LIMIT) {
				writeFileSync(join(d.work, `css-${ms}ms-running.png`), PNG.sync.write(run));
				writeFileSync(join(d.work, `css-${ms}ms-diff.png`), PNG.sync.write(diff));
			}
		}
	}
	const ok = worst <= LIMIT;
	if (!ok) failures++;
	console.log(`${d.name.padEnd(22)} css ${ok ? "ok  " : "FAIL"} worst ${(worst * 100).toFixed(2)}% at ${worstAt} ms`);
}
await browser.close();
console.log(
	failures
		? `running: ${failures} document(s) draw differently while running`
		: `running: all ${docs.length} documents draw the same running and paused (${engine})`,
);
process.exitCode = failures ? 1 : 0;
