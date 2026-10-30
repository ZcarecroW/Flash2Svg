// Renders Lottie animations in real players for the tests: lottie-web (SVG renderer) and
// dotLottie (ThorVG, WebAssembly on a canvas) in Edge/Chrome, Skottie (Skia's player, CanvasKit
// WebAssembly) in Node. All files come from node_modules through a local HTTP server (the
// players fetch their WebAssembly, which file:// pages may not).
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import type { Browser, Page } from "playwright-core";
import { PNG } from "pngjs";

export type LottiePlayer = "lottie-web" | "dotlottie" | "skottie";

const MIME: Record<string, string> = {
	".js": "text/javascript",
	".mjs": "text/javascript",
	".wasm": "application/wasm",
	".json": "application/json",
	".html": "text/html",
	".lottie": "application/zip",
};

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}#box{position:absolute;left:0;top:0}canvas{display:block}</style>
<script src="/node_modules/lottie-web/build/player/lottie_svg.min.js"></script>
<script type="module">
import { DotLottie } from "/node_modules/@lottiefiles/dotlottie-web/dist/index.js";
DotLottie.setWasmUrl("/node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm");
let anim = null, dl = null;
const box = document.getElementById("box");
// Loads an animation (JSON text or the bytes of a .lottie) into the chosen player.
window.f2sLoad = (player, data, w, h) => new Promise((resolve, reject) => {
	anim?.destroy(); anim = null; dl?.destroy(); dl = null; box.innerHTML = "";
	box.style.width = w + "px"; box.style.height = h + "px";
	if (player === "lottie-web") {
		anim = lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: false, animationData: JSON.parse(data) });
		anim.addEventListener("DOMLoaded", () => resolve(anim.totalFrames));
		anim.addEventListener("data_failed", () => reject(new Error("lottie-web: data failed")));
	} else {
		const canvas = document.createElement("canvas");
		canvas.width = w; canvas.height = h; canvas.style.width = w + "px"; canvas.style.height = h + "px";
		box.appendChild(canvas);
		const bytes = typeof data === "string" ? data : new Uint8Array(data).buffer;
		dl = new DotLottie({ canvas, data: bytes, autoplay: false, loop: false, useFrameInterpolation: true, renderConfig: { devicePixelRatio: 1, autoResize: false, freezeOnOffscreen: false, ...window.f2sRenderConfig } });
		dl.addEventListener("load", () => resolve(dl.totalFrames));
		dl.addEventListener("loadError", (e) => reject(new Error("dotLottie: " + (e.error?.message ?? "load error"))));
	}
});
window.f2sSeek = (frame) => new Promise((resolve) => {
	if (anim) { anim.goToAndStop(frame, true); resolve(); return; }
	const target = dl;
	let fired = false;
	const done = () => { if (fired) return; fired = true; target.removeEventListener("render", done); resolve(); };
	dl.addEventListener("render", done);
	dl.setFrame(frame);
	setTimeout(done, 500);
});
window.f2sReady = true;
</script></head><body><div id="box"></div></body></html>`;

/** Serves the repository (node_modules) and the harness page on 127.0.0.1. */
export async function startServer(repo: string): Promise<{ url: string; server: Server }> {
	const server = createServer(async (req, res) => {
		const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
		if (path === "/" || path === "/harness.html") {
			res.writeHead(200, { "content-type": "text/html" }).end(HARNESS);
			return;
		}
		const file = normalize(join(repo, path));
		if (!file.startsWith(normalize(repo))) {
			res.writeHead(403).end();
			return;
		}
		try {
			const body = await readFile(file);
			res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(body);
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as { port: number }).port;
	return { url: `http://127.0.0.1:${port}/harness.html`, server };
}

