// E2E step 1: runs the extractor on fixture FLAs inside Animate.
// Usage: node scripts/e2e-extract.mjs [name,name,...] [--noref]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { outputProblems, runJsfl } from "./lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(repo, "tests", "out");
mkdirSync(outRoot, { recursive: true });
const args = process.argv.slice(2);
const noref = args.includes("--noref");
const list = args.find((a) => !a.startsWith("--"));
const names = list
	? list.split(",")
	: readdirSync(join(repo, "tests", "fixtures", "fla"))
			.filter((f) => f.endsWith(".fla"))
			.map((f) => f.replace(/\.fla$/, ""));
writeFileSync(join(outRoot, "e2e-config.txt"), `${names.join(",")}\n${noref ? "noref" : "ref"}`);
// what an interrupted run leaves in a model folder: the working copy, and Animate's auto-recovery
// file of it (Animate then fails to open the next copy there, with a dialog that waits)
for (const n of names) {
	const dir = join(outRoot, n, "model");
	if (existsSync(dir)) for (const f of readdirSync(dir)) if (/^(RECOVER_)?_source_\w*\.fla$/.test(f)) rmSync(join(dir, f), { force: true });
}
// (about 10 s a fixture with its reference frames; f59 renders 600 of them)
const res = await runJsfl(join(repo, "tests", "e2e", "extract.jsfl"), { timeoutMs: Math.max(10, names.length * 0.5) * 60000 });
console.log(`Animate exited (${res.code}) after ${res.seconds.toFixed(1)}s`);
const problems = outputProblems(res.output);
if (problems.length) {
	console.log(`FAIL Animate's Output panel reports ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
	process.exitCode = 1;
}
const logFile = join(outRoot, "extract-log.txt");
console.log(existsSync(logFile) ? readFileSync(logFile, "utf8") : "No log written.");
