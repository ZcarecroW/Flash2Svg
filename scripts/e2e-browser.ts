// E2E step 3: checks the animated outputs (SMIL, CSS, player) in a real browser (Edge/Chrome via
// playwright-core). At sampled frame times the animation is paused & seeked, screenshotted and
// compared with the static renderer's frame rendered in the same browser.
// --steps: export without interpolation (one step per frame) and check halfway between frames.
// After a stop() on the root timeline, ticks into the looping tail of the running movie clips are
// checked too (reported as negative "frames").
// Usage: node scripts/e2e-browser.ts [name,...] [--formats=smil,css] [--every=4] [--browser=msedge|chrome|firefox|webkit] [--steps] [--threshold=0.0015]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium, firefox, webkit } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene, type OutputFormat } from "../src/core/compile.ts";
import { createContext } from "../src/core/context.ts";
import { renderStatic } from "../src/core/emit/static.ts";
import { playhead, playheadFrame } from "../src/core/emit/timing.ts";
import { withFonts } from "./lib/fonts.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const formats = opt("formats", "smil,css").split(",") as OutputFormat[];
const every = parseInt(opt("every", "4"), 10);
// Animated and static output come from the same compiler, so they must agree almost exactly:
// 0.15% of the pixels is about a 15 px object on a 400x300 stage.
const threshold = parseFloat(opt("threshold", "0.0015"));
const TOLERANCE: Record<string, number> = {};
const limit = (name: string, format: string) => TOLERANCE[`${name}/${format}`] ?? threshold;
const steps = args.includes("--steps");
const list = args.find((a) => !a.startsWith("--"));
const names = list ? list.split(",") : readdirSync(out).filter((d) => existsSync(join(out, d, "model", "scene.json")));

