import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileScene } from "../../src/core/compile.ts";
import type { SceneModel } from "../../src/core/model.ts";

const load = (name: string): SceneModel => JSON.parse(readFileSync(new URL(`../fixtures/models/${name}.json`, import.meta.url), "utf8"));
// the stored models come without their atlas: every artwork is a stand-in square
const files = {
	readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#336699" d="M0 0L5 0 5 5 0 5Z"/></svg>`,
	readBinary: () => new Uint8Array(),
};
const script = (m: SceneModel, frame: number, code: string | undefined) => {
	for (const l of m.timelines[m.roots[0]!]!.layers) for (const k of l.keyframes) if (k.index === frame && k.script !== undefined) k.script = code;
};

describe("loops", () => {
	it("plays the frames before a label once when the end jumps back to it", () => {
		// f12-labels: 12 frames, labels at frames 1, 4, 7, 10; the last frame's script loops to step2
		const m = load("f12-labels");
		script(m, 11, 'gotoAndPlay("step2");');
		for (const format of ["smil", "css"] as const) {
			const out = compileScene(structuredClone(m), files, { format });
			// frames 1-3 once, then frames 4-11 (frame 12 jumps at once, it isn't shown)
			expect(out.stats.loopFrom, format).toBe(3);
			expect(out.stats.frames, format).toBe(11);
		}
		const smil = compileScene(structuredClone(m), files, { format: "smil" }).files[0]!.svg;
		expect(smil).toMatch(/begin="[\w-]+_clock\.end" repeatCount="indefinite"/);
	});

	it("writes a movie clip's loop once, repeating on its own, inside a longer horizon", () => {
		// f28-onestop without its stop(): one looping root frame with clips of 8, 10 and 11 frames
		const m = load("f28-onestop");
		for (const l of m.timelines[m.roots[0]!]!.layers) for (const k of l.keyframes) delete k.script;
		const smil = compileScene(structuredClone(m), files, { format: "smil" }).files[0]!.svg;
		// the 8-frame spinner at 24 fps: .3333333 s, repeating (not unrolled over the 440-frame horizon)
		expect(smil).toContain('dur=".3333333s" repeatCount="indefinite"');
		const css = compileScene(structuredClone(m), files, { format: "css" }).files[0]!.svg;
		expect(css).toMatch(/ \.3333333s [^;}]*infinite/);
	});

	it("writes repeating durations with 7 decimals (rounding adds up loop after loop)", () => {
		const m = load("f02-eases");
		const smil = compileScene(m, files, { format: "smil" }).files[0]!.svg;
		const durs = [...smil.matchAll(/dur="([\d.]+)s" repeatCount="indefinite"/g)].map((x) => x[1]!);
		expect(durs.length).toBeGreaterThan(0);
		// 48 frames at 24 fps: exactly 2 s, written short
		expect(durs).toContain("2");
	});
});
