// E2E step 4: drives the JS player in a real browser and checks its API and interaction:
// frame scripts and labels, goto*, loop modes and the "end" event, start modes, buttons, sounds.
// Uses the scene models written by e2e-extract (f02-eases, f12-labels, f15-button, f16-sound, f30-banner, f43-sounds).
// Usage: node scripts/e2e-player.ts [--browser=msedge]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright-core";
import { PNG } from "pngjs";
import { encodeSounds } from "../src/core/audio.ts";
import { createAudioCodecs } from "../src/core/audio-codecs.ts";
import { compileScene, type ExportSettings } from "../src/core/compile.ts";
import { nodeWasmLoader } from "../src/cli/wasm.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;

const browser = await chromium.launch({ channel: opt("browser", "msedge"), headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
// records what the player does with sounds: Web Audio sources it starts and stops, volume ramps,
// decoded files, and <audio> elements (its fallback)
const initScript = () => {
	type Src = AudioBufferSourceNode & { __i?: number };
	const w = window as unknown as { __snd: SoundLog; __sounds: HTMLAudioElement[]; Audio: typeof Audio };
	const log: SoundLog = (w.__snd = { starts: [], ramps: [], decoded: [], failed: 0 });
	w.__sounds = [];
	const Orig = w.Audio;
	w.Audio = function (src?: string) {
		const a = new Orig(src);
		w.__sounds.push(a);
		return a;
	} as unknown as typeof Audio;
	const P = AudioBufferSourceNode.prototype;
	const start = P.start,
		stop = P.stop;
	P.start = function (this: Src, when?: number, offset?: number) {
		const b = this.buffer;
		this.__i =
			log.starts.push({
				at: this.context.currentTime,
				offset: offset ?? 0,
				loop: this.loop,
				ls: this.loopStart,
				le: this.loopEnd,
				dur: b?.duration ?? 0,
				ch: b?.numberOfChannels ?? 0,
				rate: this.playbackRate.value,
				stopIn: null,
				stopped: false,
			}) - 1;
		return start.call(this, when, offset);
	};
	P.stop = function (this: Src, when?: number) {
		const s = log.starts[this.__i ?? -1];
		if (s) {
			if (when && when > this.context.currentTime) s.stopIn = when - s.at;
			else s.stopped = true;
		}
		return stop.call(this, when);
	};
	const ramp = AudioParam.prototype.linearRampToValueAtTime;
	AudioParam.prototype.linearRampToValueAtTime = function (this: AudioParam, v: number, t: number) {
		log.ramps.push([v, t]);
		return ramp.call(this, v, t);
	};
	const decode = BaseAudioContext.prototype.decodeAudioData;
	BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, data: ArrayBuffer) {
		return decode.call(this, data).then(
			(buf) => {
				log.decoded.push(buf.duration);
				return buf;
			},
			(e) => {
				log.failed++;
				throw e;
			},
		);
	} as typeof decode;
	// how often the player sets its Web Animations (start time or current time)
	const wa = window as unknown as { __seeks: number };
	wa.__seeks = 0;
	for (const k of ["startTime", "currentTime"] as const) {
		const d = Object.getOwnPropertyDescriptor(Animation.prototype, k)!;
		Object.defineProperty(Animation.prototype, k, {
			configurable: true,
			get() {
				return d.get!.call(this);
			},
			set(v) {
				wa.__seeks++;
				d.set!.call(this, v);
			},
		});
	}
};
await page.addInitScript(initScript);

interface SoundLog {
	/** at: context time of the start; stopIn: scheduled stop after the start; stopped: stopped right away */
	starts: {
		at: number;
		offset: number;
		loop: boolean;
		ls: number;
		le: number;
		dur: number;
		ch: number;
		rate: number;
		stopIn: number | null;
		stopped: boolean;
	}[];
	ramps: [number, number][];
	decoded: number[];
	failed: number;
}

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
	checks++;
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

function build(name: string, settings: Partial<ExportSettings>, tag: string): { file: string; model: SceneModel } | null {
	const modelDir = join(out, name, "model");
	if (!existsSync(join(modelDir, "scene.json"))) {
		console.log(`skip ${name}: no extracted model (run e2e-extract first)`);
		return null;
	}
	const model: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	const r = compileScene(model, files, { format: "player", includeBackground: true, ...settings });
	const dir = join(out, name, "player");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${tag}.svg`);
	writeFileSync(file, r.files[0]!.svg);
	return { file, model };
}

/** Like build(), with the sounds encoded as the panel and the CLI do it; linked files are written next to the SVG. */
async function buildEncoded(name: string, settings: Partial<ExportSettings>, tag: string): Promise<{ file: string; model: SceneModel } | null> {
	const modelDir = join(out, name, "model");
	if (!existsSync(join(modelDir, "scene.json"))) {
		console.log(`skip ${name}: no extracted model (run e2e-extract first)`);
		return null;
	}
	const read: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	const src = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	const { model, files } = await encodeSounds(read, src, settings, createAudioCodecs(nodeWasmLoader()));
	const r = compileScene(model, files, { format: "player", includeBackground: true, ...settings });
	const dir = join(out, name, "player", tag);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${tag}.svg`);
	writeFileSync(file, r.files[0]!.svg);
	for (const a of r.assets) {
		mkdirSync(dirname(join(dir, a.path)), { recursive: true });
		writeFileSync(join(dir, a.path), files.readBinary(a.source));
	}
	return { file, model };
}

