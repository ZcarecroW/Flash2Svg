// Timelines as SMIL, CSS and the player write them: what the playhead does (stops, loops, clips that
// play once), and what the baked tracks say at every tick. Small documents made here.
import { describe, expect, it } from "vitest";
import { compileScene } from "../../src/core/compile.ts";
import { createContext } from "../../src/core/context.ts";
import { bake, trackValueAt } from "../../src/core/emit/bake.ts";
import type { InstanceElement, Keyframe, Mat, SceneModel, ShapeElement, TimelineData } from "../../src/core/model.ts";
import { fitCurve, valueAt, type Track } from "../../src/core/tracks.ts";

const files = {
	readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#336699" d="M0 0L5 0 5 5 0 5Z"/></svg>`,
	readBinary: () => new Uint8Array(),
};
const shape = (atlas = "a1"): ShapeElement => ({ kind: "shape", atlas, bounds: { left: 0, top: 0, width: 5, height: 5 } });
const inst = (symbol: string, o: Partial<InstanceElement> = {}): InstanceElement => ({
	kind: "instance",
	symbol,
	symbolType: "movie clip",
	name: "",
	matrix: [1, 0, 0, 1, 0, 0] as Mat,
	transformPoint: { x: 0, y: 0 },
	color: null,
	filters: [],
	blendMode: "normal",
	visible: true,
	cacheAsBitmap: false,
	bounds: { left: 0, top: 0, width: 5, height: 5 },
	...o,
});
const kf = (index: number, duration: number, elements: Keyframe["elements"], o: Partial<Keyframe> = {}): Keyframe => ({ index, duration, elements, ...o });
const tl = (id: string, kind: TimelineData["kind"], frameCount: number, layers: Keyframe[][]): TimelineData => ({
	id,
	name: id,
	kind,
	frameCount,
	layers: layers.map((keyframes, i) => ({ name: "L" + i, type: "normal", visible: true, parent: -1, frameCount, keyframes })),
});
function model(timelines: TimelineData[]): SceneModel {
	const atlas: SceneModel["atlas"] = {};
	for (const t of timelines)
		for (const l of t.layers)
			for (const k of l.keyframes)
				for (const e of k.elements) if (e.kind === "shape" && e.atlas) atlas[e.atlas] = { file: e.atlas + ".svg", source: "x" } as SceneModel["atlas"][string];
	return {
		version: 1,
		app: { version: "24", platform: "win" },
		doc: { name: "doc", type: "Flash", width: 100, height: 100, frameRate: 24, backgroundColor: "#ffffff" },
		roots: [timelines[0]!.id],
		timelines: Object.fromEntries(timelines.map((t) => [t.id, t])),
		atlas,
		bitmaps: {},
		sounds: {},
		warnings: [],
	} as SceneModel;
}
const tween = (o: object = {}) =>
	({
		type: "classic",
		easing: 0,
		rotate: "auto",
		rotateTimes: 0,
		orientToPath: false,
		scale: true,
		snap: false,
		sync: false,
		guided: false,
		...o,
	}) as unknown as Keyframe["tween"];
const box = tl("box", "graphic", 1, [[kf(0, 1, [shape("a1")])]]);
const g = (x: number) => inst("box", { symbolType: "graphic", matrix: [1, 0, 0, 1, x, 0] });
/** Animate's samples of a straight move from x0 towards x1 over n frames. */
const lin = (x0: number, x1: number, n: number) => Array.from({ length: n }, (_, i) => ({ matrix: [1, 0, 0, 1, x0 + ((x1 - x0) * i) / n, 0], color: null }));
/** The animated part of a SMIL or CSS file (without the still copy for "reduce motion"). */
const moving = (svg: string) => svg.replace(/<g class="f2s-still".*$/s, "");
/** A clip drawn frame by frame: `n` frames, each its own drawing. */
const flipbook = (id: string, n: number, script?: string) =>
	tl(id, "movie clip", n, [Array.from({ length: n }, (_, i) => kf(i, 1, [shape(`${id}${i}`)], i === n - 1 && script ? { script } : {}))]);

