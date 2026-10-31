#!/usr/bin/env node
/**
 * flash2svg CLI: compiles a scene.json written by the Animate extractor into SVG.
 *
 *   flash2svg <scene.json> [-o out.svg] [--format smil|css|player|static|lottie|dotlottie] [options]
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { compileScene, DEFAULT_SETTINGS, type ExportSettings } from "../core/compile.ts";
import { encodeSounds } from "../core/audio.ts";
import { createAudioCodecs } from "../core/audio-codecs.ts";
import { createCodecs } from "../core/codecs.ts";
import { encodeImages } from "../core/images.ts";
import { createFontCodecs, encodeFonts, needsFonts } from "../core/fonts.ts";
import { nodeFontFiles } from "./fonts-node.ts";
import { exportRaster } from "../core/raster.ts";
import { nodeRasterizer } from "./raster-node.ts";
import { SCENE_MODEL_VERSION, type SceneModel } from "../core/model.ts";
import { nodeWasmLoader } from "./wasm.ts";

const HELP = `flash2svg <scene.json> [options]

  -o, --out <file>        output file, or a folder to write the default name into (default:
                          <document>.svg, .json or .lottie next to the scene folder)
  --format <f>            smil (default) | css | player | static | lottie (JSON) | dotlottie (.lottie) |
                          auto (the player for sounds / mouse handlers, else CSS or SMIL) |
                          gif | webp (animated raster fallbacks, e.g. for e-mail)
  --frames <a-b>          frame range, 1-based inclusive (e.g. 1-24)
  --loop <m>              auto (follow stop() scripts) | always | never
  --begin <m>             auto | click | hover | manual | visible (when half on screen) |
                          scroll (the scroll position runs it; CSS: inline SVG only)
                          (SVG; .lottie: its state machine)
  --scroll-range <r>      begin scroll: visible (while fully on screen, default) | crossing
                          (from entering to leaving the screen) | page (the page's scroll)
  --delay <s>             start delay in seconds (SVG)
  --steps                 no inter-frame interpolation (low FPS look)
  --scale <m>             fixed (the stage size, default) | fit (fill the space, show all) |
                          fill (no border, cropped) | stretch (exact fit, distorted)
  --background            include the stage colour
  --link-images           write images as files next to the SVG (or Lottie JSON) instead of embedding
  --image-lossy <f>       bitmaps set to "Photo (JPEG)" in Animate: jpeg (default) | webp | avif
  --image-lossless <f>    bitmaps set to "Lossless (PNG/GIF)", kept exactly: png (default) | webp
  --image-quality <q>     quality of lossy bitmaps, 1-100 (default: each bitmap's quality from Animate)
  --image-mode <name=m>   per bitmap (library name): lossy | lossless; repeatable
  --image-resolution <x>  bitmaps shown smaller are made smaller, down to x times the largest size
                          they are shown at (default 2; 0 = always every pixel)
  --image-full <name>     keep every pixel of this bitmap (library name); repeatable
  --sound-format <f>      compressed sounds (player format): mp3 (default) | opus
  --sound-bitrate <kbps>  on MP3's scale, Opus uses half (default: each sound's setting from Animate)
  --sound-mode <name=m>   per sound (library name): lossy | lossless (WAV); repeatable
  --text-outlines         draw dynamic text as outlines
  --no-embed-fonts        dynamic text uses the viewer's fonts (default: the installed fonts are
                          embedded as WOFF2 subsets of the characters used)
  --no-hidden-layers      skip hidden layers
  --guides                include guide layers (never shown in Flash)
  --poster <first|last>   frame shown where animation does not run, and with "reduce motion"
                          (.lottie: before a click / hover / script start)
  --ignore-reduced-motion animate also when the system asks for reduced motion
  --no-morph              shape tweens frame by frame (default: path morphs in SMIL and player)
  --digits <n>            decimal places on screen (default 2; parts shown larger or smaller get
                          more or fewer)
  --id-prefix <p>         start of every id (default: a short hash, unique per export)
  --pretty                indented output
  --svgz                  gzip-compressed SVG (.svgz): for design tools and servers that send
                          Content-Encoding: gzip; browsers don't open it from disk
  -h, --help
`;

async function main(argv: string[]) {
	// "--format=css" is the same as "--format css"
	const args = argv.flatMap((a) => (/^--[\w-]+=/.test(a) ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a]));
	if (!args.length || args.includes("-h") || args.includes("--help")) {
		process.stdout.write(HELP);
		return;
	}
	const s: Partial<ExportSettings> = {};
	let input = "";
	let out = "";
	while (args.length) {
		const a = args.shift()!;
		const val = () => {
			const v = args.shift();
			if (v === undefined) throw new Error(`Missing value for ${a}`);
			return v;
		};
		const oneOf = <T extends string>(...allowed: T[]): T => {
			const v = val();
			if (!(allowed as string[]).includes(v)) throw new Error(`${a} expects one of: ${allowed.join(", ")}`);
			return v as T;
		};
		const num = (min: number, max: number, int = false) => {
			const raw = val();
			const v = Number(raw);
			if (!raw.trim() || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
				throw new Error(`${a} expects ${int ? "an integer" : "a number"} from ${min} to ${max}`);
			}
			return v;
		};
		switch (a) {
			case "-o":
			case "--out":
				out = val();
				break;
			case "--format":
				s.format = oneOf("smil", "css", "player", "static", "lottie", "dotlottie", "auto", "gif", "webp");
				break;
			case "--frames": {
				const m = /^(\d+)(?:-(\d+))?$/.exec(val());
				if (!m) throw new Error("--frames expects a-b");
				s.startFrame = parseInt(m[1]!, 10) - 1;
				s.endFrame = m[2] ? parseInt(m[2], 10) : s.startFrame + 1;
				if (s.startFrame < 0 || s.endFrame <= s.startFrame) throw new Error("--frames expects a-b with 1 <= a <= b");
				break;
			}
			case "--loop":
				s.loop = oneOf("auto", "always", "never");
				break;
			case "--begin":
				s.begin = oneOf("auto", "click", "hover", "manual", "visible", "scroll");
				break;
			case "--scroll-range":
				s.scrollRange = oneOf("visible", "crossing", "page");
				break;
			case "--delay":
				s.delay = num(0, 86400);
				break;
			case "--scale":
				s.scale = oneOf("fixed", "fit", "fill", "stretch");
				break;
			case "--steps":
				s.smooth = false;
				break;
			case "--background":
				s.includeBackground = true;
				break;
			case "--link-images":
				s.embedImages = false;
				break;
			case "--image-lossy":
				s.imageLossy = oneOf("jpeg", "webp", "avif");
				break;
			case "--image-lossless":
				s.imageLossless = oneOf("png", "webp");
				break;
			case "--image-quality":
				s.imageQuality = num(1, 100, true);
				break;
			case "--image-mode": {
				const m = /^(.+)=(lossy|lossless)$/.exec(val());
				if (!m) throw new Error("--image-mode expects <library name>=lossy|lossless");
				s.imageModes = { ...s.imageModes, [m[1]!]: m[2] as "lossy" | "lossless" };
				break;
			}
			case "--image-resolution":
				s.imageResolution = num(0, 8);
				if (s.imageResolution > 0 && s.imageResolution < 0.25) throw new Error("--image-resolution expects 0 or a number from 0.25 to 8");
				break;
			case "--image-full":
				s.imageFullSize = { ...s.imageFullSize, [val()]: true };
				break;
			case "--sound-format":
				s.soundFormat = oneOf("mp3", "opus");
				break;
			case "--sound-bitrate":
				s.soundBitrate = num(8, 320, true);
				break;
			case "--sound-mode": {
				const m = /^(.+)=(lossy|lossless)$/.exec(val());
				if (!m) throw new Error("--sound-mode expects <library name>=lossy|lossless");
				s.soundModes = { ...s.soundModes, [m[1]!]: m[2] as "lossy" | "lossless" };
				break;
			}
			case "--no-embed-fonts":
				s.embedFonts = false;
				break;
			case "--text-outlines":
				s.textAsOutlines = true;
				break;
			case "--no-hidden-layers":
				s.includeHiddenLayers = false;
				break;
			case "--guides":
				s.includeGuides = true;
				break;
			case "--poster":
				s.posterFrame = oneOf("first", "last");
				break;
			case "--ignore-reduced-motion":
				s.reducedMotion = false;
				break;
			case "--no-morph":
				s.morph = false;
				break;
			case "--digits":
				s.digits = num(0, 6, true);
				break;
			case "--id-prefix": {
				const p = val();
				if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(p)) throw new Error("--id-prefix expects letters, digits, _ or - (not starting with a digit)");
				s.idPrefix = p;
				break;
			}
			case "--pretty":
				s.pretty = true;
				break;
			case "--svgz":
				s.svgz = true;
				break;
			default:
				if (a.startsWith("-")) throw new Error(`Unknown option ${a}`);
				input = a;
		}
	}
	if (!input) throw new Error("No scene.json given");
	const sceneFile = resolve(input);
	const base = dirname(sceneFile);
	const read = parseModel(readFileSync(sceneFile, "utf8"), input);
	const loader = nodeWasmLoader();
	let { model, files, warnings } = await encodeImages(
		read,
		{
			readText: (rel) => readFileSync(join(base, rel), "utf8"),
			readBinary: (rel) => readFileSync(join(base, rel)),
		},
		s,
		createCodecs(loader),
	);
	// only the player plays sounds ("auto" picks it for documents with sounds)
	if ((s.format === "player" || s.format === "auto") && Object.keys(model.sounds).length) {
		const r = await encodeSounds(model, files, s, createAudioCodecs(loader));
		({ model, files } = r);
		warnings = [...warnings, ...r.warnings];
	}
	// fonts of dynamic and input text (SVG formats); the WOFF2 encoder loads only for such text
	if (
		s.embedFonts !== false &&
		!s.textAsOutlines &&
		s.format !== "lottie" &&
		s.format !== "dotlottie" &&
		s.format !== "gif" &&
		s.format !== "webp" &&
		needsFonts(model)
	) {
		const { compress } = await import("woff2-encoder");
		const r = await encodeFonts(model, nodeFontFiles(), createFontCodecs(loader, compress));
		model = r.model;
		warnings = [...warnings, ...r.warnings];
	}
	const raster = s.format === "gif" || s.format === "webp";
	const kb = (n: number) => (n / 1024).toFixed(1);
	// one file per root (several library symbols: <name>_<symbol>), as the panel writes them
	const roots = model.roots.length;
	const used = new Set<string>();
	for (let r = 0; r < roots; r++) {
		const rasterWarnings = new Set<string>();
		const result = raster
			? await exportRaster(
					model,
					files,
					s,
					nodeRasterizer(loader, (m) => rasterWarnings.add(m)),
					createCodecs(loader),
					r,
				)
			: compileScene(model, files, s, r, { gzip: (d) => gzipSync(d, { level: 9 }) });
		if (r === 0) result.warnings.unshift(...warnings);
		result.warnings.push(...rasterWarnings);
		const defaultExt = result.files[0]?.ext ?? ".svg";
		const docName = basename(model.doc.name, extname(model.doc.name)) + defaultExt;
		// -o a folder (an existing one, or ending in a slash): the default name inside it
		const folder = !!out && (/[\\/]$/.test(out) || (existsSync(out) && statSync(out).isDirectory()));
		const target = resolve(!out ? join(base, "..", docName) : folder ? join(out, docName) : out);
		mkdirSync(dirname(target), { recursive: true });
		// gzip inside: the extension says so, whatever name was given
		const ext = defaultExt === ".svgz" ? ".svgz" : extname(target) || defaultExt;
		let stem = target.slice(0, target.length - extname(target).length);
		if (roots > 1) stem += "_" + (model.timelines[model.roots[r]!]?.name ?? String(r + 1)).replace(/[\\/:*?"<>|]+/g, "_");
		const own = stem;
		for (let n = 2; used.has(stem.toLowerCase()); n++) stem = own + "_" + n;
		used.add(stem.toLowerCase());
		for (const f of result.files) writeFileSync(stem + f.suffix + ext, f.bytes ?? f.svg);
		for (const a of result.assets) {
			const dst = join(dirname(target), a.path);
			mkdirSync(dirname(dst), { recursive: true });
			// re-encoded images exist only in memory
			try {
				writeFileSync(dst, files.readBinary(a.source));
			} catch {
				process.stderr.write(`warning: missing ${a.source}\n`);
			}
		}
		for (const w of result.warnings) process.stderr.write(`warning: ${w}\n`);
		const written =
			result.files.length > 1
				? `${stem + result.files[0]!.suffix + ext} … ${result.files[result.files.length - 1]!.suffix + ext}`
				: stem + (result.files[0]?.suffix ?? "") + ext;
		process.stdout.write(`${result.files.length} file(s), ${kb(result.stats.bytes)} KB, ${result.stats.durationSeconds.toFixed(2)}s -> ${written}\n`);
		// what the size is made of
		const parts = Object.entries(result.stats.parts).filter(([, n]) => n > 0);
		process.stdout.write(`  ${parts.map(([k, n]) => `${k} ${kb(n)} KB`).join(", ")}\n`);
	}
	void DEFAULT_SETTINGS;
}

/** The extractor's scene.json, or a message saying what it is instead. */
function parseModel(text: string, name: string): SceneModel {
	let m: Partial<SceneModel>;
	try {
		m = JSON.parse(text);
	} catch (e) {
		throw new Error(`${name} is not valid JSON (${(e as Error).message})`);
	}
	if (!m || typeof m !== "object" || typeof m.doc !== "object" || !Array.isArray(m.roots) || typeof m.timelines !== "object")
		throw new Error(`${name} is not a Flash2SVG scene model (the scene.json the extractor writes in Animate)`);
	if (typeof m.version === "number" && m.version > SCENE_MODEL_VERSION)
		throw new Error(`${name} was written by a newer Flash2SVG (scene model version ${m.version}; this compiler reads up to ${SCENE_MODEL_VERSION})`);
	return m as SceneModel;
}

main(process.argv.slice(2)).catch((e) => {
	process.stderr.write(`error: ${(e as Error).message}\n`);
	process.exitCode = 1;
});
