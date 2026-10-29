// Generates tests/fixtures/fla/*.fla by running build-fixtures.jsfl in Animate.
// Usage: node scripts/build-fixtures.mjs [name,name,...]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";
import { runJsfl } from "./lib/animate.mjs";

const { PNG } = pngjs;

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

// A small RGB picture with distinct quadrants for the bitmap fixture.
{
	const w = 64,
		h = 48;
	const png = new PNG({ width: w, height: h });
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const q = (x < w / 2 ? 0 : 1) + (y < h / 2 ? 0 : 2);
			const c = [[230, 40, 40], [40, 180, 60], [40, 80, 220], [240, 200, 30]][q];
			png.data[i] = c[0];
			png.data[i + 1] = c[1];
			png.data[i + 2] = c[2];
			png.data[i + 3] = 255;
		}
	writeFileSync(join(assets, "checker.png"), PNG.sync.write(png));
}

const onlyFile = join(flaDir, "fixtures-only.txt");
if (process.argv[2]) writeFileSync(onlyFile, process.argv[2]);
else if (existsSync(onlyFile)) rmSync(onlyFile);

const res = await runJsfl(join(repo, "tests", "fixtures", "build-fixtures.jsfl"));
console.log(`Animate exited (${res.code}) after ${res.seconds.toFixed(1)}s`);
const logFile = join(flaDir, "build-log.txt");
console.log(existsSync(logFile) ? readFileSync(logFile, "utf8") : "No build log written.");
