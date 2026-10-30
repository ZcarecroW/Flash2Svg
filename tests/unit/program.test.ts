import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compose, decompose } from "../../src/core/geom.ts";
import type { InstanceElement, Mat, SceneModel } from "../../src/core/model.ts";
import { buildPrograms, fromProps, markShapeAlpha, parseActions, toProps, TRANSFORM_PROPS, type InstanceItem } from "../../src/core/program.ts";
import { valueAt } from "../../src/core/tracks.ts";
import { playhead } from "../../src/core/emit/timing.ts";
import type { Program } from "../../src/core/program.ts";

function model(name: string): SceneModel {
	return JSON.parse(readFileSync(new URL(`../fixtures/models/${name}.json`, import.meta.url), "utf8"));
}

function matAt(item: InstanceItem, t: number): Mat {
	const p = {} as Record<(typeof TRANSFORM_PROPS)[number], number>;
	for (const k of TRANSFORM_PROPS) p[k] = valueAt(item.transform[k], t);
	return fromProps(p);
}

function close(a: Mat, b: Mat) {
	// linear part to 0.004, translation to 0.15px (Animate rounds to twips)
	for (let i = 0; i < 4; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.004);
	for (let i = 4; i < 6; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.15);
}

describe("matrix props", () => {
	it("round-trips through toProps/fromProps, including skew and flips", () => {
		const cases: Mat[] = [
			[1, 0, 0, 1, 10, 20],
			[0.866, 0.5, -0.5, 0.866, 3, 4],
			[1.131332, 1.131332, -0.42424, 0.42424, 419.95, 349.85],
			[-1, 0, 0, 1, 0, 0],
			[1, 0, 0, -2, 5, 5],
			[0.985794, 0.167908, -0.48201, 0.874542, 292.6, 240],
		];
		for (const m of cases) {
			const tp = { x: 3, y: -7 };
			close(fromProps(toProps(m, tp)), m);
			close(compose(decompose(m, tp), tp), m);
		}
	});
});

describe("programs reproduce Animate's tweens frame by frame", () => {
	for (const name of ["f02-eases", "f03-transforms", "f06-motionobject", "f09-guide", "f10-canvas"]) {
		it(name, () => {
			const m = model(name);
			const { programs } = buildPrograms(m, { smooth: true, includeHiddenLayers: true, includeGuides: false });
			const root = m.timelines[m.roots[0]!]!;
			const prog = programs[root.id]!;
			let checked = 0;
			for (const layer of root.layers) {
				const pl = prog.layers.find((l) => l.name === layer.name);
				if (!pl) continue;
				for (const kf of layer.keyframes) {
					const el = kf.elements[0];
					if (!el || el.kind !== "instance") continue;
					const item = pl.items.find((i) => i.kind === "instance" && i.start <= kf.index && i.end > kf.index) as InstanceItem;
					expect(item).toBeDefined();
					const samples = kf.tween?.samples;
					for (let f = 0; f < kf.duration && kf.index + f < root.frameCount; f++) {
						const expected = samples?.[f]?.matrix ?? (el as InstanceElement).matrix;
						close(matAt(item, kf.index + f), expected);
						checked++;
					}
				}
			}
			expect(checked).toBeGreaterThan(20);
		});
	}

	it("uses exact ease pieces (few keys) for classic eased tweens", () => {
		const m = model("f02-eases");
		const { programs } = buildPrograms(m, { smooth: true, includeHiddenLayers: true, includeGuides: false });
		const prog = programs[m.roots[0]!]!;
		const keysOf = (layer: string) => {
			const item = prog.layers.find((l) => l.name === layer)!.items[0] as InstanceItem;
			return item.transform.x.length;
		};
		expect(keysOf("linear")).toBeLessThanOrEqual(3);
		expect(keysOf("easeIn")).toBeLessThanOrEqual(3);
		expect(keysOf("ease50")).toBeLessThanOrEqual(3);
		expect(keysOf("customOvershoot")).toBeLessThanOrEqual(8);
		expect(keysOf("perProperty")).toBeLessThanOrEqual(6);
	});
});

