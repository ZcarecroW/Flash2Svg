/**
 * Raster fallbacks for places without SVG animation (e-mail, some apps): an animated GIF or an
 * animated WebP of the timeline's first pass. The frames are the still renderer's, tick by tick
 * (nested movie clips at their own playheads), rasterised by the host (resvg's WebAssembly in the
 * CLI, the browser in the panel) and encoded as they are drawn. Identical neighbours merge into
 * one longer frame; WebP frames keep only the rectangle that changed (it replaces what was there,
 * alpha included). APNG is lossless, with alpha; it stores the same rectangles.
 */
import { zlibSync } from "fflate";
import * as gifenc from "gifenc";
import { createContext, type FileSource } from "./context.ts";
import { DEFAULT_SETTINGS, type CompileOutput, type ExportSettings } from "./compile.ts";
import type { Codecs, Pixels } from "./images.ts";
import type { SceneModel } from "./model.ts";
import { renderStatic } from "./emit/static.ts";
import { rootTicks } from "./emit/bake.ts";
import { joinScenes } from "./scenes.ts";

/** SVG text → pixels (straight alpha) at the given size. */
export type Rasterize = (svg: string, width: number, height: number) => Promise<Pixels>;

export interface RasterFrame {
	pixels: Pixels;
	/** how long it shows, ms */
	ms: number;
}

/** More frames than this are cut (warned): a raster fallback is for short animations. */
export const MAX_RASTER_FRAMES = 1500;
/** The longest side of the pictures that decide between lossy and lossless WebP. */
const SAMPLE_SIZE = 640;

/** The ticks of one root, drawn one at a time (see tickSource). */
export interface Ticks {
	count: number;
	/** The file repeats from the start. */
	loop: boolean;
	tickMs: number;
	/** The tick's picture (`scale` < 1: smaller, for samples). */
	draw(t: number, scale?: number): Promise<Pixels>;
}

/**
 * The first pass of root `rootIndex`, tick by tick, as long as the SVG formats make it
 * (bake.ts rootTicks): movie clips that keep running — on a one-frame main timeline, or after a
 * stop() — play on until they come round. Loops when the SVG would repeat; GIF and WebP can only
 * repeat from the start, so a part that plays once first (an intro) comes again each time
 * (warned). A frame range, and "always", play the frames in order.
 */
export function tickSource(model: SceneModel, files: FileSource, s: ExportSettings, rasterize: Rasterize, warn: (m: string) => void, rootIndex: number, most = MAX_RASTER_FRAMES, once = false): Ticks {
	model = joinScenes(model);
	const ctx = createContext(model, files, { smooth: true, includeHiddenLayers: s.includeHiddenLayers, includeGuides: s.includeGuides, digits: s.digits });
	const rootId = model.roots[rootIndex];
	if (!rootId || !ctx.programs[rootId]) throw new Error("Nothing to export");
	const { frames: rootFrames, horizon } = rootTicks(ctx, rootId, { loop: s.loop, startFrame: s.startFrame, endFrame: s.endFrame });
	if (horizon.tail > 0 && !once)
		warn(
			`GIF and WebP can only repeat from the start: the first ${(horizon.tail / horizon.fps).toFixed(1)} s (before the part that loops) play again each time`,
		);
	let count = rootFrames.length;
	if (count > most) {
		warn(`The animation has ${count} frames: this export keeps the first ${most}`);
		count = most;
	}
	const { width, height, frameRate } = model.doc;
	// colour grading: the finished picture, pixel by pixel (exact; the drawings stay as they are)
	const grade = s.grade && !s.grade.empty ? s.grade : null;
	const W = Math.max(1, Math.round(width)),
		H = Math.max(1, Math.round(height));
	// The picture drawn last: a tick that draws the same (a hold, a stop) isn't drawn again — the
	// SVG costs microseconds, the picture milliseconds (seconds with large filters). The pixels are
	// only read after this (GIF, WebP and APNG writers, video).
	let last: { svg: string; scale: number; px: Pixels } | null = null;
	return {
		count,
		loop: horizon.loop || horizon.tail > 0,
		tickMs: 1000 / frameRate,
		draw: async (t, scale = 1) => {
			const svg = renderStatic(ctx, rootId, {
				frame: rootFrames[t]!,
				ticks: t,
				movieClips: "play",
				includeBackground: s.includeBackground,
				embedImages: true,
				textAsOutlines: true,
			}).svg;
			if (last && last.svg === svg && last.scale === scale) return last.px;
			const px = await rasterize(svg, Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale)));
			grade?.pixels(px.data);
			last = { svg, scale, px };
			return px;
		},
	};
}

