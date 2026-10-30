import { describe, expect, it } from "vitest";
import { bitmapScales } from "../../src/core/bitmap-scale.ts";
import type { ElementData, Keyframe, LayerData, Mat, SceneModel, TimelineData } from "../../src/core/model.ts";

const box = { left: 0, top: 0, width: 1, height: 1 };
const bitmap = (id: string, matrix: Mat): ElementData => ({ kind: "bitmap", bitmap: id, matrix, bounds: box });
const instance = (symbol: string, matrix: Mat, extra: object = {}): ElementData =>
	({ kind: "instance", symbol, symbolType: "movie clip", name: "", matrix, transformPoint: { x: 0, y: 0 }, color: null, filters: [], blendMode: "normal", visible: true, cacheAsBitmap: false, bounds: box, ...extra }) as ElementData;
const kf = (elements: ElementData[], extra: Partial<Keyframe> = {}): Keyframe => ({ index: 0, duration: 1, elements, ...extra });
const layer = (keyframes: Keyframe[], extra: Partial<LayerData> = {}): LayerData => ({ name: "l", type: "normal", visible: true, parent: -1, frameCount: 1, keyframes, ...extra });
const timeline = (id: string, layers: LayerData[], kind: TimelineData["kind"] = "movie clip"): TimelineData => ({ id, name: id, kind, frameCount: 1, layers });
const scale = (s: number, r = 0): Mat => [s * Math.cos(r), s * Math.sin(r), -s * Math.sin(r), s * Math.cos(r), 5, 7];

function model(timelines: TimelineData[], atlas: Record<string, string> = {}): { m: SceneModel; files: { readText(r: string): string; readBinary(): Uint8Array } } {
	const m = {
		roots: [timelines[0]!.id],
		timelines: Object.fromEntries(timelines.map((t) => [t.id, t])),
		atlas: Object.fromEntries(Object.keys(atlas).map((id) => [id, { file: `atlas/${id}.svg`, source: "" }])),
		bitmaps: {},
		sounds: {},
		warnings: [],
	} as unknown as SceneModel;
	return { m, files: { readText: (r) => atlas[r.replace(/^atlas\/|\.svg$/g, "")] ?? "", readBinary: () => new Uint8Array() } };
}

const near = (v: number | undefined, x: number) => expect(v).toBeCloseTo(x, 6);

