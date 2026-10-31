// E2E step 1: runs the extractor on fixture FLAs inside Animate.
// Usage: node scripts/e2e-extract.mjs [name,name,...] [--noref]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const res = await runJsfl(join(repo, "tests", "e2e", "extract.jsfl"));
console.log(`Animate exited (${res.code}) after ${res.seconds.toFixed(1)}s`);
const problems = outputProblems(res.output);
if (problems.length) {
	console.log(`FAIL Animate's Output panel reports ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
	process.exitCode = 1;
}
const logFile = join(outRoot, "extract-log.txt");
console.log(existsSync(logFile) ? readFileSync(logFile, "utf8") : "No log written.");