/**
 * The ticks as frames, handed on one by one: identical neighbours merge into one longer frame (a
 * frame goes on once the next one differs). Returns the length in ms.
 */
async function eachFrame(src: Ticks, add: (f: RasterFrame) => void | Promise<void>): Promise<number> {
	let pending: RasterFrame | null = null;
	for (let t = 0; t < src.count; t++) {
		const pixels = await src.draw(t);
		if (pending && same(pending.pixels.data, pixels.data)) pending.ms += src.tickMs;
		else {
			if (pending) await add(pending);
			pending = { pixels, ms: src.tickMs };
		}
	}
	if (pending) await add(pending);
	return src.count * src.tickMs;
}

/** All frames of the first pass at once (tests and tools; the export streams them, see exportRaster). */
export async function rasterFrames(
	model: SceneModel,
	files: FileSource,
	s: ExportSettings,
	rasterize: Rasterize,
	warn: (m: string) => void,
	rootIndex = 0,
): Promise<{ frames: RasterFrame[]; loop: boolean }> {
	const src = tickSource(model, files, s, rasterize, warn, rootIndex);
	const frames: RasterFrame[] = [];
	await eachFrame(src, (f) => void frames.push(f));
	return { frames, loop: src.loop };
}

function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

// gifenc: an ES module in bundles, CommonJS (names under default) when Node runs the sources
const G = ((gifenc as unknown as { GIFEncoder?: unknown }).GIFEncoder ? gifenc : (gifenc as unknown as { default: typeof gifenc }).default) as typeof gifenc;
const { GIFEncoder, quantize, applyPalette } = G;

const transparentAny = (d: Uint8ClampedArray) => {
	for (let i = 3; i < d.length; i += 4) if (d[i]! < 128) return true;
	return false;
};

const translucentAny = (d: Uint8ClampedArray) => {
	for (let i = 3; i < d.length; i += 4) if (d[i]! < 255) return true;
	return false;
};

/**
 * Frame durations in units of `unit` ms as the frames come, rounded on the running total (a 24 fps
 * GIF alternates 4 and 5 hundredths, keeping its length). Browsers show a frame of 10 ms or less
 * for 100 ms (Chrome, Firefox and Safari alike), so no frame gets less than `min` units: a frame
 * that would start sooner after the one before is left out, its time going to that one (a 60 fps
 * GIF plays about 40 pictures a second, a 120 fps WebP about 60; the length stays exact). A frame
 * is written once the next kept one starts (or at the end): one picture waits, no more.
 */
export class Pacer {
	private t = 0;
	private kept: RasterFrame | null = null;
	private keptAt = 0;
	private unit: number;
	private min: number;
	private write: (f: RasterFrame, delay: number) => void | Promise<void>;
	constructor(unit: number, min: number, write: (f: RasterFrame, delay: number) => void | Promise<void>) {
		this.unit = unit;
		this.min = min;
		this.write = write;
	}

	add(f: RasterFrame): void | Promise<void> {
		const at = Math.round(this.t / this.unit);
		this.t += f.ms;
		if (!this.kept) {
			this.kept = f;
			this.keptAt = at;
			return;
		}
		if (at - this.keptAt < this.min) return;
		const done = this.kept,
			delay = at - this.keptAt;
		this.kept = f;
		this.keptAt = at;
		return this.write(done, delay);
	}

