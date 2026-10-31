// E2E: the raster fallbacks (animated GIF, animated WebP) frame by frame in the browser. Each
// frame is decoded with ImageDecoder (WebCodecs) at the time of a tick and compared with the
// static renderer's frame for that tick, drawn by the same browser. GIF has 256 colours a frame,
// WebP is lossy: compared with pixelmatch's colour threshold, a little looser than the SVG checks.
// The files last as long as the SVG formats' first pass (bake.ts rootTicks): movie clips that keep
// running on a one-frame main timeline, or after a stop(), play on.
// Usage: node scripts/e2e-raster.ts [name,...] [--every=6]
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright-core";
import { compileScene } from "../src/core/compile.ts";
import { createCodecs } from "../src/core/codecs.ts";
import { createContext } from "../src/core/context.ts";
import { renderStatic } from "../src/core/emit/static.ts";
import { rootTicks } from "../src/core/emit/bake.ts";
import type { SceneModel } from "../src/core/model.ts";
import { exportRaster } from "../src/core/raster.ts";
import { nodeRasterizer } from "../src/cli/raster-node.ts";
import { nodeWasmLoader } from "../src/cli/wasm.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const every = parseInt(args.find((a) => a.startsWith("--every="))?.slice(8) ?? "6", 10);
const names = (
	args.find((a) => !a.startsWith("--")) ?? "f03-transforms,f04-nested,f04-nested@60,f18-bitmap,f27-stop,f28-onestop,f25-paint,f42-images,f35-edge"
).split(",");
const LIMIT = { gif: 0.02, webp: 0.01 };
const loader = nodeWasmLoader();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
// ImageDecoder needs a secure context: a page from localhost
const server = createServer((_, res) => void res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>raster</title>"));
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
let failures = 0;

for (const name of names) {
	// "name@60": the document at another frame rate (above 50 fps a GIF has to leave pictures out)
	const [doc, fps] = name.split("@");
	const modelDir = join(out, doc!, "model");
	if (!existsSync(join(modelDir, "scene.json"))) continue;
	const model: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	if (fps) model.doc.frameRate = Number(fps);
	const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	const { width, height, frameRate } = model.doc;
	const W = Math.round(width),
		H = Math.round(height);
	const ctx = createContext(model, files, { smooth: true, includeHiddenLayers: true, includeGuides: false, digits: 2 });
	const rootId = model.roots[0]!;
	const ticks = rootTicks(ctx, rootId, { loop: "auto" });
	const pass = ticks.frames;
	// GIF and WebP repeat from the start whenever the SVG repeats something
	const loops = ticks.horizon.loop || ticks.horizon.tail > 0;
	for (const format of ["gif", "webp"] as const) {
		const t0 = performance.now();
		const r = await exportRaster(model, files, { format, includeBackground: true }, nodeRasterizer(loader), createCodecs(loader));
		const ms = performance.now() - t0;
		const bytes = r.files[0]!.bytes!;
		// what a browser's decoder reads: no frame so short that browsers show it for 100 ms, the
		// whole length, and the repetition (a loop: forever)
		const info = await page.evaluate(
			async ({ data, type }) => {
				const dec = new ImageDecoder({ data: new Uint8Array(data), type });
				await dec.tracks.ready;
				const track = dec.tracks.selectedTrack!;
				const ds: number[] = [];
				for (let i = 0; i < track.frameCount; i++) {
					const { image } = await dec.decode({ frameIndex: i });
					ds.push((image.duration ?? 0) / 1000);
					image.close();
				}
				return { ds, repeat: track.repetitionCount };
			},
			{ data: Array.from(bytes), type: `image/${format}` },
		);
		const total = info.ds.reduce((a, b) => a + b, 0);
		const short = info.ds.filter((d) => d <= 10).length;
		const repeats = info.ds.length < 2 || (info.repeat === Infinity) === loops;
		const timing = !short && Math.abs(total / 1000 - r.stats.durationSeconds) < 0.011 && repeats;
		if (!timing) {
			failures++;
			console.log(
				`${name} ${format}: ${short} frame(s) of 10 ms or less, ${(total / 1000).toFixed(3)} s for ${r.stats.durationSeconds.toFixed(3)} s, repetition ${info.repeat} (${loops ? "should loop" : "should play once"})`,
			);
		}
		let worst = 0,
			worstTick = -1,
			ok = 0,
			n = 0;
		for (let t = 0; t < pass.length; t += every) {
			const ref = renderStatic(ctx, rootId, {
				frame: pass[t]!,
				ticks: t,
				movieClips: "play",
				includeBackground: true,
				embedImages: true,
				textAsOutlines: true,
			}).svg;
			const [a, b] = await page.evaluate(
				async ({ ref, data, type, at, W, H }) => {
					const draw = async (src: CanvasImageSource) => {
						const c = new OffscreenCanvas(W, H);
						const g = c.getContext("2d")!;
						g.drawImage(src, 0, 0, W, H);
						return Array.from(g.getImageData(0, 0, W, H).data);
					};
					const img = new Image(W, H);
					img.src = URL.createObjectURL(new Blob([ref], { type: "image/svg+xml" }));
					await img.decode();
					const dec = new ImageDecoder({ data: new Uint8Array(data), type });
					await dec.tracks.ready;
					const count = dec.tracks.selectedTrack!.frameCount;
					// the frame showing at time `at` (µs)
					let frame = null as VideoFrame | null;
					for (let i = 0, start = 0; i < count; i++) {
						const { image } = await dec.decode({ frameIndex: i });
						const end = start + (image.duration ?? 0);
						if (at < end || i === count - 1) {
							frame = image;
							break;
						}
						start = end;
						image.close();
					}
					const got = await draw(frame!);
					frame!.close();
					return [await draw(img), got];
				},
				{ ref, data: Array.from(bytes), type: `image/${format}`, at: ((t + 0.5) / frameRate) * 1e6, W, H },
			);
			const bad = pixelmatch(Uint8Array.from(a), Uint8Array.from(b), null, W, H, { threshold: 0.15, includeAA: false }) / (W * H);
			n++;
			if (bad <= LIMIT[format]) ok++;
			if (bad > worst) [worst, worstTick] = [bad, t];
		}
		// as long as the SVG's pass (a GIF of a one-frame main timeline was one still picture)
		const long = Math.abs(r.stats.durationSeconds - pass.length / frameRate) < 0.5 / frameRate;
		if (ok < n || !long) failures++;
		if (!long) console.log(`${name} ${format}: lasts ${r.stats.durationSeconds.toFixed(2)} s, the SVG formats ${(pass.length / frameRate).toFixed(2)} s`);
		console.log(
			`${name.padEnd(16)} ${format.padEnd(5)} ${ok}/${n} frames ok, worst tick ${worstTick}: ${(worst * 100).toFixed(2)}%  (${(bytes.length / 1024).toFixed(1)} KB, ${r.stats.durationSeconds.toFixed(2)} s, exported in ${ms.toFixed(0)} ms)`,
		);
	}
}
await browser.close();
server.close();
console.log(failures ? `\nRaster: ${failures} FAILED` : "\nRaster: all good");
process.exit(failures ? 1 : 0);
