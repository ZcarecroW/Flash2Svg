import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compose, decompose } from "../../src/core/geom.ts";
import type { InstanceElement, Mat, SceneModel } from "../../src/core/model.ts";
import { buildPrograms, fromProps, parseActions, toProps, TRANSFORM_PROPS, type InstanceItem } from "../../src/core/program.ts";
import { valueAt } from "../../src/core/tracks.ts";

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
});
