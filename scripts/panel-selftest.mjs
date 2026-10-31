// Runs the installed panel's self-test inside Animate: writes the job file, launches Animate,
// waits for the panel to export the fixtures and quit, then prints the results.
// Needs a --selftest build installed (npm run build -- --selftest && npm run package && node scripts/dev-install.mjs --zxp).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findAnimate, isAnimateRunning } from "./lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out", "selftest");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const fla = (n) => join(repo, "tests", "fixtures", "fla", `${n}.fla`);
const jobs = [
	{ fla: fla("f02-eases"), output: join(out, "eases-smil.svg"), settings: { format: "smil" } },
	{ fla: fla("f04-nested"), output: join(out, "nested-css.svg"), settings: { format: "css" } },
	{ fla: fla("f13-camera"), output: join(out, "camera-player.svg"), settings: { format: "player" } },
	{ fla: fla("f10-canvas"), output: join(out, "canvas-smil.svg"), settings: { format: "smil", includeBackground: true } },
	{ fla: fla("f12-labels"), output: join(out, "labels-frames.svg"), settings: { format: "static" } },
	{ fla: fla("f16-sound"), output: join(out, "sound-player.svg"), settings: { format: "player", embedImages: false } },
	// panel edge cases: current frame is always a still; a range; empty number fields; "#" and spaces in the path
	{ fla: fla("f02-eases"), output: join(out, "current-frame.svg"), settings: { format: "smil" }, frames: "current", expect: { files: 1, format: "static" } },
	{ fla: fla("f12-labels"), output: join(out, "range.svg"), settings: { format: "static" }, frames: "range", rangeStart: 4, rangeEnd: 6, expect: { files: 3 } },
	{ fla: fla("f02-eases"), output: join(out, "empty fields.svg"), settings: { format: "css", digits: null, delay: null }, expect: { files: 1 } },
	{ fla: fla("f18-bitmap"), output: join(out, "dir #1", "bitmap linked.svg"), settings: { format: "smil", embedImages: false }, expect: { files: 1, assets: true } },
	// image codecs (loaded on demand inside the panel): per-bitmap modes, every format, linked files
	{ fla: fla("f42-images"), output: join(out, "images-webp.svg"), settings: { format: "smil", imageLossy: "webp", imageLossless: "webp", imageModes: { "photo.jpg": "lossless" } }, expect: { files: 1, mimes: ["image/webp"], noMimes: ["image/jpeg", "image/png"], parts: ["drawing", "animation", "images"] } },
	{ fla: fla("f42-images"), output: join(out, "images-avif.svg"), settings: { format: "css", imageLossy: "avif", imageQuality: 60 }, expect: { files: 1, mimes: ["image/avif", "image/png"] } },
	{ fla: fla("f42-images"), output: join(out, "images linked", "images.svg"), settings: { format: "player", embedImages: false }, expect: { files: 1, assets: true, parts: ["runtime", "linked"] } },
	// downscaling: bitmaps shown smaller are written at 2x (the default) or 1x their size on stage; tiles, pixel art and "Full" keep every pixel
	{ fla: fla("f44-bitmap-sizes"), output: join(out, "sizes-2x.svg"), settings: { format: "smil" }, expect: { files: 1, pixels: { "large.png": [320, 240], "nested.png": [200, 150], "fill.png": [160, 160], "tile.png": [64, 64], "pixels.png": [64, 64] } } },
	{ fla: fla("f44-bitmap-sizes"), output: join(out, "sizes-1x.svg"), settings: { format: "player", imageResolution: 1, imageFullSize: { "large.png": true } }, expect: { files: 1, pixels: { "large.png": [640, 480], "nested.png": [100, 75], "fill.png": [80, 80] } } },
	// audio codecs (loaded on demand): Opus embedded (Raw stays WAV), MP3 linked, no sound outside the player
	{ fla: fla("f43-sounds"), output: join(out, "sounds-opus.svg"), settings: { format: "player", soundFormat: "opus" }, expect: { files: 1, mimes: ["audio/ogg", "audio/wav"], noMimes: ["audio/mpeg"], parts: ["sounds", "runtime"] } },
	{ fla: fla("f43-sounds"), output: join(out, "sounds linked", "sounds.svg"), settings: { format: "player", embedImages: false, soundModes: { "chord.wav": "lossless" } }, expect: { files: 1, soundFiles: [".mp3", ".wav"] } },
	{ fla: fla("f43-sounds"), output: join(out, "sounds-smil.svg"), settings: { format: "smil" }, expect: { files: 1, warning: /Sounds play only in the JS player/ } },
	// shape tweens as path morphs: SMIL animates path data and gradient matrices, the player gets morph parts
	{ fla: fla("f45-morph"), output: join(out, "morph.svg"), settings: { format: "smil" }, expect: { files: 1, contains: [/<animate attributeName="d"/, /<animateTransform attributeName="gradientTransform"/] } },
	{ fla: fla("f45-morph"), output: join(out, "morph-player.svg"), settings: { format: "player" }, expect: { files: 1, contains: [/"mp":\[/] } },
	// Lottie: the file name follows the format (.svg chosen, .json / .lottie written); bitmaps embedded,
	// linked next to the JSON, or inside the archive
	{ fla: fla("f45-morph"), output: join(out, "morph-lottie.svg"), settings: { format: "lottie" }, preview: {}, expect: { files: 1, ext: ".json", lottie: true, parts: ["drawing", "animation"], preview: { svg: true, moving: true } } },
	{ fla: fla("f42-images"), output: join(out, "images.lottie"), settings: { format: "dotlottie", imageLossy: "webp" }, preview: {}, expect: { files: 1, ext: ".lottie", dotlottie: true, parts: ["images"], preview: { canvas: true, moving: true, state: "play" } } },
	{ fla: fla("f42-images"), output: join(out, "images lottie linked", "images.json"), settings: { format: "lottie", embedImages: false }, preview: {}, expect: { files: 1, ext: ".json", lottie: true, linkedImages: true, preview: { svg: true, images: true } } },
	// Lottie effects (filters) and the preview: lottie-web draws them as SVG filters; a JSON in dotLottie;
	// a .lottie whose state machine waits for a click, then plays the intro (a stop() with running clips)
	{ fla: fla("f08-filters"), output: join(out, "filters.json"), settings: { format: "lottie" }, preview: {}, expect: { files: 1, lottie: true, contains: [/"ty":25/, /"ty":29/, /"tt":3/, /"bm":10/], preview: { svg: true, filters: true } } },
	{ fla: fla("f02-eases"), output: join(out, "eases-in-dotlottie.json"), settings: { format: "lottie" }, preview: { player: "dotlottie" }, expect: { files: 1, lottie: true, preview: { canvas: true, moving: true } } },
	{ fla: fla("f27-stop"), output: join(out, "stop-click.lottie"), settings: { format: "dotlottie", begin: "click" }, preview: { click: true }, expect: { files: 1, dotlottie: true, preview: { canvas: true, state: "idle", stateAfterClick: "intro" } } },
	// selected library symbols: one file per symbol, named after it
	{ fla: fla("f04-nested"), output: join(out, "lib.svg"), settings: { format: "css" }, source: "library", select: ["spinner", "counter"], expect: { files: 2, names: ["lib_spinner.svg", "lib_counter.svg"] } },
	// a second scene: only the current one is exported, with a warning
	{ fla: fla("f12-labels"), output: join(out, "scenes.svg"), settings: { format: "smil" }, jsfl: "fl.getDocumentDOM().addNewScene('Second'); fl.getDocumentDOM().editScene(0); 'ok'", expect: { files: 1, warning: /2 scenes/ } },
];
const resultFile = join(out, "result.json");
writeFileSync(join(tmpdir(), "flash2svg-selftest.json"), JSON.stringify({ jobs, result: resultFile, quit: true }));

if (isAnimateRunning()) {
	console.error("Close Animate first.");
	process.exit(1);
}
const started = Date.now();
// Opening a document fires the event the self-test build starts on
const kick = join(out, "kick.jsfl");
writeFileSync(kick, `fl.createDocument("timeline");\n`);
const child = spawn(findAnimate(), [kick], { stdio: "ignore", cwd: tmpdir() });
const timeoutMs = 6 * 60 * 1000;
await new Promise((resolve) => {
	const timer = setInterval(() => {
		const done = existsSync(resultFile) && JSON.parse(readFileSync(resultFile, "utf8")).done;
		if (done || Date.now() - started > timeoutMs) {
			clearInterval(timer);
			resolve();
		}
	}, 2000);
	child.on("exit", () => {
		clearInterval(timer);
		resolve();
	});
});
if (!existsSync(resultFile)) {
	console.error(`No result after ${((Date.now() - started) / 1000).toFixed(0)}s: the panel did not start automatically.`);
	try {
		child.kill();
	} catch {}
	process.exit(1);
}
const res = JSON.parse(readFileSync(resultFile, "utf8"));
// check what the jobs promised
res.results.forEach((r, i) => {
	const exp = jobs[i]?.expect ?? {};
	if (!r.ok) return;
	const problems = [];
	// the size overview: the parts add up to the files' size; the expected ones are there
	const parts = (r.parts ?? []).reduce((all, p) => {
		for (const k in p) all[k] = (all[k] ?? 0) + p[k];
		return all;
	}, {});
	const sum = Object.values(parts).reduce((a, b) => a + b, 0);
	if (sum !== r.bytes) problems.push(`size parts add up to ${sum}, the files have ${r.bytes}`);
	for (const k of exp.parts ?? []) if (!(k === "linked" ? r.linkedBytes > 0 : parts[k] > 0)) problems.push(`no ${k} in the size overview`);
	if (exp.files !== undefined && r.files.length !== exp.files) problems.push(`${r.files.length} files, expected ${exp.files}`);
	if (exp.names) for (const n of exp.names) if (!r.files.some((f) => f.endsWith(n))) problems.push(`no file ${n}`);
	if (exp.warning && !r.warnings.some((w) => exp.warning.test(w))) problems.push(`missing warning ${exp.warning}`);
	if (exp.format && r.format !== exp.format) problems.push(`format ${r.format}, expected ${exp.format}`);
	for (const f of r.files) {
		if (!existsSync(f)) problems.push(`missing ${f}`);
		else if (!f.endsWith(".lottie") && /NaN|undefined/.test(readFileSync(f, "utf8"))) problems.push(`NaN/undefined in ${f}`);
		if (exp.ext && !f.endsWith(exp.ext)) problems.push(`${f} should end in ${exp.ext}`);
	}
	if (exp.lottie && r.files[0] && existsSync(r.files[0])) {
		try {
			const anim = JSON.parse(readFileSync(r.files[0], "utf8"));
			if (!anim.layers?.length || !(anim.op > anim.ip)) problems.push("Lottie without layers or frames");
			if (exp.linkedImages) {
				const linked = (anim.assets ?? []).filter((a) => a.p && a.e === 0);
				if (!linked.length) problems.push("no linked images in the Lottie");
				for (const a of linked) if (!existsSync(join(dirname(r.files[0]), a.u + a.p))) problems.push(`linked image ${a.u + a.p} not written`);
			}
		} catch (e) {
			problems.push(`not JSON: ${e.message}`);
		}
	}
	if (exp.dotlottie && r.files[0] && existsSync(r.files[0])) {
		// a ZIP: local file header signature, a manifest, the animation (its images, the state machine) inside
		const zip = readFileSync(r.files[0]);
		if (zip.readUInt32LE(0) !== 0x04034b50) problems.push("not a ZIP archive");
		const text = zip.toString("latin1");
		if (!text.includes("manifest.json") || !/a\/[^/]+\.json/.test(text)) problems.push("archive without manifest or animation");
		if (exp.parts?.includes("images") && !text.includes("i/")) problems.push("archive without its images");
		if (exp.preview?.state && !text.includes("s/playback.json")) problems.push("archive without the state machine");
	}
	if (exp.preview) {
		const p = r.preview ?? {};
		const e = exp.preview;
		if (p.error) problems.push(`preview: ${p.error}`);
		if (e.svg && !(p.svgElements > 0)) problems.push("preview: lottie-web drew nothing");
		if (e.filters && !(p.svgFilters > 0)) problems.push("preview: no SVG filters (effects)");
		if (e.images && !(p.svgImages > 0)) problems.push("preview: no images");
		if (e.canvas && !(p.canvasPixels > 0)) problems.push("preview: dotLottie drew nothing");
		if (e.moving && (!p.time || p.time[0] === p.time[1])) problems.push(`preview: the time stands still (${p.time})`);
		if (e.state && p.state !== e.state) problems.push(`preview: state "${p.state}", expected "${e.state}"`);
		if (e.stateAfterClick && p.stateAfterClick !== e.stateAfterClick) problems.push(`preview: after a click "${p.stateAfterClick}", expected "${e.stateAfterClick}"`);
	}
	if (exp.mimes || exp.noMimes) {
		const svg = readFileSync(r.files[0], "utf8");
		for (const m of exp.mimes ?? []) if (!svg.includes(`data:${m};base64,`)) problems.push(`no ${m} image`);
		for (const m of exp.noMimes ?? []) if (svg.includes(`data:${m};base64,`)) problems.push(`unexpected ${m} image`);
	}
	if (exp.assets && r.files[0]) {
		const svg = readFileSync(r.files[0], "utf8");
		const href = /xlink:href="(bitmaps\/[^"]+)"/.exec(svg)?.[1];
		if (!href || !existsSync(join(dirname(r.files[0]), href))) problems.push("linked bitmap not written next to the SVG");
	}
	for (const [name, wh] of Object.entries(exp.pixels ?? {})) {
		const got = r.images?.find((i) => i[0] === name);
		if (!got || got[1] !== wh[0] || got[2] !== wh[1]) problems.push(`${name} written ${got ? got[1] + "x" + got[2] : "not at all"}, expected ${wh.join("x")}`);
	}
	if (exp.contains && r.files[0]) {
		const svg = readFileSync(r.files[0], "utf8");
		for (const re of exp.contains) if (!re.test(svg)) problems.push(`no ${re} in the output`);
	}
	if (exp.soundFiles && r.files[0]) {
		const dir = join(dirname(r.files[0]), "sounds");
		const list = existsSync(dir) ? readdirSync(dir) : [];
		for (const e of exp.soundFiles) if (!list.some((f) => f.endsWith(e))) problems.push(`no ${e} sound next to the SVG (${list.join(", ")})`);
	}
	if (problems.length) {
		r.ok = false;
		r.error = problems.join("; ");
	}
});
// temp folders of the exports must be gone
const leftovers = readdirSync(tmpdir()).filter((d) => d.startsWith("flash2svg-") && statSync(join(tmpdir(), d)).isDirectory() && statSync(join(tmpdir(), d)).mtimeMs >= started);
if (leftovers.length) res.results.push({ ok: false, fla: "temp folders", error: `left behind: ${leftovers.join(", ")}` });
for (const r of res.results) {
	console.log(r.ok ? `OK   ${r.fla.split(/[\\/]/).pop()}  ${r.files.length} file(s) ${(r.bytes / 1024).toFixed(1)} KB in ${r.seconds.toFixed(1)}s  ${r.docType}  ${r.warnings.length} warning(s)` : `FAIL ${r.fla}: ${r.error}`);
}
console.log(`total ${((Date.now() - started) / 1000).toFixed(0)}s, done=${res.done}`);
process.exitCode = res.results.every((r) => r.ok) && res.done ? 0 : 1;
