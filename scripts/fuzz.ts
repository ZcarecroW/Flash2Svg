// Fuzzing the compiler: the fixtures' real scene models (tests/out/<name>/model, written by the
// e2e extraction), mutated at random in ways Animate documents can take — extreme or degenerate
// matrices, frame scripts that jump nowhere, labels and names with markup and odd characters,
// every filter and blend mode with extreme values, emptied keyframes and layers, odd frame rates
// and stage sizes — then compiled with random settings in every format. Each output is checked:
//   - no exception
//   - well-formed XML (own strict checker: tags, attributes, entities, characters XML allows)
//   - ids unique, every url(#…) / href="#…" / begin="id.event" reference resolves
//   - no NaN / undefined / Infinity / [object Object] in the output
//   - Lottie: valid JSON against the official schema; .lottie: a readable archive
//   - the same input gives the same bytes
//   - with --browser: SMIL, CSS and player files load in Edge without script errors while the
//     player is driven through its API (play, stop, gotoAndPlay to labels that exist or not,
//     seek, speed, clips) and clicked, hovered and tabbed at random
// Failures are grouped by message; each group's first case is saved to tests/out/fuzz/ so that
// `node scripts/fuzz.ts --replay tests/out/fuzz/<case>.json` runs it again.
// Usage: node scripts/fuzz.ts [--runs 300] [--seed 1] [--formats smil,css,...] [--browser [--verbose]] [--replay file]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createServer } from "node:http";
import { strFromU8, unzipSync } from "fflate";
import { chromium, type Browser, type Page } from "playwright-core";
import { compileScene, type CompileOutput, type ExportSettings } from "../src/core/compile.ts";
import { encodeImages } from "../src/core/images.ts";
import { encodeSounds } from "../src/core/audio.ts";
import { createAudioCodecs } from "../src/core/audio-codecs.ts";
import { createCodecs } from "../src/core/codecs.ts";
import { createFontCodecs, encodeFonts } from "../src/core/fonts.ts";
import { exportRaster } from "../src/core/raster.ts";
import { nodeFontFiles } from "../src/cli/fonts-node.ts";
import { nodeRasterizer } from "../src/cli/raster-node.ts";
import { nodeWasmLoader } from "../src/cli/wasm.ts";
import type { ElementData, FilterData, Mat, SceneModel, TimelineData } from "../src/core/model.ts";

const repo = join(import.meta.dirname, "..");
const outDir = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
	const i = args.indexOf("--" + name);
	return i >= 0 ? args[i + 1]! : def;
};
const RUNS = Number(opt("runs", "300"));
const SEED = Number(opt("seed", String(Date.now() % 100000)));
const FORMATS = opt("formats", "smil,css,player,static,lottie,dotlottie,auto,gif,webp").split(",") as ExportSettings["format"][];
const REPLAY = opt("replay", "");
const MUTATE = !args.includes("--no-mutate");
const BROWSER = args.includes("--browser");
const VERBOSE = args.includes("--verbose");

// ------------------------------------------------------------------ random
let state = SEED >>> 0;
const rand = () => {
	state = (state + 0x6d2b79f5) >>> 0;
	let t = state;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number) => rand() < p;
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

// strings Animate lets authors type (labels, instance names, text, accessibility), and some it doesn't
const WEIRD = [
	"",
	" ",
	"a<b&c>\"d'e",
	"]]>",
	"</script><script>alert(1)</script>",
	"</style>",
	"--",
	"Ü ✓ 日本語 עברית",
	"😀👍🏽",
	"x".repeat(300),
	"tab\there\r\nnew line",
	"5",
	"0",
	"-1",
	"label with spaces",
	"#hash",
	"url(#x)",
	"${x}",
	"back\\slash",
	"/* c */",
	"`tick`",
	"&amp;",
	"&#x0;",
];
const EXOTIC = ["a\u0003b", "￿", "lone\ud800", "nul\u0000"];
const weird = () => (chance(0.08) ? pick(EXOTIC) : pick(WEIRD));

const BLENDS = [
	"normal",
	"layer",
	"multiply",
	"screen",
	"overlay",
	"hardlight",
	"lighten",
	"darken",
	"difference",
	"add",
	"subtract",
	"invert",
	"alpha",
	"erase",
	"unknownMode",
];
const FILTER_KINDS = ["blurFilter", "glowFilter", "dropShadowFilter", "bevelFilter", "gradientGlowFilter", "gradientBevelFilter", "adjustColorFilter"];

