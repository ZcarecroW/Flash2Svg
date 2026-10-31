/**
 * Runs an export from the panel: JSFL extraction (in steps, with progress), then compilation
 * in the panel, then writing the SVG(s) and assets.
 */
import { compileScene, type CompileOutput, type ExportSettings, type OutputFormat } from "../../core/compile.ts";
import { encodeSounds, type AudioCodecs, type SoundReport } from "../../core/audio.ts";
import type { createAudioCodecs } from "../../core/audio-codecs.ts";
import { encodeImages, type Codecs, type ImageReport, type WasmLoader } from "../../core/images.ts";
import type { createCodecs } from "../../core/codecs.ts";
import type { SceneModel } from "../../core/model.ts";
import { encodeFonts, fontFiles, fontFolders, needsFonts, type FontCodecs, type FontFs } from "../../core/fonts.ts";
import { exportRaster, type Rasterize } from "../../core/raster.ts";
import { evalJson, evalScript, extensionPath, fromFileUri, node, toFileUri } from "./cep.ts";

export interface DocInfo {
	open: boolean;
	name?: string;
	path?: string | null;
	type?: string;
	width?: number;
	height?: number;
	frameRate?: number;
	timeline?: string;
	isSymbol?: boolean;
	frameCount?: number;
	currentFrame?: number;
	selectedSymbols?: string[];
	/** scenes in the document */
	scenes?: number;
}

interface JobStatus {
	state: "running" | "done" | "error" | "idle";
	phase?: string;
	progress?: number;
	message?: string;
	scene?: string;
	warnings?: number;
}

export interface ExportRequest {
	settings: ExportSettings;
	source: "timeline" | "library" | "scenes";
	frames: "all" | "current" | "range";
	rangeStart: number;
	rangeEnd: number;
	/** Absolute output path (file); empty = next to the FLA */
	output: string;
	/** Keep the scene data next to the output as <name>.scene/ (scene.json and its files), for the command line. */
	keepScene?: boolean;
}

export interface ExportResult {
	files: string[];
	/** Format actually written ("current frame" exports are always static). */
	format: OutputFormat;
	output: CompileOutput[];
	warnings: string[];
	seconds: number;
	/** How each bitmap was written. */
	images: ImageReport[];
	/** How each sound was written (player format). */
	sounds: SoundReport[];
	/** Bytes of the bitmaps and sounds written next to the SVG (not embedded). */
	linkedBytes: number;
}

/** A library bitmap and its compression setting in Animate (see Flash2Svg.bitmaps()). */
export interface BitmapInfo {
	name: string;
	width: number;
	height: number;
	compression: "photo" | "lossless";
	/** JPEG quality; -1 = the imported JPEG's own */
	quality: number;
}

/** A library sound and its compression setting in Animate (see Flash2Svg.sounds()). */
export interface SoundInfo {
	name: string;
	original: "raw" | "mp3";
	compression: "default" | "adpcm" | "mp3" | "raw" | "speech";
	/** MP3 compression: kbit/s (0 otherwise) */
	bitRate: number;
	/** imported MP3 at its own quality */
	importedQuality: boolean;
}

/**
 * Loads one of the panel's codec bundles (its own script, on first use) and creates its codecs
 * with the WebAssembly in wasm/.
 */
function lazyBundle<T>(file: string, global: string, what: string): () => Promise<T> {
	let p: Promise<T> | null = null;
	return () => {
		const nd = nodeOrThrow();
		p ??= new Promise<T>((resolve, reject) => {
			const script = document.createElement("script");
			script.src = file;
			script.onload = () => {
				const create = (window as unknown as Record<string, Record<string, (load: WasmLoader) => T> | undefined>)[global];
				const fn = create && Object.values(create)[0];
				if (!fn) return reject(new Error(`The ${what} did not load`));
				const dir = nd.path.join(extensionPath(), "wasm");
				resolve(fn((f) => nd.fs.readFileSync(nd.path.join(dir, f))));
			};
			script.onerror = () => reject(new Error(`The ${what} (panel/${file}) are missing`));
			document.head.appendChild(script);
		});
		p.catch(() => (p = null));
		return p;
	};
}

