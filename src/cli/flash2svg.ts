#!/usr/bin/env node
/**
 * flash2svg CLI: compiles a scene.json written by the Animate extractor into SVG.
 *
 *   flash2svg <scene.json> [-o out.svg] [--format smil|css|player|static|lottie|dotlottie] [options]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { compileScene, DEFAULT_SETTINGS, type ExportSettings } from "../core/compile.ts";
import { encodeSounds } from "../core/audio.ts";
import { createAudioCodecs } from "../core/audio-codecs.ts";
import { createCodecs } from "../core/codecs.ts";
import { encodeImages } from "../core/images.ts";
import { createFontCodecs, encodeFonts } from "../core/fonts.ts";
import { nodeFontFiles } from "./fonts-node.ts";
import type { SceneModel } from "../core/model.ts";
import { nodeWasmLoader } from "./wasm.ts";

const HELP = `flash2svg <scene.json> [options]

  -o, --out <file>        output file (default: <document>.svg, .json or .lottie next to scene.json)
  --format <f>            smil (default) | css | player | static | lottie (JSON) | dotlottie (.lottie) |
                          auto (the player for sounds / mouse handlers, else CSS or SMIL)
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
				s.format = oneOf("smil", "css", "player", "static", "lottie", "dotlottie", "auto");
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
	const read = JSON.parse(readFileSync(sceneFile, "utf8")) as SceneModel;
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
	// only the player plays sounds
	if (s.format === "player" && Object.keys(model.sounds).length) {
		const r = await encodeSounds(model, files, s, createAudioCodecs(loader));
		({ model, files } = r);
		warnings = [...warnings, ...r.warnings];
	}
	// fonts of dynamic and input text (SVG formats)
	if (s.embedFonts !== false && !s.textAsOutlines && s.format !== "lottie" && s.format !== "dotlottie") {
		const { compress } = await import("woff2-encoder");
		const r = await encodeFonts(model, nodeFontFiles(), createFontCodecs(loader, compress));
		model = r.model;
		warnings = [...warnings, ...r.warnings];
	}
	const result = compileScene(model, files, s, 0, { gzip: (d) => gzipSync(d, { level: 9 }) });
	result.warnings.unshift(...warnings);
	const defaultExt = result.files[0]?.ext ?? ".svg";
	const target = resolve(out || join(base, "..", basename(model.doc.name, extname(model.doc.name)) + defaultExt));
	mkdirSync(dirname(target), { recursive: true });
	// gzip inside: the extension says so, whatever name was given
	const ext = defaultExt === ".svgz" ? ".svgz" : extname(target) || defaultExt;
	const stem = target.slice(0, target.length - extname(target).length);
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
	const kb = (n: number) => (n / 1024).toFixed(1);
	process.stdout.write(`${result.files.length} file(s), ${kb(result.stats.bytes)} KB, ${result.stats.durationSeconds.toFixed(2)}s -> ${stem + ext}\n`);
	// what the size is made of
	const parts = Object.entries(result.stats.parts).filter(([, n]) => n > 0);
	process.stdout.write(`  ${parts.map(([k, n]) => `${k} ${kb(n)} KB`).join(", ")}\n`);
	void DEFAULT_SETTINGS;
}

main(process.argv.slice(2)).catch((e) => {
	process.stderr.write(`error: ${(e as Error).message}\n`);
	process.exitCode = 1;
});
