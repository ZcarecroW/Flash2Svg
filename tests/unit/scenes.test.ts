import { describe, expect, it } from "vitest";
import { compileScene } from "../../src/core/compile.ts";
import type { SceneModel, TimelineData } from "../../src/core/model.ts";
import { ALL_SCENES, joinScenes } from "../../src/core/scenes.ts";
import { exportRaster } from "../../src/core/raster.ts";

const scene = (id: string, name: string, frames: number, script: Record<number, string>, labels: Record<number, string> = {}): TimelineData => ({
	id,
	name,
	kind: "scene",
	frameCount: frames,
	layers: [
		{
			name: "a",
			type: "normal",
			visible: true,
			parent: -1,
			frameCount: frames,
			keyframes: Array.from({ length: frames }, (_, i) => ({
				index: i,
				duration: 1,
				elements: [],
				...(script[i] ? { script: script[i] } : {}),
				...(labels[i] ? { label: { name: labels[i]!, type: "name" as const } } : {}),
			})),
		},
	],
});

const model = (): SceneModel =>
	({
		version: 1,
		doc: { name: "d", type: "Flash", width: 100, height: 100, frameRate: 24, backgroundColor: "#FFFFFF" },
		roots: [ALL_SCENES],
		sceneOrder: ["scene:0", "scene:1"],
		timelines: {
			"scene:0": scene("scene:0", "Scene 1", 10, { 9: 'gotoAndPlay(3, "Scene 2");' }, { 0: "intro" }),
			"scene:1": scene(
				"scene:1",
				"Scene 2",
				5,
				{ 4: "stop(); btn.addEventListener(MouseEvent.CLICK, f); function f(e:MouseEvent):void { prevScene(); }", 0: 'gotoAndStop("intro")' },
				{ 0: "intro" },
			),
		},
		atlas: {},
		bitmaps: {},
		sounds: {},
		warnings: [],
	}) as unknown as SceneModel;

describe("all scenes in a row", () => {
	it("joins the scenes, frame numbers and scene jumps count on the joined timeline", () => {
		const j = joinScenes(model()).timelines[ALL_SCENES]!;
		expect(j.frameCount).toBe(15);
		expect(j.layers).toHaveLength(2);
		const scripts = j.layers.flatMap((l) => l.keyframes.filter((k) => k.script).map((k) => [k.index, k.script]));
		expect(scripts).toEqual([
			[9, "gotoAndPlay(13);"],
			[10, 'gotoAndStop("Scene 2/intro")'],
			[14, "stop(); btn.addEventListener(MouseEvent.CLICK, f); function f(e:MouseEvent):void { gotoAndPlay(1); }"],
		]);
		// a label in both scenes is named with its scene
		const labels = j.layers.flatMap((l) => l.keyframes.filter((k) => k.label).map((k) => [k.index, k.label!.name]));
		expect(labels).toEqual([
			[0, "Scene 1/intro"],
			[10, "Scene 2/intro"],
		]);
	});

	it("compiles: the player follows the jumps across scenes", () => {
		const out = compileScene(model(), { readText: () => "", readBinary: () => new Uint8Array() }, { format: "player" });
		expect(out.warnings.join()).not.toMatch(/scene/i);
		const P = JSON.parse(/<script type="application\/json"><!\[CDATA\[([\s\S]*?)\]\]>/.exec(out.files[0]!.svg)![1]!);
		expect(P.tl[ALL_SCENES].ac).toEqual({ 9: [[2, 12, 1]], 10: [[2, "Scene 2/intro", 0]], 14: [[0]] });
		expect(P.tl[ALL_SCENES].ev).toEqual([[14, "btn", 0, [2, "", 0, 1]]]);
	});
});

describe("all scenes as GIF", () => {
	it("draws the joined scenes (the raster export used to look for a timeline that isn't stored)", async () => {
		let drawn = 0;
		const out = await exportRaster(
			model(),
			{ readText: () => "", readBinary: () => new Uint8Array() },
			{ format: "gif", loop: "always" },
			async (_svg, width, height) => (drawn++, { data: new Uint8ClampedArray(width * height * 4), width, height }),
			null,
		);
		// "always": every frame of both scenes in order
		expect(drawn).toBe(15);
		expect(out.files[0]!.ext).toBe(".gif");
	});
});