describe("a wait between two tweens", () => {
	// tween in (frames 1-10: x 0 to 100), wait (11-30), tween out (31-40: 100 to 200)
	const root = tl("root", "scene", 48, [
		[
			kf(0, 10, [g(0)], { tween: tween({ samples: lin(0, 100, 10) }) }),
			kf(10, 20, [g(100)]),
			kf(30, 10, [g(100)], { tween: tween({ samples: lin(100, 200, 10) }) }),
			kf(40, 8, [g(200)]),
		],
	]);
	const m = model([root, box]);

	it("stays a wait in the baked track (the second tween doesn't start where the first ended)", () => {
		const ctx = createContext(structuredClone(m), files, { smooth: true, includeHiddenLayers: true, includeGuides: false });
		const node = bake(ctx, "root", { smooth: true, loop: "auto" }).root.layers[0]!.nodes[0] as unknown as { transform: { x: Track } };
		for (const [tick, x] of [
			[5, 50],
			[10, 100],
			[20, 100],
			[30, 100],
			[35, 150],
			[40, 200],
		] as const)
			expect(trackValueAt(node.transform.x, tick), `tick ${tick}`).toBeCloseTo(x, 3);
	});

	it("is written as one in SMIL and Lottie", () => {
		const smil = moving(compileScene(structuredClone(m), files, { format: "smil" }).files[0]!.svg);
		// two keys at 100: where the wait begins and (just before) where it ends
		expect(smil).toMatch(/values="0 0;100 0;100 0;100 0;200 0;200 0" keyTimes="0;\.208333;\.6247\d*;\.625;\.833333;1"/);
		const lottie = compileScene(structuredClone(m), files, { format: "lottie" }).files[0]!.svg;
		const keys = [...(lottie.match(/"p":\{"a":1,"k":\[.*?\]\}\]/)?.[0] ?? "").matchAll(/"t":([\d.]+)/g)].map((x) => +x[1]!);
		expect(keys).toEqual([0, 10, 30, 40]);
	});
});

describe("where the playhead stops", () => {
	it("a tween arrives and stays: it doesn't move on towards the next frame and jump back", () => {
		// a clip: x 0 to 90 over frames 1-10, stop() on frame 10, where a second tween would go on to 190
		const clip = tl("clip", "movie clip", 20, [
			[
				kf(0, 9, [g(0)], { tween: tween({ samples: lin(0, 90, 9) }) }),
				kf(9, 10, [g(90)], { tween: tween({ samples: lin(90, 190, 10) }), script: "stop();" }),
				kf(19, 1, [g(190)]),
			],
		]);
		const m = model([tl("root", "scene", 30, [[kf(0, 30, [inst("clip")])]]), clip, box]);
		const ctx = createContext(structuredClone(m), files, { smooth: true, includeHiddenLayers: true, includeGuides: false });
		const clipNode = bake(ctx, "root", { smooth: true, loop: "auto" }).root.layers[0]!.nodes[0] as unknown as {
			child: { layers: { nodes: { transform: { x: Track } }[] }[] };
		};
		const x = clipNode.child.layers[0]!.nodes[0]!.transform.x;
		for (const t of [9, 9.5, 9.99, 10, 20]) expect(trackValueAt(x, t), `tick ${t}`).toBeCloseTo(90, 3);
		const smil = moving(compileScene(structuredClone(m), files, { format: "smil" }).files[0]!.svg);
		expect(smil).not.toContain("100 0");
	});
});

describe("movie clips on a root that loops", () => {
	it("a clip that stops plays once on a one-frame root (it was a still picture of its first frame)", () => {
		const m = model([tl("root", "scene", 1, [[kf(0, 1, [inst("clip")])]]), flipbook("clip", 5, "stop();")]);
		for (const format of ["smil", "css"] as const) {
			const out = compileScene(structuredClone(m), files, { format });
			expect(out.stats.frames, format).toBe(5);
			expect(out.stats.loopFrom, format).toBeUndefined();
			// played once, the last frame holds
			expect(moving(out.files[0]!.svg), format).toMatch(format === "smil" ? /fill="freeze"/ : / both[;}]/);
			expect(out.files[0]!.svg, format).not.toMatch(/repeatCount="indefinite"| infinite/);
		}
	});

	it("a clip with an intro plays it once, then its loop repeats", () => {
		// 5 frames, the last one jumps back to frame 3: frames 1-2 once, then 3 and 4 go round (5 isn't shown)
		const m = model([tl("root", "scene", 1, [[kf(0, 1, [inst("clip")])]]), flipbook("clip", 5, "gotoAndPlay(3);")]);
		const out = compileScene(structuredClone(m), files, { format: "smil" });
		expect([out.stats.frames, out.stats.loopFrom]).toEqual([4, 2]);
		// back to frame 4: a loop of that one frame, which is a stop on it — shown, then it holds
		const held = model([tl("root", "scene", 1, [[kf(0, 1, [inst("clip")])]]), flipbook("clip", 5, "gotoAndPlay(4);")]);
		const once = compileScene(held, files, { format: "smil" });
		expect([once.stats.frames, once.stats.loopFrom]).toEqual([4, undefined]);
	});

	it("starts everything again with Always loop", () => {
		const m = model([tl("root", "scene", 1, [[kf(0, 1, [inst("clip")])]]), flipbook("clip", 5, "stop();")]);
		const out = compileScene(structuredClone(m), files, { format: "smil", loop: "always" });
		expect(out.stats.loopFrom).toBeUndefined();
	});

	it("counts a clip that lives through the loop, not only one on every frame of the timeline", () => {
		// 3 frames once, then frames 4-12 go round (frame 13 jumps back): a 7-frame clip on frames 4-13
		const root = tl("root", "scene", 13, [
			[kf(0, 3, []), kf(3, 10, [inst("spin")])],
			[kf(0, 12, [shape("r")]), kf(12, 1, [shape("r")], { script: "gotoAndPlay(4);" })],
		]);
		const out = compileScene(model([root, flipbook("spin", 7)]), files, { format: "smil" });
		// the loop of 9 and the clip of 7 come round together after 63 ticks
		expect(out.stats.loopFrom).toBe(3);
		expect(out.stats.frames).toBe(66);
	});
});

