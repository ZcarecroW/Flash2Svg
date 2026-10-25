// Generates tests/fixtures/fla/*.fla by running build-fixtures.jsfl in Animate.
// Usage: node scripts/build-fixtures.mjs [name,name,...]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runJsfl } from "./lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const flaDir = join(repo, "tests", "fixtures", "fla");
mkdirSync(flaDir, { recursive: true });

// A short beep for the sound fixture (16-bit mono PCM WAV).
const assets = join(repo, "tests", "fixtures", "assets");
mkdirSync(assets, { recursive: true });
{
	const rate = 22050,
		seconds = 0.4,
		n = Math.round(rate * seconds);
	const buf = Buffer.alloc(44 + n * 2);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write("WAVEfmt ", 8);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(rate, 24);
	buf.writeUInt32LE(rate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(n * 2, 40);
	for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 880) * 8000 * (1 - i / n)), 44 + i * 2);
	writeFileSync(join(assets, "beep.wav"), buf);
}

const onlyFile = join(flaDir, "fixtures-only.txt");
if (process.argv[2]) writeFileSync(onlyFile, process.argv[2]);
else if (existsSync(onlyFile)) rmSync(onlyFile);

const res = await runJsfl(join(repo, "tests", "fixtures", "build-fixtures.jsfl"));
console.log(`Animate exited (${res.code}) after ${res.seconds.toFixed(1)}s`);
const logFile = join(flaDir, "build-log.txt");
console.log(existsSync(logFile) ? readFileSync(logFile, "utf8") : "No build log written.");
