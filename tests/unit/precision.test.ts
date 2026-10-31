import { describe, expect, it } from "vitest";
import { compileScene } from "../../src/core/compile.ts";
import type { InstanceElement, SceneModel, TimelineData } from "../../src/core/model.ts";
import { decimalsFor, measurePrecision } from "../../src/core/precision.ts";
import { buildPrograms, type InstanceItem } from "../../src/core/program.ts";

const box = { left: 0, top: 0, width: 100, height: 100 };
const symbol = (id: string, atlas: string): TimelineData => ({
	id,
	name: id,
	kind: "graphic",
	frameCount: 1,
	layers: [
		{
			name: "art",
			type: "normal",
			visible: true,
			parent: -1,
			frameCount: 1,
			keyframes: [{ index: 0, duration: 1, elements: [{ kind: "shape", atlas, bounds: box }] }],
		},
	],
});
const instance = (symbol: string, s: number, x: number): InstanceElement => ({
	kind: "instance",
	symbol,
	symbolType: "graphic",
	name: "",
	matrix: [s, 0, 0, s, x, 10],
	transformPoint: { x: 0, y: 0 },
	color: null,
	filters: [],
	blendMode: "normal",
	visible: true,
	cacheAsBitmap: false,
	bounds: { left: x, top: 10, width: 100 * s, height: 100 * s },
});

/** A scene showing one drawing at a tenth of its size and another 8 times larger. */
function scene(): SceneModel {
	return {
		doc: { name: "p.fla", type: "Flash", width: 400, height: 300, frameRate: 24, backgroundColor: "#FFFFFF" },
		roots: ["scene:0"],
		timelines: {
			"scene:0": {
				id: "scene:0",
				name: "Scene 1",
				kind: "scene",
				frameCount: 1,
				layers: [
					{
						name: "l",
						type: "normal",
						visible: true,
						parent: -1,
						frameCount: 1,
						keyframes: [{ index: 0, duration: 1, elements: [instance("sym:small", 0.1, 5), instance("sym:big", 8, 50)] }],
					},
				],
			},
			"sym:small": symbol("sym:small", "a1"),
			"sym:big": symbol("sym:big", "a2"),
		},
		atlas: { a1: { file: "a1.svg", source: "sym:small layer 0 frame 0" }, a2: { file: "a2.svg", source: "sym:big layer 0 frame 0" } },
		bitmaps: {},
		sounds: {},
		warnings: [],
	} as unknown as SceneModel;
}

// the same drawing in both symbols, with more decimals than either needs
const files = {
	readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#f00" d="M 10.1234 20.4567 L 30.7891 40.9876 L 12.3456 45.6789 Z"/></svg>`,
	readBinary: () => new Uint8Array(),
};

describe("precision from the displayed size", () => {
	it("rounds decimals on the log scale", () => {
		expect(decimalsFor(2, 1)).toBe(2);
		expect(decimalsFor(2, 3)).toBe(2);
		expect(decimalsFor(2, 0.1)).toBe(1);
		expect(decimalsFor(2, 8)).toBe(3);
		expect(decimalsFor(2, 0.001)).toBe(0);
		expect(decimalsFor(2, Number.NaN)).toBe(2);
	});

	it("draws a drawing shown smaller with fewer decimals, one shown larger with more", () => {
		const svg = compileScene(scene(), files, { format: "static", digits: 2 }).files[0]!.svg;
		const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);
		// the small symbol's copy: 1 decimal; the big one's: 3 (identical drawings are not merged then)
		expect(paths).toContain("M10.1 20.5L30.8 41L12.3 45.7Z");
		expect(paths).toContain("M10.123 20.457L30.789 40.988L12.346 45.679Z");
	});

	it("writes the positions of a shrunk symbol's children with fewer decimals", () => {
		const m = scene();
		// a child inside the small symbol, at a position with many decimals
		m.timelines["sym:small"]!.layers[0]!.keyframes[0]!.elements.push(instance("sym:big", 1, 12.3456));
		const svg = compileScene(m, files, { format: "static", digits: 2 }).files[0]!.svg;
		// in the small symbol's space (shown at 0.1): 1 decimal
		expect(svg).toMatch(/translate\(12\.3 10\)/);
	});

	it("gives angles and scale factors as many decimals as their content spans, at least 3 and 4", () => {
		const m = scene();
		const { programs } = buildPrograms(m, { smooth: true, includeHiddenLayers: true, includeGuides: false });
		const p = measurePrecision(m, programs, 2);
		const [small, big] = programs["scene:0"]!.layers.flatMap((l) => l.items) as InstanceItem[];
		// the small one turns 14 px of content (a tenth of 141): still 3 and 4
		expect(p.instance(small!, "scene:0")).toMatchObject({ x: 2, rot: 3, sx: 4 });
		// the big one: 8 times 141 px (20 px per degree, 141 px per unit of scale)
		expect(p.instance(big!, "scene:0")).toMatchObject({ x: 2, rot: 3, sx: 4 });
		// the same placed inside the big symbol (shown 8 times larger): positions and scale factors need more
		expect(p.instance({ ...big!, transform: { ...big!.transform } }, "sym:big")).toMatchObject({ x: 3, sx: 5 });
	});

	it("reuses an identical drawing only when it is imported the same way", () => {
		// both symbols shown at 1:1; the second one's stroke keeps its width (scale "none")
		const m = scene();
		const stroked = {
			readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#003366" stroke-width="3" fill="none" d="M 1 2 L 3 4"/></svg>`,
			readBinary: () => new Uint8Array(),
		};
		const [a, b] = m.timelines["scene:0"]!.layers[0]!.keyframes[0]!.elements as InstanceElement[];
		a!.matrix = [1, 0, 0, 1, 5, 10];
		b!.matrix = [1, 0, 0, 1, 50, 10];
		(m.timelines["sym:big"]!.layers[0]!.keyframes[0]!.elements[0] as { fixedStrokes?: string[] }).fixedStrokes = ["#003366|3"];
		const svg = compileScene(m, stroked, { format: "static" }).files[0]!.svg;
		expect(svg.match(/<path /g)).toHaveLength(2);
		expect(svg.match(/vector-effect="non-scaling-stroke"/g)).toHaveLength(1);
	});
});
