// Generates tests/fixtures/fla/*.fla by running build-fixtures.jsfl in Animate.
// Usage: node scripts/build-fixtures.mjs [name,name,...]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";
import { outputProblems, runJsfl } from "./lib/animate.mjs";

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

// Pictures for the image-format fixture (f42): a photo-like JPEG, a transparent icon, a pixel
// pattern for a bitmap fill, and a soft transparent glow.
{
	const make = (w, h, fn) => {
		const p = new PNG({ width: w, height: h });
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) p.data.set(fn(x, y), (y * w + x) * 4);
		return p;
	};
	// deterministic noise so the files stay the same between runs
	let seed = 7;
	const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const photo = make(240, 160, (x, y) => {
		const n = rnd() * 30 - 15;
		const sky = y < 90;
		const r = sky ? 90 + y * 0.8 : 60 + Math.sin(x / 9) * 20;
		const g = sky ? 140 + y * 0.6 : 120 + Math.cos(y / 7) * 25;
		const b = sky ? 220 - y * 0.3 : 50 + (x % 13) * 2;
		const sun = Math.hypot(x - 180, y - 40) < 22 ? 90 : 0;
		return [r + n + sun, g + n + sun, b + n, 255].map((v) => Math.max(0, Math.min(255, Math.round(v))));
	});
	const { default: encodeJpeg, init } = await import("@jsquash/jpeg/encode.js");
	await init(await WebAssembly.compile(readFileSync(join(repo, "node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"))));
	const jpeg = await encodeJpeg({ data: new Uint8ClampedArray(photo.data), width: photo.width, height: photo.height }, { quality: 85 });
	writeFileSync(join(assets, "photo.jpg"), new Uint8Array(jpeg));
	writeFileSync(join(assets, "photo-as-png.png"), PNG.sync.write(photo));
	const icon = make(48, 48, (x, y) => {
		const d = Math.hypot(x - 23.5, y - 23.5);
		const a = Math.max(0, Math.min(1, 20 - d));
		return d < 12 ? [255, 255, 255, 255 * a] : [200, 30, 60, 255 * a];
	});
	writeFileSync(join(assets, "icon.png"), PNG.sync.write(icon));
	const pattern = make(8, 8, (x, y) => (((x >> 1) + (y >> 1)) % 2 ? [20, 20, 20, 255] : [250, 210, 0, 255]));
	writeFileSync(join(assets, "pattern.png"), PNG.sync.write(pattern));
	const glow = make(96, 96, (x, y) => {
		const d = Math.min(1, Math.hypot(x - 47.5, y - 47.5) / 48);
		return [255, 160 + 90 * (1 - d), 40, 255 * (1 - d) ** 2].map(Math.round);
	});
	writeFileSync(join(assets, "glow.png"), PNG.sync.write(glow));
}

// Pictures for the downscaling fixture (f44), all shown smaller than their pixels: a photo, a
// transparent picture in a tweened clip, a bitmap fill (clipped) and a tile (repeated), pixel art
// without smoothing, and a wide picture scaled differently per axis. Smooth content, so Animate's
// and the browser's way of drawing a bitmap smaller give the same picture.
{
	const make = (w, h, fn) => {
		const p = new PNG({ width: w, height: h });
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) p.data.set(fn(x / w, y / h, x, y).map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * w + x) * 4);
		return PNG.sync.write(p);
	};
	writeFileSync(
		join(assets, "large.png"),
		make(640, 480, (u, v) => {
			const hill = v > 0.55 + Math.sin(u * 7) * 0.08;
			const sun = Math.max(0, 1 - Math.hypot(u - 0.75, v - 0.25) / 0.12);
			return hill ? [60 + u * 80, 130 + Math.cos(v * 9) * 30, 50, 255] : [90 + v * 120 + sun * 150, 140 + v * 80 + sun * 100, 230 - v * 60, 255];
		}),
	);
	writeFileSync(
		join(assets, "nested.png"),
		make(400, 300, (u, v) => {
			const d = Math.hypot(u - 0.5, (v - 0.5) * 0.75) / 0.38;
			const a = Math.max(0, Math.min(1, (1 - d) * 6));
			return [220 * (1 - u) + 30, 80 + 150 * v, 200 * u + 30, 255 * a];
		}),
	);
	writeFileSync(
		join(assets, "fill.png"),
		make(320, 320, (u, v) => {
			const r = Math.hypot(u - 0.5, v - 0.5);
			return [128 + 120 * Math.cos(r * 18), 128 + 120 * Math.sin(u * 5), 128 + 120 * Math.cos(v * 4), 255];
		}),
	);
	writeFileSync(join(assets, "tile.png"), make(64, 64, (u, v) => [200 + 50 * Math.cos(u * 2 * Math.PI), 120 + 80 * Math.sin(v * 2 * Math.PI), 60, 255]));
	writeFileSync(join(assets, "pixels.png"), make(64, 64, (u, v, x, y) => (((x >> 3) + (y >> 3)) % 2 ? [30, 30, 120, 255] : [240, 240, 240, 255])));
	writeFileSync(join(assets, "wide.png"), make(400, 200, (u, v) => [255 * u, 90 + 100 * Math.sin(v * Math.PI), 255 * (1 - u), 255]));
}