	/** The last frame: never shorter than `min` (a few ms longer at most). */
	finish(): void | Promise<void> {
		const f = this.kept;
		this.kept = null;
		if (f) return this.write(f, Math.max(this.min, Math.round(this.t / this.unit) - this.keptAt));
	}
}

/** The frames a Pacer keeps and their durations, for a list of frames. */
export function paced(frames: RasterFrame[], unit: number, min: number): { frames: RasterFrame[]; delays: number[] } {
	const out = { frames: [] as RasterFrame[], delays: [] as number[] };
	const pacer = new Pacer(unit, min, (f, d) => {
		out.frames.push(f);
		out.delays.push(d);
	});
	for (const f of frames) void pacer.add(f);
	void pacer.finish();
	return out;
}

interface Writer {
	add(f: RasterFrame): void | Promise<void>;
	finish(): Uint8Array | Promise<Uint8Array>;
}

/** Animated GIF, written as the frames come: a palette per frame (256 colours), 1-bit transparency where the frames have it. */
function gifWriter(loop: boolean): Writer {
	const gif = GIFEncoder();
	// hundredths of a second, at least 2 (browsers slow 1 down to 10)
	const pacer = new Pacer(10, 2, (f, cs) => {
		const { data, width, height } = f.pixels;
		const alpha = transparentAny(data);
		const format = alpha ? "rgba4444" : "rgb565";
		const palette = quantize(data, 256, { format, oneBitAlpha: alpha });
		const index = applyPalette(data, palette, format);
		const t = alpha ? palette.findIndex((c: number[]) => c[3] === 0) : -1;
		// Every frame clears what was there when its time is over (disposal 2): each is a whole
		// picture. An opaque frame left in place would show through the transparent parts of the
		// next one (a fade-in over an empty stage that loops).
		gif.writeFrame(index, width, height, {
			palette,
			delay: cs * 10,
			repeat: loop ? 0 : -1,
			transparent: t >= 0,
			transparentIndex: Math.max(0, t),
			dispose: 2,
		});
	});
	return {
		add: (f) => pacer.add(f),
		finish: () => {
			void pacer.finish();
			gif.finish();
			return gif.bytes();
		},
	};
}

/** Animated GIF of a list of frames. */
export function encodeGif(frames: RasterFrame[], loop: boolean): Uint8Array {
	const w = gifWriter(loop);
	for (const f of frames) void w.add(f);
	return w.finish() as Uint8Array;
}

/** The part of `b` that differs from `a`, with even left/top (WebP frame offsets are halved), or null. */
function changed(a: Pixels, b: Pixels): { x: number; y: number; w: number; h: number } | null {
	const { width: W, height: H } = b;
	let x0 = W,
		y0 = H,
		x1 = -1,
		y1 = -1;
	const A = new Uint32Array(a.data.buffer, a.data.byteOffset, W * H);
	const B = new Uint32Array(b.data.buffer, b.data.byteOffset, W * H);
	for (let y = 0; y < H; y++)
		for (let x = 0, i = y * W; x < W; x++, i++)
			if (A[i] !== B[i]) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				y1 = y;
			}
	if (x1 < 0) return null;
	x0 &= ~1;
	y0 &= ~1;
	return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(p: Pixels, r: { x: number; y: number; w: number; h: number }): Pixels {
	const out = new Uint8ClampedArray(r.w * r.h * 4);
	for (let y = 0; y < r.h; y++) out.set(p.data.subarray(((r.y + y) * p.width + r.x) * 4, ((r.y + y) * p.width + r.x + r.w) * 4), y * r.w * 4);
	return { data: out, width: r.w, height: r.h };
}

/**
 * Lossless for an animated WebP? Some of its frames encoded both ways: flat vector drawings come
 * out smaller lossless (and exact, and faster to encode — a demo of gears: 553 → 303 KB),
 * gradients and photos lossy (the hero demo: 258 KB lossy, 866 KB lossless). Measured on four
 * documents, the choice from the first, middle and last frame was the one that choosing frame by
 * frame would make.
 */
