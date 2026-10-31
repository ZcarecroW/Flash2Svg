import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileScene, type ExportSettings } from "../../src/core/compile.ts";
import type { SceneModel } from "../../src/core/model.ts";

function compile(name: string, settings: Partial<ExportSettings>) {
	const model: SceneModel = JSON.parse(readFileSync(new URL(`../fixtures/models/${name}.json`, import.meta.url), "utf8"));
	const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };
	return compileScene(model, files, settings);
}

describe("start when visible", () => {
	it("holds SMIL and CSS with a script, so they just play where scripts don't run", () => {
		const smil = compile("f03-transforms", { format: "smil", begin: "visible" }).files[0]!.svg;
		expect(smil).toMatch(/IntersectionObserver/);
		expect(smil).toMatch(/s\.pauseAnimations\(\)/);
		// the animations themselves start as usual
		expect(smil).not.toMatch(/begin="indefinite"/);
		const css = compile("f03-transforms", { format: "css", begin: "visible" }).files[0]!.svg;
		expect(css).toMatch(/\.f2s-wait \*\{animation-play-state:paused\}/);
		expect(css).toMatch(/classList\.add\("f2s-wait"\)/);
		const player = compile("f03-transforms", { format: "player", begin: "visible" }).files[0]!.svg;
		expect(player).toMatch(/data-begin="visible"/);
	});
});

describe("scroll", () => {
	it("plays the first pass once, without a delay", () => {
		// f28 stops with movie clips running: on scroll there is no looping tail
		for (const format of ["smil", "css"] as const) {
			const svg = compile("f28-onestop", { format, begin: "scroll", delay: 2 }).files[0]!.svg;
			expect(svg).not.toMatch(/indefinite|infinite|clock/);
			expect(svg).not.toMatch(/begin="2s"|\b2s both/);
		}
		const player = compile("f28-onestop", { format: "player", begin: "scroll", delay: 2 }).files[0]!.svg;
		expect(player).toMatch(/data-loop="0"/);
		expect(player).toMatch(/data-delay=""|^(?![\s\S]*data-delay="2")/);
	});

	it("CSS: a view timeline on the SVG, set after the animation rules", () => {
		const svg = compile("f03-transforms", { format: "css", begin: "scroll" }).files[0]!.svg;
		const id = /<svg[^>]* id="([^"]+)"/.exec(svg)![1]!;
		const rule = svg.indexOf(`#${id}{view-timeline:--${id}}#${id} [class]{animation-timeline:--${id};animation-range:contain}`);
		expect(rule).toBeGreaterThan(0);
		// the shorthand resets animation-timeline: the timeline must come later
		const rules = [...svg.matchAll(/ \.[\w-]+\{animation:/g)];
		expect(rules.length).toBeGreaterThan(0);
		expect(rules[rules.length - 1]!.index).toBeLessThan(rule);
		expect(compile("f03-transforms", { format: "css", begin: "scroll", scrollRange: "crossing" }).files[0]!.svg).toMatch(/animation-timeline:--[^;}]+\}/);
		expect(compile("f03-transforms", { format: "css", begin: "scroll", scrollRange: "page" }).files[0]!.svg).toMatch(/animation-timeline:scroll\(root\)/);
	});

	it("SMIL: a script sets the time from the scroll position (range code and duration)", () => {
		const out = compile("f03-transforms", { format: "smil", begin: "scroll", scrollRange: "crossing" });
		const svg = out.files[0]!.svg;
		const m = /\(document\.getElementById\("[^"]+"\),([\d.]+),(\d)\)/.exec(svg);
		expect(m).not.toBeNull();
		expect(+m![1]!).toBeCloseTo(out.stats.durationSeconds, 3);
		expect(m![2]).toBe("1");
	});

	it("Lottie: plays when loaded, with a warning", () => {
		for (const begin of ["visible", "scroll"] as const) {
			const out = compile("f03-transforms", { format: "dotlottie", begin });
			expect(out.warnings.some((w) => w.includes("up to the page"))).toBe(true);
		}
	});
});