function randomFilter(): FilterData {
	const name = pick(FILTER_KINDS);
	if (name === "adjustColorFilter")
		return { name, enabled: chance(0.9), brightness: int(-100, 100), contrast: int(-100, 100), saturation: int(-100, 100), hue: int(-180, 180) };
	const n = pick([0, 0.5, 1, 2, 4, 10, 50, 255]);
	const f: FilterData = {
		name,
		enabled: chance(0.9),
		angle: pick([0, 45, -90, 359, 720]),
		blurX: n,
		blurY: chance(0.5) ? n : pick([0, 3, 100]),
		distance: pick([0, 1, 5, -20, 300]),
		color: pick(["#000000", "#FF0000", "#FFFFFF80", "#00000000"]),
		quality: pick(["low", "medium", "high"]),
		inner: chance(0.3),
		knockout: chance(0.2),
		hideObject: chance(0.15),
		strength: pick([0, 1, 50, 100, 200, 1000]),
	};
	if (name === "bevelFilter") Object.assign(f, { shadowColor: "#000000", highlightColor: "#FFFFFF", type: pick(["inner", "outer", "full"]) });
	if (name.startsWith("gradient")) {
		const stops = int(1, 15);
		Object.assign(f, {
			type: pick(["inner", "outer", "full"]),
			posArray: Array.from({ length: stops }, (_, i) => Math.round((i * 255) / Math.max(1, stops - 1))),
			colorArray: Array.from({ length: stops }, () => pick(["#FFFFFF00", "#FF00FF", "#000000", "#123456AA"])),
			gradientIndex: 0,
		});
	}
	return f;
}

function randomMatrix(m: Mat): Mat {
	switch (int(0, 7)) {
		case 0:
			return [0, 0, 0, 0, m[4], m[5]];
		case 1:
			return [-m[0], m[1], m[2], -m[3], m[4], m[5]];
		case 2:
			return [m[0] * 1e4, m[1], m[2], m[3] * 1e4, m[4] * 1e3, m[5] * 1e3];
		case 3:
			return [m[0] * 1e-7, m[1] * 1e-7, m[2] * 1e-7, m[3] * 1e-7, m[4], m[5]];
		case 4:
			return [1, 0, 2.5, 1, m[4], m[5]]; // skew
		case 5:
			return [m[0], m[1], m[2], m[3], -1e6, 1e6];
		case 6:
			return [0, 1, -1, 0, m[4] + 0.123456789, m[5]];
		default:
			return [m[0], m[1], m[2], m[3], m[4] + 0.5, m[5] - 0.5];
	}
}

function scripts(names: string[], labels: string[]): string {
	const inst = names.length ? pick(names) : "btn";
	const label = labels.length ? pick(labels) : "nope";
	return pick([
		"stop();",
		"play();",
		"gotoAndPlay(1);",
		"gotoAndStop(0);",
		"gotoAndPlay(99999);",
		"gotoAndPlay(-5);",
		"gotoAndPlay('nope');",
		`gotoAndStop(${JSON.stringify(label)});`,
		`gotoAndPlay(${JSON.stringify(label)});`,
		"this.stop();",
		"this.gotoAndPlay(3);",
		"nextFrame();",
		"prevFrame();",
		"nextScene();",
		"prevScene();",
		"gotoAndPlay(1, 'Scene 2');",
		"var n:int = 0; n++; if (n < 3) gotoAndPlay(1); else stop();",
		"if (this.n == undefined) this.n = 0; if (++this.n < 2) this.gotoAndPlay(0); else this.stop();",
		"if (x) { stop(); }",
		"}{",
		"/* stop(); */",
		"// stop();",
		"stop() stop()",
		`${inst}.addEventListener(MouseEvent.CLICK, f); function f(e:MouseEvent):void { gotoAndStop(5); }`,
		`this.${inst}.addEventListener("click", function () { this.gotoAndPlay(${JSON.stringify(label)}); }.bind(this));`,
		`${inst}.addEventListener(MouseEvent.MOUSE_OVER, (e) => { MovieClip(this.root).gotoAndPlay(2); });`,
		`this.${inst}.on("dblclick", () => { this.${inst}.visible = false; });`,
		`${inst}.addEventListener(MouseEvent.CLICK, g); function g(e) { navigateToURL(new URLRequest("https://example.com/?a=1&b=\\"2\\"<x>"), "_blank"); }`,
		`this.${inst}.addEventListener("click", () => window.open("javascript:alert(1)", "_blank"));`,
		"stage.addEventListener(KeyboardEvent.KEY_DOWN, k); function k(e) { stop(); }",
		"addEventListener(Event.ENTER_FRAME, f); function f(e) {}",
		`this.${inst}.visible = false;`,
		"MovieClip(this.root).gotoAndPlay(2);",
		"exportRoot.stop();",
		"this.parent.gotoAndStop(1);",
	]);
}

function namesIn(t: TimelineData) {
	const names: string[] = [];
	for (const l of t.layers) for (const k of l.keyframes) for (const e of k.elements) if (e.kind === "instance" && e.name) names.push(e.name);
	return names;
}

const log: string[] = [];

