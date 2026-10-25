/**
 * Runs an export from the panel: JSFL extraction (in steps, with progress), then compilation
 * in the panel, then writing the SVG(s) and assets.
 */
import { compileScene, type CompileOutput, type ExportSettings } from "../../core/compile.ts";
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
	output: CompileOutput[];
	warnings: string[];
	seconds: number;
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

export function defaultOutput(info: DocInfo, symbol?: string): string {
	if (!node || !info.path) return "";
	const fla = fromFileUri(info.path);
	const dir = node.path.dirname(fla);
	const base = node.path.basename(fla, node.path.extname(fla));
	const suffix = symbol ?? (info.isSymbol ? info.timeline : "");
	return node.path.join(dir, `${base}${suffix ? "_" + suffix.replace(/[\\/:*?"<>|]+/g, "_") : ""}.svg`);
}

export async function runExport(req: ExportRequest, info: DocInfo, onProgress: (p: number, msg: string) => void, isCancelled: () => boolean): Promise<ExportResult> {
	if (!node) throw new Error("Node.js is not available in this panel.");
	const t0 = Date.now();
	await ensureJsfl();
	const work = node.fs.mkdtempSync(node.path.join(node.os.tmpdir(), "flash2svg-"));
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
	const sceneDir = node.path.join(work, "scene");
	const model: SceneModel = JSON.parse(node.fs.readFileSync(node.path.join(sceneDir, "scene.json"), "utf8"));
	const files = {
		readText: (rel: string) => node.fs.readFileSync(node.path.join(sceneDir, rel), "utf8"),
		readBinary: (rel: string) => node.fs.readFileSync(node.path.join(sceneDir, rel)),
	};
	const settings: Partial<ExportSettings> = { ...req.settings };
	if (req.frames === "current") {
		settings.startFrame = (info.currentFrame ?? 0);
		settings.endFrame = settings.startFrame + 1;
		if (settings.format !== "static") settings.format = "static";
	} else if (req.frames === "range") {
		settings.startFrame = Math.max(0, req.rangeStart - 1);
		settings.endFrame = Math.max(settings.startFrame + 1, req.rangeEnd);
	}

	const written: string[] = [];
	const outputs: CompileOutput[] = [];
	const warnings = new Set<string>();
	for (let r = 0; r < model.roots.length; r++) {
		const out = compileScene(model, files, settings, r);
		outputs.push(out);
		out.warnings.forEach((w) => warnings.add(w));
		const rootName = model.timelines[model.roots[r]!]?.name ?? "";
		let target = req.output || defaultOutput(info, model.roots.length > 1 || req.source === "library" ? rootName : undefined);
		if (!target) throw new Error("Save the document first, or choose an output file.");
		if (model.roots.length > 1 && req.output) {
			const ext = node.path.extname(req.output) || ".svg";
			target = req.output.slice(0, req.output.length - node.path.extname(req.output).length) + "_" + rootName.replace(/[\\/:*?"<>|]+/g, "_") + ext;
		}
		const ext = node.path.extname(target) || ".svg";
		const stem = target.slice(0, target.length - node.path.extname(target).length);
		node.fs.mkdirSync(node.path.dirname(target), { recursive: true });
		for (const f of out.files) {
			const p = stem + f.suffix + ext;
			node.fs.writeFileSync(p, f.svg, "utf8");
			written.push(p);
		}
		for (const a of out.assets) {
			const dst = node.path.join(node.path.dirname(target), a.path);
			node.fs.mkdirSync(node.path.dirname(dst), { recursive: true });
			node.fs.copyFileSync(node.path.join(sceneDir, a.source), dst);
		}
	}
	try {
		node.fs.rmSync(work, { recursive: true, force: true });
	} catch {
		/* temp folder cleanup is best effort */
	}
	onProgress(1, "Done");
	return { files: written, output: outputs, warnings: [...warnings], seconds: (Date.now() - t0) / 1000 };
}

/** Per-document settings (stored inside the FLA through JSFL document data). */
export async function loadDocSettings(): Promise<string | null> {
	const r = await evalScript("(function(){var d=fl.getDocumentDOM();return d&&d.documentHasData('flash2svg')?d.getDataFromDocument('flash2svg'):'';})()");
	return r || null;
}

export async function saveDocSettings(json: string) {
	await evalScript(`(function(){var d=fl.getDocumentDOM();if(d)d.addDataToDocument('flash2svg','string',${JSON.stringify(json)});})()`);
}