/** SVG frames to pixels by the panel's browser (raster.ts). */
const canvasRasterizer: Rasterize = async (svg, width, height) => {
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		const img = new Image(width, height);
		img.src = url;
		await img.decode();
		const c = document.createElement("canvas");
		c.width = width;
		c.height = height;
		const g = c.getContext("2d", { willReadFrequently: true })!;
		g.drawImage(img, 0, 0, width, height);
		const d = g.getImageData(0, 0, width, height);
		return { data: d.data, width, height };
	} finally {
		URL.revokeObjectURL(url);
	}
};

/** The image codecs (panel/codecs.js) and the audio codecs (panel/audio.js). */
const panelCodecs = lazyBundle<Codecs>("codecs.js", "Flash2SvgCodecs", "image codecs");
const panelAudio = lazyBundle<AudioCodecs>("audio.js", "Flash2SvgAudio", "audio codecs");
const panelFonts = lazyBundle<FontCodecs>("fonts.js", "Flash2SvgFonts", "font codecs");
// (the bundles' entry points: src/panel/codecs-entry.ts, audio-entry.ts)
export type { createAudioCodecs, createCodecs };

export async function libraryBitmaps(): Promise<BitmapInfo[]> {
	await ensureJsfl();
	return evalJson<BitmapInfo[]>("Flash2Svg.bitmaps()");
}

export async function librarySounds(): Promise<SoundInfo[]> {
	await ensureJsfl();
	return evalJson<SoundInfo[]>("Flash2Svg.sounds()");
}

let loaded = false;

export async function ensureJsfl() {
	if (loaded) {
		const ok = await evalScript("typeof Flash2Svg != 'undefined'").catch(() => "false");
		if (ok === "true") return;
	}
	const uri = toFileUri(extensionPath() + "/jsfl/flash2svg.jsfl");
	await evalScript(`fl.runScript(${JSON.stringify(uri)})`);
	loaded = true;
}

export async function docInfo(): Promise<DocInfo> {
	await ensureJsfl();
	return evalJson<DocInfo>("Flash2Svg.info()");
}

/** The file extension a format writes. */
export function formatExt(format: string | undefined): string {
	return format === "lottie" ? ".json" : format === "dotlottie" ? ".lottie" : format === "gif" ? ".gif" : format === "webp" ? ".webp" : ".svg";
}

export function defaultOutput(info: DocInfo, symbol?: string, ext = ".svg"): string {
	if (!node || !info.path) return "";
	const fla = fromFileUri(info.path);
	const dir = node.path.dirname(fla);
	const base = node.path.basename(fla, node.path.extname(fla));
	const suffix = symbol ?? (info.isSymbol ? info.timeline : "");
	return node.path.join(dir, `${base}${suffix ? "_" + suffix.replace(/[\\/:*?"<>|]+/g, "_") : ""}${ext}`);
}

/**
 * `file` ending in the format's extension: another format's is replaced (an .svg name chosen
 * before switching to Lottie follows), any other is kept and the format's added ("anim.v2" →
 * "anim.v2.svg"; never "scene.fla").
 */
export function withExt(file: string, ext: string): string {
	if (file.toLowerCase().endsWith(ext.toLowerCase())) return file;
	return file.replace(/\.(svgz?|json|lottie|gif|webp)$/i, "") + ext;
}

/**
 * The file the user asked for, as an absolute path without the extension decided yet: a relative
 * name is placed next to the FLA, a folder (ending in a slash, or an existing one) gets the
 * default name inside it.
 */