function mutate(m: SceneModel) {
	const ids = Object.keys(m.timelines);
	const touch = (p: number, what: string, fn: () => void) => {
		if (!chance(p)) return;
		fn();
		log.push(what);
	};
	touch(0.08, "frameRate", () => (m.doc.frameRate = pick([1, 0.5, 120, 23.976, 0.01])));
	touch(0.06, "stage size", () => {
		m.doc.width = pick([1, 2, 8192, 333.33]);
		m.doc.height = pick([1, 3, 8192, 100.5]);
	});
	touch(0.05, "doc name", () => (m.doc.name = weird() + ".fla"));
	touch(0.05, "doc acc", () => (m.doc.acc = { name: weird(), description: weird(), silent: chance(0.3), forceSimple: chance(0.3) }));
	touch(0.05, "background", () => (m.doc.backgroundColor = pick(["#000000", "#FFFFFF00", "#12345680"])));
	for (const id of ids) {
		const t = m.timelines[id]!;
		const labels: string[] = [];
		for (const l of t.layers) for (const k of l.keyframes) if (k.label) labels.push(k.label.name);
		touch(0.03, `${id}: truncate`, () => {
			const n = int(1, Math.max(1, t.frameCount));
			t.frameCount = n;
			for (const l of t.layers) {
				l.keyframes = l.keyframes.filter((k) => k.index < n);
				for (const k of l.keyframes)
					if (k.index + k.duration > n) {
						k.duration = n - k.index;
						if (k.tween?.samples) k.tween.samples = k.tween.samples.slice(0, k.duration);
						if (k.tween?.shapeFrames) k.tween.shapeFrames = k.tween.shapeFrames.slice(0, k.duration);
					}
				l.frameCount = Math.min(l.frameCount, n);
			}
		});
		touch(0.03, `${id}: extend`, () => (t.frameCount += int(1, 50)));
		touch(0.03, `${id}: drop layer`, () => {
			if (t.layers.length < 2) return;
			const i = int(0, t.layers.length - 1);
			if (t.layers.some((l) => l.parent === i)) return;
			t.layers.splice(i, 1);
			for (const l of t.layers) if (l.parent > i) l.parent--;
		});
		touch(0.02, `${id}: no layers`, () => {
			t.layers = [];
		});
		for (const [li, l] of t.layers.entries()) {
			touch(0.03, `${id}/${li}: hide`, () => (l.visible = !l.visible));
			touch(0.02, `${id}/${li}: guide`, () => {
				if (l.type === "normal" && !t.layers.some((o) => o.parent === li)) l.type = "guide";
			});
			touch(0.02, `${id}/${li}: empty mask`, () => {
				if (l.type === "normal" && !t.layers.some((o) => o.parent === li)) l.type = "mask";
			});
			touch(0.01, `${id}/${li}: name`, () => (l.name = weird()));
			touch(
				0.03,
				`${id}/${li}: effects`,
				() =>
					(l.effects = [
						{
							frame: 0,
							filters: chance(0.7) ? [randomFilter()] : [],
							blendMode: pick(BLENDS),
							color: chance(0.5) ? { mode: "advanced", rP: 50, gP: 100, bP: 0, aP: 70, rA: 20, gA: 0, bA: -255, aA: 0 } : undefined,
						},
					]),
			);
			for (const k of l.keyframes) {
				touch(
					0.02,
					`${id}/${li}@${k.index}: label`,
					() => (k.label = { name: chance(0.3) && labels.length ? pick(labels) : weird(), type: pick(["name", "name", "comment", "anchor"]) }),
				);
				touch(0.04, `${id}/${li}@${k.index}: script`, () => (k.script = scripts(namesIn(t), labels)));
				touch(0.02, `${id}/${li}@${k.index}: empty`, () => {
					k.elements = [];
					delete k.tween;
				});
				if (k.tween && k.tween.type !== "shape") {
					touch(0.03, `${id}/${li}@${k.index}: ease`, () => (k.tween!.easing = pick([-100, 100, 0, -1, 1])));
					touch(0.02, `${id}/${li}@${k.index}: custom ease`, () => {
						k.tween!.customEase = {
							all: pick([
								[
									{ x: 0, y: 0 },
									{ x: 0.5, y: 2 },
									{ x: 0.5, y: -1 },
									{ x: 1, y: 1 },
								],
								[
									{ x: 0, y: 0 },
									{ x: 0, y: 0 },
									{ x: 1, y: 1 },
									{ x: 1, y: 1 },
								],
								[
									{ x: 0, y: 0 },
									{ x: 0.2, y: 0 },
									{ x: 0.3, y: 1 },
									{ x: 0.5, y: 0.5 },
									{ x: 0.6, y: 0 },
									{ x: 0.8, y: 1 },
									{ x: 1, y: 1 },
								],
							]),
						};
					});
					touch(0.02, `${id}/${li}@${k.index}: rotate`, () => {
						k.tween!.rotate = pick(["clockwise", "counter-clockwise", "auto"]);
						k.tween!.rotateTimes = pick([0, 1, 7]);
					});
				}
				for (const e of k.elements) mutateElement(e, `${id}/${li}@${k.index}`, touch);
			}
		}
	}
	touch(0.03, "sounds", () => {
		for (const t of Object.values(m.timelines))
			for (const l of t.layers)
				for (const k of l.keyframes)
					if (k.sound) {
						k.sound.sync = pick(["event", "start", "stop", "stream"]);
						k.sound.loops = pick([0, 1, 3, 9999]);
						k.sound.loopMode = pick(["repeat", "loop"]);
						if (chance(0.5))
							k.sound.envelope = [
								[0, 32768, 0],
								[44100 * 100, 0, 32768],
							];
					}
	});
}

