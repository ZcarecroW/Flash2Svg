import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileScene } from "../../src/core/compile.ts";
import type { InstanceElement, Keyframe, Mat, SceneModel, TimelineData } from "../../src/core/model.ts";
import { buildPrograms, DEPTH_FOCAL, type InstanceItem } from "../../src/core/program.ts";
import { valueAt } from "../../src/core/tracks.ts";

const OPTS = { smooth: true, includeHiddenLayers: false, includeGuides: false };
const load = (name: string): SceneModel => JSON.parse(readFileSync(new URL(`../fixtures/models/${name}.json`, import.meta.url), "utf8"));
const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };

function instance(matrix: Mat): InstanceElement {
	return {
		kind: "instance",
		symbol: "sym:s",
		symbolType: "graphic",
		name: "",
		matrix,
		transformPoint: { x: 0, y: 0 },
		color: null,
		filters: [],
		blendMode: "normal",
		visible: true,
		cacheAsBitmap: false,
		bounds: { left: 0, top: 0, width: 10, height: 10 },
	} as unknown as InstanceElement;
}

/** A timeline of a layer with a keyframe per frame, one instance moving 10 px a frame. */
function frames(ik: boolean, n: number): SceneModel {
	const keyframes = Array.from({ length: n }, (_, index): Keyframe => ({ index, duration: 1, elements: [instance([1, 0, 0, 1, index * 10, 0])] }));
	const root: TimelineData = { id: "scene:0", name: "Scene 1", kind: "scene", frameCount: n, layers: [{ name: "l", type: "normal", visible: true, parent: -1, frameCount: n, keyframes, ...(ik ? { ik: true } : {}) }] };
	const sym: TimelineData = { id: "sym:s", name: "s", kind: "graphic", frameCount: 1, layers: [] };
	return { timelines: { "scene:0": root, "sym:s": sym }, roots: ["scene:0"], warnings: [], doc: { width: 100, height: 100 } } as unknown as SceneModel;
}

describe("armatures", () => {
	it("makes the frames of a pose layer one motion, as few keys as the path needs", () => {
		const it0 = buildPrograms(frames(true, 40), OPTS).programs["scene:0"]!.layers[0]!.items[0] as InstanceItem;
		expect(it0.transform.x.length).toBeLessThan(4);
		expect(valueAt(it0.transform.x, 25.5)).toBeCloseTo(255, 3);
		expect(it0.end).toBe(40);
	});

	it("keeps the steps of plain frame by frame animation, and of a pose layer when not smooth", () => {
		const plain = buildPrograms(frames(false, 40), OPTS).programs["scene:0"]!.layers[0]!.items[0] as InstanceItem;
		expect(plain.transform.x.length).toBe(40);
		expect(valueAt(plain.transform.x, 25.5)).toBeCloseTo(250, 3);
		const steps = buildPrograms(frames(true, 40), { ...OPTS, smooth: false }).programs["scene:0"]!.layers[0]!.items[0] as InstanceItem;
		expect(valueAt(steps.transform.x, 25.5)).toBeCloseTo(250, 3);
	});
});

describe("layer depth", () => {
	const scale = (z: number) => DEPTH_FOCAL / (DEPTH_FOCAL + z);

	it("draws each layer through its own view instead of one view for all", () => {
		const { programs } = buildPrograms(load("f62-depth2"), OPTS);
		const root = programs["scene:0"]!;
		expect(root.view).toBeUndefined();
		for (const l of root.layers) for (const it of l.items) expect(it.kind === "instance" && (it as InstanceItem).symbol.includes("#depth")).toBe(true);
	});

	it("scales about the stage's centre by the layer's depth minus the camera's", () => {
		const { programs } = buildPrograms(load("f62-depth2"), OPTS);
		const c = programs["scene:0"]!.layers.find((l) => l.name === "c")!.items[0] as InstanceItem;
		// c: depth 200, camera -100
		const s = scale(300);
		expect(valueAt(c.transform.sx, 5)).toBeCloseTo(s, 3);
		expect(valueAt(c.transform.x, 5)).toBeCloseTo(200 * (1 - s), 2);
		expect(valueAt(c.transform.y, 5)).toBeCloseTo(150 * (1 - s), 2);
	});

	it("stacks layers by depth: the farthest first, a layer that passes another changes place", () => {
		const { programs } = buildPrograms(load("f62-depth2"), OPTS);
		const root = programs["scene:0"]!;
		const shown = (f: number) => root.layers.filter((l) => l.items.some((i) => f >= i.start && f < i.end)).map((l) => l.name);
		// at the start a, b are nearer than c, whatever the timeline's order (c is on top of it)
		expect(shown(0)).toEqual(["c", "a", "b"]);
		// at the end a (depth 400) lies behind c (200)
		expect(shown(23)).toEqual(["a", "c", "b"]);
		// the layer that passes the other goes on as a second instance, in time with the first
		const copies = root.layers.filter((l) => l.name === "a" || l.name === "c").flatMap((l) => l.items as InstanceItem[]);
		expect(copies).toHaveLength(3);
		const [first, second] = copies.filter((i) => i.symbol === copies.find((c) => copies.filter((o) => o.symbol === c.symbol).length === 2)!.symbol).sort((x, y) => x.start - y.start);
		expect(first!.end).toBe(second!.start);
		expect(second!.graphic![0]!.firstFrame).toBe(second!.start);
	});

	it("leaves a camera without any depth to the one view", () => {
		const model = load("f62-depth2");
		const t = model.timelines["scene:0"]!;
		for (const l of t.layers) delete l.depth;
		for (const c of t.camera!) delete c.z;
		expect(buildPrograms(model, OPTS).programs["scene:0"]!.view).toBeDefined();
	});
});

describe("button hit areas", () => {
	const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

	it("draws the Hit frame invisibly over the states; it alone takes the pointer", () => {
		for (const format of ["smil", "css"] as const) {
			const svg = compileScene(load("f66-hit"), files, { format }).files[0]!.svg;
			// three buttons with states
			expect(count(svg, /class="f2s-btn"/g)).toBe(3);
			expect(count(svg, /class="f2s-hit" opacity="0"/g)).toBe(3);
			expect(svg).toMatch(/\.f2s-btn>g\{pointer-events:none\}/);
			expect(svg).toMatch(/\.f2s-btn>\.f2s-hit\{pointer-events:auto\}/);
		}
	});
});
