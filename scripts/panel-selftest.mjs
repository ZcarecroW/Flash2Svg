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
	const exp = jobs[i]?.expect;
	if (!r.ok || !exp) return;
	const problems = [];
	if (exp.files !== undefined && r.files.length !== exp.files) problems.push(`${r.files.length} files, expected ${exp.files}`);
	if (exp.names) for (const n of exp.names) if (!r.files.some((f) => f.endsWith(n))) problems.push(`no file ${n}`);
	if (exp.warning && !r.warnings.some((w) => exp.warning.test(w))) problems.push(`missing warning ${exp.warning}`);
	if (exp.format && r.format !== exp.format) problems.push(`format ${r.format}, expected ${exp.format}`);
	for (const f of r.files) {
		if (!existsSync(f)) problems.push(`missing ${f}`);
		else if (/NaN|undefined/.test(readFileSync(f, "utf8"))) problems.push(`NaN/undefined in ${f}`);
	}
	if (exp.assets && r.files[0]) {
		const svg = readFileSync(r.files[0], "utf8");
		const href = /xlink:href="(bitmaps\/[^"]+)"/.exec(svg)?.[1];
		if (!href || !existsSync(join(dirname(r.files[0]), href))) problems.push("linked bitmap not written next to the SVG");
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
