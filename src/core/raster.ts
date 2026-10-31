/**
 * Raster fallbacks for places without SVG animation (e-mail, some apps): an animated GIF or an
 * animated WebP of the timeline's first pass. The frames are the still renderer's, tick by tick
 * (nested movie clips at their own playheads), rasterised by the host (resvg's WebAssembly in the
 * CLI, the browser in the panel). Identical neighbours merge into one longer frame; WebP frames
 * keep only the rectangle that changed (it replaces what was there, alpha included).
 */
import * as gifenc from "gifenc";
import { createContext, type FileSource } from "./context.ts";
import { DEFAULT_SETTINGS, type CompileOutput, type ExportSettings } from "./compile.ts";
import type { Codecs, Pixels } from "./images.ts";
import type { SceneModel } from "./model.ts";
import { renderStatic } from "./emit/static.ts";
import { playhead } from "./emit/timing.ts";
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

/**
 * The first pass of root `rootIndex`, frame by frame. Loops when the timeline loops ("auto": a
 * frame script jumps back, or no stop(); "always"/"never" as set). A frame range, and "always",
 * play the frames in order as the SVG formats do (bake.ts): the scripts don't decide then.
 */
export async function rasterFrames(
	model: SceneModel,
	files: FileSource,
	s: ExportSettings,
	rasterize: Rasterize,
	warn: (m: string) => void,
	rootIndex = 0,
): Promise<{ frames: RasterFrame[]; loop: boolean }> {
	model = joinScenes(model);
	const ctx = createContext(model, files, { smooth: true, includeHiddenLayers: s.includeHiddenLayers, includeGuides: s.includeGuides, digits: s.digits });
	const rootId = model.roots[rootIndex];
	const prog = rootId ? ctx.programs[rootId] : undefined;
	if (!rootId || !prog) throw new Error("Nothing to export");
	let pass: number[];
	let loop: boolean;
	if (s.startFrame !== undefined || s.endFrame !== undefined || s.loop === "always") {
		const a = Math.max(0, Math.min(prog.frameCount - 1, s.startFrame ?? 0));
		const e = Math.max(a + 1, Math.min(prog.frameCount, s.endFrame ?? prog.frameCount));
		pass = [];
		for (let f = a; f < e; f++) pass.push(f);
		loop = s.loop !== "never";
	} else {
		const ph = playhead(prog);
		pass = [...ph.prefix, ...ph.cycle];
		loop = s.loop === "auto" && ph.cycle.length > 0;
	}
	if (!pass.length) pass = [0];
	if (pass.length > MAX_RASTER_FRAMES) {
		warn(`The animation has ${pass.length} frames: the raster export keeps the first ${MAX_RASTER_FRAMES}`);
		pass = pass.slice(0, MAX_RASTER_FRAMES);
	}
	const { width, height, frameRate } = model.doc;
	const W = Math.max(1, Math.round(width)),
		H = Math.max(1, Math.round(height));
	const ms = 1000 / frameRate;
	const frames: RasterFrame[] = [];
	for (let t = 0; t < pass.length; t++) {
		const svg = renderStatic(ctx, rootId, {
			frame: pass[t]!,
			ticks: t,
			movieClips: "play",
			includeBackground: s.includeBackground,
			embedImages: true,
			textAsOutlines: true,
		}).svg;
		const pixels = await rasterize(svg, W, H);
		const prev = frames[frames.length - 1];
		if (prev && same(prev.pixels.data, pixels.data)) prev.ms += ms;
		else frames.push({ pixels, ms });
	}
	return { frames, loop };
}

function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
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

/**
 * Durations in units of `unit` ms, rounded on the running total (a 24 fps GIF alternates 4 and 5
 * hundredths, keeping its length).
 */
function delays(frames: RasterFrame[], unit: number): number[] {
	let t = 0,
		sent = 0;
	return frames.map((f) => {
		t += f.ms;
		const d = Math.max(1, Math.round(t / unit) - sent);
		sent += d;
		return d;
	});
}

