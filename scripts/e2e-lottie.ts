// E2E for the Lottie output: every fixture exported as Lottie JSON (and once as .lottie), checked
// against the official schema (lottie-specs + ajv), then played in three players - lottie-web
// (SVG renderer) and dotLottie (ThorVG) in Edge/Chrome, Skottie (CanvasKit) in Node - and each
// sampled frame compared with the static renderer's frame rendered in the same browser.
// Usage: node scripts/e2e-lottie.ts [name,...] [--players=lottie-web,dotlottie,skottie] [--every=4] [--threshold=0.004] [--steps]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium, type Page } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";
import { withFonts } from "./lib/fonts.ts";
import { openHarness, skottie, startServer, WebPlayers, type LottiePlayer } from "./lib/lottie-players.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const players = opt("players", "lottie-web,dotlottie,skottie").split(",") as LottiePlayer[];
const every = parseInt(opt("every", "4"), 10);
// Same compiler, same geometry: as tight as the SVG checks (0.15% ~ a 15 px object on 400x300).
const threshold = parseFloat(opt("threshold", "0.0015"));
const steps = args.includes("--steps");
// Known differences (measured 2026-10-30, set just above), by fixture or "fixture/player".
const TOLERANCE: Record<string, number> = {
	// Animate's layer "fx" filter: left out (warned)
	"f22-layers": 0.002,
	// Lottie has no subtract blend: drawn as multiply by the inverted colours (warned); a solid box
	// at 60 % over a dark ground shows it (1.22 % in all three players, 2026-10-31)
	"f32-blend2": 0.013,
	// a text field's border and drop shadow aren't in Lottie (warned; the text is): 0.89 %
	"f56-text3": 0.01,
	// a gradient glow with four stops, looked up at 0, 50 and 100 % (warned)
	"f46-filters3": 0.0013,
	// dotLottie (ThorVG) blurs narrower: bevels, which subtract two blurred copies, show it most
	"f19-filters2/dotlottie": 0.0017,
	"f46-filters3/dotlottie": 0.0026,
	// dotLottie (ThorVG) blurs narrower (two of its three box blur passes at its quality)
	"f20-misc/dotlottie": 0.0025,
	"f29-motion/dotlottie": 0.0025,
	// a rotated repeating bitmap fill: tiles as separate images, their edges anti-aliased
	"f45-morph": 0.002,
	// dotLottie (ThorVG) samples outside a bitmap as transparent (the edge strips of a clipped
	// bitmap fill come out faded), smooths pixel art and anti-aliases tile edges (seams)
	"f25-paint/dotlottie": 0.06,
	"f42-images/dotlottie": 0.022,
	"f45-morph/dotlottie": 0.026,
	// ... and filters scaled-down bitmaps a little differently
	"f44-bitmap-sizes/dotlottie": 0.002,
	// an advanced colour effect on a bitmap (unequal multipliers) has no Lottie effect: only its alpha
	// (warned); tint and brightness are Fill effects and match
	"f50-bitmap-tint": 0.014,
};
const limit = (name: string, player: string) => TOLERANCE[`${name}/${player}`] ?? TOLERANCE[name] ?? threshold;
const list = args.find((a) => !a.startsWith("--"));
// video components play only in a browser (scripts/e2e-video.ts checks them); Animate draws the
// component's placeholder, Lottie has no video
const VIDEO = new Set(["f51-video", "f52-video-canvas"]);
const names = list ? list.split(",") : readdirSync(out).filter((d) => existsSync(join(out, d, "model", "scene.json")) && !VIDEO.has(d));

const require = createRequire(import.meta.url);
const { LottieValidator, get_schema_path } = require("@lottie-animation-community/lottie-specs/src/validator-node.js");
const { Ajv2020 } = require("ajv/dist/2020");
const validator = new LottieValidator(Ajv2020, JSON.parse(readFileSync(get_schema_path(), "utf8")));

const { url, server } = await startServer(repo);
const browser = await chromium.launch({ channel: opt("browser", "msedge"), headless: true });
const harness = await openHarness(browser, url);
const web = new WebPlayers(harness);
const ref: Page = await browser.newPage({ deviceScaleFactor: 1 });
let failures = 0;

async function still(file: string, w: number, h: number): Promise<PNG> {
	await ref.setViewportSize({ width: Math.ceil(w), height: Math.ceil(h) });
	await ref.goto(pathToFileURL(file).href);
	await ref.waitForLoadState("load");
	return PNG.sync.read(await ref.screenshot({ clip: { x: 0, y: 0, width: Math.ceil(w), height: Math.ceil(h) } }));
}

