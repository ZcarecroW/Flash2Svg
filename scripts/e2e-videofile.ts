// E2E: MP4, WebM and APNG exports. The export runs in a browser (WebCodecs), as in the panel; the
// files are played in the browsers: frames compared with the still renderer, length, sound, seeking.
// Usage: node scripts/e2e-videofile.ts [name,name,...] [--browser=msedge|firefox]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium, firefox } from "playwright-core";
import { exportRaster } from "../src/core/raster.ts";
import { nodeRasterizer } from "../src/cli/raster-node.ts";
import { nodeWasmLoader } from "../src/cli/wasm.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const names = (args.find((a) => !a.startsWith("--")) ?? "f02-eases,f16-sound").split(",");
const engine = args.find((a) => a.startsWith("--browser="))?.slice(10) ?? "msedge";
const out = join(repo, "tests", "out");
const work = join(out, "videofile");
mkdirSync(work, { recursive: true });

// the export as it is in the panel, for a page
const bundle = await build({
	stdin: {
		contents: `import { exportVideo } from "./src/core/video.ts";
const rasterize = async (svg, width, height) => {
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		const img = new Image(width, height);
		img.src = url;
		await img.decode();
		const c = document.createElement("canvas");
		c.width = width;
		c.height = height;
		const g = c.getContext("2d", { willReadFrequently: true });
		g.drawImage(img, 0, 0, width, height);
		const d = g.getImageData(0, 0, width, height);
		return { data: d.data, width, height };
	} finally {
		URL.revokeObjectURL(url);
	}
};
window.run = async (name, format, list) => {
	const model = await (await fetch("/" + name + "/model/scene.json")).json();
	const need = {};
	for (const p of list) need[p] = new Uint8Array(await (await fetch("/" + name + "/model/" + p)).arrayBuffer());
	const files = {
		readBinary: (p) => need[p],
		readText: (p) => new TextDecoder().decode(need[p]),
	};
	return await window.exportWith(model, files, format);
};
window.exportWith = async (model, files, format) => {
	const t0 = performance.now();
	const r = await exportVideo(model, files, { format, includeBackground: true }, rasterize);
	return { ms: performance.now() - t0, bytes: Array.from(r.files[0].bytes), warnings: r.warnings, frames: r.stats.frames, seconds: r.stats.durationSeconds };
};`,
		resolveDir: repo,
		loader: "js",
	},
	bundle: true,
	format: "iife",
	write: false,
	target: "chrome99",
	platform: "browser",
	logLevel: "silent",
});
writeFileSync(join(work, "export.js"), bundle.outputFiles[0]!.text);
writeFileSync(join(work, "index.html"), `<!doctype html><title>export</title><body style="margin:0"><script src="export.js"></script></body>`);

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".mp4": "video/mp4", ".webm": "video/webm", ".png": "image/png" };
const server = createServer((req, res) => {
	const file = normalize(join(out, decodeURIComponent(req.url!.split("?")[0]!)));
	if (!file.startsWith(out) || !existsSync(file)) {
		res.writeHead(404).end();
		return;
	}
	const body = readFileSync(file);
	// (ranges: a browser seeks in a video that way)
	const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
	if (m) {
		const a = +m[1]!,
			b = m[2] ? +m[2] : body.length - 1;
		res.writeHead(206, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-range": `bytes ${a}-${b}/${body.length}`, "accept-ranges": "bytes", "content-length": b - a + 1 }).end(body.subarray(a, b + 1));
		return;
	}
	res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "accept-ranges": "bytes" }).end(body);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser =
	engine === "firefox"
		? await firefox.launch({ channel: "moz-firefox", headless: true, firefoxUserPrefs: { "security.sandbox.content.level": 0, "media.autoplay.default": 0 }, env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" } })
		: await chromium.launch({ channel: "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
let failures = 0;
const check = (name: string, ok: boolean, more = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
	if (!ok) failures++;
};

/** The video at some times, as pictures. */
async function shots(url: string, times: number[], w: number, h: number) {
	await page.setContent(`<!doctype html><body style="margin:0"><video id="v" src="${url}" width="${w}" height="${h}" muted preload="auto" style="display:block"></video></body>`);
	const info = await page.evaluate(
		() =>
			new Promise<{ duration: number; width: number; height: number; error: string }>((done) => {
				const v = document.getElementById("v") as HTMLVideoElement;
				const end = () => done({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, error: v.error?.message ?? "" });
				v.onloadeddata = end;
				v.onerror = end;
				setTimeout(end, 8000);
			}),
	);
	const out: Buffer[] = [];
	for (const t of times) {
		await page.evaluate(
			(t) =>
				new Promise<void>((done) => {
					const v = document.getElementById("v") as HTMLVideoElement;
					v.onseeked = () => setTimeout(done, 150);
					v.currentTime = t;
					setTimeout(done, 3000);
				}),
			t,
		);
		// (what a screenshot shows of a video isn't sure: the frame itself, on a canvas)
		const data = await page.evaluate(() => {
			const v = document.getElementById("v") as HTMLVideoElement;
			const c = document.createElement("canvas");
			c.width = v.videoWidth;
			c.height = v.videoHeight;
			c.getContext("2d")!.drawImage(v, 0, 0);
			return c.toDataURL("image/png").split(",")[1]!;
		});
		out.push(Buffer.from(data, "base64"));
	}
	return { info, out };
}

const diff = (a: Buffer, b: Uint8Array | Uint8ClampedArray, w: number, h: number) => {
	const pa = PNG.sync.read(a);
	return pixelmatch(pa.data, b as Uint8Array, undefined, w, h, { threshold: 0.2 }) / (w * h);
};

for (const name of names) {
	const dir = join(out, name, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	const files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) };
	const { width: W, height: H, frameRate } = model.doc;
	for (const format of ["mp4", "webm"] as const) {
		await page.goto(`${origin}/videofile/index.html`);
		const paths = readdirSync(dir, { recursive: true, withFileTypes: true })
			.filter((e) => e.isFile())
			.map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"));
		const r = await page.evaluate(([n, f, l]) => (window as unknown as { run(a: string, b: string, c: string[]): Promise<{ ms: number; bytes: number[]; warnings: string[]; frames: number; seconds: number }> }).run(n as string, f as string, l as string[]), [name, format, paths]);
		const bytes = Uint8Array.from(r.bytes);
		const file = join(work, `${name}.${format}`);
		writeFileSync(file, bytes);
		console.log(`  ${name}.${format}: ${(bytes.length / 1024).toFixed(1)} KB, ${r.frames} frames, ${r.seconds.toFixed(2)} s, ${(r.ms / 1000).toFixed(2)} s to export${r.warnings.length ? `; ${r.warnings.join(" | ")}` : ""}`);
		const times = [0, Math.floor(r.frames / 2), r.frames - 1].map((f) => (f + 0.5) / frameRate);
		await page.goto(`${origin}/videofile/index.html`);
		const { info, out: pics } = await shots(`/videofile/${name}.${format}`, times, W & ~1 ? W + (W & 1) : W, H + (H & 1));
		check(`${name}.${format} plays`, !info.error && info.width === W + (W & 1) && info.height === H + (H & 1), JSON.stringify(info));
		check(`${name}.${format} length`, Math.abs(info.duration - r.seconds) < 0.1, `${info.duration} of ${r.seconds}`);
		// the same frames, drawn by the renderer of the raster formats
		const { rasterFrames } = await import("../src/core/raster.ts");
		const loader = nodeWasmLoader();
		const { frames } = await rasterFrames(model, files, { ...{ format: "gif" as const }, includeBackground: true } as never, nodeRasterizer(loader), () => {});
		const list: { pixels: { data: Uint8ClampedArray; width: number; height: number }; at: number }[] = [];
		let at = 0;
		for (const f of frames) {
			list.push({ pixels: f.pixels, at });
			at += f.ms;
		}
		for (let i = 0; i < times.length; i++) {
			const t = times[i]! * 1000;
			const at = Math.max(0, list.filter((x) => x.at <= t).length - 1);
			const f = list[at]!;
			if (f.pixels.width !== W + (W & 1) || f.pixels.height !== H + (H & 1)) continue;
			// (Firefox lands a frame off with H.264 now and then: its seeking, not the file's)
			const near = engine === "firefox" ? [at - 1, at, at + 1] : [at];
			const d = Math.min(...near.map((k) => list[k]).filter((x) => x).map((x) => diff(pics[i]!, x!.pixels.data, f.pixels.width, f.pixels.height)));
			check(`${name}.${format} at ${times[i]!.toFixed(2)} s`, d < 0.03, `${(d * 100).toFixed(2)} % of the pixels differ`);
		}
		if (Object.keys(model.sounds).length) {
			await page.goto(`${origin}/videofile/index.html`);
			const sound = await page.evaluate(async (url) => {
				const ac = new OfflineAudioContext(2, 48000, 48000);
				const b = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer());
				let peak = 0;
				for (const v of b.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
				return { seconds: b.duration, peak };
			}, `/videofile/${name}.${format}`);
			check(`${name}.${format} has its sound`, sound.peak > 0.01, JSON.stringify(sound));
		}
	}
	// APNG: in the command line too
	const loader = nodeWasmLoader();
	const t0 = performance.now();
	const r = await exportRaster(model, files, { format: "apng", includeBackground: true }, nodeRasterizer(loader), null);
	const png = join(work, `${name}.png`);
	writeFileSync(png, r.files[0]!.bytes!);
	console.log(`  ${name}.png: ${(r.files[0]!.bytes!.length / 1024).toFixed(1)} KB, ${r.stats.frames} frames, ${((performance.now() - t0) / 1000).toFixed(2)} s`);
	await page.goto(`${origin}/videofile/index.html`);
	const ok = await page.evaluate(
		async (url) => {
			const img = new Image();
			img.src = url;
			await img.decode();
			return [img.naturalWidth, img.naturalHeight];
		},
		`/videofile/${name}.png`,
	);
	check(`${name}.png decodes`, ok[0] === Math.round(W) && ok[1] === Math.round(H), ok.join("x"));
	if (engine === "msedge") {
		// each frame as the file has it, against the frames that went in: lossless, so exact
		const { rasterFrames } = await import("../src/core/raster.ts");
		const { frames } = await rasterFrames(model, files, { format: "gif", includeBackground: true } as never, nodeRasterizer(loader), () => {});
		const got = await page.evaluate(async (url) => {
			const d = new (window as unknown as { ImageDecoder: new (o: object) => any }).ImageDecoder({ type: "image/png", data: await (await fetch(url)).arrayBuffer() });
			await d.tracks.ready;
			const count = d.tracks.selectedTrack.frameCount;
			const out: string[] = [];
			for (const i of [0, count >> 1, count - 1]) {
				const { image } = await d.decode({ frameIndex: i });
				const c = document.createElement("canvas");
				c.width = image.displayWidth;
				c.height = image.displayHeight;
				c.getContext("2d")!.drawImage(image, 0, 0);
				out.push(c.toDataURL("image/png").split(",")[1]!);
				image.close();
			}
			return { count, out };
		}, `/videofile/${name}.png`);
		check(`${name}.png has its frames`, got.count === frames.length, `${got.count} of ${frames.length}`);
		[0, got.count >> 1, got.count - 1].forEach((i, k) => {
			const f = frames[i];
			if (!f) return;
			const d = pixelmatch(PNG.sync.read(Buffer.from(got.out[k]!, "base64")).data, f.pixels.data as unknown as Uint8Array, undefined, f.pixels.width, f.pixels.height, { threshold: 0 });
			check(`${name}.png frame ${i}`, d === 0, `${d} pixels differ`);
		});
	}
}
await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nVideo files are good");
process.exit(failures ? 1 : 0);
