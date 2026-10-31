// E2E for the dotLottie state machine (src/core/statemachine.ts): exports fixtures as .lottie and
// runs them in dotlottie-web with stateMachineId "playback", sampling the state and frame on
// every animation frame: the intro once then the tail (a stop() with movie clips running), never
// a frame past the last one, a click to start and to start again, looping, playing once.
// Usage: node scripts/e2e-statemachine.ts [--browser=msedge]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { compileScene, type ExportSettings } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";
import { openHarness, startServer } from "./lib/lottie-players.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const browserArg = process.argv.find((a) => a.startsWith("--browser="))?.slice(10) ?? "msedge";

function exportLottie(name: string, s: Partial<ExportSettings>) {
	const dir = join(out, name, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	const files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) };
	const r = compileScene(model, files, { format: "dotlottie", ...s });
	return {
		bytes: r.files[0]!.bytes!,
		frames: r.stats.frames,
		tail: r.stats.loopFrom ?? 0,
		fps: model.doc.frameRate || 24,
		w: model.doc.width,
		h: model.doc.height,
	};
}

type Sample = { s: string; f: number; t: number };

/** Loads a .lottie with its state machine; samples [state, frame] on every animation frame. */
async function run(page: Page, bytes: Uint8Array, w: number, h: number) {
	await page.setViewportSize({ width: w, height: h });
	await page.evaluate(
		async ([data, ww, hh]) => {
			const { DotLottie } = await import("/node_modules/@lottiefiles/dotlottie-web/dist/index.js" as string);
			document.querySelectorAll("canvas.sm").forEach((c) => c.remove());
			const W = window as unknown as { smDl?: { destroy(): void }; smSamples: unknown[] };
			W.smDl?.destroy();
			const canvas = document.createElement("canvas");
			canvas.className = "sm";
			canvas.width = ww as number;
			canvas.height = hh as number;
			canvas.style.cssText = `position:absolute;left:0;top:0;width:${ww}px;height:${hh}px`;
			document.body.appendChild(canvas);
			const dl = new DotLottie({
				canvas,
				data: new Uint8Array(data as number[]).buffer,
				stateMachineId: "playback",
				renderConfig: { devicePixelRatio: 1, freezeOnOffscreen: false },
			});
			W.smDl = dl;
			W.smSamples = [];
			await new Promise((res) => dl.addEventListener("load", res));
			const tick = () => {
				if (W.smDl !== dl) return;
				W.smSamples.push({ s: dl.stateMachineGetCurrentState(), f: Math.round(dl.currentFrame * 100) / 100, t: performance.now() });
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		[[...bytes], w, h] as const,
	);
	const samples = () => page.evaluate(() => (window as unknown as { smSamples: Sample[] }).smSamples.splice(0));
	return { samples, wait: (ms: number) => page.waitForTimeout(ms), click: (x = w / 2, y = h / 2) => page.mouse.click(x, y) };
}

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
	console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(46)} ${detail}`);
	if (!ok) failures++;
};
const span = (list: Sample[], state: string): [number, number] | null => {
	const f = list.filter((x) => x.s === state).map((x) => x.f);
	return f.length ? [Math.min(...f), Math.max(...f)] : null;
};

const { url, server } = await startServer(repo);
const browser = await chromium.launch({ channel: browserArg, headless: true });
const page = await openHarness(browser, url);

// Time from one wrap of the playhead to the next (ms), or NaN with fewer than two wraps.
function wrapPeriod(s: Sample[], state?: string): number {
	const at = s.filter((x, i) => i && (!state || (x.s === state && s[i - 1]!.s === state)) && x.f < s[i - 1]!.f).map((x) => x.t);
	return at.length >= 2 ? (at[at.length - 1]! - at[0]!) / (at.length - 1) : NaN;
}
// within 5 %: a loop a frame short (dotLottie plays [0, op − 1]) is 2–4 % off at 24–48 frames
const near = (ms: number, want: number) => !Number.isFinite(ms) || Math.abs(ms - want) <= want * 0.05;

// a stop() while movie clips keep running: the intro once, then the tail, each frame its full
// time (the .lottie holds the last frame once more: frame `frames` is shown at the wrap)
for (const name of ["f27-stop", "f28-onestop", "f30-banner"]) {
	const e = exportLottie(name, {});
	const p = await run(page, e.bytes, e.w, e.h);
	const intro = ((e.tail || 1) / e.fps) * 1000;
	const period = ((e.frames - e.tail) / e.fps) * 1000;
	await p.wait(intro + Math.min(2.5 * period, 6000) + 300);
	const s = await p.samples();
	const first = s[0]?.s;
	const tailSpan = span(s, "tail");
	const introSpan = span(s, "intro");
	const wraps = s.filter((x, i) => i && x.s === "tail" && s[i - 1]!.s === "tail" && x.f < s[i - 1]!.f).length;
	check(
		`${name}: intro, then the tail`,
		first === "intro" &&
			!!tailSpan &&
			!!introSpan &&
			introSpan[1] <= e.tail + 1e-6 &&
			tailSpan[0] >= e.tail - 0.01 &&
			tailSpan[1] <= e.frames + 1e-6 &&
			(period > 2000 || wraps > 0) &&
			near(wrapPeriod(s, "tail"), period),
		`intro ${introSpan?.join("..")} tail ${tailSpan?.join("..")} of ${e.frames} frames (tail from ${e.tail}), ${wraps} wrap(s), loop ${wrapPeriod(s, "tail").toFixed(0)} of ${period.toFixed(0)} ms`,
	);
}

// start on a click (poster: the last frame), a second click starts again
{
	const e = exportLottie("f27-stop", { begin: "click", posterFrame: "last" });
	const p = await run(page, e.bytes, e.w, e.h);
	await p.wait(400);
	let s = await p.samples();
	const idle = s.every((x) => x.s === "idle") && s.length > 0 && s.every((x) => Math.abs(x.f - (e.frames - 1)) < 1e-6);
	await p.click();
	await p.wait(500);
	s = await p.samples();
	const started = s.some((x) => x.s === "intro") && Math.max(...s.map((x) => x.f)) > 3;
	await p.click();
	await p.wait(150);
	s = await p.samples();
	const again = s.some((x) => x.s === "intro" && x.f < 6);
	check("f27-stop: poster, click starts, click restarts", idle && started && again, `idle at the last frame ${idle}, started ${started}, restarted ${again}`);
}

// loops as a whole, and plays once
{
	const e = exportLottie("f02-eases", { loop: "always" });
	const p = await run(page, e.bytes, e.w, e.h);
	await p.wait((e.frames / e.fps) * 1000 * 3.2);
	const s = await p.samples();
	const wraps = s.filter((x, i) => i && x.f < s[i - 1]!.f).length;
	check(
		"f02-eases: loops",
		s.every((x) => x.s === "play") && wraps >= 1 && Math.max(...s.map((x) => x.f)) <= e.frames && near(wrapPeriod(s), (e.frames / e.fps) * 1000),
		`${wraps} wrap(s), max frame ${Math.max(...s.map((x) => x.f))}, loop ${wrapPeriod(s).toFixed(0)} of ${((e.frames / e.fps) * 1000).toFixed(0)} ms`,
	);
	const once = exportLottie("f02-eases", { loop: "never" });
	const q = await run(page, once.bytes, once.w, once.h);
	await q.wait((once.frames / once.fps) * 1000 + 600);
	const t = await q.samples();
	const end = t[t.length - 1]?.f ?? -1;
	check(
		"f02-eases: plays once and stays on the last frame",
		!t.some((x, i) => i && x.f < t[i - 1]!.f) && Math.abs(end - once.frames) < 1e-6,
		`ends at ${end} of ${once.frames}`,
	);
}

// buttons from code snippets (f47): labels as states, clicks on the buttons' layers as transitions
{
	const e = exportLottie("f47-snippets", {});
	const p = await run(page, e.bytes, e.w, e.h);
	await p.wait(400);
	const a = await p.samples();
	const held = a.length > 0 && a.every((x) => x.s === "f1" && x.f === 0);
	// btn_next at (60, 260): gotoAndPlay(2), up to the stop() on frame 24
	await p.click(60, 260);
	await p.wait(1400);
	const b = await p.samples();
	const played = b.some((x) => x.s === "f2") && b[b.length - 1]!.f === 23 && b.some((x) => x.f > 1 && x.f < 23);
	// btn_end at (153, 260): gotoAndStop("end") (frame 19)
	await p.click(153, 260);
	await p.wait(300);
	const c = await p.samples();
	const stopped = c[c.length - 1]?.s === "still19" && c[c.length - 1]?.f === 18;
	check("f47-snippets: buttons switch the states", held && played && stopped, `held ${held} (${[...new Set(a.map((x) => x.s + ":" + x.f))].join(" ")}), played ${played} (last ${b[b.length - 1]?.s} ${b[b.length - 1]?.f}), stopped ${stopped} (${c[c.length - 1]?.s} ${c[c.length - 1]?.f})`);
}

await browser.close();
server.close();
console.log(failures ? `${failures} check(s) failed` : "all state machine checks OK");
process.exitCode = failures ? 1 : 0;