export function resolveOutput(output: string, info: DocInfo, defaultName: string): string {
	const nd = nodeOrThrow();
	let p = (output ?? "").trim();
	if (!p) return "";
	if (!nd.path.isAbsolute(p)) {
		if (!info.path) throw new Error(`"${p}" is not a full path, and the document isn't saved yet: choose the file with the folder button`);
		p = nd.path.join(nd.path.dirname(fromFileUri(info.path)), p);
	}
	let folder = /[\\/]$/.test(p);
	if (!folder) {
		try {
			folder = nd.fs.statSync(p).isDirectory();
		} catch {
			/* doesn't exist yet: a file */
		}
	}
	return folder ? nd.path.join(p, defaultName) : nd.path.normalize(p);
}

export async function runExport(
	req: ExportRequest,
	info: DocInfo,
	onProgress: (p: number, msg: string) => void,
	isCancelled: () => boolean,
): Promise<ExportResult> {
	if (!node) throw new Error("Node.js is not available in this panel.");
	const t0 = Date.now();
	await ensureJsfl();
	const work = node.fs.mkdtempSync(node.path.join(node.os.tmpdir(), "flash2svg-"));
	try {
		return await exportInto(work, req, info, onProgress, isCancelled, t0);
	} finally {
		// also after errors and cancels: the scene data can be large
		try {
			node.fs.rmSync(work, { recursive: true, force: true });
		} catch {
			/* temp folder cleanup is best effort */
		}
	}
}