for (const name of names) {
	const modelDir = join(out, name, "model");
	const model: SceneModel = await withFonts(JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8")));
	const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	const dir = join(out, name, "lottie");
	mkdirSync(dir, { recursive: true });
	const { width: w, height: h } = model.doc;
	const t0 = performance.now();
	const res = compileScene(model, files, { format: "lottie", includeBackground: true, smooth: !steps });
	const ms = performance.now() - t0;
	const json = res.files[0]!.svg;
	writeFileSync(join(dir, `anim${steps ? "-steps" : ""}.json`), json);
	const dot = compileScene(model, files, { format: "dotlottie", includeBackground: true, smooth: !steps }).files[0]!.bytes!;
	writeFileSync(join(dir, `anim${steps ? "-steps" : ""}.lottie`), dot);
	const problems = validator.validate(JSON.parse(json), true) as { type: string; message: string; path: string }[];
	const errors = problems.filter((p) => p.type === "error");
	const unknown = [...new Set(problems.filter((p) => p.type === "warning").map((p) => p.message))];
	// (Lottie draws dynamic text from Animate's outlines)
	const statics = compileScene(model, files, { format: "static", includeBackground: true, textAsOutlines: true });
	const frames = Math.min(statics.files.length, res.stats.frames || statics.files.length);
	const sample: number[] = [];
	for (let f = 0; f < frames; f += every) sample.push(f);
	const refs = new Map<number, PNG>();
	for (const f of sample) {
		const sfile = join(dir, `static-${f + 1}.svg`);
		writeFileSync(sfile, statics.files[f]!.svg);
		refs.set(f, await still(sfile, w, h));
	}
	// Animate's own frame (tests/out/<name>/ref, see e2e-compare) over the stage colour, where it
	// exists: our SVG approximates a few things (a tinted instance is coloured as a group), so a
	// Lottie frame that differs from the SVG passes if it matches Animate at least as well
	const bgHex = model.doc.backgroundColor.replace("#", "");
	const bg = [0, 2, 4].map((i) => parseInt(bgHex.slice(i, i + 2), 16) || 255);
	const animateRef = (f: number): PNG | null => {
		const file = join(out, name, "ref", `f${String(f + 1).padStart(4, "0")}.png`);
		if (!existsSync(file)) return null;
		const png = PNG.sync.read(readFileSync(file));
		if (png.width !== Math.ceil(w) || png.height !== Math.ceil(h)) return null;
		for (let i = 0; i < png.data.length; i += 4) {
			const a = png.data[i + 3]! / 255;
			for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(png.data[i + k]! * a + bg[k]! * (1 - a));
			png.data[i + 3] = 255;
		}
		return png;
	};
	const ratioOf = (a: PNG, b: PNG) => pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.15, includeAA: false }) / (a.width * a.height);
	const report: string[] = [];
	let bad = false;
	for (const p of players) {
		let worst = 0,
			worstFrame = -1,
			byAnimate = 0;
		try {
			let render: (f: number) => Promise<PNG>;
			let dispose = () => {};
			if (p === "skottie") {
				const sk = await skottie(json, w, h);
				render = async (f) => sk.frame(f + (steps ? 0.5 : 0));
				dispose = () => sk.dispose();
			} else {
				// dotLottie gets the .lottie archive: tests the container too
				await web.load(p, p === "dotlottie" ? dot : json, w, h);
				render = (f) => web.frame(f + (steps ? 0.5 : 0), w, h);
			}
			for (const f of sample) {
				const want = refs.get(f)!;
				const got = await render(f);
				const diff = new PNG({ width: want.width, height: want.height });
				const n = pixelmatch(want.data, got.data, diff.data, want.width, want.height, { threshold: 0.15, includeAA: false });
				let ratio = n / (want.width * want.height);
				if (ratio > limit(name, p)) {
					const anim = animateRef(f);
					if (anim) {
						const la = ratioOf(anim, got),
							sa = ratioOf(anim, want);
						if (la <= limit(name, p) && la <= sa) {
							byAnimate++;
							ratio = la;
						}
					}
				}
				if (ratio > limit(name, p)) {
					writeFileSync(join(dir, `${p}-f${f + 1}-got.png`), PNG.sync.write(got));
					writeFileSync(join(dir, `ref-f${f + 1}.png`), PNG.sync.write(want));
					writeFileSync(join(dir, `${p}-f${f + 1}-diff.png`), PNG.sync.write(diff));
				}
				if (ratio > worst) {
					worst = ratio;
					worstFrame = f + 1;
				}
			}
			dispose();
		} catch (e) {
			worst = 1;
			report.push(`${p} ERROR ${(e as Error).message.split("\n")[0]}`);
			bad = true;
			continue;
		}
		const ok = worst <= limit(name, p);
		if (!ok) bad = true;
		report.push(
			`${p} ${(worst * 100).toFixed(2)}%${worstFrame > 0 && worst > 0 ? `@${worstFrame}` : ""}${byAnimate ? ` (${byAnimate} by Animate)` : ""}${ok ? "" : " FAIL"}`,
		);
	}
	if (errors.length) bad = true;
	if (bad) failures++;
	console.log(
		`${bad ? "FAIL" : "OK  "} ${name.padEnd(22)} ${(json.length / 1024).toFixed(1).padStart(6)} KB json ${(dot.length / 1024).toFixed(1).padStart(6)} KB .lottie ${ms.toFixed(0).padStart(4)} ms  schema ${errors.length ? errors.length + " errors" : "ok"}  ${report.join("  ")}`,
	);
	for (const e of errors.slice(0, 5)) console.log(`       schema: ${e.path}: ${e.message}`);
	if (unknown.length) console.log(`       unknown to the schema: ${unknown.slice(0, 6).join("; ")}`);
	for (const wmsg of res.warnings) console.log(`       warning: ${wmsg}`);
}
await browser.close();
server.close();
console.log(failures ? `${failures} fixture(s) failed` : "all fixtures OK");
process.exitCode = failures ? 1 : 0;