describe("frame actions", () => {
	it("parses AS3 and canvas scripts", () => {
		expect(parseActions("stop();")).toEqual([{ type: "stop" }]);
		expect(parseActions("this.stop();")).toEqual([{ type: "stop" }]);
		expect(parseActions('this.gotoAndPlay("intro"); // stop()')).toEqual([{ type: "goto", target: "intro", play: true }]);
		expect(parseActions("gotoAndStop(5);")).toEqual([{ type: "goto", target: 5, play: false }]);
		expect(parseActions("myClip.stop();")).toEqual([]);
	});

	it("reads labels with commas and brackets, and leaves out jumps into other scenes", () => {
		expect(parseActions('gotoAndPlay("a, (b)");')).toEqual([{ type: "goto", target: "a, (b)", play: true }]);
		const warnings: string[] = [];
		const warn = (m: string) => warnings.push(m);
		expect(parseActions('gotoAndPlay(1, "Scene 2");', { scene: "Scene 1", warn })).toEqual([]);
		expect(warnings[0]).toMatch(/Scene 2/);
		expect(parseActions("gotoAndStop(3, 'Scene 1');", { scene: "Scene 1", warn })).toEqual([{ type: "goto", target: 3, play: false }]);
	});
});

describe("frame actions: conditions", () => {
	const pass = (script: string, zeroBased = false) => parseActions(script, { zeroBased });

	it("counts HTML5 Canvas frame numbers from 0", () => {
		expect(pass("this.gotoAndPlay(0);", true)).toEqual([{ type: "goto", target: 1, play: true }]);
		expect(pass("gotoAndPlay(1);")).toEqual([{ type: "goto", target: 1, play: true }]);
	});

	it("understands the 'play N times' banner idioms", () => {
		// CreateJS (Animate's HTML5 banner snippet)
		expect(pass("if (!this.looped) this.looped = 1;\nif (this.looped++ == 3) this.stop();", true)).toEqual([{ type: "stop", passes: { from: 3, before: 4 } }]);
		expect(pass("this.loops = (this.loops || 0) + 1;\nif (this.loops >= 3) { this.stop(); }", true)).toEqual([{ type: "stop", passes: { from: 3, before: 0 } }]);
		// AS3
		expect(pass("var loops:int; loops++;\nif (loops == 2) stop();")).toEqual([{ type: "stop", passes: { from: 2, before: 3 } }]);
		// if / else with a goto
		expect(pass("if (!this.n) this.n = 1; else this.n++;\nif (this.n < 3) { this.gotoAndPlay(0); } else { this.stop(); }", true)).toEqual([
			{ type: "goto", target: 1, play: true, passes: { from: 0, before: 3 } },
			{ type: "stop", passes: { from: 3, before: 0 } },
		]);
		expect(pass("count++; if (count < 3) gotoAndPlay(1); else stop();")).toEqual([
			{ type: "goto", target: 1, play: true, passes: { from: 0, before: 3 } },
			{ type: "stop", passes: { from: 3, before: 0 } },
		]);
	});

	it("runs other conditional actions always, with a warning", () => {
		const warnings: string[] = [];
		expect(parseActions("if (this.paused) this.stop();", { warn: (m) => warnings.push(m) })).toEqual([{ type: "stop" }]);
		expect(warnings.length).toBe(1);
		expect(parseActions("stop(); if (x) { y(); }", { warn: (m) => warnings.push(m) })).toEqual([{ type: "stop" }]);
		expect(warnings.length).toBe(1);
	});

	it("simulates passes: the frame with a goto is not shown, the stop comes on the third pass", () => {
		const prog = { frameCount: 4, labels: [], actions: { 3: pass("if (!this.n) this.n = 1; else this.n++;\nif (this.n < 3) this.gotoAndPlay(0); else this.stop();", true) } } as unknown as Program;
		const p = playhead(prog);
		expect(p.cycle).toEqual([]);
		expect(p.prefix).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 3]);
	});
});