/** A browser page with both web players, ready to load animations. */
export async function openHarness(browser: Browser, url: string): Promise<Page> {
	const page = await browser.newPage({ deviceScaleFactor: 1 });
	page.on("pageerror", (e) => console.error("page error:", e.message));
	await page.goto(url);
	await page.waitForFunction(() => (window as unknown as { f2sReady?: boolean }).f2sReady === true);
	return page;
}

export class WebPlayers {
	private page: Page;
	private loaded = "";
	constructor(page: Page) {
		this.page = page;
	}
	/** Loads `data` (Lottie JSON text, or .lottie bytes for dotLottie) unless it is already loaded. */
	async load(player: Exclude<LottiePlayer, "skottie">, data: string | Uint8Array, w: number, h: number, key = ""): Promise<number> {
		const id = `${player}|${key}`;
		if (key && id === this.loaded) return -1;
		await this.page.setViewportSize({ width: Math.ceil(w), height: Math.ceil(h) });
		const arg = typeof data === "string" ? data : [...data];
		const n = await this.page.evaluate(([p, d, ww, hh]) => (window as unknown as { f2sLoad: (...a: unknown[]) => Promise<number> }).f2sLoad(p, d, ww, hh), [
			player,
			arg,
			w,
			h,
		] as const);
		this.loaded = id;
		return n;
	}
	async frame(frame: number, w: number, h: number): Promise<PNG> {
		await this.page.evaluate((f) => (window as unknown as { f2sSeek: (f: number) => Promise<void> }).f2sSeek(f), frame);
		await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		const buf = await this.page.screenshot({ clip: { x: 0, y: 0, width: Math.ceil(w), height: Math.ceil(h) }, omitBackground: false });
		return PNG.sync.read(buf);
	}
}

interface CanvasKitLike {
	MakeManagedAnimation(json: string, assets?: Record<string, ArrayBuffer>): SkottieAnimation | null;
	MakeSurface(
		w: number,
		h: number,
	): { getCanvas(): SkCanvas; makeImageSnapshot(): { encodeToBytes(): Uint8Array | null; delete(): void }; flush(): void; delete(): void } | null;
	LTRBRect(l: number, t: number, r: number, b: number): Float32Array;
	WHITE: Float32Array;
	TRANSPARENT: Float32Array;
}
interface SkCanvas {
	clear(c: Float32Array): void;
}
interface SkottieAnimation {
	seekFrame(f: number): void;
	render(c: SkCanvas, dst: Float32Array): void;
	delete(): void;
}

let ck: Promise<CanvasKitLike> | null = null;
/** Skia's Lottie player (Skottie) from CanvasKit's full build, in Node. */
export function canvasKit(): Promise<CanvasKitLike> {
	if (!ck) {
		const require = createRequire(import.meta.url);
		const init = require("canvaskit-wasm/bin/full/canvaskit.js") as (o: { locateFile(f: string): string }) => Promise<CanvasKitLike>;
		const dir = join(require.resolve("canvaskit-wasm/bin/full/canvaskit.js"), "..");
		ck = init({ locateFile: (f) => join(dir, f) });
	}
	return ck;
}

/** Renders frames with Skottie; `assets`: image files by name (for linked images). */
export async function skottie(json: string, w: number, h: number, assets?: Record<string, ArrayBuffer>) {
	const CK = await canvasKit();
	const anim = CK.MakeManagedAnimation(json, assets);
	if (!anim) throw new Error("Skottie could not load the animation");
	const surface = CK.MakeSurface(Math.ceil(w), Math.ceil(h));
	if (!surface) throw new Error("no surface");
	return {
		frame(f: number, background: Float32Array = CK.WHITE): PNG {
			const c = surface.getCanvas();
			c.clear(background);
			anim.seekFrame(f);
			anim.render(c, CK.LTRBRect(0, 0, w, h));
			surface.flush();
			const img = surface.makeImageSnapshot();
			const png = PNG.sync.read(Buffer.from(img.encodeToBytes()!));
			img.delete();
			return png;
		},
		dispose() {
			anim.delete();
			surface.delete();
		},
	};
}