// --browser=firefox: the installed Firefox over WebDriver BiDi (content sandbox off: it crashes
// headless content processes here); --browser=webkit: Playwright's WebKit build (needs a one-off
// `node node_modules/playwright-core/cli.js install webkit`); else an installed Chromium channel
const engine = opt("browser", "msedge");
const browser =
	engine === "firefox"
		? await firefox.launch({ channel: "moz-firefox", headless: true, firefoxUserPrefs: { "security.sandbox.content.level": 0 }, env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" } })
		: engine === "webkit"
			? await webkit.launch({ headless: true })
			: await chromium.launch({ channel: engine, headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
let failures = 0;

async function shot(file: string, width: number, height: number, seek: { format: string; time: number } | null): Promise<PNG> {
	await page.setViewportSize({ width: Math.ceil(width), height: Math.ceil(height) });
	await page.goto(pathToFileURL(file).href);
	await page.waitForLoadState("load");
	if (seek) {
		await page.evaluate(({ format, time }) => {
			const svg = document.documentElement as unknown as SVGSVGElement;
			if (format === "smil") {
				svg.pauseAnimations();
				svg.setCurrentTime(time);
			} else if (format === "css") {
				// Commit the seeked values as static styles: Edge rasterises running CSS animations on the
				// compositor with its own sub-pixel snap (a moving box lands 1 px off), which would hide
				// real differences behind a looser tolerance.
				for (const a of document.getAnimations()) {
					a.pause();
					a.currentTime = time * 1000;
					a.commitStyles();
					a.cancel();
				}
				svg.pauseAnimations?.();
				svg.setCurrentTime?.(time);
			} else if (format === "player") {
				const p = (svg as unknown as { flash2svg?: { seek(t: number): void; pause(): void } }).flash2svg;
				p?.pause();
				p?.seek(time);
				p?.pause();
			}
		}, seek);
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	}
	const buf = await page.screenshot({ clip: { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) } });
	return PNG.sync.read(buf);
}

for (const name of names) {
	const modelDir = join(out, name, "model");
	const model: SceneModel = await withFonts(JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8")));
	const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	const dir = join(out, name, "browser");
	mkdirSync(dir, { recursive: true });
	const { width, height, frameRate } = model.doc;
	const statics = compileScene(model, files, { format: "static", includeBackground: true });
	const frameCount = statics.files.length;
	// A root that stops (stop() script) leaves its movie clips running: check ticks after the stop,
	// into the looping tail, against static renders of the last frame at those ticks.
	const ctx = createContext(model, files, { smooth: true, includeHiddenLayers: true, includeGuides: false, digits: 2 });
	const rootId = model.roots[0]!;
	const ph = playhead(ctx.programs[rootId]!);
	// after the stop, around the end of the first pass (SMIL/CSS switch to the tail there) and in the tail
	const firstStats = compileScene(model, files, { format: "smil" }).stats;
	const firstPass = firstStats.loopFrom ?? firstStats.frames;
	const stopTicks = !steps && !ph.cycle.length ? [...new Set([ph.prefix.length, ph.prefix.length + 6, firstPass - 1, firstPass + 3, firstPass + 29, 2 * firstPass + 11])] : [];
	const stopFrame = ph.prefix[ph.prefix.length - 1] ?? 0;
	// far ahead (the player finds where its state repeats instead of playing through): ticks with
	// the root frame they show
	const far = steps ? [] : [5003, 12347].map((t) => [t, playheadFrame(ctx.programs[rootId]!, t)] as const);
	for (const format of formats) {
		const anim = compileScene(model, files, { format, includeBackground: true, smooth: !steps });
		const file = join(dir, `${format}${steps ? "-steps" : ""}.svg`);
		writeFileSync(file, anim.files[0]!.svg);
		const horizon = Math.round(anim.stats.durationSeconds * frameRate);
		let worst = 0,
			worstFrame = -1,
			ok = 0,
			n = 0;
		for (let f = 0; f < Math.min(frameCount, horizon || frameCount); f += every) {
			const sfile = join(dir, `static-${f + 1}.svg`);
			writeFileSync(sfile, statics.files[f]!.svg);
			const ref = await shot(sfile, width, height, null);
			const got = await shot(file, width, height, { format, time: (f + (steps ? 0.5 : 0.02)) / frameRate });
			const diff = new PNG({ width: ref.width, height: ref.height });
			const bad = pixelmatch(ref.data, got.data, diff.data, ref.width, ref.height, { threshold: 0.15, includeAA: false });
			const ratio = bad / (ref.width * ref.height);
			n++;
			if (ratio <= limit(name, format)) ok++;
			else {
				writeFileSync(join(dir, `${format}-f${f + 1}-got.png`), PNG.sync.write(got));
				writeFileSync(join(dir, `${format}-f${f + 1}-diff.png`), PNG.sync.write(diff));
			}
			if (ratio > worst) {
				worst = ratio;
				worstFrame = f + 1;
			}
		}
		for (const [t, frame] of [...stopTicks.map((t) => [t, stopFrame] as const), ...far]) {
			const sfile = join(dir, `static-t${t}.svg`);
			writeFileSync(sfile, renderStatic(ctx, rootId, { frame, ticks: t, movieClips: "play", includeBackground: true, embedImages: true, textAsOutlines: true }).svg);
			const ref = await shot(sfile, width, height, null);
			const got = await shot(file, width, height, { format, time: (t + 0.02) / frameRate });
			const diff = new PNG({ width: ref.width, height: ref.height });
			const ratio = pixelmatch(ref.data, got.data, diff.data, ref.width, ref.height, { threshold: 0.15, includeAA: false }) / (ref.width * ref.height);
			n++;
			if (ratio <= limit(name, format)) ok++;
			else {
				writeFileSync(join(dir, `${format}-t${t}-got.png`), PNG.sync.write(got));
				writeFileSync(join(dir, `${format}-t${t}-diff.png`), PNG.sync.write(diff));
			}
			if (ratio > worst) {
				worst = ratio;
				worstFrame = -t;
			}
		}
		// the end state of a non-looping export: everything holds the last frame
		const once = compileScene(model, files, { format, includeBackground: true, smooth: !steps, loop: "never" });
		const onceFile = join(dir, `${format}${steps ? "-steps" : ""}-once.svg`);
		writeFileSync(onceFile, once.files[0]!.svg);
		const lastFrame = Math.min(frameCount, Math.round(once.stats.durationSeconds * frameRate) || frameCount) - 1;
		const lastFile = join(dir, `static-${lastFrame + 1}.svg`);
		writeFileSync(lastFile, statics.files[lastFrame]!.svg);
		const ref = await shot(lastFile, width, height, null);
		const got = await shot(onceFile, width, height, { format, time: once.stats.durationSeconds + 0.5 });
		const diff = new PNG({ width: ref.width, height: ref.height });
		const endRatio = pixelmatch(ref.data, got.data, diff.data, ref.width, ref.height, { threshold: 0.15, includeAA: false }) / (ref.width * ref.height);
		const endOk = endRatio <= limit(name, format);
		if (!endOk) {
			writeFileSync(join(dir, `${format}-end-got.png`), PNG.sync.write(got));
			writeFileSync(join(dir, `${format}-end-diff.png`), PNG.sync.write(diff));
		}
		if (ok < n || !endOk) failures++;
		console.log(
			`${name.padEnd(18)} ${(format + (steps ? "/st" : "")).padEnd(9)} ${ok}/${n} frames ok, worst frame ${worstFrame}: ${(worst * 100).toFixed(2)}%, ` +
				`end ${endOk ? "ok" : "FAIL"} ${(endRatio * 100).toFixed(2)}%  (${(anim.stats.bytes / 1024).toFixed(1)} KB)`,
		);
	}
}
await browser.close();
process.exitCode = failures ? 1 : 0;
