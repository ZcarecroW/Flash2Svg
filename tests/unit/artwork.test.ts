import { describe, expect, it } from "vitest";
import { importArtwork } from "../../src/core/artwork.ts";
import { createContext } from "../../src/core/context.ts";
import { OutputDoc } from "../../src/core/emit/document.ts";
import type { SceneModel } from "../../src/core/model.ts";
import { serialize } from "../../src/core/xml.ts";

// What Animate's SVG export writes for a rectangle with a bitmap fill
const BITMAP_FILL = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="300" height="200"><defs>
<image id="pic_png" x="0" y="0" width="64" height="48" xlink:href="./images/pic_png.png"/>
<pattern id="Pattern_1" patternUnits="userSpaceOnUse" patternTransform="matrix( 0.5, 0, 0, 0.5, 10,10) " width="64" height="48"><use xlink:href="#pic_png"/></pattern>
<g id="Layer0_0_FILL"><path fill="url(#Pattern_1)" stroke="none" d="M 10 10 L 10 110 140 110 140 10 10 10 Z"/></g>
</defs><g><use xlink:href="#Layer0_0_FILL"/></g></svg>`;

const text = (a: ReturnType<typeof importArtwork>) => [...a.defs, a.body].map((n) => serialize(n)).join("");

describe("bitmap fills", () => {
	it("repeat: keeps the pattern and links the image to the model bitmap", () => {
		const a = importArtwork(BITMAP_FILL, "s1", { digits: 2, bitmapFills: [{ bitmap: "bmppic_png", name: "pic.png", clipped: false }] });
		const s = text(a);
		expect(s).toMatch(/<pattern/);
		expect(s).toMatch(/data-bitmap="bmppic_png"/);
		expect(s).not.toMatch(/images\/pic_png/);
	});

	it("clip: draws the bitmap once and stretches its edge pixels over the rest of the shape", () => {
		const a = importArtwork(BITMAP_FILL, "s1", { digits: 2, bitmapFills: [{ bitmap: "bmppic_png", name: "pic.png", clipped: true }] });
		const s = text(a);
		expect(s).not.toMatch(/<pattern/);
		expect(s).toMatch(/<clipPath/);
		// the shape (130x100) is bigger than the bitmap (32x24 at 0.5): right, bottom and their corner
		expect((s.match(/<svg /g) ?? []).length).toBe(3);
		expect(s).not.toMatch(/<svg x="-/); // nothing to extend on the left or top
	});

	it("resolves the image when the document is written (embedded or linked)", () => {
		const model = { doc: { width: 300, height: 200, frameRate: 24, backgroundColor: "#FFFFFF" }, roots: [], timelines: {}, atlas: {}, sounds: {}, warnings: [], bitmaps: { bmppic_png: { name: "pic.png", file: "bitmaps/bmppic_png.png", width: 64, height: 48, smoothing: false } } } as unknown as SceneModel;
		const ctx = createContext(model, { readText: () => "", readBinary: () => new Uint8Array([1, 2, 3]) }, { smooth: true, includeHiddenLayers: true, includeGuides: false, digits: 2 });
		const a = importArtwork(BITMAP_FILL, "s1", { digits: 2, bitmapFills: [{ bitmap: "bmppic_png", name: "pic.png", clipped: false }] });
		for (const embedImages of [true, false]) {
			const doc = new OutputDoc(ctx, { embedImages, idPrefix: "" });
			doc.artwork(a);
			const s = doc.defs.map((d) => serialize(d)).join("");
			expect(s).toMatch(embedImages ? /xlink:href="data:image\/png;base64,AQID"/ : /xlink:href="bitmaps\/bmppic_png.png"/);
			expect(s).toMatch(/image-rendering="pixelated"/);
			expect(s).not.toMatch(/data-bitmap/);
		}
		// the shared artwork itself is not changed
		expect(text(a)).toMatch(/data-bitmap/);
	});
});

describe("strokes", () => {
	it("draws strokes thinner than a pixel as 1 px hairlines, like Animate", () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#000" stroke-width="0.1" fill="none" d="M0 0L10 10"/><path stroke="#000" stroke-width="2" fill="none" d="M0 0L10 10"/></svg>`;
		const s = text(importArtwork(svg, "s1", { digits: 2 }));
		expect(s).toMatch(/stroke-width="1"[^>]*vector-effect="non-scaling-stroke"/);
		expect(s).toMatch(/stroke-width="2"/);
	});
});

describe("stroke and fill alpha", () => {
	const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#336699" fill-opacity="0.5019607843137255" stroke="#000000" stroke-opacity="1" stroke-width="3" d="M0 0L10 0 10 10Z"/></svg>`;

	it("moves alpha into the colour, so the shape can inherit its instance's alpha", () => {
		const s = text(importArtwork(SVG, "s1", { digits: 2 }));
		expect(s).toMatch(/fill="#33669980"/);
		expect(s).toMatch(/stroke="#000000"/);
		expect(s).not.toMatch(/-opacity/);
	});

	it("keeps strokes with scale 'none' at their width", () => {
		expect(text(importArtwork(SVG, "s1", { digits: 2, fixedStrokes: new Set(["#000000|3"]) }))).toMatch(/vector-effect="non-scaling-stroke"/);
		expect(text(importArtwork(SVG, "s1", { digits: 2, fixedStrokes: new Set(["#000000|2"]) }))).not.toMatch(/vector-effect/);
	});
});