async function open(file: string, model: SceneModel, margin = 0) {
	await page.setViewportSize({ width: Math.ceil(model.doc.width) + margin, height: Math.ceil(model.doc.height) + margin });
	await page.goto(pathToFileURL(file).href);
	await page.waitForLoadState("load");
}

type Api = {
	play(): void;
	pause(): void;
	stop(): void;
	gotoAndPlay(t: number | string): void;
	gotoAndStop(t: number | string): void;
	seek(s: number): void;
	on(type: string, fn: (e: { frame: number; label?: string }) => void): void;
	currentFrame: number;
	totalFrames: number;
	muted: boolean;
};

const api = <T>(page: Page, fn: (a: Api) => T): Promise<T> => page.evaluate(`(${fn.toString()})(document.documentElement.flash2svg)`) as Promise<T>;
const frame = () => api(page, (a) => a.currentFrame);
const wait = (ms: number) => page.waitForTimeout(ms);

async function pixel(x: number, y: number): Promise<[number, number, number]> {
	const png = PNG.sync.read(await page.screenshot({ clip: { x, y, width: 1, height: 1 } }));
	return [png.data[0]!, png.data[1]!, png.data[2]!];
}
const near = (a: [number, number, number], b: [number, number, number]) => a.every((v, i) => Math.abs(v - b[i]!) < 24);

// ------------------------------------------------------------------ Web Animations
{
	// f04-nested: tweens in nested movie clips (a 12-frame spinner loops twice a second, the root
	// every 2 s) play as Web Animations; the player only sets them when a timeline jumps
	const b = build("f04-nested", {}, "waapi");
	if (b) {
		await open(b.file, b.model);
		await wait(300);
		const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
		const n = await running();
		check("web animations: tweens play as Web Animations", n > 0, `${n} running`);
		const seeks = () => page.evaluate(() => (window as unknown as { __seeks: number }).__seeks);
		const s0 = await seeks();
		await wait(1000);
		const s1 = await seeks();
		// (the spinner's tween starts anew in every loop, twice a second: one setting each; a drift
		// would set every animation on every frame, ~60 times a second)
		check("web animations: they keep in step on their own, set again only at loops", s1 - s0 <= 3 * n + 4, `${s1 - s0} settings for ${n} animations in 1 s`);
		await api(page, (a) => a.pause());
		check("web animations: pause holds them", (await running()) === 0);
		await api(page, (a) => a.play());
		await wait(100);
		check("web animations: play goes on", (await running()) === n, `${await running()} running`);
	}
}
{
	// f02-eases: tweens on the root only; stopping the root holds them at once (not a frame later)
	const b = build("f02-eases", {}, "waapi");
	if (b) {
		await open(b.file, b.model);
		await wait(300);
		const states = () => page.evaluate(() => document.getAnimations().map((a) => a.playState));
		const n = (await states()).filter((s) => s === "running").length;
		await api(page, (a) => a.gotoAndStop(5));
		const after = await states();
		check("web animations: gotoAndStop holds them at once", n > 0 && after.every((s) => s !== "running"), `${n} running before, then ${after.join(",")}`);
		await api(page, (a) => a.gotoAndPlay(5));
		await wait(50);
		check("web animations: gotoAndPlay runs them again", (await states()).filter((s) => s === "running").length === n);
		await api(page, (a) => a.stop());
		check(
			"web animations: stop() holds them at once",
			(await states()).every((s) => s !== "running"),
			(await states()).join(","),
		);
	}
}
{
	// f40-strokes has hairlines: their geometry follows every transform, the browser couldn't keep
	// them rastered; instances that draw them are moved by the player itself
	const b = build("f40-strokes", {}, "waapi");
	if (b) {
		await open(b.file, b.model);
		await wait(300);
		const r = await page.evaluate(() => {
			const svg = document.documentElement;
			let hairline = 0;
			const anims = document.getAnimations();
			for (const a of anims) {
				const t = (a.effect as KeyframeEffect).target!;
				for (const u of t.querySelectorAll("use")) {
					const ref = svg.querySelector((u.getAttribute("xlink:href") ?? u.getAttribute("href"))!);
					if (ref?.querySelector("[vector-effect]") || ref?.hasAttribute("vector-effect")) hairline++;
				}
			}
			return { anims: anims.length, hairline };
		});
		check("web animations: none for instances drawing hairlines", r.hairline === 0, JSON.stringify(r));
	}
}