async function webpLossless(samples: Pixels[], codecs: Codecs, quality: number): Promise<boolean> {
	let a = 0,
		b = 0;
	for (const px of samples) {
		a += (await codecs.webp(px, { quality })).length;
		b += (await codecs.webp(px, { lossless: 1, exact: 1 })).length;
	}
	return b < a;
}

/**
 * Animated WebP (RIFF: VP8X, ANIM, ANMF frames), written as the frames come: each frame encoded by
 * the WebP codec (lossy at `quality` with its alpha, or lossless), only the rectangle that changed,
 * not blended (it replaces what was there).
 */
function webpWriter(loop: boolean, codecs: Codecs, quality: number, lossless: boolean): Writer {
	const chunks: Uint8Array[] = [];
	let prev: Pixels | null = null;
	let alpha = false;
	let W = 1,
		H = 1;
	// milliseconds, at least 11 (browsers slow 10 and less down to 100)
	const pacer = new Pacer(1, 11, async (f, ms) => {
		const p = f.pixels;
		if (!prev) {
			W = p.width;
			H = p.height;
		}
		const r = !prev ? { x: 0, y: 0, w: W, h: H } : (changed(prev, p) ?? { x: 0, y: 0, w: 2, h: 2 });
		const part = r.w === W && r.h === H ? p : crop(p, r);
		// (any alpha at all: WebP keeps all of it, and its header has to say so)
		alpha ||= translucentAny(part.data);
		const webp = await codecs.webp(part, lossless ? { lossless: 1, exact: 1 } : { quality });
		const payload = [u24(r.x / 2), u24(r.y / 2), u24(r.w - 1), u24(r.h - 1), u24(Math.min(0xffffff, ms)), Uint8Array.of(2), ...frameChunks(webp)];
		chunks.push(chunk("ANMF", concat(payload)));
		prev = p;
	});
	return {
		add: (f) => pacer.add(f),
		finish: async () => {
			await pacer.finish();
			const vp8x = chunk("VP8X", concat([Uint8Array.of(0x02 | (alpha ? 0x10 : 0), 0, 0, 0), u24(W - 1), u24(H - 1)]));
			const anim = chunk("ANIM", Uint8Array.of(0, 0, 0, 0, loop ? 0 : 1, 0));
			const body = concat([ascii("WEBP"), vp8x, anim, ...chunks]);
			return concat([ascii("RIFF"), u32(body.length), body]);
		},
	};
}

/** The scanlines of a picture, each with the PNG filter that suits it, deflated. */
function pngData(p: Pixels): Uint8Array {
	const { data, width: w, height: h } = p;
	const row = w * 4;
	const raw = new Uint8Array((row + 1) * h);
	const tries = [0, 1, 2, 3, 4].map(() => new Uint8Array(row));
	const [t0, t1, t2, t3, t4] = tries as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
	for (let y = 0; y < h; y++) {
		const cur = y * row;
		const up = cur - row;
		let s0 = 0,
			s1 = 0,
			s2 = 0,
			s3 = 0,
			s4 = 0;
		for (let i = 0; i < row; i++) {
			const v = data[cur + i]!;
			const a = i >= 4 ? data[cur + i - 4]! : 0;
			const b = y ? data[up + i]! : 0;
			const c = y && i >= 4 ? data[up + i - 4]! : 0;
			const pa = Math.abs(b - c),
				pb = Math.abs(a - c),
				pc = Math.abs(a + b - 2 * c);
			const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			// (the five candidates one by one: an array of them for every byte of every frame cost
			// more than the compression — 62 ms for 1280 × 720, now 21)
			let d = v;
			t0[i] = d;
			s0 += d < 128 ? d : 256 - d;
			d = (v - a) & 255;
			t1[i] = d;
			s1 += d < 128 ? d : 256 - d;
			d = (v - b) & 255;
			t2[i] = d;
			s2 += d < 128 ? d : 256 - d;
			d = (v - ((a + b) >> 1)) & 255;
			t3[i] = d;
			s3 += d < 128 ? d : 256 - d;
			d = (v - paeth) & 255;
			t4[i] = d;
			s4 += d < 128 ? d : 256 - d;
		}
		const sums = [s0, s1, s2, s3, s4];
		let best = 0;
		for (let k = 1; k < 5; k++) if (sums[k]! < sums[best]!) best = k;
		const at = y * (row + 1);
		raw[at] = best;
		raw.set(tries[best]!, at + 1);
	}
	return zlibSync(raw, { level: 9 });
}