// Sounds for the sound fixture (f43): a stereo chord (44.1 kHz WAV, a different chord left and
// right; also as a copy with other compression settings) and a short melody imported as MP3.
{
	const rate = 44100;
	const seconds = 1.5;
	const n = Math.round(rate * seconds);
	const wav = Buffer.alloc(44 + n * 4);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(36 + n * 4, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(2, 22);
	wav.writeUInt32LE(rate, 24);
	wav.writeUInt32LE(rate * 4, 28);
	wav.writeUInt16LE(4, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(n * 4, 40);
	for (let i = 0; i < n; i++) {
		const t = i / rate,
			env = Math.min(1, t * 40) * Math.min(1, (seconds - t) * 8);
		const l = env * 0.3 * (Math.sin(2 * Math.PI * 440 * t) + 0.5 * Math.sin(2 * Math.PI * 660 * t));
		const r = env * 0.3 * (Math.sin(2 * Math.PI * 550 * t) + 0.5 * Math.sin(2 * Math.PI * 880 * t));
		wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
		wav.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
	}
	writeFileSync(join(assets, "chord.wav"), wav);
	// the same, set to MP3 32 kbps mono in Animate
	writeFileSync(join(assets, "chord mono.wav"), wav);
	// melody: eight notes of 0.25 s
	const notes = [523, 587, 659, 698, 784, 698, 659, 587];
	const m = Math.round(rate * 2);
	const mel = new Float32Array(m);
	for (let i = 0; i < m; i++) {
		const t = i / rate,
			k = Math.floor(t / 0.25),
			u = t - k * 0.25;
		mel[i] = 0.35 * Math.sin(2 * Math.PI * notes[k] * t) * Math.min(1, u * 80) * Math.max(0, 1 - u * 3);
	}
	const { createEncoder } = await import("wasm-media-encoders/esnext");
	const enc = await createEncoder("audio/mpeg", readFileSync(join(repo, "node_modules/wasm-media-encoders/wasm/mp3.wasm")));
	enc.configure({ sampleRate: rate, channels: 1, bitrate: 96 });
	writeFileSync(join(assets, "melody.mp3"), Buffer.concat([Buffer.from(enc.encode([mel])), Buffer.from(enc.finalize())]));
}

const onlyFile = join(flaDir, "fixtures-only.txt");
if (process.argv[2]) writeFileSync(onlyFile, process.argv[2]);
else if (existsSync(onlyFile)) rmSync(onlyFile);

const res = await runJsfl(join(repo, "tests", "fixtures", "build-fixtures.jsfl"));
console.log(`Animate exited (${res.code}) after ${res.seconds.toFixed(1)}s`);
const problems = outputProblems(res.output);
if (problems.length) {
	console.log(`FAIL Animate's Output panel reports ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
	process.exitCode = 1;
}
const logFile = join(flaDir, "build-log.txt");
console.log(existsSync(logFile) ? readFileSync(logFile, "utf8") : "No build log written.");
