#!/usr/bin/env node
/**
 * flash2svg CLI: compiles a scene.json written by the Animate extractor into SVG.
 *
 *   flash2svg <scene.json> [-o out.svg] [--format smil|css|player|static] [options]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { compileScene, DEFAULT_SETTINGS, type ExportSettings } from "../core/compile.ts";
import type { SceneModel } from "../core/model.ts";

const HELP = `flash2svg <scene.json> [options]

  -o, --out <file>        output SVG (default: <document>.svg next to scene.json)
  --format <f>            smil (default) | css | player | static
  --frames <a-b>          frame range, 1-based inclusive (e.g. 1-24)
  --loop <m>              auto (follow stop() scripts) | always | never
  --begin <m>             auto | click | hover | manual
  --delay <s>             start delay in seconds
  --steps                 no inter-frame interpolation (low FPS look)
  --background            include the stage colour
  --link-images           write images as files next to the SVG instead of embedding
  --text-outlines         draw dynamic text as outlines
  --no-hidden-layers      skip hidden layers
  --poster <first|last>   frame shown where animation does not run
  --digits <n>            decimal places (default 2)
  --id-prefix <p>         start of every id (default: a short hash, unique per export)
  --pretty                indented output
  -h, --help
`;

function main(argv: string[]) {
	const args = [...argv];
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
				s.format = oneOf("smil", "css", "player", "static");
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
				s.begin = oneOf("auto", "click", "hover", "manual");
				break;
			case "--delay":
				s.delay = num(0, 86400);
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
			case "--text-outlines":
				s.textAsOutlines = true;
				break;
			case "--no-hidden-layers":
				s.includeHiddenLayers = false;
				break;
			case "--poster":
				s.posterFrame = oneOf("first", "last");
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
			default:
				if (a.startsWith("-")) throw new Error(`Unknown option ${a}`);
				input = a;
		}
	}
	if (!input) throw new Error("No scene.json given");
	const sceneFile = resolve(input);
	const base = dirname(sceneFile);
	const model: SceneModel = JSON.parse(readFileSync(sceneFile, "utf8"));
	const result = compileScene(
		model,
		{
			readText: (rel) => readFileSync(join(base, rel), "utf8"),
			readBinary: (rel) => readFileSync(join(base, rel)),
		},
		s,
	);
	const target = resolve(out || join(base, "..", basename(model.doc.name, extname(model.doc.name)) + ".svg"));
	mkdirSync(dirname(target), { recursive: true });
	const ext = extname(target) || ".svg";
	const stem = target.slice(0, target.length - extname(target).length);
	for (const f of result.files) writeFileSync(stem + f.suffix + ext, f.svg);
	for (const a of result.assets) {
		const dst = join(dirname(target), a.path);
		mkdirSync(dirname(dst), { recursive: true });
		const src = join(base, a.source);
		if (existsSync(src)) copyFileSync(src, dst);
	}
	for (const w of result.warnings) process.stderr.write(`warning: ${w}\n`);
	const kb = (result.stats.bytes / 1024).toFixed(1);
	process.stdout.write(`${result.files.length} file(s), ${kb} KB, ${result.stats.durationSeconds.toFixed(2)}s -> ${target}\n`);
	void DEFAULT_SETTINGS;
}

try {
	main(process.argv.slice(2));
} catch (e) {
	process.stderr.write(`error: ${(e as Error).message}\n`);
	process.exitCode = 1;
}