async function exportInto(
	work: string,
	req: ExportRequest,
	info: DocInfo,
	onProgress: (p: number, msg: string) => void,
	isCancelled: () => boolean,
	t0: number,
): Promise<ExportResult> {
	const node = nodeOrThrow();
	const items = req.source === "library" ? (info.selectedSymbols ?? []) : [];
	if (req.source === "library" && !items.length) throw new Error("Select one or more symbols in the Library first.");
	const opts = { outDir: toFileUri(node.path.join(work, "scene")), items, allScenes: req.source === "scenes" };
	let st = await evalJson<JobStatus>(`Flash2Svg.start(${JSON.stringify(JSON.stringify(opts))})`);
	while (st.state === "running") {
		if (isCancelled()) {
			await evalScript("Flash2Svg.cancel()");
			throw cancelError();
		}
		onProgress(0.05 + 0.75 * (st.progress ?? 0), st.message ?? "Working");
		st = await evalJson<JobStatus>("Flash2Svg.step(250)");
	}
	if (st.state === "error") throw new Error(st.message || "Extraction failed");
	// the encoders and the rasterizer stop at their next picture, sound or frame
	const check = () => {
		if (isCancelled()) throw cancelError();
	};
	check();

	const nd = node;
	const sceneDir = nd.path.join(work, "scene");
	let model: SceneModel = JSON.parse(nd.fs.readFileSync(nd.path.join(sceneDir, "scene.json"), "utf8"));
	let files = {
		readText: (rel: string) => nd.fs.readFileSync(nd.path.join(sceneDir, rel), "utf8"),
		readBinary: (rel: string): Uint8Array => nd.fs.readFileSync(nd.path.join(sceneDir, rel)),
	};
	let images: ImageReport[] = [];
	const imageWarnings: string[] = [];
	if (Object.keys(model.bitmaps).length) {
		onProgress(0.81, "Encoding images");
		const enc = await encodeImages(model, files, req.settings, cancellable(await panelCodecs(), check));
		({ model, files, report: images } = enc);
		imageWarnings.push(...enc.warnings);
	}
	const settings: Partial<ExportSettings> = { ...req.settings };
	if (req.frames === "current") {
		settings.startFrame = info.currentFrame ?? 0;
		settings.endFrame = settings.startFrame + 1;
		if (settings.format !== "static") settings.format = "static";
	} else if (req.frames === "range") {
		// 1-based and inclusive; swapped ends, empty fields and frames past the end are forgiven
		const last = Math.max(1, info.frameCount ?? Number.MAX_SAFE_INTEGER);
		const clamp = (n: number, d: number) => Math.max(1, Math.min(last, Number.isFinite(n) ? Math.round(n) : d));
		const a = clamp(req.rangeStart, 1),
			b = clamp(req.rangeEnd, last);
		settings.startFrame = Math.min(a, b) - 1;
		settings.endFrame = Math.max(a, b);
	}

	// only the player plays sounds
	let sounds: SoundReport[] = [];
	if ((settings.format === "player" || settings.format === "auto") && Object.keys(model.sounds).length) {
		check();
		onProgress(0.85, "Encoding sounds");
		const enc = await encodeSounds(model, files, req.settings, cancellable(await panelAudio(), check));
		({ model, files, report: sounds } = enc);
		imageWarnings.push(...enc.warnings);
	}

	// fonts of dynamic and input text (SVG formats); the font codecs (1 MB) load only for such text
	const lottieOut = settings.format === "lottie" || settings.format === "dotlottie";
	if (settings.embedFonts !== false && !settings.textAsOutlines && !lottieOut && settings.format !== "gif" && settings.format !== "webp" && needsFonts(model)) {
		check();
		onProgress(0.88, "Embedding fonts");
		const nd = nodeOrThrow();
		const files = fontFiles(
			nd.fs as unknown as FontFs,
			nd.path.join,
			fontFolders(
				nd.os.platform(),
				(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {},
				nd.os.homedir(),
				nd.path.join,
			),
		);
		const enc = await encodeFonts(model, files, await panelFonts());
		model = enc.model;
		imageWarnings.push(...enc.warnings);
	}

	const written: string[] = [];
	let firstStem = "";
	const usedStems = new Set<string>();
	const outputs: CompileOutput[] = [];
	let linkedBytes = 0;
	const warnings = new Set<string>(imageWarnings);
	// Node's zlib packs .svgz smaller than the fallback
	const hooks = { gzip: (d: Uint8Array) => node.zlib.gzipSync(d, { level: 9 }) };
	for (let r = 0; r < model.roots.length; r++) {
		check();
		const raster = settings.format === "gif" || settings.format === "webp";
		onProgress(0.9 + (0.1 * r) / model.roots.length, raster ? "Drawing frames" : lottieOut ? "Writing Lottie" : "Compiling SVG");
		const out = raster
			? await exportRaster(
					model,
					files,
					settings,
					(svg, w, h) => (check(), canvasRasterizer(svg, w, h)),
					settings.format === "webp" ? cancellable(await panelCodecs(), check) : null,
					r,
				)
			: compileScene(model, files, settings, r, hooks);
		outputs.push(out);
		out.warnings.forEach((w) => warnings.add(w));
		const rootName = model.timelines[model.roots[r]!]?.name ?? "";
		// the format decides the extension (an .svg name chosen before switching to Lottie follows)
		const fext = out.files[0]?.ext ?? ".svg";
		const fallback = defaultOutput(info, model.roots.length > 1 || req.source === "library" ? rootName : undefined, fext);
		const chosen = resolveOutput(req.output, info, fallback ? node.path.basename(fallback) : "animation" + fext);
		const output = chosen ? withExt(chosen, fext) : "";
		let target = output || fallback;
		if (!target) throw new Error("Save the document first, or choose an output file.");
		if (model.roots.length > 1 && output) target = output.slice(0, output.length - fext.length) + "_" + rootName.replace(/[\\/:*?"<>|]+/g, "_") + fext;
		const ext = fext;
		let stem = target.slice(0, target.length - fext.length);
		// symbols whose names differ only in characters a file name can't have ("a/b", "a:b") get their own files
		for (let n = 2; usedStems.has(stem.toLowerCase()); n++) stem = target.slice(0, target.length - fext.length) + "_" + n;
		usedStems.add(stem.toLowerCase());
		if (r === 0) firstStem = stem;
		const folder = node.path.dirname(target);
		fsStep(folder, () => node.fs.mkdirSync(folder, { recursive: true }));
		for (const f of out.files) {
			const p = stem + f.suffix + ext;
			writeAtomic(p, f.bytes ?? f.svg);
			written.push(p);
		}
		for (const a of out.assets) {
			const dst = node.path.join(folder, a.path);
			fsStep(dst, () => node.fs.mkdirSync(node.path.dirname(dst), { recursive: true }));
			// re-encoded images and sounds exist only in memory
			const bytes = files.readBinary(a.source);
			writeAtomic(dst, bytes);
			linkedBytes += bytes.byteLength;
		}
	}
	if (req.keepScene && firstStem) {
		const dir = firstStem + ".scene";
		// replaced only when it is scene data written before: never a folder of the user's
		if (node.fs.existsSync(dir) && !node.fs.existsSync(node.path.join(dir, "scene.json")))
			throw new Error(`The scene data goes to ${dir}, which exists and holds something else: rename or move it, or choose another file name.`);
		fsStep(dir, () => {
			node.fs.rmSync(dir, { recursive: true, force: true });
			node.fs.cpSync(sceneDir, dir, { recursive: true });
		});
	}
	onProgress(1, "Done");
	return {
		files: written,
		format: settings.format ?? req.settings.format,
		output: outputs,
		warnings: [...warnings],
		seconds: (Date.now() - t0) / 1000,
		images,
		sounds,
		linkedBytes,
	};
}

/** Runs a file operation on `path`; its errors say in words what went wrong and what to do. */
function fsStep<T>(path: string, fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		const code = (e as { code?: string }).code;
		const why: Record<string, string> = {
			EACCES: `No permission to write ${path} (a protected folder, or a read-only file): choose another place.`,
			EPERM: `No permission to write ${path} (a protected folder, or a read-only file): choose another place.`,
			EBUSY: `${path} is open in another program: close it there and export again.`,
			ENOSPC: `The disk is full: ${path} could not be written.`,
			EROFS: `${path} is on a drive that can't be written to: choose another place.`,
			ENAMETOOLONG: `The path is too long for the file system: ${path}`,
			ENOENT: `The folder for ${path} can't be made (is the drive there?).`,
			EISDIR: `${path} is a folder: choose a file name.`,
			ENOTDIR: `A part of ${path} is a file, not a folder.`,
		};
		if (code && why[code]) throw new Error(why[code]);
		throw e;
	}
}

/**
 * Writes the file through a temporary one next to it: an export that fails half-way (a full disk)
 * leaves the previous file as it was, never a cut-off one.
 */
function writeAtomic(path: string, data: string | Uint8Array) {
	const nd = nodeOrThrow();
	const tmp = `${path}.${Date.now().toString(36)}.tmp`;
	fsStep(path, () => {
		try {
			if (typeof data === "string") nd.fs.writeFileSync(tmp, data, "utf8");
			else nd.fs.writeFileSync(tmp, data);
			nd.fs.renameSync(tmp, path);
		} catch (e) {
			try {
				nd.fs.rmSync(tmp, { force: true });
			} catch {
				/* best effort */
			}
			throw e;
		}
	});
}

/** The error a cancelled export ends with (named like fetch's, so encoders pass it on). */
function cancelError(): Error {
	return Object.assign(new Error("Export cancelled"), { name: "AbortError" });
}

/** `codecs` whose every call first runs `check` (which throws once the export is cancelled). */
function cancellable<T extends object>(codecs: T, check: () => void): T {
	return new Proxy(codecs, {
		get(target, key, receiver) {
			const v = Reflect.get(target, key, receiver) as unknown;
			return typeof v === "function"
				? (...args: unknown[]) => {
						check();
						return (v as (...a: unknown[]) => unknown).apply(target, args);
					}
				: v;
		},
	});
}

function nodeOrThrow() {
	if (!node) throw new Error("Node.js is not available in this panel.");
	return node;
}

/** Per-document settings (stored inside the FLA through JSFL document data). */
export async function loadDocSettings(): Promise<string | null> {
	const r = await evalScript("(function(){var d=fl.getDocumentDOM();return d&&d.documentHasData('flash2svg')?d.getDataFromDocument('flash2svg'):'';})()");
	return r || null;
}

export async function saveDocSettings(json: string) {
	await evalScript(`(function(){var d=fl.getDocumentDOM();if(d)d.addDataToDocument('flash2svg','string',${JSON.stringify(json)});})()`);
}
