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
	source: "timeline" | "library";
	frames: "all" | "current" | "range";
	rangeStart: number;
	rangeEnd: number;
	/** Absolute output path (file); empty = next to the FLA */
	output: string;
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

/** The image codecs (panel/codecs.js) and the audio codecs (panel/audio.js). */
const panelCodecs = lazyBundle<Codecs>("codecs.js", "Flash2SvgCodecs", "image codecs");
const panelAudio = lazyBundle<AudioCodecs>("audio.js", "Flash2SvgAudio", "audio codecs");
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
	return format === "lottie" ? ".json" : format === "dotlottie" ? ".lottie" : ".svg";
}

export function defaultOutput(info: DocInfo, symbol?: string, ext = ".svg"): string {
	if (!node || !info.path) return "";
	const fla = fromFileUri(info.path);
	const dir = node.path.dirname(fla);
	const base = node.path.basename(fla, node.path.extname(fla));
	const suffix = symbol ?? (info.isSymbol ? info.timeline : "");
	return node.path.join(dir, `${base}${suffix ? "_" + suffix.replace(/[\\/:*?"<>|]+/g, "_") : ""}${ext}`);
}

/** `file` with the format's extension, if it has one of another format. */
function withExt(file: string, ext: string): string {
	return file.replace(/\.(svgz?|json|lottie)$/i, "") + (/\.(svgz?|json|lottie)$/i.test(file) || !/\.[^\\/.]+$/.test(file) ? ext : "");
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
	const opts = { outDir: toFileUri(node.path.join(work, "scene")), items };
	let st = await evalJson<JobStatus>(`Flash2Svg.start(${JSON.stringify(JSON.stringify(opts))})`);
	while (st.state === "running") {
		if (isCancelled()) {
			await evalScript("Flash2Svg.cancel()");
			throw new Error("Export cancelled");
		}
		onProgress(0.05 + 0.75 * (st.progress ?? 0), st.message ?? "Working");
		st = await evalJson<JobStatus>("Flash2Svg.step(250)");
	}
	if (st.state === "error") throw new Error(st.message || "Extraction failed");

	onProgress(0.82, "Compiling SVG");
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
		onProgress(0.8, "Encoding images");
		const enc = await encodeImages(model, files, req.settings, await panelCodecs());
		({ model, files, report: images } = enc);
		imageWarnings.push(...enc.warnings);
	}
	const settings: Partial<ExportSettings> = { ...req.settings };
	if (req.frames === "current") {
		settings.startFrame = info.currentFrame ?? 0;
		settings.endFrame = settings.startFrame + 1;
		if (settings.format !== "static") settings.format = "static";
	} else if (req.frames === "range") {
		settings.startFrame = Math.max(0, req.rangeStart - 1);
		settings.endFrame = Math.max(settings.startFrame + 1, req.rangeEnd);
	}

	// only the player plays sounds
	let sounds: SoundReport[] = [];
	if ((settings.format === "player" || settings.format === "auto") && Object.keys(model.sounds).length) {
		onProgress(0.85, "Encoding sounds");
		const enc = await encodeSounds(model, files, req.settings, await panelAudio());
		({ model, files, report: sounds } = enc);
		imageWarnings.push(...enc.warnings);
	}

	const written: string[] = [];
	const outputs: CompileOutput[] = [];
	let linkedBytes = 0;
	const warnings = new Set<string>(imageWarnings);
	// Node's zlib packs .svgz smaller than the fallback
	const hooks = { gzip: (d: Uint8Array) => node.zlib.gzipSync(d, { level: 9 }) };
	for (let r = 0; r < model.roots.length; r++) {
		const out = compileScene(model, files, settings, r, hooks);
		outputs.push(out);
		out.warnings.forEach((w) => warnings.add(w));
		const rootName = model.timelines[model.roots[r]!]?.name ?? "";
		// the format decides the extension (an .svg name chosen before switching to Lottie follows)
		const fext = out.files[0]?.ext ?? ".svg";
		const output = req.output ? withExt(req.output, fext) : "";
		let target = output || defaultOutput(info, model.roots.length > 1 || req.source === "library" ? rootName : undefined, fext);
		if (!target) throw new Error("Save the document first, or choose an output file.");
		if (model.roots.length > 1 && output) {
			const ext = node.path.extname(output) || fext;
			target = output.slice(0, output.length - node.path.extname(output).length) + "_" + rootName.replace(/[\\/:*?"<>|]+/g, "_") + ext;
		}
		const ext = node.path.extname(target) || fext;
		const stem = target.slice(0, target.length - node.path.extname(target).length);
		node.fs.mkdirSync(node.path.dirname(target), { recursive: true });
		for (const f of out.files) {
			const p = stem + f.suffix + ext;
			if (f.bytes) node.fs.writeFileSync(p, f.bytes);
			else node.fs.writeFileSync(p, f.svg, "utf8");
			written.push(p);
		}
		for (const a of out.assets) {
			const dst = node.path.join(node.path.dirname(target), a.path);
			node.fs.mkdirSync(node.path.dirname(dst), { recursive: true });
			// re-encoded images and sounds exist only in memory
			const bytes = files.readBinary(a.source);
			node.fs.writeFileSync(dst, bytes);
			linkedBytes += bytes.byteLength;
		}
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
