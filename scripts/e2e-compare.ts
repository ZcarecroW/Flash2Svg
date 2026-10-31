// E2E step 2: renders frames of each extracted fixture with the static renderer, rasterises them
// in Edge (the real target; resvg alongside for information) and compares against Animate's own
// PNG export.
// Usage: node scripts/e2e-compare.ts [name,name,...] [--every=N] [--threshold=0.003] [--browser=msedge]
//   [--images=jpeg|webp|avif|lossless]: re-encode the bitmaps first (lossy format, or all lossless)
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { nodeWasmLoader } from "../src/cli/wasm.ts";
import { createContext, type FileSource } from "../src/core/context.ts";
import { createCodecs } from "../src/core/codecs.ts";
import { encodeImages, type ImageSettings } from "../src/core/images.ts";
import { renderStatic } from "../src/core/emit/static.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const every = parseInt(opt("every", "6"), 10);
// Share of pixels that may differ from Animate's PNG: anti-aliasing and font hinting only.
const threshold = parseFloat(opt("threshold", "0.003"));
const list = args.find((a) => !a.startsWith("--"));
// f22: Animate snaps the strokes of the scaled 9-slice panel to whole pixels and hints the
// dynamic text; our geometry is the unsnapped one. f31 is mostly text: Animate hints glyphs
// (same outlines and positions, edge pixels differ). f35: Animate never draws a stroke thinner
// than a pixel (the box flipping through scale 0); f40: strokes that scale only horizontally or
// vertically are drawn as normal strokes (both are known limits). f45: where a shape that splits
// overlaps itself during the tween, Animate's rendering leaves the overlap empty; its SVG export
// (what we follow) fills it.
const TOLERANCE: Record<string, number> = { "f22-layers": 0.006, "f31-text2": 0.008, "f35-edge": 0.005, "f40-strokes": 0.004, "f45-morph": 0.012 };
const imagesOpt = opt("images", "");
const images: Partial<ImageSettings> | null = !imagesOpt ? null : imagesOpt === "lossless" ? {} : { imageLossy: imagesOpt as ImageSettings["imageLossy"] };
const codecs = createCodecs(nodeWasmLoader());
const names = list ? list.split(",") : readdirSync(out).filter((d) => existsSync(join(out, d, "model", "scene.json")));

interface Row {
	name: string;
	frame: number;
	diff: number;
	/** resvg's result, for information (it lacks some blend modes and extreme image scaling). */
	resvg: number;
}
// resvg (for information) runs in a child process: it panics on some inputs (far off-stage
// coordinates, which Animate produces itself for tweens starting at scale 0; some stretched bitmap
// pieces), and a Rust panic ends the process. A dead worker is restarted, that frame is "n/a".
let worker: ChildProcess | null = null;
let job = 0;
function renderResvg(svg: string, width: number): Promise<Buffer | string> {
	worker ??= fork(join(repo, "scripts", "lib", "resvg-worker.mjs"), { stdio: ["ignore", "ignore", "ignore", "ipc"] });
	const w = worker;
	const id = ++job;
	return new Promise((resolve) => {
		const onMsg = (m: { id: number; png?: string; error?: string }) => {
			if (m.id !== id) return;
			w.off("message", onMsg);
			w.off("exit", onExit);
			resolve(m.png ? Buffer.from(m.png, "base64") : `error ${m.error}`);
		};
		const onExit = () => {
			w.off("message", onMsg);
			if (worker === w) worker = null;
			resolve("n/a (resvg crashed)");
		};
		w.on("message", onMsg);
		w.once("exit", onExit);
		w.send({ id, svg, width });
	});
}

