/**
 * Flash plays a document's scenes in a row. With "all scenes" the extractor writes each scene's
 * timeline and their order (`SceneModel.sceneOrder`); this joins them into one timeline
 * "scene:all": every scene's layers (kept apart: their frames don't overlap), keyframes moved by
 * the frames before the scene, frame scripts rewritten so frame numbers count on the joined
 * timeline (`gotoAndPlay(5, "Scene 2")` → the 5th frame of scene 2; `nextScene()` / `prevScene()`
 * → the first frame of that scene). Labels that occur in several scenes get the scene's name in
 * front ("Scene 2/intro"), also where scripts name them.
 */
import type { CameraFrame, LayerData, SceneModel, TimelineData } from "./model.ts";

export const ALL_SCENES = "scene:all";

export function joinScenes(model: SceneModel): SceneModel {
	const order = model.sceneOrder;
	if (!order?.length || model.timelines[ALL_SCENES]) return model;
	const scenes = order.map((id) => model.timelines[id]).filter((t): t is TimelineData => !!t);
	const zeroBased = model.doc.type !== "Flash";
	const offsets = new Map<string, number>();
	let total = 0;
	for (const t of scenes) {
		offsets.set(t.name, total);
		total += t.frameCount;
	}
	// labels in more than one scene: named with their scene
	const seen = new Map<string, number>();
	for (const t of scenes) for (const name of new Set(labelsOf(t))) seen.set(name, (seen.get(name) ?? 0) + 1);
	const label = (scene: string, name: string) => ((seen.get(name) ?? 0) > 1 ? `${scene}/${name}` : name);

	const layers: LayerData[] = [];
	let camera: CameraFrame[] | undefined;
	scenes.forEach((t, si) => {
		const off = offsets.get(t.name)!;
		const base = layers.length;
		const next = scenes[si + 1]?.name;
		const prev = scenes[si - 1]?.name;
		for (const l of t.layers)
			layers.push({
				...l,
				parent: l.parent >= 0 ? l.parent + base : -1,
				frameCount: off + l.frameCount,
				keyframes: l.keyframes.map((k) => ({
					...k,
					index: k.index + off,
					...(k.label ? { label: { ...k.label, name: k.label.type === "comment" ? k.label.name : label(t.name, k.label.name) } } : {}),
					...(k.script ? { script: rewrite(k.script, { scene: t.name, offsets, label, zeroBased, next, prev }) } : {}),
				})),
				...(l.rig ? { rig: [...Array<null>(off).fill(null), ...l.rig] } : {}),
				...(l.effects ? { effects: l.effects.map((e) => ({ ...e, frame: e.frame + off })) } : {}),
			});
		if (t.camera) {
			camera ??= [];
			camera.length = off;
			camera.push(...t.camera);
		}
	});
	if (camera) camera.length = total;
	const joined: TimelineData = {
		id: ALL_SCENES,
		name: scenes[0]?.name ?? "Scene 1",
		kind: "scene",
		frameCount: total,
		layers,
		...(camera ? { camera: fillCamera(camera) } : {}),
	};
	if (scenes.filter((t) => t.layers.some((l) => l.type === "camera")).length > 1)
		model.warnings.push("Several scenes use the camera: in all scenes in a row only the first scene's camera moves the view");
	// (the scenes themselves are only parts of it now)
	const timelines = Object.fromEntries(Object.entries(model.timelines).filter(([id]) => !order.includes(id)));
	return { ...model, roots: [ALL_SCENES], timelines: { ...timelines, [ALL_SCENES]: joined } };
}

function labelsOf(t: TimelineData): string[] {
	return t.layers.flatMap((l) => l.keyframes.filter((k) => k.label && k.label.type !== "comment").map((k) => k.label!.name));
}

/** Frames before the camera's first use hold the first camera frame (sparse entries filled). */
function fillCamera(c: CameraFrame[]): CameraFrame[] {
	const first = c.find((f) => f);
	let last = first!;
	return Array.from(c, (f) => (f ? (last = f) : last));
}

/** A frame script with frame numbers on the joined timeline (see joinScenes). */
function rewrite(
	script: string,
	o: { scene: string; offsets: Map<string, number>; label: (scene: string, name: string) => string; zeroBased: boolean; next?: string; prev?: string },
): string {
	const first = (scene: string) => o.offsets.get(scene)! + (o.zeroBased ? 0 : 1);
	return script
		.replace(/\b(gotoAndPlay|gotoAndStop)\s*\(\s*(\d+|"[^"]*"|'[^']*')\s*(?:,\s*("[^"]*"|'[^']*')\s*)?\)/g, (m, fn: string, arg: string, sceneArg?: string) => {
			const scene = sceneArg ? sceneArg.slice(1, -1) : o.scene;
			if (!o.offsets.has(scene)) return m;
			if (/^\d+$/.test(arg)) return `${fn}(${parseInt(arg, 10) + o.offsets.get(scene)!})`;
			return `${fn}(${JSON.stringify(o.label(scene, arg.slice(1, -1)))})`;
		})
		.replace(/\b(nextScene|prevScene)\s*\(\s*\)/g, (m, fn: string) => {
			const to = fn === "nextScene" ? o.next : o.prev;
			return to ? `gotoAndPlay(${first(to)})` : m;
		});
}
