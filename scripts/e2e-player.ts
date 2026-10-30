// E2E step 4: drives the JS player in a real browser and checks its API and interaction:
// frame scripts and labels, goto*, loop modes and the "end" event, start modes, buttons, sounds.
// Uses the scene models written by e2e-extract (f02-eases, f12-labels, f15-button, f16-sound, f30-banner).
// Usage: node scripts/e2e-player.ts [--browser=msedge]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene, type ExportSettings } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;

const browser = await chromium.launch({ channel: opt("browser", "msedge"), headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
// count sounds the player starts
await page.addInitScript(() => {
	const w = window as unknown as { __sounds: HTMLAudioElement[]; Audio: typeof Audio };
	w.__sounds = [];
	const Orig = w.Audio;
	w.Audio = function (src?: string) {
		const a = new Orig(src);
		w.__sounds.push(a);
		return a;
	} as unknown as typeof Audio;
});

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

const api = <T>(page: Page, fn: (a: Api) => T): Promise<T> =>
	page.evaluate(`(${fn.toString()})(document.documentElement.flash2svg)`) as Promise<T>;
const frame = () => api(page, (a) => a.currentFrame);
const wait = (ms: number) => page.waitForTimeout(ms);

async function pixel(x: number, y: number): Promise<[number, number, number]> {
	const png = PNG.sync.read(await page.screenshot({ clip: { x, y, width: 1, height: 1 } }));
	return [png.data[0]!, png.data[1]!, png.data[2]!];
}
const near = (a: [number, number, number], b: [number, number, number]) => a.every((v, i) => Math.abs(v - b[i]!) < 24);

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
		await api(page, (a) => a.gotoAndStop(5));
		check("labels: gotoAndStop(number) is 1-based", (await frame()) === 5, `frame ${await frame()}`);
		await api(page, (a) => a.gotoAndPlay("step2"));
		await wait(400);
		const f = await frame();
		check("labels: gotoAndPlay(label) plays on", f > 4 && f <= 12, `frame ${f}`);
		await api(page, (a) => a.seek(0.5));
		check("labels: seek(0.5s) -> frame 7", (await frame()) === 7, `frame ${await frame()}`);
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
{
	// f16-sound: event sound on frame 1
	const b = build("f16-sound", { loop: "always" }, "sound");
	if (b) {
		await open(b.file, b.model);
		await wait(300);
		const n = await page.evaluate(() => (window as unknown as { __sounds: HTMLAudioElement[] }).__sounds.length);
		check("sound: event sound starts on frame 1", n === 1, `${n} sounds`);
		await page.evaluate(() => {
			const a = (document.documentElement as unknown as { flash2svg: Api }).flash2svg;
			a.muted = true;
		});
		const paused = await page.evaluate(() => (window as unknown as { __sounds: HTMLAudioElement[] }).__sounds.every((s) => s.paused));
		check("sound: muted pauses playing sounds", paused);
		await wait(1200);
		const m = await page.evaluate(() => (window as unknown as { __sounds: HTMLAudioElement[] }).__sounds.length);
		check("sound: muted -> no new sounds after looping", m === n, `${m} sounds`);
	}
}

await browser.close();
console.log(failures ? `\nplayer: ${failures} of ${checks} checks failed` : `\nplayer: all ${checks} checks ok`);
process.exitCode = failures ? 1 : 0;
