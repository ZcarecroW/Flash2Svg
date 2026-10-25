// Runs the installed panel's self-test inside Animate: writes the job file, launches Animate,
// waits for the panel to export the fixtures and quit, then prints the results.
// Needs a --selftest build installed (npm run build -- --selftest && npm run package && node scripts/dev-install.mjs --zxp).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
for (const r of res.results) {
	console.log(r.ok ? `OK   ${r.fla.split(/[\\/]/).pop()}  ${r.files.length} file(s) ${(r.bytes / 1024).toFixed(1)} KB in ${r.seconds.toFixed(1)}s  ${r.docType}  ${r.warnings.length} warning(s)` : `FAIL ${r.fla}: ${r.error}`);
}
console.log(`total ${((Date.now() - started) / 1000).toFixed(0)}s, done=${res.done}`);
process.exitCode = res.results.every((r) => r.ok) && res.done ? 0 : 1;