describe("largest displayed size of bitmaps", () => {
	it("takes each axis of the bitmap's own matrix, through rotation", () => {
		const { m, files } = model([timeline("root", [layer([kf([bitmap("a", [0.5, 0, 0, 0.25, 0, 0]), bitmap("b", scale(0.3, 1.1))])])], "scene")]);
		const s = bitmapScales(m, files);
		near(s.get("a")?.x, 0.5);
		near(s.get("a")?.y, 0.25);
		near(s.get("b")?.x, 0.3);
		near(s.get("b")?.y, 0.3);
		expect(s.get("a")?.tiled).toBe(false);
	});

	it("multiplies through nested symbols and takes the largest of several places", () => {
		const { m, files } = model([
			timeline("root", [layer([kf([instance("clip", scale(0.5)), instance("clip", scale(0.2)), bitmap("a", scale(0.1))])])], "scene"),
			timeline("clip", [layer([kf([bitmap("a", scale(0.4)), instance("inner", [2, 0, 0, 0.5, 0, 0])])])]),
			timeline("inner", [layer([kf([bitmap("b", scale(1))])])]),
		]);
		const s = bitmapScales(m, files);
		near(s.get("a")?.x, 0.2); // 0.5 * 0.4 beats 0.1 directly
		// a non-uniform instance scale counts with its largest stretch for both axes (upper bound)
		near(s.get("b")?.x, 0.5 * 2);
		near(s.get("b")?.y, 0.5 * 2);
	});

	it("covers every frame of a tween, layer parenting and 3D", () => {
		const samples = [0.1, 0.3, 0.6, 0.2].map((v) => ({ matrix: scale(v), color: null }));
		const tween = { type: "classic", easing: 0, rotate: "none", rotateTimes: 0, orientToPath: false, scale: true, snap: false, sync: false, guided: false, samples } as Keyframe["tween"];
		const { m, files } = model([
			timeline(
				"root",
				[
					layer([kf([instance("clip", scale(0.1))], { tween, duration: 4 })]),
					layer([kf([bitmap("rigged", scale(0.5))])], { rig: [null, scale(0.5), scale(1.5)] }),
					layer([kf([instance("clip3d", scale(0.1), { is3D: true })])]),
				],
				"scene",
			),
			timeline("clip", [layer([kf([bitmap("a", scale(1))])])]),
			timeline("clip3d", [layer([kf([bitmap("deep", scale(1))])])]),
		]);
		const s = bitmapScales(m, files);
		near(s.get("a")?.x, 0.6);
		near(s.get("rigged")?.x, 0.75);
		expect(s.get("deep")?.x).toBe(Infinity);
	});

	it("leaves out guide layers and, when asked, hidden ones", () => {
		const { m, files } = model([
			timeline(
				"root",
				[
					layer([kf([bitmap("a", scale(0.2))])]),
					layer([kf([bitmap("a", scale(1)), bitmap("onGuide", scale(1))])], { type: "guide" }),
					layer([kf([bitmap("a", scale(0.5))])], { visible: false }),
				],
				"scene",
			),
		]);
		near(bitmapScales(m, files).get("a")?.x, 0.5);
		expect(bitmapScales(m, files).has("onGuide")).toBe(false);
		near(bitmapScales(m, files, { includeHiddenLayers: false }).get("a")?.x, 0.2);
		near(bitmapScales(m, files, { includeGuides: true }).get("a")?.x, 1);
	});

	it("magnifies by the camera's zoom (the view is the inverse of the camera)", () => {
		const cam = (z: number): Mat => [1 / z, 0, 0, 1 / z, 0, 0];
		const { m, files } = model([
			timeline("root", [layer([kf([instance("cam", cam(1)), instance("cam", cam(2.5))])], { type: "camera" }), layer([kf([bitmap("a", scale(0.2))])])], "scene"),
			timeline("cam", []),
		]);
		near(bitmapScales(m, files).get("a")?.x, 0.5);
	});

	it("reads bitmap fills from the drawing's patterns: clipped ones scale, repeating ones are tiles", () => {
		const svg = (fills: string) => `<svg><defs>
<image id="pattern_png" x="0" y="0" width="8" height="8" xlink:href="./images/pattern_png.png"/>
<image id="photo_jpg" x="0" y="0" width="240" height="160" xlink:href="./images/photo_jpg.jpg"/>
${fills}
<g id="F"><path fill="url(#P1)" d="M 0 0 L 10 10 Z"/></g></defs>
<g transform="matrix( 1, 0, 0, 1, 0,0) "><use xlink:href="#F"/></g></svg>`;
		const one = svg(`<pattern id="P1" patternUnits="userSpaceOnUse" patternTransform="matrix( 0.25, 0, 0, 0.5, 130,220) " width="240" height="160"><use xlink:href="#photo_jpg"/></pattern>
<pattern id="P2" patternUnits="userSpaceOnUse" patternTransform="matrix( 3, 0, 0, 3, 0,0) " width="8" height="8"><use xlink:href="#pattern_png"/></pattern>`);
		const shape = (atlas: string, fills: { bitmap: string; name: string; clipped: boolean }[]): ElementData => ({ kind: "shape", atlas, bitmapFills: fills, bounds: box });
		const fills = [
			{ bitmap: "photo", name: "photo.jpg", clipped: true },
			{ bitmap: "tile", name: "pattern.png", clipped: false },
		];
		const { m, files } = model(
			[timeline("root", [layer([kf([shape("s1", fills), shape("missing", [{ bitmap: "lost", name: "lost.png", clipped: true }])])])], "scene"), timeline("x", [])],
			{ s1: one, missing: svg("") },
		);
		const s = bitmapScales(m, files);
		near(s.get("photo")?.x, 0.25);
		near(s.get("photo")?.y, 0.5);
		expect(s.get("photo")?.tiled).toBe(false);
		expect(s.get("tile")).toMatchObject({ x: 3, y: 3, tiled: true });
		// a fill the drawing doesn't show as expected keeps its full size
		expect(s.get("lost")?.x).toBe(Infinity);
	});

	it("reads the fills of every frame of a shape tween", () => {
		const frame = (sx: number) =>
			`<svg><defs><image id="i" width="10" height="10" xlink:href="./images/a_png.png"/><pattern id="P" patternTransform="matrix(${sx},0,0,${sx},0,0)" width="10" height="10"><use xlink:href="#i"/></pattern></defs></svg>`;
		const fill = { bitmap: "a", name: "a.png", clipped: true };
		const tween = { type: "shape", easing: 0, rotate: "none", rotateTimes: 0, orientToPath: false, scale: true, snap: false, sync: false, guided: false, shapeFrames: ["f0", "f1", "f2"] } as Keyframe["tween"];
		const { m, files } = model([timeline("root", [layer([kf([{ kind: "shape", atlas: "f0", bitmapFills: [fill], bounds: box }], { tween, duration: 3 })])], "scene")], {
			f0: frame(0.1),
			f1: frame(0.7),
			f2: frame(0.3),
		});
		near(bitmapScales(m, files).get("a")?.x, 0.7);
	});
});
