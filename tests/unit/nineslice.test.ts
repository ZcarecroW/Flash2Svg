import { describe, expect, it } from "vitest";
import { importArtwork } from "../../src/core/artwork.ts";
import { artworkBounds, mapAxis, mapPath, sliceArtwork, type Axis, type SliceMap } from "../../src/core/nineslice.ts";
import { serialize } from "../../src/core/xml.ts";
import { minifyPath } from "../../src/core/pathdata.ts";

// a 60 wide symbol with 16 px corners on the left and right
const axis = (s: number): Axis => ({ s, a: 0, b: 60, l: 16, r: 44 });

describe("9-slice axis mapping", () => {
	it("keeps the corners and stretches the middle", () => {
		const ax = axis(3);
		expect(mapAxis(ax, 0)).toBe(0);
		expect(mapAxis(ax, 16)).toBe(16);
		expect(mapAxis(ax, 44)).toBe(164);
		expect(mapAxis(ax, 60)).toBe(180);
		expect(mapAxis(ax, 30)).toBe(90);
		// outside the content (strokes): corners keep their slope
		expect(mapAxis(ax, -1)).toBe(-1);
		expect(mapAxis(ax, 61)).toBe(181);
	});

	it("shrinks the corners when scaled below their size", () => {
		const ax = axis(0.4); // 24 px wide in total, corners would need 32
		expect(mapAxis(ax, 0)).toBeCloseTo(0);
		expect(mapAxis(ax, 16)).toBeCloseTo(12);
		expect(mapAxis(ax, 30)).toBeCloseTo(12);
		expect(mapAxis(ax, 60)).toBeCloseTo(24);
	});

	it("mirrors with a negative scale", () => {
		expect(mapAxis(axis(-2), 60)).toBe(-120);
		expect(mapAxis(axis(-2), 10)).toBe(-10);
	});
});

describe("path rewriting", () => {
	it("turns relative, H/V and smooth commands into absolute ones", () => {
		const id = (p: { x: number; y: number }) => p;
		expect(mapPath("m10 10h5v5l-5 0z", id, 2)).toBe("M10 10L15 10 15 15 10 15Z");
		expect(mapPath("M0 0Q5 5 10 0T20 0", id, 2)).toBe("M0 0Q5 5 10 0 15-5 20 0");
		expect(mapPath("M0 0C0 5 5 5 5 0S10-5 10 0", id, 2)).toBe("M0 0C0 5 5 5 5 0 5-5 10-5 10 0");
	});
});

describe("sliced artwork", () => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
		<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="60" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
		<g transform="translate(10 0)"><path fill="url(#g)" stroke="#000" stroke-width="2" d="M-10 0L50 0 50 40-10 40Z"/></g></svg>`;
	const art = importArtwork(svg, "a", { digits: 2 });
	const m: SliceMap = { pre: [1, 0, 0, 1, 0, 0], x: axis(3), y: { s: 1, a: 0, b: 40, l: 12, r: 28 } };

	it("moves the vertices, keeps the stroke width and scales the gradient normally", () => {
		const out = sliceArtwork(art, m, "b", 2);
		const text = [...out.defs, out.body].map((n) => serialize(n)).join("");
		expect(text).toContain(`d="${minifyPath("M0 0L180 0 180 40 0 40Z")}"`);
		expect(text).toContain('stroke-width="2"');
		expect(text).not.toContain('stroke-width="6"');
		expect(text).toMatch(/gradientTransform="matrix\(3 0 0 1 30 0\)"/);
		// the copy has its own ids
		expect(text).not.toMatch(/id="a_/);
	});

	it("measures bounds with half the stroke width", () => {
		expect(artworkBounds(art)).toEqual({ l: -1, t: -1, r: 61, b: 41 });
	});
});
