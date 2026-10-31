/**
 * Public entry point of the compiler: scene model -> SVG text(s).
 */
import { gzipSync, strToU8 } from "fflate";
import { createContext, type FileSource, type ScaleMode } from "./context.ts";
import { dotLottieId, packDotLottie } from "./dotlottie.ts";
import { renderAnimated, type BeginMode } from "./emit/animate.ts";
import { lottieParts, renderLottie } from "./emit/lottie.ts";
import { renderPlayer } from "./emit/player.ts";
import { renderStatic } from "./emit/static.ts";
import { playbackStateMachine } from "./statemachine.ts";
import { joinScenes } from "./scenes.ts";
import { hasRootInteractions, interactiveStateMachine } from "./interactive.ts";
import type { ScrollRange } from "./emit/triggers.ts";
import { playhead } from "./emit/timing.ts";
import type { SoundSettings } from "./audio.ts";
import type { ImageSettings } from "./images.ts";
import type { SceneModel } from "./model.ts";

/**
 * "lottie": Lottie JSON; "dotlottie": the same in a .lottie archive with its bitmaps; "auto": the
 * JS player when sounds or mouse handlers need its script, else CSS or SMIL (see chooseFormat);
 * "gif" / "webp": animated raster fallbacks (raster.ts: exportRaster, async, instead of compileScene).
 */
export type OutputFormat = "smil" | "css" | "player" | "static" | "lottie" | "dotlottie" | "auto" | "gif" | "webp";

/** CSS plays transforms on the compositor (smoother, also in Safari): chosen up to this much larger than SMIL. */
const CSS_SIZE_FACTOR = 1.15;

/**
 * Image and sound settings take effect through encodeImages (images.ts) and encodeSounds
 * (audio.ts), run before compileScene.
 */
export interface ExportSettings extends ImageSettings, SoundSettings {
	format: OutputFormat;
	/** Static format: which frames (0-based). Default: all frames of the range. */
	frames?: number[];
	startFrame?: number;
	endFrame?: number;
	loop: "auto" | "always" | "never";
	/**
	 * "visible": when half on screen; "scroll": the scroll position runs it, once (CSS: inline SVG
	 * only; SMIL and the player also in an <object> of the same origin). Where scripts don't run
	 * (<img>), "visible" and SMIL "scroll" just play.
	 */
	begin: BeginMode;
	/** begin "scroll": while fully on screen (CSS `contain`), while crossing the screen (`cover`), or with the page. */
	scrollRange: ScrollRange;
	delay: number;
	/**
	 * SVG size: "fixed" (the stage size) or filling the space it is given: "fit" (show all), "fill"
	 * (no border, cropped), "stretch" (exact fit). Default "fixed".
	 */
	scale?: ScaleMode;
	/** High FPS interpolation of tweens. */
	smooth: boolean;
	includeBackground: boolean;
	includeHiddenLayers: boolean;
	includeGuides: boolean;
	embedImages: boolean;
	textAsOutlines: boolean;
	/**
	 * Dynamic and input text: embed the installed fonts as WOFF2 subsets (see encodeFonts in
	 * fonts.ts, run before compileScene). Default true.
	 */
	embedFonts?: boolean;
	posterFrame: "first" | "last";
	/** "Reduce motion" in the system settings shows the poster frame (the player: until a click). */
	reducedMotion: boolean;
	/**
	 * Shape tweens as path morphs (SMIL and the player; CSS output always draws them frame by
	 * frame): one blended drawing instead of a drawing per frame, checked against every frame.
	 */
	morph: boolean;
	/** Decimals on screen (shown larger or smaller, a part gets more or fewer, see precision.ts). */
	digits: number;
	pretty: boolean;
	/**
	 * SVG formats: gzip-compressed files (.svgz), for design tools and servers that send them with
	 * Content-Encoding: gzip. Browsers don't open them from disk; on the web, plain SVG compressed
	 * by the server (Brotli) is smaller.
	 */
	svgz?: boolean;
	/**
	 * Start of every id in the output, so several SVGs can be inlined into one page. Default: a
	 * short hash of the document, timeline and settings (the same export gives the same ids).
	 */
	idPrefix?: string;
}

