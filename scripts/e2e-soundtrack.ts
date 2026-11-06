// E2E: sounds of SMIL and CSS output: what starts when, in a page and as a file of its own. f43-sounds
// has an event sound with an envelope that repeats, a stream, in and out points, a mono sound with
// panning, a "start" sound inside a movie clip and a stop.
// Usage: node scripts/e2e-soundtrack.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { nodeWasmLoader } from "../src/cli/wasm.ts";
import { createAudioCodecs } from "../src/core/audio-codecs.ts";
import { encodeSounds } from "../src/core/audio.ts";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` (${detail.slice(0, 200)})`}`);
};
const near = (a: number, b: number, d: number) => Math.abs(a - b) <= d;

interface Start {
	at: number;
	offset: number;
	loop: boolean;
	dur: number;
	ch: number;
	stopIn: number | null;
	stopped: boolean;
}

const modelDir = join(out, "f43-sounds", "model");
if (!existsSync(join(modelDir, "scene.json"))) {
	console.log("skip: no extracted model (run e2e-extract first)");
	process.exit(0);
}
const read: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
const src = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
const { model, files } = await encodeSounds(read, src, { soundFormat: "mp3" }, createAudioCodecs(nodeWasmLoader()));
const dir = join(out, "f43-sounds", "soundtrack");
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
for (const format of ["smil", "css"] as const) {
	const r = compileScene(model, files, { format, includeBackground: true, loop: "always" });
	const svg = r.files[0]!.svg;
	const file = join(dir, `${format}.svg`);
	writeFileSync(file, svg);
	const html = join(dir, `${format}.html`);
	writeFileSync(html, `<!doctype html><html><body style="margin:0">${svg}</body></html>`);
	for (const [form, path] of [["page", html], ["file", file]] as const) {
		const tag = `${format} ${form}:`;
		const page = await browser.newPage();
		const errors: string[] = [];
		page.on("pageerror", (e) => void errors.push(e.message));
		await page.addInitScript(() => {
			const w = window as unknown as { __starts: Start[] };
			const log: Start[] = (w.__starts = []);
			const P = AudioBufferSourceNode.prototype;
			const start = P.start,
				stop = P.stop;
			P.start = function (this: AudioBufferSourceNode & { __i?: number }, when?: number, offset?: number) {
				const b = this.buffer;
				this.__i = log.push({ at: this.context.currentTime, offset: offset ?? 0, loop: this.loop, dur: b?.duration ?? 0, ch: b?.numberOfChannels ?? 0, stopIn: null, stopped: false }) - 1;
				return start.call(this, when, offset);
			};
			P.stop = function (this: AudioBufferSourceNode & { __i?: number }, when?: number) {
				const s = log[this.__i ?? -1];
				if (s) {
					if (when && when > this.context.currentTime) s.stopIn = when - s.at;
					else s.stopped = true;
				}
				return stop.call(this, when);
			};
		});
		await page.goto(pathToFileURL(path).href);
		await page.waitForTimeout(700);
		const log = () => page.evaluate(() => (window as unknown as { __starts: Start[] }).__starts);
		let l = await log();
		const chord = l.find((s) => s.loop);
		check(`${tag} the event sound repeats twice`, !!chord && near(chord.stopIn ?? 0, 3, 0.1), JSON.stringify(l));
		const melody = l.find((s) => !s.loop && near(s.dur, 2.04, 0.06));
		check(`${tag} the stream starts with the animation`, !!melody && melody.offset < 0.15, JSON.stringify(l));
		await page.waitForTimeout(1300);
		l = await log();
		const beep = l.find((s) => s.ch === 1 && near(s.dur, 0.4, 0.06) && s.offset > 0.02);
		check(`${tag} in and out point`, !!beep && near(beep.offset, 0.05, 0.02) && near(beep.stopIn ?? 0, 0.25, 0.03), JSON.stringify(beep));
		check(`${tag} the stream stops after its frames`, !!l.find((s) => near(s.dur, 2.04, 0.06))?.stopped, JSON.stringify(l));
		await page.waitForTimeout(500);
		l = await log();
		check(`${tag} stop sound ends the event sound`, !!l.find((s) => s.loop && chord && s.at === chord.at)?.stopped, JSON.stringify(l.filter((s) => s.loop)));
		const beeps = l.filter((s) => s.ch === 1 && near(s.dur, 0.4, 0.06) && s.at < (chord?.at ?? 0) + 1.9);
		check(`${tag} a "start" sound in a movie clip not while it plays`, beeps.length === 2, JSON.stringify(beeps));
		// the animation repeats: its sounds with it
		const seconds = model.timelines[model.roots[0]!]!.frameCount / model.doc.frameRate;
		await page.waitForTimeout(Math.max(0, seconds * 1000 - 2300));
		l = await log();
		check(`${tag} sounds come again with the loop`, l.filter((s) => s.loop).length >= 2, `${seconds} s, ${JSON.stringify(l.filter((s) => s.loop))}`);
		check(`${tag} no script errors`, !errors.length, errors.join(" | "));
		await page.close();
	}
}
// ---- Lottie JSON: audio layers, played by lottie-web through Howler
{
	const r = compileScene(model, files, { format: "lottie", includeBackground: true, loop: "always", lottieSounds: true });
	const json = r.files[0]!.svg || new TextDecoder().decode(r.files[0]!.bytes);
	const animation = JSON.parse(json);
	const audio = animation.layers.filter((l: { ty: number }) => l.ty === 6);
	check("lottie: audio layers", audio.length >= 4, String(audio.length));
	check("lottie: sounds as assets", animation.assets.filter((a: { t?: number }) => a.t === 2).length === 4, String(animation.assets.length));
	const page = await browser.newPage();
	await page.setContent('<!doctype html><html><body style="margin:0"><div id="a" style="width:400px;height:300px"></div></body></html>');
	await page.evaluate(() => {
		const w = window as unknown as { __plays: number; Howl: unknown };
		w.__plays = 0;
		w.Howl = class {
			constructor(_o: { src: string[] }) {}
			play() {
				w.__plays++;
			}
			pause() {}
			playing() {
				return false;
			}
			seek() {
				return 0;
			}
			rate() {}
			volume() {}
			setVolume() {}
			on() {}
		};
	});
	await page.addScriptTag({ path: join(repo, "node_modules/lottie-web/build/player/lottie.min.js") });
	await page.evaluate((data) => {
		const w = window as unknown as { lottie: { loadAnimation(o: object): unknown } };
		w.lottie.loadAnimation({ container: document.getElementById("a"), renderer: "svg", loop: true, autoplay: true, animationData: data });
	}, animation);
	await page.waitForTimeout(1500);
	const plays = await page.evaluate(() => (window as unknown as { __plays: number }).__plays);
	check("lottie: lottie-web plays them", plays >= 2, String(plays));
	await page.close();
	const plain = compileScene(model, files, { format: "lottie", includeBackground: true, loop: "always" });
	check("lottie: no sounds unless asked for", !/"ty":6/.test(plain.files[0]!.svg || new TextDecoder().decode(plain.files[0]!.bytes)) && plain.warnings.some((w) => /Sounds in Lottie/.test(w)), plain.warnings.join(" | "));
}
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nSounds play in SMIL and CSS");
process.exitCode = failures ? 1 : 0;