describe("movie clips on a root that stops", () => {
	const spinner = flipbook("spin", 8);
	const stopped = (content: InstanceElement) =>
		tl("root", "scene", 5, [[kf(0, 5, [content])], [kf(0, 4, [shape("r")]), kf(4, 1, [shape("r")], { script: "stop();" })]]);

	it("run on inside a one-frame clip and inside a graphic, as directly on the root", () => {
		const direct = compileScene(model([stopped(inst("spin")), spinner]), files, { format: "smil" });
		expect([direct.stats.frames, direct.stats.loopFrom]).toEqual([13, 5]);
		const holder = tl("holder", "movie clip", 1, [[kf(0, 1, [inst("spin")])]]);
		const inClip = compileScene(model([stopped(inst("holder")), holder, spinner]), files, { format: "smil" });
		expect([inClip.stats.frames, inClip.stats.loopFrom]).toEqual([13, 5]);
		const graphic = tl("pic", "graphic", 1, [[kf(0, 1, [inst("spin")])]]);
		const inGraphic = compileScene(model([stopped(inst("pic", { symbolType: "graphic" })), graphic, spinner]), files, { format: "css" });
		expect([inGraphic.stats.frames, inGraphic.stats.loopFrom]).toEqual([13, 5]);
	});
});

describe("clips of different lengths on one frame", () => {
	it("write their frames once, repeating on their own (not unrolled over the common horizon)", () => {
		// 24, 25 and 26 frames come round together after 7800 ticks
		const root = tl("root", "scene", 1, [[kf(0, 1, [inst("a")])], [kf(0, 1, [inst("b")])], [kf(0, 1, [inst("c")])]]);
		const m = model([root, flipbook("a", 24), flipbook("b", 25), flipbook("c", 26)]);
		const smil = compileScene(structuredClone(m), files, { format: "smil" });
		expect(smil.stats.frames).toBe(7800);
		expect(smil.files[0]!.svg.length).toBeLessThan(40000);
		expect(smil.files[0]!.svg).toContain(
			'<animate attributeName="display" values="inline;none" keyTimes="0;.04" calcMode="discrete" dur="1.0416667s" repeatCount="indefinite"/>',
		);
		const css = compileScene(structuredClone(m), files, { format: "css" });
		expect(css.files[0]!.svg.length).toBeLessThan(40000);
	});
});

