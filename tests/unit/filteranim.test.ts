import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileScene } from "../../src/core/compile.ts";
import { blurSigma, buildFilters } from "../../src/core/emit/filters.ts";
import { filterRuns, filterValue, type FilterSet } from "../../src/core/emit/filteranim.ts";
import type { FilterData, SceneModel } from "../../src/core/model.ts";
import { valueAt } from "../../src/core/tracks.ts";

const warn = () => {};
const one = { x: 1, y: 1 };
const blur = (x: number, y = x): FilterData => ({ name: "blurFilter", enabled: true, blurX: x, blurY: y, quality: "high" });
const shadow = (distance: number, strength = 100, extra: Partial<FilterData> = {}): FilterData => ({
	name: "dropShadowFilter",
	enabled: true,
	blurX: 8,
	blurY: 8,
	distance,
	angle: 45,
	strength,
	color: "#000000",
	quality: "medium",
	...extra,
});
/** One set per frame from `from` on. */
const frames = (fs: FilterData[][], from = 0): FilterSet[] => fs.map((filters, i) => ({ t: from + i, filters }));

describe("animated filters", () => {
	it("writes a blur tween as one filter whose blur switches at the frames, one number for both axes", () => {
		const amounts = Array.from({ length: 11 }, (_, i) => 4 + i * 1.6);
		const runs = filterRuns(frames(amounts.map((a) => [blur(a)])), one, warn, 0);
		expect(runs).toHaveLength(1);
		const a = runs[0]!.animated!;
		expect(a.anims).toHaveLength(1);
		const an = a.anims[0]!;
		expect(an.attr).toBe("stdDeviation");
		expect(an.tracks).toHaveLength(1);
		expect(an.tracks[0]!.every((k) => k.ease === "hold")).toBe(true);
		// Animate's value at every frame, and still between frames (filters step with the frames)
		amounts.forEach((v, f) => {
			expect(Math.abs(valueAt(an.tracks[0]!, f) - blurSigma(v, "high"))).toBeLessThan(5e-4);
			expect(valueAt(an.tracks[0]!, f + 0.5)).toBe(valueAt(an.tracks[0]!, f));
		});
		// the region covers the widest blur
		expect(a.margin.x).toBeCloseTo(buildFilters([blur(amounts[10]!)], one, warn).margin.x, 6);
	});

	it("keeps one make-up from a shadow's distance 0 on (its offset always there), keys only where values change", () => {
		const d = Array.from({ length: 9 }, (_, i) => i * 0.8);
		const runs = filterRuns(frames(d.map((x) => [shadow(x)])), one, warn, 0);
		expect(runs).toHaveLength(1);
		const dx = runs[0]!.animated!.anims.find((a) => a.attr === "dx")!.tracks[0]!;
		d.forEach((x, f) => expect(valueAt(dx, f)).toBe(Math.round(Math.cos(Math.PI / 4) * x)));
		expect(dx.length).toBe(new Set(d.map((x) => Math.round(Math.cos(Math.PI / 4) * x))).size);
	});

	it("splits where the make-up changes; a still run gets no animation", () => {
		const sets: FilterSet[] = [
			{ t: 0, filters: [shadow(4, 100)] },
			{ t: 5, filters: [shadow(4, 50)] },
			{ t: 6, filters: [shadow(4, 60)] },
			{ t: 8, filters: [shadow(4, 60, { inner: true })] }, // inner: another make-up
			{ t: 9, filters: [] },
			{ t: 10, filters: [blur(4)] },
		];
		const runs = filterRuns(sets, one, warn, 0);
		expect(runs.map((r) => [r.t, r.sets.length, !!r.animated])).toEqual([
			[0, 3, true],
			[8, 1, false],
			[9, 1, false],
			[10, 1, false],
		]);
		const slope = runs[0]!.animated!.anims.find((a) => a.attr === "slope")!.tracks[0]!;
		expect([4.9, 5, 5.5, 6, 7.9].map((t) => valueAt(slope, t))).toEqual([1, 0.5, 0.5, 0.6, 0.6]);
		// the primitives show the poster's values
		const posterLast = filterRuns(sets, one, warn, 7)[0]!.animated!;
		const slopeNode = JSON.stringify(posterLast.primitives);
		expect(slopeNode).toContain('"slope":".6"');
	});

	it("writes colours as #rrggbb and numbers with their decimals", () => {
		expect(filterValue({ kind: 1, digits: 0 }, [255, 127.6, -3])).toBe("#ff8000");
		expect(filterValue({ kind: 0, digits: 3 }, [1.23456, 0, -0.5])).toBe("1.235 0 -.5");
	});

	it("compiles the player to one filter per tween whose values it sets (SMIL and CSS: a filter per frame)", () => {
		const model: SceneModel = JSON.parse(readFileSync(new URL("../fixtures/models/f46-filters3.json", import.meta.url), "utf8"));
		const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };
		const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
		const smil = compileScene(model, files, { format: "smil" }).files[0]!.svg;
		const css = compileScene(model, files, { format: "css" }).files[0]!.svg;
		const player = compileScene(model, files, { format: "player" }).files[0]!.svg;
		// SMIL: no animation inside filters (Chromium would draw them again at every refresh of the screen)
		expect(smil).not.toMatch(/<fe[A-Za-z]+[^>]*>\s*<animate/);
		expect(count(smil, /<filter/g)).toBe(count(css, /<filter/g));
		expect(player).toMatch(/"fa":\{/);
		expect(count(player, /<filter/g)).toBeLessThan(count(css, /<filter/g) / 2);
		expect(player.length).toBeLessThan(smil.length);
	});

	it("shows the poster frame's filters where nothing animates (SMIL, CSS)", () => {
		const model: SceneModel = JSON.parse(readFileSync(new URL("../fixtures/models/f46-filters3.json", import.meta.url), "utf8"));
		const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };
		for (const posterFrame of ["first", "last"] as const) {
			const smil = compileScene(model, files, { format: "smil", posterFrame, loop: "never" }).files[0]!.svg;
			// <g filter="url(#a)"><g ...>...</g><animate attributeName="filter" values="url(#a);...;url(#z)" ...>
			const switches = [...smil.matchAll(/<g filter="([^"]+)">(?:(?!<g filter=)[\s\S])*?<animate attributeName="filter" values="([^"]+)"/g)];
			expect(switches.length).toBeGreaterThan(0);
			for (const [, shown, values] of switches) {
				const list = values!.split(";").filter((v) => v !== "none");
				expect(shown).toBe(posterFrame === "first" ? list[0] : list[list.length - 1]);
			}
		}
	});
});