const CRC = new Int32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c;
});

const be32 = (v: number) => Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >> 8) & 255, v & 255);
const be16 = (v: number) => Uint8Array.of((v >> 8) & 255, v & 255);

function pngChunk(tag: string, data: Uint8Array): Uint8Array {
	const body = concat([ascii(tag), data]);
	let c = -1;
	for (const b of body) c = CRC[(c ^ b) & 255]! ^ (c >>> 8);
	return concat([be32(data.length), body, be32((c ^ -1) >>> 0)]);
}

/**
 * Animated PNG, written as the frames come: 32-bit, each frame only the rectangle that changed,
 * replacing what was there. Lossless with alpha; bigger than the others.
 */
function apngWriter(loop: boolean): Writer {
	const chunks: Uint8Array[] = [];
	let prev: Pixels | null = null;
	let W = 1,
		H = 1,
		seq = 0,
		frames = 0;
	// milliseconds, at least 11 (browsers slow 10 and less down to 100)
	const pacer = new Pacer(1, 11, (f, ms) => {
		const p = f.pixels;
		if (!prev) {
			W = p.width;
			H = p.height;
		}
		const r = !prev ? { x: 0, y: 0, w: W, h: H } : (changed(prev, p) ?? { x: 0, y: 0, w: 1, h: 1 });
		const part = r.w === W && r.h === H ? p : crop(p, r);
		const body = pngData(part);
		chunks.push(
			pngChunk(
				"fcTL",
				concat([
					be32(seq++),
					be32(r.w),
					be32(r.h),
					be32(r.x),
					be32(r.y),
					...(ms > 65535 ? [be16(Math.min(65535, Math.round(ms / 10))), be16(100)] : [be16(ms), be16(1000)]),
					Uint8Array.of(0, 0),
				]),
			),
		);
		chunks.push(frames ? pngChunk("fdAT", concat([be32(seq++), body])) : pngChunk("IDAT", body));
		frames++;
		prev = p;
	});
	return {
		add: (f) => pacer.add(f),
		finish: () => {
			void pacer.finish();
			const ihdr = pngChunk("IHDR", concat([be32(W), be32(H), Uint8Array.of(8, 6, 0, 0, 0)]));
			const actl = pngChunk("acTL", concat([be32(frames), be32(loop ? 0 : 1)]));
			return concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), ihdr, actl, ...chunks, pngChunk("IEND", new Uint8Array(0))]);
		},
	};
}

/** Animated WebP of a list of frames; `mode` "auto" decides from the first, middle and last one (see webpLossless). */
export async function encodeAnimatedWebp(
	all: RasterFrame[],
	loop: boolean,
	codecs: Codecs,
	quality: number,
	mode: "lossy" | "lossless" | "auto" = "auto",
): Promise<Uint8Array> {
	const lossless =
		mode === "auto"
			? await webpLossless(
					[...new Set([0, all.length >> 1, all.length - 1])].map((i) => all[i]!.pixels),
					codecs,
					quality,
				)
			: mode === "lossless";
	const w = webpWriter(loop, codecs, quality, lossless);
	for (const f of all) await w.add(f);
	return w.finish();
}