describe("alpha / erase blends", () => {
	// f32: "shared" (shapes and an erase box in one layer) is placed with and without the
	// "layer" blend; "faded" has an alpha gradient on its own layer
	const { programs } = buildPrograms(model("f32-blend2"), { smooth: true, includeHiddenLayers: true, includeGuides: false });
	const root = programs["scene:0"]!;
	const uses = root.layers.flatMap((l) => l.items).filter((it): it is InstanceItem => it.kind === "instance" && it.symbol.startsWith("sym:shared"));

	it("cuts only inside instances placed with the layer blend", () => {
		expect(uses.map((u) => `${u.blendMode} ${u.symbol}`).sort()).toEqual(["layer sym:shared#layer", "normal sym:shared"]);
		// the plain symbol keeps the erase element (not drawn); the copy masks what is below it
		expect(programs["sym:shared"]!.layers.every((l) => l.type !== "mask")).toBe(true);
		const cut = programs["sym:shared#layer"]!.layers;
		// (raw shapes of a layer always lie below its instances: nothing stays above the cut here)
		expect(cut.map((l) => l.type)).toEqual(["normal", "mask"]);
		expect(cut[1]!.maskMode).toBe("erase");
		expect(cut[0]!.maskedBy).toBe(cut[1]!.index);
	});

	it("limits alpha to the element's bounds", () => {
		const layers = programs["sym:faded"]!.layers;
		const mask = layers.find((l) => l.type === "mask")!;
		expect(mask.maskMode).toBe("alpha");
		expect(mask.maskBox).toBeDefined();
	});
});

describe("instance alpha", () => {
	const track = (v: number) => [{ t: 0, v, ease: "hold" as const }];
	const color = (a: number) => ({ rP: track(100), gP: track(100), bP: track(100), aP: track(a), rA: track(0), gA: track(0), bA: track(0), aA: track(0) });
	const inst = (symbol: string, alpha: number | null, extra: Partial<InstanceItem> = {}): InstanceItem =>
		({
			kind: "instance", start: 0, end: 1, symbol, symbolType: "movie clip", name: "", transform: {} as InstanceItem["transform"],
			color: alpha === null ? null : color(alpha), filters: [], blendMode: "normal", visible: true, cacheAsBitmap: false,
			bounds: { left: 0, top: 0, width: 1, height: 1 }, ...extra,
		}) as InstanceItem;
	const prog = (id: string, items: Program["layers"][number]["items"]): Program => ({ id, name: id, kind: "movie clip", frameCount: 1, layers: [{ index: 0, name: "l", type: "normal", maskedBy: -1, items }], labels: [], actions: {} });

	it("applies to each shape like Flash, except where shapes cannot inherit it", () => {
		const outer = inst("sym:a", 50);
		const plain = inst("sym:b", null);
		const filtered = inst("sym:b", 50, { filters: [{ t: 0, filters: [{ name: "blurFilter" } as never] }] });
		const photo = inst("sym:p", 50);
		const blended = inst("sym:b", 50, { blendMode: "multiply" });
		const layered = inst("sym:b", 50, { blendMode: "layer" });
		const inner = inst("sym:b", 40);
		const programs: Record<string, Program> = {
			root: prog("root", [outer, plain, filtered, photo, blended, layered]),
			"sym:a": prog("sym:a", [inner]),
			"sym:b": prog("sym:b", [{ kind: "art", start: 0, end: 1, uid: "1", slot: 0, art: "x" }]),
			"sym:p": prog("sym:p", [{ kind: "art", start: 0, end: 1, uid: "2", slot: 0, art: "photo" }]),
		};
		markShapeAlpha(programs, ["root"], (art) => (art === "photo" ? 4 : 1));
		expect(outer.shapeAlpha).toBe(1); // fills only: fill-opacity
		expect(plain.shapeAlpha).toBe(0);
		expect(filtered.shapeAlpha).toBe(0);
		expect(blended.shapeAlpha).toBe(1); // multiply: still per shape, as Animate draws it
		expect(layered.shapeAlpha).toBe(0);
		expect(photo.shapeAlpha).toBe(0); // images ignore fill-opacity
		// inherited values do not multiply: inside, alpha stays a group opacity
		expect(inner.shapeAlpha).toBe(0);
		expect(programs["sym:a"]!.inShapeAlpha).toBe(true);
		expect(programs.root!.inShapeAlpha).toBeUndefined();
	});
});