function mutateElement(e: ElementData, where: string, touch: (p: number, w: string, fn: () => void) => void) {
	if (e.kind === "instance") {
		touch(0.03, `${where}: matrix`, () => (e.matrix = randomMatrix(e.matrix)));
		touch(0.02, `${where}: transform point`, () => (e.transformPoint = { x: pick([0, -1e4, 1e5]), y: pick([0, 3.3, -77]) }));
		touch(
			0.03,
			`${where}: color`,
			() =>
				(e.color = pick([
					{ mode: "alpha", rP: 100, gP: 100, bP: 100, aP: 0, rA: 0, gA: 0, bA: 0, aA: 0 },
					{ mode: "advanced", rP: -100, gP: 300, bP: 100, aP: 100, rA: 255, gA: -255, bA: 0, aA: 255 },
					{ mode: "tint", rP: 0, gP: 0, bP: 0, aP: 100, rA: 255, gA: 0, bA: 0, aA: 0 },
					null,
				])),
		);
		touch(0.04, `${where}: filters`, () => (e.filters = Array.from({ length: int(0, 4) }, randomFilter)));
		touch(0.04, `${where}: blend`, () => (e.blendMode = pick(BLENDS)));
		touch(0.02, `${where}: invisible`, () => (e.visible = false));
		touch(0.02, `${where}: cache`, () => (e.cacheAsBitmap = !e.cacheAsBitmap));
		touch(0.03, `${where}: name`, () => (e.name = weird()));
		touch(
			0.02,
			`${where}: acc`,
			() => (e.acc = { name: weird(), description: weird(), shortcut: weird(), tabIndex: pick([0, 1, -1, 32000]), silent: chance(0.3) }),
		);
		if (e.symbolType === "graphic")
			touch(0.04, `${where}: graphic loop`, () => {
				e.loop = pick(["loop", "play once", "single frame", "loop reverse", "play once reverse"]);
				e.firstFrame = pick([0, 1, 5, 9999]);
				if (chance(0.5)) e.lastFrame = pick([0, 2, 9999]);
			});
	} else if (e.kind === "text") {
		touch(0.05, `${where}: text`, () => {
			e.text = weird();
			for (const r of e.runs) r.text = e.text;
		});
		touch(0.02, `${where}: runs`, () => {
			for (const r of e.runs) {
				r.face = pick(["NoSuchFont", "Arial", "_sans", "Times New Roman", weird()]);
				r.letterSpacing = pick([-10, 0, 50]);
				r.size = pick([1, 0.5, 400]);
			}
		});
		touch(0.02, `${where}: text type`, () => (e.textType = pick(["static", "dynamic", "input"])));
		touch(0.02, `${where}: text acc`, () => (e.acc = { name: weird(), silent: chance(0.5) }));
	} else if (e.kind === "bitmap") {
		touch(0.03, `${where}: bitmap matrix`, () => (e.matrix = randomMatrix(e.matrix)));
	}
}

function randomSettings(format: ExportSettings["format"], m: SceneModel): Partial<ExportSettings> {
	const s: Partial<ExportSettings> = { format };
	const maybe = <K extends keyof ExportSettings>(k: K, values: ExportSettings[K][]) => {
		if (chance(0.35)) s[k] = pick(values);
	};
	maybe("loop", ["auto", "always", "never"]);
	maybe("begin", ["auto", "click", "hover", "manual", "visible", "scroll"]);
	maybe("scrollRange", ["visible", "crossing", "page"]);
	maybe("delay", [0, 0.3, 86400]);
	maybe("scale", ["fixed", "fit", "fill", "stretch"]);
	maybe("smooth", [true, false]);
	maybe("includeBackground", [true, false]);
	maybe("includeHiddenLayers", [true, false]);
	maybe("includeGuides", [true, false]);
	maybe("embedImages", [true, false]);
	maybe("textAsOutlines", [true, false]);
	maybe("posterFrame", ["first", "last"]);
	maybe("reducedMotion", [true, false]);
	maybe("morph", [true, false]);
	maybe("digits", [0, 1, 2, 4, 6]);
	maybe("pretty", [true, false]);
	maybe("svgz", [false, false, true]);
	maybe("idPrefix", ["p", "a-b_c"]);
	const root = m.timelines[m.roots[0]!];
	const n = root?.frameCount ?? 1;
	if (chance(0.15)) {
		s.startFrame = int(0, Math.max(0, n - 1));
		s.endFrame = Math.min(n, s.startFrame + int(1, n));
	}
	if (format === "static" && chance(0.4)) s.frames = [0, int(0, n + 3), -1].filter((f, i, a) => a.indexOf(f) === i);
	return s;
}

// ------------------------------------------------------------------ checks
/** Index of the first character XML 1.0 doesn't allow (control characters, unpaired surrogates, U+FFFE/FFFF), or -1. */
function badXmlChar(src: string): number {
	for (let i = 0; i < src.length; i++) {
		const c = src.charCodeAt(i);
		if (c < 0x20) {
			if (c !== 9 && c !== 10 && c !== 13) return i;
		} else if (c >= 0xd800 && c <= 0xdbff) {
			if (i + 1 >= src.length || (src.charCodeAt(i + 1) & 0xfc00) !== 0xdc00) return i;
			i++;
		} else if ((c >= 0xdc00 && c <= 0xdfff) || c === 0xfffe || c === 0xffff) return i;
	}
	return -1;
}