const browser = await chromium.launch({ channel: opt("browser", "msedge"), headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const rows: Row[] = [];
let failed = 0;

for (const name of names) {
	const dir = join(out, name);
	const modelDir = join(dir, "model");
	let model: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	let files: FileSource = {
		readText: (rel) => readFileSync(join(modelDir, rel), "utf8"),
		readBinary: (rel) => readFileSync(join(modelDir, rel)),
	};
	if (images) {
		// "lossless": every bitmap of this document (the modes are read by name)
		const modes = imagesOpt === "lossless" ? Object.fromEntries(Object.values(model.bitmaps).map((b) => [b.name, "lossless" as const])) : {};
		const r = await encodeImages(model, files, { ...images, imageModes: modes, includeHiddenLayers: false, includeGuides: false }, codecs);
		({ model, files } = r);
		for (const x of r.report) {
			const px = x.width < x.sourceWidth || x.height < x.sourceHeight ? `, ${x.width}x${x.height} of ${x.sourceWidth}x${x.sourceHeight}` : "";
			console.log(`${name} ${x.name}: ${x.mode} ${x.format} ${x.bytes} B${px} (lossless master ${x.sourceBytes} B)`);
		}
	}
	const ctx = createContext(model, files, { smooth: true, includeHiddenLayers: false, includeGuides: false, digits: 2 });
	const root = model.roots[0]!;
	const count = ctx.programs[root]!.frameCount;
	const cmp = join(dir, "compare");
	mkdirSync(cmp, { recursive: true });
	const frames = new Set<number>();
	for (let f = 0; f < count; f += every) frames.add(f);
	frames.add(count - 1);
	for (const f of [...frames].sort((a, b) => a - b)) {
		const refFile = join(dir, "ref", `f${String(f + 1).padStart(4, "0")}.png`);
		const single = join(dir, "ref", "f.png");
		const refPath = existsSync(refFile) ? refFile : count === 1 && existsSync(single) ? single : null;
		if (!refPath) continue;
		const { svg } = renderStatic(ctx, root, { frame: f, movieClips: "first", includeBackground: true, embedImages: true, textAsOutlines: true });
		writeFileSync(join(cmp, `f${f + 1}.svg`), svg);
		const ref = PNG.sync.read(readFileSync(refPath));
		// Animate exports PNGs with a transparent stage: composite over the stage colour
		const bg = model.doc.backgroundColor;
		const br = parseInt(bg.slice(1, 3), 16),
			bgG = parseInt(bg.slice(3, 5), 16),
			bb = parseInt(bg.slice(5, 7), 16);
		for (let i = 0; i < ref.data.length; i += 4) {
			const a = ref.data[i + 3]! / 255;
			ref.data[i] = Math.round(ref.data[i]! * a + br * (1 - a));
			ref.data[i + 1] = Math.round(ref.data[i + 1]! * a + bgG * (1 - a));
			ref.data[i + 2] = Math.round(ref.data[i + 2]! * a + bb * (1 - a));
			ref.data[i + 3] = 255;
		}
		const compare = (png: PNG) => {
			if (png.width !== ref.width || png.height !== ref.height) return { ratio: 1, diffPng: null };
			const diffPng = new PNG({ width: ref.width, height: ref.height });
			const bad = pixelmatch(ref.data, png.data, diffPng.data, ref.width, ref.height, { threshold: 0.15, includeAA: false });
			return { ratio: bad / (ref.width * ref.height), diffPng };
		};
		let resvg = NaN;
		if (!args.includes("--no-resvg")) {
			const r = await renderResvg(svg, ref.width);
			if (typeof r === "string") console.log(`${name} frame ${f + 1}: resvg ${r}`);
			else resvg = compare(PNG.sync.read(r)).ratio;
		}
		await page.setViewportSize({ width: ref.width, height: ref.height });
		await page.goto(pathToFileURL(join(cmp, `f${f + 1}.svg`)).href);
		await page.waitForLoadState("load");
		const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: ref.width, height: ref.height } }));
		const { ratio, diffPng } = compare(png);
		if (!diffPng) {
			console.log(`${name} frame ${f + 1}: size ${png.width}x${png.height} vs ref ${ref.width}x${ref.height}`);
			failed++;
			continue;
		}
		rows.push({ name, frame: f + 1, diff: ratio, resvg });
		if (ratio > (TOLERANCE[name] ?? threshold)) {
			failed++;
			writeFileSync(join(cmp, `f${f + 1}-ours.png`), PNG.sync.write(png));
			writeFileSync(join(cmp, `f${f + 1}-diff.png`), PNG.sync.write(diffPng));
		}
	}
	if (ctx.warnings.length) console.log(`${name} warnings: ${ctx.warnings.join(" | ")}`);
}

const byName = new Map<string, Row[]>();
for (const r of rows) (byName.get(r.name) ?? byName.set(r.name, []).get(r.name)!).push(r);
for (const [name, rs] of byName) {
	const worst = rs.reduce((a, b) => (b.diff > a.diff ? b : a));
	const okCount = rs.filter((r) => r.diff <= (TOLERANCE[name] ?? threshold)).length;
	const done = rs.filter((r) => !Number.isNaN(r.resvg));
	const resvgNote = done.length ? `${(Math.max(...done.map((r) => r.resvg)) * 100).toFixed(2)}%` : "n/a";
	const na = rs.length - done.length;
	console.log(`${name.padEnd(20)} ${okCount}/${rs.length} frames ok, worst frame ${worst.frame}: ${(worst.diff * 100).toFixed(2)}% pixels differ (resvg ${resvgNote}${done.length && na ? `, ${na} frame(s) n/a` : ""})`);
}
await browser.close();
(worker as ChildProcess | null)?.kill();
process.exitCode = failed ? 1 : 0;