export const DEFAULT_SETTINGS: ExportSettings = {
	format: "smil",
	loop: "auto",
	begin: "auto",
	scrollRange: "visible",
	delay: 0,
	scale: "fixed",
	smooth: true,
	includeBackground: false,
	includeHiddenLayers: true,
	includeGuides: false,
	embedImages: true,
	textAsOutlines: false,
	embedFonts: true,
	posterFrame: "first",
	reducedMotion: true,
	morph: true,
	digits: 2,
	pretty: false,
	svgz: false,
	imageLossy: "jpeg",
	imageLossless: "png",
	imageQuality: 0,
	imageModes: {},
	imageResolution: 2,
	imageFullSize: {},
	soundFormat: "mp3",
	soundBitrate: 0,
	soundModes: {},
};

export interface OutputFile {
	/** Suggested file name suffix ("" for the main file, "_12" for frame 12...). */
	suffix: string;
	/** The file's text: SVG markup (Lottie: the JSON; dotLottie: empty, see `bytes`). */
	svg: string;
	/** File extension when it isn't .svg (".json", ".lottie"). */
	ext?: string;
	/** Binary files (dotLottie). */
	bytes?: Uint8Array;
}

export interface CompileOutput {
	files: OutputFile[];
	/** Files to copy next to the output (sidecar images, sounds), relative to scene.json. */
	assets: { path: string; source: string }[];
	warnings: string[];
	/** frames: ticks of the first pass (SMIL/CSS: the horizon; `loopFrom`: where a looping tail starts after a stop()). */
	stats: { durationSeconds: number; frames: number; bytes: number; loopFrom?: number; parts: SizeParts; drawings: DrawingCost[]; format?: OutputFormat };
}

/**
 * Format "auto": the JS player when the document needs its script — sounds, or mouse handlers
 * other than web links; else CSS, unless SMIL is clearly smaller (shape tweens: SMIL morphs one
 * drawing, CSS draws every frame). The choice and why is the first warning, `stats.format` says it.
 */
