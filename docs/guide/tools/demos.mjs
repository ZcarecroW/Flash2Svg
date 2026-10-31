#!/usr/bin/env node
/**
 * The user guide's demo animations, made with the exporter itself:
 *   1. builds the demo documents in Animate (docs/guide/demos/build-demos.jsfl → demos/fla/)
 *   2. extracts them like the panel's Export does (extract-demos.jsfl → demos/models/<name>/)
 * The guide's build (docs/guide/build.mjs) compiles the models into every format it shows, with
 * the compiler of the same checkout, so the pages always show what this version writes.
 *
 *   node docs/guide/tools/demos.mjs [name,name] [--no-build]     (Animate must not be running)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { outputProblems, runJsfl } from "../../../scripts/lib/animate.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..", "demos");
const fla = join(here, "fla");
mkdirSync(fla, { recursive: true });
const args = process.argv.slice(2);
const list = args.find((a) => !a.startsWith("--"));
let failed = false;

if (!args.includes("--no-build")) {
	writeFileSync(join(fla, "only.txt"), list ?? "");
	if (!list) writeFileSync(join(fla, "only.txt"), "");
	const r = await runJsfl(join(here, "build-demos.jsfl"));
	console.log(`Built in ${r.seconds.toFixed(1)} s:\n${readFileSync(join(fla, "build-log.txt"), "utf8")}`);
	const problems = outputProblems(r.output);
	if (problems.length) {
		console.log(`Animate's Output panel:\n  ${problems.join("\n  ")}`);
		failed = true;
	}
}
const names = list ? list.split(",") : readdirSync(fla).filter((f) => f.endsWith(".fla")).map((f) => f.slice(0, -4));
writeFileSync(join(fla, "extract.txt"), names.join(","));
const r = await runJsfl(join(here, "extract-demos.jsfl"));
const log = existsSync(join(fla, "extract-log.txt")) ? readFileSync(join(fla, "extract-log.txt"), "utf8") : "no log";
console.log(`Extracted in ${r.seconds.toFixed(1)} s:\n${log}`);
const problems = outputProblems(r.output);
if (problems.length || /ERROR/.test(log)) {
	console.log(`Problems:\n  ${problems.join("\n  ")}`);
	failed = true;
}
process.exitCode = failed ? 1 : 0;