/** Strict-enough XML well-formedness: returns the first problem or "". */
function checkXml(src: string): string {
	let i = src.startsWith("<?xml") ? src.indexOf("?>") + 2 : 0;
	const stack: string[] = [];
	let roots = 0;
	const bad = badXmlChar(src);
	if (bad >= 0) return `character U+${src.charCodeAt(bad).toString(16).padStart(4, "0")} not allowed in XML at ${bad}`;
	const entity = (s: string, at: number) => {
		const m = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(s);
		if (m) return `bad entity at ${at + m.index}: ${s.slice(m.index, m.index + 12)}`;
		for (const r of s.matchAll(/&#(x[0-9a-fA-F]+|\d+);/g)) {
			const c = r[1]![0] === "x" ? parseInt(r[1]!.slice(1), 16) : parseInt(r[1]!, 10);
			if (c > 0x10ffff || badXmlChar(String.fromCodePoint(c)) >= 0) return `character reference to U+${c.toString(16)} at ${at + r.index!}`;
		}
		return "";
	};
	while (i < src.length) {
		const lt = src.indexOf("<", i);
		const text = src.slice(i, lt < 0 ? src.length : lt);
		if (text.trim()) {
			if (!stack.length) return `text outside the root at ${i}`;
			const e = entity(text, i);
			if (e) return e;
			if (text.includes("]]>")) return `"]]>" in text at ${i}`;
		}
		if (lt < 0) break;
		if (src.startsWith("<!--", lt)) {
			const end = src.indexOf("-->", lt + 4);
			if (end < 0) return "unclosed comment";
			if (src.slice(lt + 4, end).includes("--")) return `"--" in a comment at ${lt}`;
			i = end + 3;
			continue;
		}
		if (src.startsWith("<![CDATA[", lt)) {
			if (!stack.length) return "CDATA outside the root";
			const end = src.indexOf("]]>", lt + 9);
			if (end < 0) return "unclosed CDATA";
			i = end + 3;
			continue;
		}
		if (src.startsWith("<!DOCTYPE", lt) || src.startsWith("<?", lt)) {
			i = src.indexOf(">", lt) + 1;
			continue;
		}
		const close = src[lt + 1] === "/";
		const m = /^<\/?([A-Za-z_:][\w.:-]*)/.exec(src.slice(lt, lt + 200));
		if (!m) return `bad tag at ${lt}: ${src.slice(lt, lt + 20)}`;
		const name = m[1]!;
		let j = lt + m[0].length;
		if (close) {
			const end = src.indexOf(">", j);
			if (src.slice(j, end).trim()) return `junk in end tag at ${lt}`;
			if (stack.pop() !== name) return `mismatched </${name}> at ${lt}`;
			i = end + 1;
			continue;
		}
		const seen = new Set<string>();
		for (;;) {
			const ws = /^\s*/.exec(src.slice(j, j + 1000))![0].length;
			j += ws;
			if (src[j] === ">" || src.startsWith("/>", j)) break;
			if (!ws) return `no space before attribute at ${j} in <${name}>`;
			const a = /^([A-Za-z_:][\w.:-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(src.slice(j, j + 1_000_000));
			if (!a) return `bad attribute at ${j} in <${name}>: ${src.slice(j, j + 40)}`;
			if (seen.has(a[1]!)) return `duplicate attribute ${a[1]} in <${name}> at ${j}`;
			seen.add(a[1]!);
			const e = entity(a[3] ?? a[4] ?? "", j);
			if (e) return e;
			j += a[0].length;
		}
		if (!stack.length) {
			roots++;
			if (roots > 1) return `second root element at ${lt}`;
		}
		if (src.startsWith("/>", j)) i = j + 2;
		else {
			stack.push(name);
			i = j + 1;
		}
	}
	if (stack.length) return `unclosed <${stack[stack.length - 1]}>`;
	if (!roots) return "no root element";
	return "";
}

function checkIds(src: string): string {
	const ids = new Map<string, number>();
	for (const m of src.matchAll(/\sid="([^"]*)"/g)) ids.set(m[1]!, (ids.get(m[1]!) ?? 0) + 1);
	for (const [id, n] of ids) {
		if (n > 1) return `duplicate id "${id}" (${n}×)`;
		if (!/^[A-Za-z_][\w.-]*$/.test(id)) return `id "${id}" is not a valid name`;
	}
	// the player's timeline data refers to its artwork by id too, but inside a script: only markup here
	const markup = src.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
	// (in presentation attributes and links: labels and names may say "url(#x)" as text)
	for (const m of markup.matchAll(/\s(?:fill|stroke|clip-path|mask|filter|style)="[^"]*?url\(#([^)]+)\)|\s(?:xlink:)?href="#([^"]+)"/g)) {
		const id = m[1] ?? m[2]!;
		if (!ids.has(id)) return `reference to missing id "${id}"`;
	}
	for (const m of markup.matchAll(/\s(?:begin|end)="([^"]*)"/g))
		for (const part of m[1]!.split(";")) {
			const r = /^\s*([A-Za-z_][\w-]*)\.(begin|end|click|mouseover|mouseout|mouseenter|mouseleave|mousedown|mouseup|focusin|focusout|repeat)/.exec(part);
			if (r && !ids.has(r[1]!)) return `timing refers to missing id "${r[1]}"`;
		}
	// CSS rules for ids
	for (const s of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
		for (const r of s[1]!.matchAll(/url\(#([\w.-]+)\)/g)) if (!ids.has(r[1]!)) return `CSS refers to missing id "${r[1]}"`;
	return "";
}

function checkTokens(src: string): string {
	const m = /NaN|undefined|Infinity|\[object Object\]/.exec(src);
	return m ? `"${m[0]}" in the output near ${JSON.stringify(src.slice(Math.max(0, m.index - 60), m.index + 30))}` : "";
}

const require = createRequire(import.meta.url);
const { LottieValidator, get_schema_path } = require("@lottie-animation-community/lottie-specs/src/validator-node.js");
const { Ajv2020 } = require("ajv/dist/2020");
const validator = new LottieValidator(Ajv2020, JSON.parse(readFileSync(get_schema_path(), "utf8")));
const allowedLottie = /unknown property '(v|st|td|bm|ef)'/;

function checkLottie(json: string): string {
	let anim;
	try {
		anim = JSON.parse(json);
	} catch (e) {
		return "Lottie JSON doesn't parse: " + (e as Error).message;
	}
	const tok = /\bnull\b/.exec(json);
	if (tok) return `null in the Lottie JSON near ${json.slice(Math.max(0, tok.index - 60), tok.index + 20)}`;
	if (!(anim.op > anim.ip)) return `op ${anim.op} not after ip ${anim.ip}`;
	if (!(anim.fr > 0)) return `frame rate ${anim.fr}`;
	const problems = (validator.validate(anim, true) as { type: string; message: string; path: string }[]).filter(
		(p) => p.type === "error" || !allowedLottie.test(p.message),
	);
	return problems.length ? `schema: ${problems[0]!.message} at ${problems[0]!.path}` : "";
}

function checkOutput(out: CompileOutput, s: Partial<ExportSettings>): string {
	if (!out.files.length && s.format !== "static") return "no output file";
	for (const f of out.files) {
		if (s.format === "gif" || s.format === "webp") {
			if (!f.bytes?.length) return "empty raster file";
			continue;
		}
		if (f.ext === ".lottie") {
			let zip;
			try {
				zip = unzipSync(f.bytes!);
			} catch (e) {
				return ".lottie doesn't unzip: " + (e as Error).message;
			}
			const manifest = JSON.parse(strFromU8(zip["manifest.json"]!));
			const id = manifest.animations?.[0]?.id;
			const anim = zip[`a/${id}.json`];
			if (!anim) return `.lottie without its animation a/${id}.json`;
			const p = checkLottie(strFromU8(anim));
			if (p) return ".lottie: " + p;
			for (const sm of manifest.stateMachines ?? []) if (!zip[`s/${sm.id}.json`]) return `.lottie without its state machine s/${sm.id}.json`;
			continue;
		}
		if (f.ext === ".json") {
			const p = checkLottie(f.svg);
			if (p) return p;
			continue;
		}
		if (f.ext === ".svgz") continue;
		const text = f.svg;
		const p =
			checkXml(text) ||
			checkIds(text) ||
			checkTokens(text.replace(/<desc[^>]*>[\s\S]*?<\/desc>|<title[^>]*>[\s\S]*?<\/title>|aria-label="[^"]*"|data:[^"')]*/g, ""));
		if (p) return `${f.suffix || "main"}: ${p}`;
	}
	return "";
}

// ------------------------------------------------------------------ pipeline
const loader = nodeWasmLoader();
const codecs = createCodecs(loader);
const audioCodecs = createAudioCodecs(loader);
const { compress } = await import("woff2-encoder");
const fontCodecs = createFontCodecs(loader, compress);
const fontFiles = nodeFontFiles();
const rasterizer = nodeRasterizer(loader);

async function run(base: string, model: SceneModel, s: Partial<ExportSettings>, encode: { images: boolean; sounds: boolean; fonts: boolean }) {
	const dir = join(outDir, base, "model");
	let files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) as Uint8Array };
	let m = model;
	if (encode.images) ({ model: m, files } = await encodeImages(m, files, s, codecs));
	if (encode.sounds && s.format === "player" && Object.keys(m.sounds).length) ({ model: m, files } = await encodeSounds(m, files, s, audioCodecs));
	if (encode.fonts && s.embedFonts !== false && !s.textAsOutlines) ({ model: m } = await encodeFonts(m, fontFiles, fontCodecs));
	if (s.format === "gif" || s.format === "webp") return exportRaster(m, files, s, rasterizer, codecs);
	return compileScene(m, files, s, 0);
}

const bases = readdirSync(outDir)
	.filter((d) => /^f\d\d/.test(d) && existsSync(join(outDir, d, "model", "scene.json")))
	.map((d) => ({ name: d, model: readFileSync(join(outDir, d, "model", "scene.json"), "utf8") }));
const failures = new Map<string, { count: number; first: string }>();
mkdirSync(join(outDir, "fuzz"), { recursive: true });

// ------------------------------------------------------------------ browser
let page: Page | null = null;
let browser: Browser | null = null;
let newPage: () => Promise<Page>;
let served = "";
const errors: string[] = [];
let base = "";
if (BROWSER) {
	const server = createServer((_, res) => void res.writeHead(200, { "content-type": "image/svg+xml" }).end(served));
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	server.unref();
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
	browser = await chromium.launch({ channel: "msedge", headless: true });
	process.on("exit", () => void browser?.close());
	// a page of its own context: one that hangs is left behind with it
	newPage = async () => {
		const p = await (await browser!.newContext({ viewport: { width: 640, height: 480 } })).newPage();
		p.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
		p.on("console", (m) => {
			if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
		});
		return p;
	};
	page = await newPage();
}

/** browserCheck with a time limit: a page that doesn't answer in 20 s hangs (its context is dropped). */
async function browserCheckTimed(svg: string, ops: Op[]): Promise<string> {
	let timer: NodeJS.Timeout | undefined;
	const hang = new Promise<string>((r) => (timer = setTimeout(() => r("browser: no answer in 20 s (hangs)"), 20000)));
	const result = await Promise.race([browserCheck(svg, ops).catch((e: Error) => `browser: ${e.message.split("\n")[0]}`), hang]);
	clearTimeout(timer);
	if (result.startsWith("browser:")) {
		const old = page!;
		page = await within(newPage(), 10000);
		if (page)
			void old
				.context()
				.close()
				.catch(() => {});
		else {
			// the whole browser stopped answering (a wedged GPU process takes every page with it): start a
			// new one (Playwright kills one that won't close when this process exits)
			void within(browser!.close(), 5000);
			browser = await chromium.launch({ channel: "msedge", headless: true });
			page = await newPage();
			if (VERBOSE) console.log("  (browser restarted)");
		}
	}
	return result;
}

/** The promise's value, or null once `ms` pass without one. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
	let timer: NodeJS.Timeout | undefined;
	return Promise.race([p.catch(() => null), new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)))]).finally(() => clearTimeout(timer));
}

type Op = ["api", string, unknown, string] | ["click" | "move", number, number] | ["key", string] | ["wait", number];

/** What the browser check does, chosen up front so that a saved case replays it. */
function browserOps(model: SceneModel, s: Partial<ExportSettings>): Op[] {
	const labels: (string | number)[] = [0, 1, -3, 1.5, 1e9, "", "nope", weird()];
	for (const t of Object.values(model.timelines)) for (const l of t.layers) for (const k of l.keyframes) if (k.label) labels.push(k.label.name);
	const names = Object.values(model.timelines).flatMap(namesIn);
	const ops: Op[] = [];
	for (let i = int(3, 10); i > 0; i--) {
		const op = int(0, 9);
		if (op <= 4 && (s.format === "player" || s.format === "auto")) {
			const call = pick(["play", "pause", "stop", "gotoAndPlay", "gotoAndStop", "seek", "speed", "clip", "muted"] as const);
			// (NaN as a string: the case file is JSON)
			const arg = call === "seek" ? pick([-1, 0, 0.5, 3, 1e6, "NaN"]) : call === "speed" ? pick([0, -1, 0.5, 4, 100, "NaN"]) : pick(labels);
			ops.push(["api", call, arg, names.length ? pick(names) : "x"]);
		} else if (op <= 6) ops.push(["click", int(0, 640), int(0, 480)]);
		else if (op === 7) ops.push(["move", int(0, 640), int(0, 480)]);
		else if (op === 8) ops.push(["key", pick(["Tab", "Enter", " "])]);
		else ops.push(["wait", int(10, 120)]);
	}
	return ops;
}

async function browserCheck(svg: string, ops: Op[]): Promise<string> {
	if (!page) return "";
	served = svg;
	errors.length = 0;
	await page.goto(base + "case.svg?" + Math.random());
	for (const op of ops) {
		if (op[0] === "api") {
			const [, call, raw, clip] = op;
			const arg = raw === "NaN" ? Number.NaN : raw;
			await page.evaluate(
				({ call, arg, clip }) => {
					const p = (document.documentElement as unknown as { flash2svg?: Record<string, unknown> }).flash2svg as
						Record<string, (...a: unknown[]) => unknown> | undefined;
					if (!p) return;
					if (call === "speed") (p as unknown as { speed: unknown }).speed = arg;
					else if (call === "muted") (p as unknown as { muted: boolean }).muted = true;
					else if (call === "clip") (p.clip!(clip) as Record<string, (a: unknown) => void> | null)?.gotoAndStop?.(arg);
					else p[call]!(arg);
				},
				{ call, arg, clip },
			);
		} else if (op[0] === "click") await page.mouse.click(op[1], op[2]);
		else if (op[0] === "move") await page.mouse.move(op[1], op[2]);
		else if (op[0] === "key") await page.keyboard.press(op[1]);
		else await page.waitForTimeout(op[1]);
	}
	await page.waitForTimeout(50);
	return errors.length ? errors[0]!.slice(0, 300) : "";
}

async function oneCase(
	c: {
		base: string;
		model: SceneModel;
		settings: Partial<ExportSettings>;
		encode: { images: boolean; sounds: boolean; fonts: boolean };
		mutations: string[];
		ops?: Op[];
	},
	n: number,
) {
	const t0 = performance.now();
	let problem = "";
	let browserMs = -1;
	try {
		const out = await run(c.base, structuredClone(c.model), c.settings, c.encode);
		problem = checkOutput(out, c.settings);
		if (!problem && c.settings.format !== "gif" && c.settings.format !== "webp" && chance(0.25)) {
			const again = await run(c.base, structuredClone(c.model), c.settings, c.encode);
			const same =
				out.files.length === again.files.length &&
				out.files.every((f, i) => f.svg === again.files[i]!.svg && Buffer.from(f.bytes ?? []).equals(Buffer.from(again.files[i]!.bytes ?? [])));
			if (!same) problem = "not deterministic";
		}
		const f = out.files[0];
		if (!problem && BROWSER && f && !f.ext && /^(smil|css|player|auto)$/.test(c.settings.format ?? "")) {
			// saved first: a hang can take the process with it
			c.ops ??= browserOps(c.model, c.settings);
			writeFileSync(join(outDir, "fuzz", "current.json"), JSON.stringify(c));
			const t = performance.now();
			problem = await browserCheckTimed(f.svg, c.ops);
			browserMs = performance.now() - t;
		}
	} catch (e) {
		const err = e as Error;
		problem = `threw ${err.name}: ${err.message} @ ${
			(err.stack ?? "")
				.split("\n")
				.find((l) => l.includes("src"))
				?.trim() ?? ""
		}`;
	}
	const ms = performance.now() - t0;
	if (!problem && ms > 20000) problem = `slow: ${(ms / 1000).toFixed(1)} s`;
	if (VERBOSE) {
		// slow but not a problem yet: kept for profiling
		const keep = !problem && ms > 5000 ? join(outDir, "fuzz", `slow-${SEED}-${n}.json`) : "";
		if (keep) writeFileSync(keep, JSON.stringify(c));
		console.log(
			`  #${n} ${c.base} ${c.settings.format}: ${ms.toFixed(0)} ms${browserMs >= 0 ? ` (browser ${browserMs.toFixed(0)})` : ""}${problem ? " - " + problem : ""}${keep ? " -> " + keep : ""}`,
		);
	}
	if (problem) {
		const key = problem.replace(/\d+(\.\d+)?/g, "#").slice(0, 160);
		const f = failures.get(key);
		if (f) f.count++;
		else {
			const file = join(outDir, "fuzz", `case-${SEED}-${n}.json`);
			writeFileSync(file, JSON.stringify(c));
			failures.set(key, {
				count: 1,
				first: `${problem}\n    ${c.base} ${JSON.stringify(c.settings)}\n    mutations: ${c.mutations.slice(0, 12).join("; ")}\n    replay: node scripts/fuzz.ts --replay ${file}`,
			});
		}
	}
	return ms;
}

if (REPLAY) {
	const c = JSON.parse(readFileSync(REPLAY, "utf8"));
	const out = await run(c.base, c.model, c.settings, c.encode);
	let problem = checkOutput(out, c.settings);
	const f = out.files[0];
	if (!problem && BROWSER && f && !f.ext) problem = await browserCheckTimed(f.svg, c.ops ?? []);
	if (c.ops) console.log("ops:", JSON.stringify(c.ops));
	console.log(problem || "no problem", out.warnings);
	process.exit(0);
}

let total = 0;
const t0 = performance.now();
for (let n = 0; n < RUNS; n++) {
	const base = pick(bases);
	const model: SceneModel = JSON.parse(base.model);
	log.length = 0;
	if (MUTATE) mutate(model);
	const format = pick(FORMATS);
	const settings = randomSettings(format, model);
	// raster fallbacks draw every frame: keep them short
	if ((format === "gif" || format === "webp") && (model.timelines[model.roots[0]!]?.frameCount ?? 0) > 24) {
		settings.startFrame = 0;
		settings.endFrame = 12;
	}
	const encode = { images: chance(0.3), sounds: chance(0.5), fonts: chance(0.5) };
	total += await oneCase({ base: base.name, model, settings, encode, mutations: [...log] }, n);
	if ((n + 1) % 50 === 0) console.log(`${n + 1} cases, ${failures.size} problem kind(s), ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(`\nseed ${SEED}: ${RUNS} cases in ${((performance.now() - t0) / 1000).toFixed(0)} s (compile ${(total / RUNS).toFixed(0)} ms average)`);
for (const [, f] of [...failures].sort((a, b) => b[1].count - a[1].count)) console.log(`\n[${f.count}×] ${f.first}`);
console.log(failures.size ? `\nFUZZ: ${failures.size} kind(s) of problems` : "\nFUZZ: no problems");
process.exitCode = failures.size ? 1 : 0;
// an open browser keeps the process alive (Playwright kills one that won't close on exit)
if (browser && (await within(browser.close(), 10000)) === null) process.exit();
