// E2E step 3: checks the animated outputs (SMIL, CSS, player) in a real browser (Edge/Chrome via
// playwright-core). At sampled frame times the animation is paused & seeked, screenshotted and
// compared with the static renderer's frame rendered in the same browser.
// Usage: node scripts/e2e-browser.ts [name,...] [--formats=smil,css] [--every=4] [--browser=msedge]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene, type OutputFormat } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const formats = opt("formats", "smil,css").split(",") as OutputFormat[];
const every = parseInt(opt("every", "4"), 10);
const threshold = parseFloat(opt("threshold", "0.01"));
const list = args.find((a) => !a.startsWith("--"));
const names = list ? list.split(",") : readdirSync(out).filter((d) => existsSync(join(out, d, "model", "scene.json")));

const browser = await chromium.launch({ channel: opt("browser", "msedge"), headless: true });
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
				for (const a of document.getAnimations()) {
					a.pause();
					a.currentTime = time * 1000;
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
	const model: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	const dir = join(out, name, "browser");
	mkdirSync(dir, { recursive: true });
	const { width, height, frameRate } = model.doc;
	const statics = compileScene(model, files, { format: "static", includeBackground: true });
	const frameCount = statics.files.length;
	for (const format of formats) {
		const anim = compileScene(model, files, { format, includeBackground: true });
		const file = join(dir, `${format}.svg`);
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
			const got = await shot(file, width, height, { format, time: (f + 0.02) / frameRate });
			const diff = new PNG({ width: ref.width, height: ref.height });
			const bad = pixelmatch(ref.data, got.data, diff.data, ref.width, ref.height, { threshold: 0.15, includeAA: false });
			const ratio = bad / (ref.width * ref.height);
			n++;
			if (ratio <= threshold) ok++;
			else {
				writeFileSync(join(dir, `${format}-f${f + 1}-got.png`), PNG.sync.write(got));
				writeFileSync(join(dir, `${format}-f${f + 1}-diff.png`), PNG.sync.write(diff));
			}
			if (ratio > worst) {
				worst = ratio;
				worstFrame = f + 1;
			}
		}
		if (ok < n) failures++;
		console.log(`${name.padEnd(18)} ${format.padEnd(6)} ${ok}/${n} frames ok, worst frame ${worstFrame}: ${(worst * 100).toFixed(2)}%  (${(anim.stats.bytes / 1024).toFixed(1)} KB)`);
	}
}
await browser.close();
process.exitCode = failures ? 1 : 0;