// ------------------------------------------------------------------ out of view, reduced motion
{
	// f02-eases inline in a page, below the fold: the player rests out of view, goes on in view
	const b = build("f02-eases", {}, "offscreen");
	if (b) {
		const html = b.file.replace(/\.svg$/, ".html");
		writeFileSync(
			html,
			`<!doctype html><body style="margin:0"><div style="height:3000px"></div>${readFileSync(b.file, "utf8").replace(/^<\?xml[^>]*>/, "")}</body>`,
		);
		await page.setViewportSize({ width: 500, height: 400 });
		await page.goto(pathToFileURL(html).href);
		await wait(400);
		const f = () => page.evaluate(() => (document.querySelector("svg") as unknown as { flash2svg: Api }).flash2svg.currentFrame);
		const f0 = await f();
		await wait(500);
		check("out of view: the player rests (no frames, its time stands)", (await f()) === f0, `frame ${f0} -> ${await f()}`);
		await page.evaluate(() => document.querySelector("svg")!.scrollIntoView());
		await wait(500);
		check("in view: it goes on from there", (await f()) > f0, `frame ${f0} -> ${await f()}`);
	}
}
{
	// "reduce motion" in the system settings: the player shows the poster frame until a click;
	// SMIL and CSS show it still
	await page.emulateMedia({ reducedMotion: "reduce" });
	const b = build("f02-eases", {}, "reduce");
	if (b) {
		await open(b.file, b.model);
		await wait(500);
		const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
		check("reduced motion: the player shows the poster frame, still", (await frame()) === 1 && (await running()) === 0, `frame ${await frame()}`);
		await page.mouse.click(10, 10);
		await wait(400);
		check("reduced motion: a click plays it", (await frame()) > 1, `frame ${await frame()}`);
	}
	const shot = async () => page.screenshot();
	// the poster frame (the first) as a still picture
	const poster = build("f02-eases", { format: "static", frames: [0] }, "reduce-poster");
	let posterShot: Buffer | null = null;
	if (poster) {
		await open(poster.file, poster.model);
		posterShot = await shot();
	}
	for (const format of ["smil", "css"] as const) {
		const s = build("f02-eases", { format }, `reduce-${format}`);
		if (!s) continue;
		await open(s.file, s.model);
		await wait(200);
		const a = await shot();
		await wait(600);
		const c = await shot();
		check(`reduced motion: ${format} stands still`, a.equals(c));
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await open(s.file, s.model);
		await wait(200);
		const d = await shot();
		await wait(600);
		check(`no preference: ${format} moves`, !d.equals(await shot()));
		if (posterShot) {
			const pa = PNG.sync.read(a).data,
				pp = PNG.sync.read(posterShot).data;
			let differ = 0;
			for (let i = 0; i < pa.length; i++) if (Math.abs(pa[i]! - pp[i]!) > 24) differ++;
			check(`reduced motion: ${format} shows the poster frame`, differ < 200, `${differ} bytes differ from the still render`);
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
	}
	await page.emulateMedia({ reducedMotion: "no-preference" });
}

// ------------------------------------------------------------------ labels, stop(), goto
{
	// f12-labels: 12 fps, 12 frames, labels step1..step4 on frames 1/4/7/10, stop() on frame 12
	const b = build("f12-labels", {}, "auto");
	if (b) {
		await open(b.file, b.model);
		check("labels: API on the svg element", await api(page, (a) => !!a && a.totalFrames === 12));
		await wait(1600);
		check("labels: plays and stops at stop() on the last frame", (await frame()) === 12, `frame ${await frame()}`);
		await wait(300);
		check("labels: stays stopped", (await frame()) === 12);
		await api(page, (a) => a.gotoAndStop("step3"));
		check("labels: gotoAndStop(label)", (await frame()) === 7, `frame ${await frame()}`);
		await wait(250);
		check("labels: gotoAndStop stays", (await frame()) === 7);
		// a label that doesn't exist stays where it is, also one named like an Object method
		await api(page, (a) => a.gotoAndStop("nope"));
		await api(page, (a) => a.gotoAndStop("toString"));
		await api(page, (a) => a.gotoAndStop("constructor"));
		await api(page, (a) => a.gotoAndStop("__proto__"));
		await api(page, (a) => a.gotoAndStop("hasOwnProperty"));
		check("labels: unknown labels (also toString, constructor, __proto__) stay", (await frame()) === 7, `frame ${await frame()}`);
		await api(page, (a) => a.gotoAndStop(5));
		check("labels: gotoAndStop(number) is 1-based", (await frame()) === 5, `frame ${await frame()}`);
		await api(page, (a) => a.gotoAndPlay("step2"));
		await wait(400);
		const f = await frame();
		check("labels: gotoAndPlay(label) plays on", f > 4 && f <= 12, `frame ${f}`);
		await api(page, (a) => a.seek(0.5));
		check("labels: seek(0.5s) -> frame 7", (await frame()) === 7, `frame ${await frame()}`);
		// out-of-range values: NaN and Infinity leave it, negative times are the start; speed takes positive numbers only
		await api(page, (a) => a.seek(Number.NaN));
		await api(page, (a) => a.seek(Infinity));
		check("labels: seek(NaN), seek(Infinity) are ignored", (await frame()) === 7, `frame ${await frame()}`);
		await api(page, (a) => a.seek(-3));
		check("labels: seek(-3) -> frame 1", (await frame()) === 1, `frame ${await frame()}`);
		const speeds = await page.evaluate(() => {
			const a = (document.documentElement as unknown as { flash2svg: { speed: number } }).flash2svg;
			const got: number[] = [];
			for (const v of [0, -1, Number.NaN, Infinity, 2, 1]) {
				a.speed = v;
				got.push(a.speed);
			}
			return got;
		});
		check("labels: speed keeps positive numbers only", JSON.stringify(speeds) === "[1,1,1,1,2,1]", JSON.stringify(speeds));
		await api(page, (a) => a.pause());
		const events = await page.evaluate(
			() =>
				new Promise<{ frame: number; label?: string }[]>((resolve) => {
					const a = (document.documentElement as unknown as { flash2svg: Api }).flash2svg;
					const got: { frame: number; label?: string }[] = [];
					a.on("frame", (e) => got.push({ frame: e.frame, label: e.label }));
					a.gotoAndPlay(1);
					setTimeout(() => resolve(got), 600);
				}),
		);
		check(
			"labels: frame events carry labels",
			events.some((e) => e.frame === 0 && e.label === "step1") && events.some((e) => e.frame === 3 && e.label === "step2"),
			JSON.stringify(events.slice(0, 5)),
		);
	}
}

// ------------------------------------------------------------------ pass counters (banner)
{
	// f30-banner: HTML5 Canvas, 24 fps, 12 frames; Animate's "stop after 3 loops" snippet on frame 12
	const b = build("f30-banner", {}, "auto");
	if (b) {
		await open(b.file, b.model);
		await api(page, (a) => a.pause());
		const at = async (tick: number) => {
			await page.evaluate((t) => (document.documentElement as unknown as { flash2svg: Api }).flash2svg.seek(t), tick / 24);
			return frame();
		};
		check("passes: first pass reaches frame 12", (await at(11)) === 12, `frame ${await frame()}`);
		check("passes: then loops to frame 1", (await at(12)) === 1, `frame ${await frame()}`);
		check("passes: third pass", (await at(30)) === 7, `frame ${await frame()}`);
		check("passes: stops on frame 12 of the third pass", (await at(60)) === 12, `frame ${await frame()}`);
	}
}

// ------------------------------------------------------------------ loop modes, end event
{
	// f02-eases: 24 fps, 48 frames, no scripts
	const once = build("f02-eases", { loop: "never" }, "once");
	if (once) {
		await open(once.file, once.model);
		await page.evaluate(() => {
			const w = window as unknown as { __ends: number };
			w.__ends = 0;
			(document.documentElement as unknown as { flash2svg: Api }).flash2svg.on("end", () => w.__ends++);
		});
		await wait(2600);
		const ends = await page.evaluate(() => (window as unknown as { __ends: number }).__ends);
		check("loop never: stops on the last frame", (await frame()) === 48, `frame ${await frame()}`);
		check("loop never: one end event", ends === 1, `${ends} events`);
		await api(page, (a) => a.play());
		await wait(300);
		check("loop never: play() at the end restarts", (await frame()) > 1 && (await frame()) < 48, `frame ${await frame()}`);
	}
	const loop = build("f02-eases", { loop: "always" }, "loop");
	if (loop) {
		await open(loop.file, loop.model);
		await wait(2400);
		const f = await frame();
		check("loop always: wraps around", f > 1 && f < 40, `frame ${f}`);
	}
}

// ------------------------------------------------------------------ start modes
{
	const click = build("f02-eases", { begin: "click" }, "click");
	if (click) {
		await open(click.file, click.model);
		await wait(300);
		check("begin click: waits", (await frame()) === 1, `frame ${await frame()}`);
		await page.mouse.click(5, 5);
		await wait(300);
		check("begin click: plays after a click", (await frame()) > 1, `frame ${await frame()}`);
	}
	const hover = build("f02-eases", { begin: "hover" }, "hover");
	if (hover) {
		const { width, height } = hover.model.doc;
		await page.mouse.move(width + 50, height + 50);
		await open(hover.file, hover.model, 100);
		await wait(250);
		check("begin hover: waits", (await frame()) === 1, `frame ${await frame()}`);
		await page.mouse.move(10, 10);
		await page.mouse.move(20, 20);
		await wait(300);
		const f1 = await frame();
		check("begin hover: plays while hovered", f1 > 1, `frame ${f1}`);
		// in a standalone SVG document the root <svg> is the whole canvas: leave the viewport
		await page.mouse.move(width + 150, 5);
		await wait(50);
		const f2 = await frame();
		await wait(300);
		check("begin hover: pauses on leave", (await frame()) === f2, `frame ${f2} -> ${await frame()}`);
	}
	const manual = build("f02-eases", { begin: "manual" }, "manual");
	if (manual) {
		await open(manual.file, manual.model);
		await wait(300);
		check("begin manual: waits for play()", (await frame()) === 1);
		await api(page, (a) => a.play());
		await wait(300);
		check("begin manual: play() starts", (await frame()) > 1);
	}
	const delayed = build("f02-eases", { delay: 0.6 }, "delay");
	if (delayed) {
		await open(delayed.file, delayed.model);
		await wait(300);
		check("delay: waits", (await frame()) === 1, `frame ${await frame()}`);
		await wait(700);
		check("delay: then plays", (await frame()) > 1, `frame ${await frame()}`);
	}
}

// ------------------------------------------------------------------ buttons
{
	// f15-button: 100x50 button at (150, 100): up red, over green, down blue
	const b = build("f15-button", {}, "button");
	if (b) {
		await open(b.file, b.model);
		await wait(100);
		check("button: up state", near(await pixel(150, 100), [0xcc, 0x33, 0x33]), String(await pixel(150, 100)));
		await page.mouse.move(150, 100);
		await wait(100);
		check("button: over state", near(await pixel(150, 100), [0x33, 0xcc, 0x33]), String(await pixel(150, 100)));
		await page.mouse.down();
		await wait(100);
		check("button: down state", near(await pixel(150, 100), [0x33, 0x33, 0xcc]), String(await pixel(150, 100)));
		await page.mouse.up();
		await wait(100);
		check("button: back to over", near(await pixel(150, 100), [0x33, 0xcc, 0x33]), String(await pixel(150, 100)));
		await page.mouse.move(5, 5);
		await wait(100);
		check("button: back to up", near(await pixel(150, 100), [0xcc, 0x33, 0x33]), String(await pixel(150, 100)));
		await page.mouse.move(110, 100);
		await wait(100);
		// the hit area (frame 4, black) must never be drawn
		check("button: hit frame not drawn", !near(await pixel(110, 100), [0, 0, 0]));
	}
}

// ------------------------------------------------------------------ sounds
const sndLog = () => page.evaluate(() => (window as unknown as { __snd: SoundLog }).__snd);
const near1 = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
{
	// f16-sound (a model without the encoding step, as older exports): event sound on frame 1
	const b = build("f16-sound", { loop: "always" }, "sound");
	if (b) {
		await open(b.file, b.model);
		await wait(300);
		const n = (await sndLog()).starts.length;
		check("sound: event sound starts on frame 1 (Web Audio)", n === 1, `${n} sounds`);
		await api(page, (a) => (a.muted = true));
		const l = await sndLog();
		check(
			"sound: muted stops playing sounds",
			l.starts.every((s) => s.stopped || s.stopIn !== null),
			JSON.stringify(l.starts),
		);
		await wait(1200);
		const m = (await sndLog()).starts.length;
		check("sound: muted -> no new sounds after looping", m === n, `${m} sounds`);
	}
}
for (const format of ["mp3", "opus"] as const) {
	// f43-sounds through the encoding step: see tests/fixtures/build-fixtures.jsfl
	const b = await buildEncoded("f43-sounds", { loop: "always", soundFormat: format }, `sounds-${format}`);
	if (!b) break;
	const tag = `sound ${format}:`;
	await open(b.file, b.model);
	await wait(500);
	let l = await sndLog();
	check(`${tag} all four files decode`, l.decoded.length === 4 && !l.failed, `${l.decoded.length} decoded, ${l.failed} failed`);
	// chord: event with "fade in", repeated twice: one looping source over the whole sound, stopping after 2 x 1.5 s
	const chord = l.starts.find((s) => s.loop);
	check(`${tag} looping event sound (repeat 2)`, !!chord && near1(chord.le - chord.ls, 1.5, 0.002) && near1(chord.stopIn ?? 0, 3, 0.05), JSON.stringify(chord));
	check(`${tag} encoder delay skipped`, !!chord && chord.offset < 0.06 && near1(chord.ls, chord.offset, 0.03), JSON.stringify(chord));
	check(
		`${tag} fade-in envelope ramps to full volume at 0.375 s`,
		l.ramps.some(([v, t]) => v === 1 && chord && near1(t - chord.at, 0.375, 0.05)),
		JSON.stringify(l.ramps),
	);
	// the stream sound (melody, frames 1-24)
	const melody = l.starts.find((s) => !s.loop && near1(s.dur, 2.04, 0.05));
	check(`${tag} stream sound starts with the timeline`, !!melody && melody.offset < 0.1, JSON.stringify(l.starts));
	await wait(1300);
	l = await sndLog();
	// beep at frame 7 with in point 0.05 s and out point 0.3 s
	const beep = l.starts.find((s) => s.ch === 1 && near1(s.dur, 0.4, 0.05) && s.offset > 0.02);
	check(`${tag} in and out point`, !!beep && near1(beep.offset, 0.05, 0.01) && near1(beep.stopIn ?? 0, 0.25, 0.02), JSON.stringify(beep));
	// chord mono (MP3 32 kbps mono in Animate) panning from left to right over 1 s
	const pan = l.starts.find((s) => s.ch === 1 && near1(s.dur, 1.5, 0.2));
	check(`${tag} mono sound (Animate's convert to mono)`, !!pan, JSON.stringify(l.starts));
	check(`${tag} panning envelope`, l.ramps.filter(([, t]) => pan && near1(t - pan.at, 1, 0.05)).length === 2, JSON.stringify(l.ramps));
	check(`${tag} stream sound stops after its frames`, !!l.starts.find((s) => near1(s.dur, 2.04, 0.05))?.stopped);
	// frame 41: stop sound for the chord
	await wait(500);
	l = await sndLog();
	check(
		`${tag} stop sound ends the chord`,
		!!l.starts.find((s) => s.loop && chord && s.at === chord.at)?.stopped,
		JSON.stringify(l.starts.filter((s) => s.loop)),
	);
	// frame 31 plays the beep, frame 37 the movie clip's: "start" sync, so not while it still plays (0.4 s)
	const beeps = l.starts.filter((s) => s.ch === 1 && near1(s.dur, 0.4, 0.05) && s.at < 1.9);
	check(`${tag} "start" sound (in a movie clip) not while the same sound plays`, beeps.length === 2, JSON.stringify(beeps));
	// goto into the stream sound's frames: it starts at that frame's position
	const before = l.starts.length;
	await api(page, (a) => a.gotoAndPlay(13));
	await wait(150);
	l = await sndLog();
	const resumed = l.starts.slice(before).find((s) => near1(s.dur, 2.04, 0.05));
	check(`${tag} stream sound joins at the frame after a goto`, !!resumed && near1(resumed.offset, 0.5, 0.06), JSON.stringify(l.starts.slice(before)));
	// pause holds the sounds, play goes on from there
	await api(page, (a) => a.pause());
	l = await sndLog();
	const held = l.starts.slice(before);
	check(
		`${tag} pause holds the sounds`,
		held.every((s) => s.stopped || (s.stopIn !== null && s.stopIn < 0.2)),
		JSON.stringify(held),
	);
	await wait(300);
	const n0 = l.starts.length;
	await api(page, (a) => a.play());
	await wait(100);
	l = await sndLog();
	const again = l.starts.slice(n0).find((s) => near1(s.dur, 2.04, 0.05));
	check(`${tag} play continues the stream at its position`, !!again && again.offset > 0.5 && again.offset < 0.8, JSON.stringify(l.starts.slice(n0)));
	await api(page, (a) => (a.muted = true));
	await wait(100);
	l = await sndLog();
	check(
		`${tag} muted stops everything`,
		l.starts.every((s) => s.stopped || s.stopIn !== null),
		JSON.stringify(l.starts.filter((s) => !s.stopped && s.stopIn === null)),
	);
	// seeking doesn't play the sounds of the frames passed
	// (unmuted, the stream sound comes back at its frame on the next tick)
	await api(page, (a) => (a.muted = false));
	await wait(150);
	const n1 = (await sndLog()).starts.length;
	// (to frame 25: the next sound, frame 31, is 0.25 s away)
	await api(page, (a) => a.seek(1.0));
	await wait(50);
	l = await sndLog();
	check(`${tag} seek starts no event sounds on the way`, l.starts.length - n1 === 0, JSON.stringify(l.starts.slice(n1)));
	// a button plays the sound on its Down frame when pressed (Flash), once per press
	const n2 = l.starts.length;
	await page.mouse.move(240, 170);
	await wait(50);
	await page.mouse.down();
	await wait(150);
	l = await sndLog();
	const pressed = l.starts.slice(n2).filter((s) => s.ch === 1 && near1(s.dur, 1.5, 0.2));
	check(`${tag} button sound on its Down frame`, pressed.length === 1, JSON.stringify(l.starts.slice(n2)));
	await page.mouse.up();
	await page.mouse.move(5, 5);
}
{
	// linked sounds on file:// can't be fetched: the <audio> fallback plays them
	const b = await buildEncoded("f43-sounds", { loop: "always", embedImages: false }, "sounds-linked");
	if (b) {
		await open(b.file, b.model);
		await wait(500);
		const n = await page.evaluate(() => (window as unknown as { __sounds: HTMLAudioElement[] }).__sounds.length);
		check("sound linked: <audio> fallback plays on file://", n >= 2, `${n} audio elements`);
	}
}

{
	// autoplay blocked (a browser without the test flag): sounds wait, keeping their positions, and
	// join at the first click
	const b = await buildEncoded("f43-sounds", { loop: "always" }, "sounds-mp3");
	if (b) {
		const strict = await chromium.launch({ channel: opt("browser", "msedge"), headless: true });
		const p2 = await strict.newPage();
		await p2.addInitScript(initScript);
		await p2.goto(pathToFileURL(b.file).href);
		await p2.waitForTimeout(700);
		const state = await p2.evaluate(() => (window as unknown as { __f2sAudio?: AudioContext }).__f2sAudio?.state);
		const before = await p2.evaluate(() => (window as unknown as { __snd: SoundLog }).__snd.starts.length);
		check("autoplay blocked: no sound before an interaction", state !== "running" && before === 0, `${state}, ${before} starts`);
		await p2.mouse.click(5, 5);
		await p2.waitForTimeout(250);
		const l = await p2.evaluate(() => (window as unknown as { __snd: SoundLog }).__snd);
		const stream = l.starts.find((x) => Math.abs(x.dur - 2.04) < 0.05);
		check("autoplay blocked: the first click starts the sounds at their positions", !!stream && stream.offset > 0.5, JSON.stringify(l.starts));
		await strict.close();
	}
}

// ------------------------------------------------------------------ code snippets (mouse handlers)
{
	// f47-snippets: stop() on frame 1; buttons at y 260, x 60 (go to frame 2 and play), 153 (go to
	// "end" = frame 19 and stop), 246 (web page), 339 (hide mc_box at 200,160); mc_spin (320,160)
	// spins while the mouse is over it
	const b = build("f47-snippets", {}, "snippets");
	if (b) {
		await open(b.file, b.model);
		await wait(300);
		check("snippets: the frame script stops on frame 1", (await frame()) === 1, `frame ${await frame()}`);
		await page.mouse.click(60, 260);
		await wait(250);
		const f = await frame();
		check("snippets: a click goes to frame 2 and plays", f > 2 && f < 24, `frame ${f}`);
		await wait(1100);
		check("snippets: ... up to the stop() on the last frame", (await frame()) === 24, `frame ${await frame()}`);
		await page.mouse.click(153, 260);
		await wait(250);
		check("snippets: gotoAndStop(label) on a click", (await frame()) === 19, `frame ${await frame()}`);
		const box = () => pixel(190, 160);
		check("snippets: mc_box shows", near(await box(), [0x33, 0x66, 0xcc]), String(await box()));
		await page.mouse.click(339, 260);
		await wait(100);
		check("snippets: a click hides mc_box (visible = false)", near(await box(), [0xee, 0xee, 0xee]), String(await box()));
		await page.evaluate(() => {
			const w = window as unknown as { __opened: unknown[]; open: unknown };
			w.__opened = [];
			w.open = (...a: unknown[]) => void w.__opened.push(a);
		});
		await page.mouse.click(246, 260);
		const opened = await page.evaluate(() => JSON.stringify((window as unknown as { __opened: unknown[] }).__opened));
		check("snippets: a click opens the web page", opened === JSON.stringify([["https://example.com/", "_blank", "noopener"]]), opened);
		const cursor = await page.evaluate(() => getComputedStyle(document.elementFromPoint(60, 260)!).cursor);
		check("snippets: buttons show the hand cursor", cursor === "pointer", cursor);
		// over / out: the spinner turns only while the mouse is on it
		const spin = async () => PNG.sync.read(await page.screenshot({ clip: { x: 280, y: 120, width: 80, height: 80 } })).data;
		const still0 = await spin();
		await wait(200);
		check("snippets: mc_spin stands still", still0.equals(await spin()));
		await page.mouse.move(320, 160);
		await wait(120);
		const a = await spin();
		await wait(120);
		check("snippets: mouse over plays mc_spin", !a.equals(await spin()));
		await page.mouse.move(320, 165);
		await wait(80);
		const c = await spin();
		await wait(80);
		check("snippets: moving within it keeps it playing", !c.equals(await spin()));
		await page.mouse.move(10, 10);
		await wait(80);
		const d = await spin();
		await wait(200);
		check("snippets: mouse out stops it", d.equals(await spin()));
		// keyboard: a button with a click handler takes the focus, Enter clicks it
		await page.evaluate(() => {
			(document.documentElement as unknown as { flash2svg: Api }).flash2svg.gotoAndStop(1);
			(document.querySelector('[data-name="btn_next"]') as SVGElement | null)?.focus();
		});
		const focused = await page.evaluate(
			() => (document.activeElement?.getAttribute("role") ?? "") + " " + (document.activeElement?.getAttribute("data-name") ?? ""),
		);
		await page.keyboard.press("Enter");
		await wait(250);
		check(
			"snippets: a button takes the focus, Enter clicks it",
			focused === "button btn_next" && (await frame()) > 2,
			`focus ${focused}, frame ${await frame()}`,
		);
	}
}

// ------------------------------------------------------------------ accessibility
{
	// f48-accessibility: document name and description, a named box with a description, a button
	// "Play" (shortcut P, tab index 1), a decoration hidden from assistive technology, a group
	// whose children don't count
	for (const format of ["player", "smil"] as const) {
		const b = format === "player" ? build("f48-accessibility", {}, "a11y") : null;
		const file = b?.file ?? join(out, "f48-accessibility", "player", "a11y-smil.svg");
		const model = b?.model ?? (JSON.parse(readFileSync(join(out, "f48-accessibility", "model", "scene.json"), "utf8")) as SceneModel);
		if (!b) {
			const modelDir = join(out, "f48-accessibility", "model");
			if (!existsSync(join(modelDir, "scene.json"))) continue;
			const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, compileScene(model, files, { format, includeBackground: true }).files[0]!.svg);
		}
		await open(file, model);
		await wait(150);
		const tree = await page.locator("svg").first().ariaSnapshot();
		const has = (re: RegExp) => re.test(tree);
		check(
			`accessibility (${format}): names, roles and descriptions reach the browser`,
			has(/group "Moving box demo"/) && has(/img "Blue box"/) && has(/button "Play"/) && has(/img "Group"/) && !has(/deco/i),
			tree.replace(/\n/g, " | "),
		);
		const desc = await page.evaluate(() => (document.querySelector('[aria-label="Blue box"] > desc') as Element | null)?.textContent ?? "");
		check(`accessibility (${format}): the description`, desc === "It moves from left to right", desc);
	}
}
await browser.close();
console.log(failures ? `\nplayer: ${failures} of ${checks} checks failed` : `\nplayer: all ${checks} checks ok`);
process.exitCode = failures ? 1 : 0;