function chooseFormat(model: SceneModel, files: FileSource, partial: Partial<ExportSettings>, rootIndex: number, hooks: CompileHooks): CompileOutput {
	const sounds = Object.keys(model.sounds).length > 0;
	const handlers = Object.values(model.timelines).some((t) => t.layers.some((l) => l.keyframes.some((k) => k.script && /addEventListener|\.on\s*\(/.test(k.script))));
	if (sounds || handlers) {
		const out = compileScene(model, files, { ...partial, format: "player" }, rootIndex, hooks);
		// handlers that are only web links work in SMIL/CSS too: the player's program tells
		if (sounds || out.files[0]?.svg.includes('"ev":')) {
			out.warnings.unshift(`Automatic format: JS player (${sounds ? "it has sounds" : "frame scripts add mouse handlers"})`);
			out.stats.format = "player";
			return out;
		}
	}
	const smil = compileScene(model, files, { ...partial, format: "smil" }, rootIndex, hooks);
	const css = compileScene(model, files, { ...partial, format: "css" }, rootIndex, hooks);
	const kb = (n: number) => (n / 1024).toFixed(1) + " KB";
	const useCss = css.stats.bytes <= smil.stats.bytes * CSS_SIZE_FACTOR;
	const out = useCss ? css : smil;
	out.warnings.unshift(
		useCss
			? `Automatic format: CSS (${kb(css.stats.bytes)}, SMIL ${kb(smil.stats.bytes)}): its transforms play on the compositor`
			: `Automatic format: SMIL (${kb(smil.stats.bytes)}, CSS ${kb(css.stats.bytes)})`,
	);
	out.stats.format = useCss ? "css" : "smil";
	return out;
}

/** What the output's characters are spent on (all files together). */
export interface SizeParts {
	/** Shapes, text, structure, filters, masks. */
	drawing: number;
	/** SMIL animation elements, CSS, the player's timeline data. */
	animation: number;
	/** Embedded bitmaps. */
	images: number;
	/** Embedded sounds. */
	sounds: number;
	/** The player's script. */
	runtime: number;
	/** Embedded fonts (@font-face). */
	fonts: number;
}

/** Drawings (shapes, outlined text) per symbol and layer, biggest first. */
export interface DrawingCost {
	/** "Symbol › Layer". */
	name: string;
	/** Different drawings (frames). */
	count: number;
	bytes: number;
}

/** What the host does better than plain JavaScript. */
export interface CompileHooks {
	/** gzip for .svgz (default: fflate; Node's zlib packs some 3-8 % smaller, and faster). */
	gzip?(data: Uint8Array): Uint8Array;
}

export function compileScene(model: SceneModel, files: FileSource, partial: Partial<ExportSettings> = {}, rootIndex = 0, hooks: CompileHooks = {}): CompileOutput {
	if (partial.format === "auto") return chooseFormat(model, files, partial, rootIndex, hooks);
	model = joinScenes(model);
	const s: ExportSettings = { ...DEFAULT_SETTINGS, ...partial };
	// number fields can arrive empty (null) or out of range from the panel
	s.digits = Number.isFinite(s.digits) ? Math.max(0, Math.min(6, Math.round(s.digits))) : DEFAULT_SETTINGS.digits;
	s.delay = Number.isFinite(s.delay) && s.delay > 0 ? s.delay : 0;
	const ctx = createContext(model, files, {
		smooth: s.smooth,
		includeHiddenLayers: s.includeHiddenLayers,
		includeGuides: s.includeGuides,
		digits: s.digits,
	});
	ctx.scale = s.scale ?? "fixed";
	ctx.background = s.includeBackground;
	const rootId = model.roots[rootIndex];
	if (!rootId) throw new Error("Nothing to export");
	const prog = ctx.programs[rootId]!;
	const prefixFor = (extra: string) => s.idPrefix ?? autoPrefix(model, rootId, s, extra);
	const fps = model.doc.frameRate || 24;
	const out: CompileOutput = {
		files: [],
		assets: [],
		warnings: ctx.warnings,
		stats: { durationSeconds: 0, frames: 0, bytes: 0, parts: { drawing: 0, animation: 0, images: 0, sounds: 0, runtime: 0, fonts: 0 }, drawings: [] },
	};
	const drawingBytes = new Map<string, number>();
	const addDrawings = (m: Map<string, number>) => {
		for (const [k, n] of m) drawingBytes.set(k, (drawingBytes.get(k) ?? 0) + n);
	};
	const assets = new Map<string, { path: string; source: string }>();
	const lottie = s.format === "lottie" || s.format === "dotlottie";
	if (lottie && (s.begin === "visible" || s.begin === "scroll"))
		out.warnings.push(`Start "${s.begin === "visible" ? "when visible" : "on scroll"}" is up to the page that shows a Lottie animation: it plays when loaded`);
	if (s.format !== "player" && !lottie && Object.keys(model.sounds).length) out.warnings.push("Sounds play only in the JS player format (SMIL, CSS and still frames have no sound)");
	// buttons from code snippets in a .lottie: labels as states, clicks as transitions (interactive.ts)
	const interactive = s.format === "dotlottie" && hasRootInteractions(prog);
	if (s.format !== "player" && !interactive) {
		// web links work as SVG links (not in Lottie); the other handlers need the player's script
		const handlers = Object.values(ctx.programs).flatMap((p) => p.interactions ?? []);
		const scripted = handlers.filter((i) => lottie || i.event !== "click" || i.actions.some((a) => a.type !== "url"));
		if (scripted.length)
			out.warnings.push(
				`${scripted.length} mouse handler${scripted.length > 1 ? "s" : ""} from frame scripts (${[...new Set(scripted.map((i) => i.on || "the timeline"))].slice(0, 4).join(", ")}) run only in the JS player format${handlers.length > scripted.length ? "; web links work here too" : ""}`,
			);
	}
	let parts: SizeParts | null = null;

	if (lottie) {
		const dot = s.format === "dotlottie";
		// interactive: the whole root timeline, in order (the state machine follows its scripts)
		const r = renderLottie(ctx, rootId, interactive ? { ...s, startFrame: 0, endFrame: prog.frameCount, loop: "never" } : s, dot ? "dotlottie" : s.embedImages ? "embed" : "link");
		const plan = interactive ? interactiveStateMachine(prog, dotLottieId(String(r.animation.nm || "animation"))) : null;
		if (plan) {
			r.animation.markers = [...((r.animation.markers as unknown[]) ?? []), ...plan.markers];
			out.warnings.push(...plan.warnings);
		}
		const json = JSON.stringify(r.animation, null, s.pretty ? 1 : undefined);
		const p = lottieParts(r.animation, json.length);
		if (dot) {
			const images = r.images.map((i) => ({ name: i.name, bytes: files.readBinary(i.source) }));
			const id = dotLottieId(String(r.animation.nm || "animation"));
			const begin = s.begin === "visible" || s.begin === "scroll" ? "auto" : s.begin;
			const sm = plan ? plan.stateMachine : r.horizon.ticks > 1 ? playbackStateMachine({ animation: id, loop: r.horizon.loop, begin, ...r.segments }) : null;
			const bytes = packDotLottie(json, id, images, sm);
			// the archive's share of the bitmaps; the compressed JSON split like the plain one
			const img = images.reduce((n, i) => n + i.bytes.length, 0);
			const rest = Math.max(0, bytes.length - img);
			const anim = Math.round((rest * p.animation) / Math.max(1, p.animation + p.drawing));
			parts = { drawing: rest - anim, animation: anim, images: img, sounds: 0, runtime: 0, fonts: 0 };
			out.files.push({ suffix: "", svg: "", ext: ".lottie", bytes });
		} else {
			parts = { ...p, sounds: 0, runtime: 0, fonts: 0 };
			out.files.push({ suffix: "", svg: json, ext: ".json" });
			for (const i of r.images) assets.set(i.name, { path: i.name, source: i.source });
		}
		out.stats.frames = r.horizon.ticks;
		out.stats.durationSeconds = r.horizon.ticks / r.horizon.fps;
		if (r.horizon.tail) out.stats.loopFrom = r.horizon.tail;
	} else if (s.format === "static") {
		// frames of the timeline only (a range typed past its end, a frame list from elsewhere)
		const start = Math.max(0, Math.min(prog.frameCount - 1, s.startFrame ?? 0));
		const end = Math.max(start + 1, Math.min(prog.frameCount, s.endFrame ?? prog.frameCount));
		const listed = s.frames?.filter((f) => Number.isInteger(f) && f >= 0 && f < prog.frameCount);
		const frames = listed?.length ? listed : Array.from({ length: end - start }, (_, i) => start + i);
		for (const f of frames) {
			const r = renderStatic(ctx, rootId, {
				idPrefix: prefixFor(String(f)),
				frame: f,
				movieClips: "play",
				includeBackground: s.includeBackground,
				embedImages: s.embedImages,
				textAsOutlines: s.textAsOutlines,
				pretty: s.pretty,
			});
			out.files.push({ suffix: frames.length > 1 ? `_${f + 1}` : "", svg: r.svg });
			r.assets.forEach((a) => assets.set(a.path, a));
			addDrawings(r.drawingBytes);
		}
		out.stats.frames = frames.length;
	} else if (s.format === "player") {
		const r = renderPlayer(ctx, rootId, { ...s, idPrefix: prefixFor("") });
		out.files.push({ suffix: "", svg: r.svg });
		r.assets.forEach((a) => assets.set(a.path, a));
		addDrawings(r.drawingBytes);
		// the first pass, as frame scripts play it
		const ph = playhead(prog);
		out.stats.frames = ph.prefix.length + ph.cycle.length;
		out.stats.durationSeconds = out.stats.frames / fps;
	} else {
		const r = renderAnimated(ctx, rootId, {
			idPrefix: prefixFor(""),
			format: s.format as "smil" | "css",
			smooth: s.smooth,
			loop: s.loop,
			startFrame: s.startFrame,
			endFrame: s.endFrame,
			includeBackground: s.includeBackground,
			embedImages: s.embedImages,
			textAsOutlines: s.textAsOutlines,
			posterFrame: s.posterFrame,
			reducedMotion: s.reducedMotion,
			morph: s.morph,
			begin: s.begin,
			scrollRange: s.scrollRange,
			delay: s.delay,
			pretty: s.pretty,
		});
		out.files.push({ suffix: "", svg: r.svg });
		r.assets.forEach((a) => assets.set(a.path, a));
		addDrawings(r.drawingBytes);
		out.stats.frames = r.horizon.ticks;
		out.stats.durationSeconds = r.horizon.ticks / r.horizon.fps;
		if (r.horizon.tail) out.stats.loopFrom = r.horizon.tail;
	}
	out.assets = [...assets.values()];
	if (s.svgz && !lottie) {
		const gzip = hooks.gzip ?? ((d: Uint8Array) => gzipSync(d, { level: 9, mtime: 0 }));
		for (const f of out.files) {
			f.bytes = gzip(strToU8(f.svg));
			f.ext = ".svgz";
		}
	}
	out.stats.bytes = out.files.reduce((n, f) => n + (f.bytes?.length ?? f.svg.length), 0);
	if (parts) out.stats.parts = parts;
	else
		for (const f of out.files) {
			const p = sizeParts(f.svg);
			if (f.bytes) {
				// compressed: each part's share of the file (the rounding goes to the largest)
				const keys = Object.keys(p) as (keyof SizeParts)[];
				const k = f.bytes.length / Math.max(1, f.svg.length);
				for (const key of keys) p[key] = Math.round(p[key] * k);
				const big = keys.reduce((a, b) => (p[b] > p[a] ? b : a));
				p[big] += f.bytes.length - keys.reduce((n, key) => n + p[key], 0);
			}
			for (const key in p) out.stats.parts[key as keyof SizeParts] += p[key as keyof SizeParts];
		}
	out.stats.drawings = drawingCosts(model, drawingBytes);
	return out;
}

const count = (re: RegExp, s: string) => {
	let n = 0;
	for (const m of s.matchAll(re)) n += m[0].length;
	return n;
};

/** Splits an output file's size by what it holds (one pass of a few regular expressions). */
export function sizeParts(svg: string): SizeParts {
	const images = count(/data:image\/[^"]*/g, svg);
	const sounds = count(/data:audio\/[^"\\]*/g, svg);
	let runtime = 0;
	let animation = count(/<style\b[^>]*>[\s\S]*?<\/style>/g, svg) + count(/<(?:animate|animateTransform|animateMotion|set)\b[^>]*>/g, svg);
	for (const m of svg.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
		// the player's timeline data (its sounds counted as sounds), or the player itself
		if (/application\/json/.test(m[1]!)) animation += m[0].length - count(/data:audio\/[^"\\]*/g, m[2]!);
		else runtime += m[0].length;
	}
	// fonts sit in the <style> too
	const fonts = count(/@font-face\{[^}]*\}/g, svg);
	animation -= fonts;
	return { drawing: Math.max(0, svg.length - images - sounds - runtime - animation - fonts), animation, images, sounds, runtime, fonts };
}

/** The drawings' bytes (per artwork, see OutputDoc.drawingBytes) by symbol and layer, biggest first. */
function drawingCosts(model: SceneModel, bytes: Map<string, number>, top = 8): DrawingCost[] {
	// artwork ids are "s" + the atlas id (9-slice copies: "s9_<n>_" + that)
	const atlasOf = new Map(Object.keys(model.atlas).map((id) => ["s" + id.replace(/[^A-Za-z0-9_]/g, "_"), id]));
	const groups = new Map<string, DrawingCost>();
	for (const [key, n] of bytes) {
		const atlas = atlasOf.get(key.replace(/^s9_\d+_/, ""));
		const m = atlas ? /^(.*) layer (\d+) frame \d+$/.exec(model.atlas[atlas]!.source) : null;
		const tl = m ? model.timelines[m[1]!] : undefined;
		const name = tl ? `${tl.name} › ${tl.layers[+m![2]!]?.name ?? "?"}` : "Other";
		const g = groups.get(name) ?? { name, count: 0, bytes: 0 };
		g.count++;
		g.bytes += n;
		groups.set(name, g);
	}
	return [...groups.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top);
}

/** Deterministic id prefix ("f" + 5 base-36 chars + "_") from what makes this output unique. */
function autoPrefix(model: SceneModel, rootId: string, s: ExportSettings, extra: string): string {
	const { idPrefix: _, ...settings } = s;
	const key = JSON.stringify([model.doc.name, rootId, settings, extra]);
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
	return "f" + (h >>> 0).toString(36).padStart(7, "0").slice(-5) + "_";
}
