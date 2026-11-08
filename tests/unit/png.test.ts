import { zlibSync } from "fflate";
import pngjs from "pngjs";
import { describe, expect, it } from "vitest";
import { decodePng, inflate } from "../../src/player/png.ts";

const { PNG } = pngjs;

describe("PNG read at once", () => {
	it("inflates stored, fixed and dynamic blocks", () => {
		const text = new TextEncoder().encode("abcabcabc ".repeat(500) + Array.from({ length: 3000 }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 90))).join(""));
		for (const level of [0, 1, 6, 9] as const) expect(inflate(zlibSync(text, { level }))).toEqual(text);
		expect(inflate(zlibSync(new Uint8Array(0)))).toEqual(new Uint8Array(0));
	});

	it("reads RGBA, RGB, grey and palette pictures as ARGB pixels", () => {
		const w = 37,
			h = 23;
		const png = new PNG({ width: w, height: h });
		let seed = 3;
		for (let i = 0; i < w * h * 4; i++) png.data[i] = (seed = (seed * 16807) % 2147483647) & 255;
		const want = Array.from({ length: w * h }, (_, i) => ((png.data[i * 4 + 3]! << 24) | (png.data[i * 4]! << 16) | (png.data[i * 4 + 1]! << 8) | png.data[i * 4 + 2]!) >>> 0);
		for (const filterType of [-1, 0, 1, 2, 3, 4]) {
			const r = decodePng(new Uint8Array(PNG.sync.write(png, { filterType })));
			expect(r?.w).toBe(w);
			expect(Array.from(r!.px)).toEqual(want);
		}
		// (no alpha: opaque; grey)
		for (let i = 3; i < w * h * 4; i += 4) png.data[i] = 255;
		want.forEach((v, i) => (want[i] = (v | 0xff000000) >>> 0));
		const rgb = decodePng(new Uint8Array(PNG.sync.write(png, { colorType: 2 })))!;
		expect(rgb.px[5]! >>> 24).toBe(255);
		expect(rgb.px[5]! & 0xffffff).toBe(want[5]! & 0xffffff);
		const grey = decodePng(new Uint8Array(PNG.sync.write(png, { colorType: 0, inputHasAlpha: true })))!;
		const g = grey.px[9]!;
		expect((g >> 16) & 255).toBe(g & 255);
	});

	it("says it can't for what it doesn't read", () => {
		expect(decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
	});
});
