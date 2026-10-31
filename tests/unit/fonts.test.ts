import { describe, expect, it } from "vitest";
import type { EmbeddedFont } from "../../src/core/fonts.ts";
import type { TextElement } from "../../src/core/model.ts";
import { textNode } from "../../src/core/emit/text.ts";
import { serialize } from "../../src/core/xml.ts";

// every character 0.5 em wide; ascent 0.8 em, descent 0.2 em
const font: EmbeddedFont = {
	face: "Test",
	bold: false,
	italic: false,
	family: "p_f2s-Test",
	woff2: "",
	upm: 1000,
	ascent: 800,
	descent: 200,
	widths: new Proxy({}, { get: () => 500 }) as Record<string, number>,
};
const fonts = { get: (face: string) => (face === "Test" ? font : undefined) };
const field = (text: string, width: number, multiline: boolean): TextElement => ({
	kind: "text",
	textType: "dynamic",
	atlas: "",
	matrix: [1, 0, 0, 1, 0, 0],
	name: "",
	width,
	height: 40,
	text,
	runs: [{ text, face: "Test", size: 10, fillColor: "#000000", bold: false, italic: false, alignment: "left", letterSpacing: 0, lineSpacing: 2 }],
	multiline,
	selectable: false,
	bounds: { left: 0, top: 0, width, height: 40 },
});

describe("dynamic text with embedded fonts", () => {
	it("wraps multiline fields at the field's width, baselines from ascent, descent and leading", () => {
		// 5 px a character, 50 px inside the gutters: "aaaa bbbb" fits, "cccc" goes on
		const svg = serialize(textNode(field("aaaa bbbb cccc", 54, true), 2, fonts));
		expect(svg).toMatch(
			/<tspan x="0" y="8"><tspan font-family="'p_f2s-Test', 'Test', sans-serif"[^>]*>aaaa bbbb<\/tspan><\/tspan><tspan x="0" y="20"><tspan [^>]*>cccc<\/tspan>/,
		);
	});

	it("single-line fields don't wrap; without the font the old approximation stays", () => {
		expect(serialize(textNode(field("aaaa bbbb cccc", 54, false), 2, fonts))).not.toMatch(/y="20"/);
		const plain = serialize(textNode({ ...field("x", 54, true), runs: [{ ...field("x", 54, true).runs[0]!, face: "Other" }] }, 2, fonts));
		expect(plain).toMatch(/y="9"/);
		expect(plain).toMatch(/font-family="'Other', sans-serif"/);
	});
});