/** The image chunks (ALPH, VP8, VP8L) of a still WebP file. */
function frameChunks(webp: Uint8Array): Uint8Array[] {
	const out: Uint8Array[] = [];
	for (let o = 12; o + 8 <= webp.length;) {
		const tag = String.fromCharCode(...webp.subarray(o, o + 4));
		const size = webp[o + 4]! | (webp[o + 5]! << 8) | (webp[o + 6]! << 16) | (webp[o + 7]! << 24);
		const end = o + 8 + size + (size & 1);
		if (tag === "ALPH" || tag === "VP8 " || tag === "VP8L") out.push(webp.subarray(o, end));
		o = end;
	}
	return out;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u24 = (v: number) => Uint8Array.of(v & 255, (v >> 8) & 255, (v >> 16) & 255);
const u32 = (v: number) => Uint8Array.of(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);

function chunk(tag: string, data: Uint8Array): Uint8Array {
	return concat([ascii(tag), u32(data.length), data, data.length & 1 ? Uint8Array.of(0) : new Uint8Array(0)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/**
 * Format "gif", "webp" or "apng" (animated): the frames rasterised and encoded as they are drawn — a few
 * pictures in memory, never all of them (a 4 s full-HD animation held 2.1 GB before). WebP is
 * lossy at the image quality (default 80) or lossless, whichever suits the drawing. The output
 * counts as images in the size overview.
 */
export async function exportRaster(
	model: SceneModel,
	files: FileSource,
	partial: Partial<ExportSettings>,
	rasterize: Rasterize,
	codecs: Codecs | null,
	rootIndex = 0,
): Promise<CompileOutput> {
	const s: ExportSettings = { ...DEFAULT_SETTINGS, ...partial };
	const warnings: string[] = [];
	const name = s.format === "gif" ? "GIF" : s.format === "apng" ? "APNG" : "WebP";
	if (Object.keys(model.sounds).length) warnings.push(`Sounds aren't part of a ${name} animation`);
	if (Object.values(model.timelines).some((t) => t.layers.some((l) => l.keyframes.some((k) => k.elements.some((e) => e.kind === "video")))))
		warnings.push(`Videos aren't part of a ${name} animation (their place stays empty)`);
	const gif = s.format === "gif";
	const apng = s.format === "apng";
	if (!gif && !apng && !codecs) throw new Error("Animated WebP needs the image codecs");
	const src = tickSource(model, files, s, rasterize, (m) => warnings.push(m), rootIndex);
	let writer: Writer;
	if (gif) writer = gifWriter(src.loop);
	else if (apng) writer = apngWriter(src.loop);
	else {
		const quality = Number.isFinite(s.imageQuality) && s.imageQuality > 0 ? Math.min(100, s.imageQuality) : 80;
		// lossy or lossless: decided on the first, middle and last tick, drawn for it at most 640
		// pixels wide (the kind of drawing decides, not its size: a full 8192 px stage took 21 s more)
		const { width, height } = model.doc;
		// (the short side keeps a pixel: a stage of 8192 × 3 would be drawn 640 × 0)
		const k = Math.min(1, Math.max(SAMPLE_SIZE / Math.max(1, width, height), 1 / Math.max(1, Math.min(width, height))));
		const samples: Pixels[] = [];
		for (const t of new Set([0, src.count >> 1, src.count - 1])) samples.push(await src.draw(t, k));
		writer = webpWriter(src.loop, codecs!, quality, await webpLossless(samples, codecs!, quality));
	}
	const ms = await eachFrame(src, (f) => writer.add(f));
	const bytes = await writer.finish();
	return {
		files: [{ suffix: "", svg: "", ext: gif ? ".gif" : apng ? ".png" : ".webp", bytes }],
		assets: [],
		warnings,
		stats: {
			durationSeconds: ms / 1000,
			frames: Math.round((ms / 1000) * model.doc.frameRate),
			bytes: bytes.length,
			parts: { drawing: 0, animation: 0, images: bytes.length, sounds: 0, runtime: 0, fonts: 0 },
			drawings: [],
		},
	};
}

/** Straight alpha from premultiplied pixels (resvg's), in place. */
export function unpremultiply(d: Uint8ClampedArray | Uint8Array): void {
	for (let i = 0; i < d.length; i += 4) {
		const a = d[i + 3]!;
		if (a && a < 255) for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.round((d[i + k]! * 255) / a));
	}
}
