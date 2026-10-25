// Generates tests/fixtures/fla/*.fla by running build-fixtures.jsfl in Animate.
// Usage: node scripts/build-fixtures.mjs [name,name,...]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runJsfl } from "./lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const flaDir = join(repo, "tests", "fixtures", "fla");
mkdirSync(flaDir, { recursive: true });

const onlyFile = join(flaDir, "fixtures-only.txt");
if (process.argv[2]) writeFileSync(onlyFile, process.argv[2]);
else if (existsSync(onlyFile)) rmSync(onlyFile);

const res = await runJsfl(join(repo, "tests", "fixtures", "build-fixtures.jsfl"));
console.log(`Animate exited (${res.code}) after ${res.seconds.toFixed(1)}s`);
const logFile = join(flaDir, "build-log.txt");
console.log(existsSync(logFile) ? readFileSync(logFile, "utf8") : "No build log written.");