/** Animated GIF: a palette per frame (256 colours), 1-bit transparency where the frames have it. */
export function encodeGif(frames: RasterFrame[], loop: boolean): Uint8Array {
	const gif = GIFEncoder();
	const cs = delays(frames, 10);
	frames.forEach((f, i) => {
		const { data, width, height } = f.pixels;
		const alpha = transparentAny(data);
		const format = alpha ? "rgba4444" : "rgb565";
		const palette = quantize(data, 256, { format, oneBitAlpha: alpha });
		const index = applyPalette(data, palette, format);
		const t = alpha ? palette.findIndex((c: number[]) => c[3] === 0) : -1;
		// transparent frames clear what was there (disposal 2), opaque ones simply cover it
		gif.writeFrame(index, width, height, {
			palette,
			delay: cs[i]! * 10,
			repeat: loop ? 0 : -1,
			transparent: t >= 0,
			transparentIndex: Math.max(0, t),
			dispose: alpha ? 2 : 1,
		});
	});
	gif.finish();
	return gif.bytes();
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
 * Animated WebP (RIFF: VP8X, ANIM, ANMF frames), each frame encoded by the WebP codec (lossy at
 * `quality` with its alpha, or lossless) and only the rectangle that changed, not blended (it
 * replaces what was there).
 */
export async function encodeAnimatedWebp(frames: RasterFrame[], loop: boolean, codecs: Codecs, quality: number, lossless: boolean): Promise<Uint8Array> {
	const W = frames[0]!.pixels.width,
		H = frames[0]!.pixels.height;
	const ms = delays(frames, 1);
	const chunks: Uint8Array[] = [];
	let alpha = false;
	for (let i = 0; i < frames.length; i++) {
		const p = frames[i]!.pixels;
		const r = i === 0 ? { x: 0, y: 0, w: W, h: H } : (changed(frames[i - 1]!.pixels, p) ?? { x: 0, y: 0, w: 2, h: 2 });
		const part = r.w === W && r.h === H ? p : crop(p, r);
		alpha ||= transparentAny(part.data);
		const webp = await codecs.webp(part, lossless ? { lossless: 1, exact: 1 } : { quality });
		const payload = [u24(r.x / 2), u24(r.y / 2), u24(r.w - 1), u24(r.h - 1), u24(Math.min(0xffffff, ms[i]!)), Uint8Array.of(2), ...frameChunks(webp)];
		chunks.push(chunk("ANMF", concat(payload)));
	}
	const vp8x = chunk("VP8X", concat([Uint8Array.of(0x02 | (alpha ? 0x10 : 0), 0, 0, 0), u24(W - 1), u24(H - 1)]));
	const anim = chunk("ANIM", Uint8Array.of(0, 0, 0, 0, loop ? 0 : 1, 0));
	const body = concat([ascii("WEBP"), vp8x, anim, ...chunks]);
	return concat([ascii("RIFF"), u32(body.length), body]);
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
 * Format "gif" or "webp" (animated): the frames rasterised and encoded (lossy WebP at the image
 * quality, default 80). The output counts as images in the size overview.
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
	if (Object.keys(model.sounds).length) warnings.push("Sounds aren't part of a GIF or WebP animation");
	if (Object.values(model.timelines).some((t) => t.layers.some((l) => l.keyframes.some((k) => k.elements.some((e) => e.kind === "video")))))
		warnings.push("Videos aren't part of a GIF or WebP animation (their place stays empty)");
	const { frames, loop } = await rasterFrames(model, files, s, rasterize, (m) => warnings.push(m), rootIndex);
	const gif = s.format === "gif";
	if (!gif && !codecs) throw new Error("Animated WebP needs the image codecs");
	const bytes = gif
		? encodeGif(frames, loop)
		: await encodeAnimatedWebp(frames, loop, codecs!, Number.isFinite(s.imageQuality) && s.imageQuality > 0 ? Math.min(100, s.imageQuality) : 80, false);
	const ms = frames.reduce((n, f) => n + f.ms, 0);
	return {
		files: [{ suffix: "", svg: "", ext: gif ? ".gif" : ".webp", bytes }],
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