describe("a tween cut short", () => {
	it("keeps its splines inside 0..1 (SVG takes nothing else)", () => {
		// a custom ease that nearly pauses in the middle, in a graphic of 21 frames shown for 15
		const N = 20;
		const ease = [
			{ x: 0, y: 0 },
			{ x: 1 / 3, y: 0.9 },
			{ x: 2 / 3, y: 0.1 },
			{ x: 1, y: 1 },
		];
		const at = (u: number) => {
			// (the curve's value at time u, by halving on its x)
			let lo = 0,
				hi = 1;
			for (let i = 0; i < 40; i++) {
				const s = (lo + hi) / 2;
				const x = 3 * (1 - s) ** 2 * s * (1 / 3) + 3 * (1 - s) * s ** 2 * (2 / 3) + s ** 3;
				if (x < u) lo = s;
				else hi = s;
			}
			const s = (lo + hi) / 2;
			return 3 * (1 - s) ** 2 * s * 0.9 + 3 * (1 - s) * s ** 2 * 0.1 + s ** 3;
		};
		const samples = Array.from({ length: N }, (_, i) => ({ matrix: [1, 0, 0, 1, 100 * at(i / N), 0], color: null }));
		const sym = tl("sym", "graphic", N + 1, [[kf(0, N, [g(0)], { tween: tween({ customEase: { all: ease }, samples }) }), kf(N, 1, [g(100)])]]);
		const root = tl("root", "scene", 15, [[kf(0, 15, [inst("sym", { symbolType: "graphic" })])]]);
		const smil = moving(compileScene(model([root, sym, box]), files, { format: "smil" }).files[0]!.svg);
		const splines = [...smil.matchAll(/keySplines="([^"]*)"/g)].flatMap((x) => x[1]!.split(/[ ;]/).map(Number));
		expect(splines.length).toBeGreaterThan(0);
		for (const v of splines) {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});
});

describe("still frames", () => {
	it("age a clip inside a graphic that shows one frame, or comes round", () => {
		// a 5-frame clip in a one-frame graphic, on a root of 10 frames
		const pic = tl("pic", "graphic", 1, [[kf(0, 1, [inst("clip")])]]);
		const root = tl("root", "scene", 10, [[kf(0, 10, [inst("pic", { symbolType: "graphic" })])]]);
		const m = model([root, pic, flipbook("clip", 5)]);
		const drawn = (frame: number) => {
			const out = compileScene(
				structuredClone(m),
				{ ...files, readText: (rel: string) => `<svg xmlns="http://www.w3.org/2000/svg"><path id="${rel}" d="M0 0H5V5H0z"/></svg>` },
				{ format: "static", frames: [frame] },
			);
			return /id="[^"]*clip_(\d)"/.exec(out.files[0]!.svg)?.[1];
		};
		// the clip's frame (0-based) in the symbol's name: its age on that root frame, round its 5 frames
		expect([drawn(0), drawn(3), drawn(7)]).toEqual(["0", "3", "2"]);
	});
});

describe("the JS player", () => {
	const looped = () => {
		// 12 frames, the last one jumps back to the first: it is never shown
		const m = model([tl("root", "scene", 12, [[kf(0, 11, [shape("r")]), kf(11, 1, [shape("r")], { script: "gotoAndPlay(1);" })]])]);
		return m;
	};
	const program = (svg: string) =>
		JSON.parse(/<script type="application\/json">(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/script>/s.exec(svg)![1]!) as {
			on?: number;
			tl: Record<string, { ac?: object }>;
		};

	it("says how long a pass is when the last frame is never shown (play once would wait for it for ever)", () => {
		const P = program(compileScene(looped(), files, { format: "player", loop: "never" }).files[0]!.svg);
		expect(P.on).toBe(11);
	});

	it("leaves the root's stop() and gotos out with Always loop", () => {
		const m = model([tl("root", "scene", 12, [[kf(0, 11, [shape("r")]), kf(11, 1, [shape("r")], { script: "stop();" })]])]);
		expect(program(compileScene(structuredClone(m), files, { format: "player" }).files[0]!.svg).tl.root!.ac).toBeDefined();
		expect(program(compileScene(structuredClone(m), files, { format: "player", loop: "always" }).files[0]!.svg).tl.root!.ac).toBeUndefined();
	});

	it("says that it plays the whole timeline when a frame range is asked for", () => {
		const out = compileScene(looped(), files, { format: "player", startFrame: 2, endFrame: 6 });
		expect(out.warnings.join("\n")).toContain("The JS player plays the whole timeline");
	});
});

describe("tracks", () => {
	it("fit a value that leaves and comes back by a twip (the ease was NaN)", () => {
		for (const vals of [
			[10, 10.05, 10],
			[10, 10.05, 10.05, 10],
			[0.1, 0.15000000000000002, 0.1],
		]) {
			const track = fitCurve(vals, 0, 0.05);
			expect(JSON.stringify(track)).not.toContain("null");
			vals.forEach((v, i) => expect(Math.abs(valueAt(track, i) - v), `${vals} at ${i}`).toBeLessThanOrEqual(0.05 + 1e-9));
		}
	});

	it("find the value at a time by halving, as a scan from the start did", () => {
		const track: Track = [
			{ t: 0, v: 0, ease: "linear" },
			{ t: 4, v: 8, ease: "hold" },
			{ t: 6, v: 1, ease: "linear" },
			// (a jump: two keys at one time, the later one counts from there on)
			{ t: 6, v: 20, ease: [0.42, 0, 0.58, 1] },
			{ t: 10, v: 30, ease: "hold" },
		];
		expect(valueAt(track, -1)).toBe(0);
		expect(valueAt(track, 2)).toBe(4);
		expect(valueAt(track, 4)).toBe(8);
		expect(valueAt(track, 5.9)).toBe(8);
		expect(valueAt(track, 6)).toBe(20);
		expect(valueAt(track, 8)).toBeCloseTo(25, 6);
		expect(valueAt(track, 10)).toBe(30);
		expect(valueAt(track, 99)).toBe(30);
		expect(valueAt([], 3)).toBe(0);
	});
});
