/**
 * Turns the scene model into "programs": per timeline, the list of things drawn on each layer,
 * with animation tracks in the timeline's own frame time.
 *
 * Tweens are fitted from Animate's ease settings (exact cubic pieces) and verified against the
 * per-frame samples Animate computed; anything that doesn't match (motion guides, motion
 * objects, exotic options) falls back to the samples themselves, simplified.
 */
import { classicEase, easePieces, evalBezier as evalEaseBezier, evalEase, isLinear, type EaseCurve } from "./easing.ts";
import { compose, decompose, nearestAngle } from "./geom.ts";
import type {
	AccInfo,
	VideoElement,
	BitmapElement,
	ColorTransform,
	ElementData,
	FilterData,
	InstanceElement,
	Keyframe,
	LayerData,
	LayerEffect,
	Mat,
	Point,
	SceneModel,
	TextElement,
	TimelineData,
	TweenData,
} from "./model.ts";
import { blankComments, splitScript, type Interaction } from "./snippets.ts";
import { simplify, type Ease, type Key, type Track } from "./tracks.ts";

export interface CompileOptions {
	/** Interpolate tweens smoothly between frames (high FPS). False = one step per frame. */
	smooth: boolean;
	includeHiddenLayers: boolean;
	includeGuides: boolean;
}

export const TRANSFORM_PROPS = ["x", "y", "rot", "skw", "sx", "sy", "tpx", "tpy"] as const;
export type TransformProp = (typeof TRANSFORM_PROPS)[number];
export const COLOR_PROPS = ["rP", "gP", "bP", "aP", "rA", "gA", "bA", "aA"] as const;
export type ColorProp = (typeof COLOR_PROPS)[number];

export type TransformTracks = Record<TransformProp, Track>;
export type ColorTracks = Record<ColorProp, Track>;

interface ItemBase {
	uid: string;
	/** Frames [start, end) of the parent timeline during which the item exists. */
	start: number;
	end: number;
	/** Element slot inside the layer (z-order, 0 = bottom). */
	slot: number;
}

export interface InstanceItem extends ItemBase {
	kind: "instance";
	symbol: string;
	symbolType: InstanceElement["symbolType"];
	name: string;
	/** Accessibility panel settings of the span's first keyframe. */
	acc?: AccInfo;
	transform: TransformTracks;
	/** null when the colour is identity for the whole item. */
	color: ColorTracks | null;
	/** Filters by frame (keyframe changes / samples); static when one entry. */
	filters: { t: number; filters: FilterData[] }[];
	blendMode: string;
	visible: boolean;
	cacheAsBitmap: boolean;
	/** Bounds of the first keyframe element, in the parent timeline space. */
	bounds: { left: number; top: number; width: number; height: number };
	/** Graphic symbols: how the child frame is chosen, per keyframe range. */
	graphic?: GraphicRange[];
	/** Alpha applies to each shape inside, not to the instance as a whole (see markShapeAlpha):
	 * 1 = to fills, 2 = to strokes, 3 = both. */
	shapeAlpha?: number;
}

export interface GraphicRange {
	start: number;
	end: number;
	loop: string;
	firstFrame: number;
	lastFrame: number;
}

export interface ArtItem extends ItemBase {
	kind: "art";
	art: string;
}

/** Frame-by-frame artwork (shape tweens): one atlas item per frame from `start`. */
export interface ArtSeqItem extends ItemBase {
	kind: "artSeq";
	arts: string[];
	/** Shape tweens: the blend ratio (0 = start shape, 1 = end shape) over local frame time. */
	ratio?: Track;
}

export interface BitmapItem extends ItemBase {
	kind: "bitmap";
	bitmap: string;
	matrix: Mat;
}

export interface TextItem extends ItemBase {
	kind: "text";
	element: TextElement;
	art: string;
}

export interface VideoItem extends ItemBase {
	kind: "video";
	element: VideoElement;
}

export type Item = InstanceItem | ArtItem | ArtSeqItem | BitmapItem | TextItem | VideoItem;

export interface ProgramLayer {
	index: number;
	name: string;
	type: string;
	/** For masked layers: index of the mask layer. */
	maskedBy: number;
	/** Mask layers made from "alpha"/"erase" blends: keep (alpha) or cut out (erase) by alpha. */
	maskMode?: "alpha" | "erase";
	/** "alpha" masks: Flash blends only inside the element's bounds (parent space); outside all stays. */
	maskBox?: { left: number; top: number; width: number; height: number };
	items: Item[];
	rig?: (Mat | null)[];
}

/** Layer effects (advanced layers) are applied by wrapping the layer in a synced graphic. */
const LAYER_FX = "#fx";

export type FrameAction = (
	| { type: "stop" }
	| { type: "play" }
	| { type: "goto"; target: number | string; play: boolean }
) & {
	/** Only on the passes over the frame (1 = first) in [from, before); 0 = open. */
	passes?: { from: number; before: number };
};

export interface Program {
	id: string;
	/** Derived copies (9-slice): the timeline this program was made from. */
	source?: string;
	name: string;
	kind: TimelineData["kind"];
	frameCount: number;
	/** Bottom-to-top drawing order. */
	layers: ProgramLayer[];
	labels: { frame: number; name: string }[];
	actions: Record<number, FrameAction[]>;
	/** Mouse handlers added by frame scripts (Animate's code snippets, see snippets.ts). */
	interactions?: Interaction[];
	camera?: TimelineData["camera"];
	/** Camera (root scenes): transform applied to all layers, in this timeline's frame time. */
	view?: TransformTracks;
	/** Placed inside an instance with shapeAlpha: masks must not inherit that alpha. */
	inShapeAlpha?: boolean;
}

export interface CompileResult {
	programs: Record<string, Program>;
	warnings: string[];
}

// ---------------------------------------------------------------------------------------------

const TOL: Record<TransformProp | ColorProp, number> = {
	x: 0.1,
	y: 0.1,
	tpx: 0.1,
	tpy: 0.1,
	rot: 0.15,
	skw: 0.15,
	sx: 0.003,
	sy: 0.003,
	rP: 0.6,
	gP: 0.6,
	bP: 0.6,
	aP: 0.6,
	rA: 1,
	gA: 1,
	bA: 1,
	aA: 1,
};

const GROUP_OF: Record<TransformProp | ColorProp, "position" | "rotation" | "scale" | "color"> = {
	x: "position",
	y: "position",
	tpx: "position",
	tpy: "position",
	rot: "rotation",
	skw: "rotation",
	sx: "scale",
	sy: "scale",
	rP: "color",
	gP: "color",
	bP: "color",
	aP: "color",
	rA: "color",
	gA: "color",
	bA: "color",
	aA: "color",
};

export function buildPrograms(model: SceneModel, opts: CompileOptions): CompileResult {
	const warnings: string[] = [...model.warnings];
	const programs: Record<string, Program> = {};
	for (const id in model.timelines) {
		programs[id] = buildProgram(model.timelines[id]!, opts, warnings, model.doc);
	}
	// alpha/erase only act inside a symbol placed with the "layer" blend (as in Animate)
	const uses = new Map<string, InstanceItem[]>();
	for (const id in programs)
		for (const l of programs[id]!.layers) for (const it of l.items) if (it.kind === "instance") (uses.get(it.symbol) ?? uses.set(it.symbol, []).get(it.symbol)!).push(it);
	for (const id in model.timelines) {
		wrapLayerEffects(programs, programs[id]!, model.timelines[id]!, warnings);
		wrapRigs(programs, programs[id]!, opts);
	}
	for (const [id, list] of uses) {
		const layered = list.filter((it) => it.blendMode === "layer");
		const prog = programs[id];
		if (!layered.length || !prog || !prog.layers.some((l) => l.items.some((it) => it.kind === "instance" && (it.blendMode === "alpha" || it.blendMode === "erase")))) continue;
		let target = prog;
		if (layered.length < list.length) {
			// also placed without "layer": those instances keep the plain symbol
			target = { ...prog, id: `${id}#layer`, source: prog.source ?? id, layers: prog.layers.map((l) => ({ ...l, items: l.items.map((it) => ({ ...it })) })) };
			programs[target.id] = target;
			for (const it of layered) it.symbol = target.id;
		}
		wrapErase(programs, target);
	}
	return { programs, warnings };
}

/**
 * Flash applies an instance's alpha to every shape inside it, so overlapping parts (the inner half
 * of a stroke over its fill, overlapping shapes) show through each other, also with blend modes
 * like multiply and with cacheAsBitmap (as Animate draws them); filters and the layer, invert
 * and subtract blends draw the instance as one picture first. SVG gets the same result from
 * the inherited fill-opacity / stroke-opacity instead of a group opacity, and is faster too (no
 * offscreen group). Inherited values do not multiply, so inside such an instance alpha falls back
 * to a group opacity; images ignore fill-opacity, so instances showing bitmaps keep it as well.
 * Only the properties that are needed are set: `paint(art)` tells what an artwork paints
 * (1 fills, 2 strokes, 4 images).
 */
const GROUP_BLENDS = new Set(["layer", "invert", "subtract", "alpha", "erase"]);

export function markShapeAlpha(programs: Record<string, Program>, roots: string[], paint: (art: string) => number) {
	const known = new Map<string, number>();
	const paintsOf = (id: string): number => {
		let r = known.get(id);
		if (r !== undefined) return r;
		known.set(id, 0); // cycle guard
		r = 0;
		const p = programs[id];
		if (p)
			for (const l of p.layers)
				for (const it of l.items)
					r |= it.kind === "bitmap" || it.kind === "video" ? 4 : it.kind === "text" ? 1 : it.kind === "art" ? paint(it.art) : it.kind === "artSeq" ? it.arts.reduce((a, x) => a | paint(x), 0) : paintsOf(it.symbol);
		known.set(id, r);
		return r;
	};
	const shapeAlpha = (it: InstanceItem): number => {
		const c = it.color;
		if (!c || GROUP_BLENDS.has(it.blendMode) || it.filters.some((f) => f.filters.length) || it.symbol.includes(LAYER_FX)) return 0;
		const all = (p: ColorProp, v: number) => c[p].every((k) => k.v === v);
		if (!(all("rP", 100) && all("gP", 100) && all("bP", 100) && all("rA", 0) && all("gA", 0) && all("bA", 0) && all("aA", 0)) || all("aP", 100)) return 0;
		const paints = paintsOf(it.symbol);
		return paints & 4 ? 0 : paints;
	};
	// parents before children, so a program's context is known before its instances are decided
	const order: string[] = [];
	const seen = new Set<string>();
	const visit = (id: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		const p = programs[id];
		if (p) for (const l of p.layers) for (const it of l.items) if (it.kind === "instance") visit(it.symbol);
		order.push(id);
	};
	for (const r of roots) visit(r);
	const inside = new Set<string>();
	for (let i = order.length - 1; i >= 0; i--) {
		const p = programs[order[i]!];
		if (!p) continue;
		const tainted = inside.has(p.id);
		if (tainted) p.inShapeAlpha = true;
		for (const l of p.layers)
			for (const it of l.items) {
				if (it.kind !== "instance") continue;
				it.shapeAlpha = tainted ? 0 : shapeAlpha(it);
				if (tainted || it.shapeAlpha) inside.add(it.symbol);
			}
	}
}

/**
 * Advanced layers can carry a colour effect, filters and a blend mode that apply to the layer's
 * whole content. The layer's items move into a graphic symbol that follows the timeline frame by
 * frame, and the effects become that instance's colour, filters and blend mode.
 */
/**
 * Layer parenting: Animate gives the parent's matrix for every frame of the child layer. The
 * layer's items move into a synced graphic symbol whose instance follows those matrices, so the
 * animated outputs move children with their parent (between frames the matrix is interpolated).
 */
function wrapRigs(programs: Record<string, Program>, prog: Program, opts: CompileOptions) {
	for (const pl of prog.layers) {
		const rig = pl.rig;
		if (!rig?.length || !pl.items.length) continue;
		const id = `${prog.id}#rig${pl.index}`;
		programs[id] = {
			id,
			name: `${prog.name} ${pl.name}`,
			kind: "graphic",
			frameCount: prog.frameCount,
			layers: [{ index: 0, name: pl.name, type: "normal", maskedBy: -1, items: pl.items }],
			labels: [],
			actions: {},
		};
		const transform = emptyTracks(TRANSFORM_PROPS);
		let prevRot: number | undefined, prevSkw: number | undefined;
		for (let f = 0; f < prog.frameCount; f++) {
			const p = toProps(rig[Math.min(f, rig.length - 1)] ?? [1, 0, 0, 1, 0, 0], { x: 0, y: 0 });
			if (prevRot !== undefined) p.rot = nearestAngle(p.rot, prevRot);
			if (prevSkw !== undefined) p.skw = nearestAngle(p.skw, prevSkw);
			prevRot = p.rot;
			prevSkw = p.skw;
			for (const k of TRANSFORM_PROPS) transform[k].push({ t: f, v: p[k], ease: opts.smooth ? "linear" : "hold" });
		}
		for (const k of TRANSFORM_PROPS) {
			transform[k] = simplify(transform[k], TOL[k] / 2);
			closeTrack(transform[k]);
		}
		const bounds = pl.items.find((it): it is InstanceItem => it.kind === "instance")?.bounds ?? { left: 0, top: 0, width: 50, height: 50 };
		const wrapper: InstanceItem = {
			kind: "instance",
			uid: `${prog.id}|${pl.index}|rig`,
			start: 0,
			end: prog.frameCount,
			slot: 0,
			symbol: id,
			symbolType: "graphic",
			name: "",
			transform,
			color: null,
			filters: [],
			blendMode: "normal",
			visible: true,
			cacheAsBitmap: false,
			bounds,
			graphic: [{ start: 0, end: prog.frameCount, loop: "play once", firstFrame: 0, lastFrame: prog.frameCount - 1 }],
		};
		pl.items = [wrapper];
		delete pl.rig;
	}
}

/** A synced graphic instance showing `id` over the whole timeline of `prog`. */
function syncedWrapper(prog: Program, id: string, uid: string, bounds: InstanceItem["bounds"]): InstanceItem {
	const hold = (v: number): Track => [{ t: 0, v, ease: "hold" }];
	return {
		kind: "instance",
		uid,
		start: 0,
		end: prog.frameCount,
		slot: 0,
		symbol: id,
		symbolType: "graphic",
		name: "",
		transform: Object.fromEntries(TRANSFORM_PROPS.map((k) => [k, hold(k === "sx" || k === "sy" ? 1 : 0)])) as TransformTracks,
		color: null,
		filters: [],
		blendMode: "normal",
		visible: true,
		cacheAsBitmap: false,
		bounds,
		graphic: [{ start: 0, end: prog.frameCount, loop: "play once", firstFrame: 0, lastFrame: prog.frameCount - 1 }],
	};
}

/**
 * "Alpha" and "erase" blends change what is below them in their timeline (Flash needs a "layer"
 * blend on the parent): keep it where the element is opaque, or cut it out there. The layer is
 * split at the element: everything below it (lower layers, lower elements of its layer) moves
 * into a synced graphic, masked by alpha by the element; elements above it stay on top.
 */
function wrapErase(programs: Record<string, Program>, prog: Program) {
	let n = 0;
	for (let i = 0; i < prog.layers.length; i++) {
		const pl = prog.layers[i]!;
		if (pl.type === "mask" || pl.maskedBy >= 0) continue;
		const cut = pl.items
			.filter((it): it is InstanceItem => it.kind === "instance" && (it.blendMode === "alpha" || it.blendMode === "erase"))
			.sort((a, b) => a.slot - b.slot)[0];
		if (!cut) continue;
		const mode = cut.blendMode as "alpha" | "erase";
		// "alpha" keeps nothing while the element is missing: only for one that is always there
		if (mode === "alpha" && (cut.start > 0 || cut.end < prog.frameCount)) continue;
		// a mask layer below must not lose a masked layer above the cut
		if (prog.layers.slice(i + 1).some((l) => l.maskedBy >= 0 && prog.layers.findIndex((m) => m.index === l.maskedBy) < i)) continue;
		const lower = pl.items.filter((it) => it !== cut && it.slot < cut.slot);
		const upper = pl.items.filter((it) => it !== cut && it.slot >= cut.slot);
		const below = prog.layers.slice(0, i);
		if (lower.length) below.push({ ...pl, index: 1e6 + n++, name: `${pl.name} (below)`, items: lower });
		cut.blendMode = "normal";
		if (!below.length) {
			// nothing to act on: the element itself is never drawn
			pl.items = upper;
			continue;
		}
		const id = `${prog.id}#${mode}${n}`;
		programs[id] = { id, name: `${prog.name} ${pl.name}`, kind: "graphic", frameCount: prog.frameCount, layers: below, labels: [], actions: {} };
		const maskIndex = 1e6 + n++;
		const out: ProgramLayer[] = [
			{ index: 1e6 + n++, name: `${pl.name} (cut)`, type: "normal", maskedBy: maskIndex, items: [syncedWrapper(prog, id, `${prog.id}|${pl.index}|${mode}${n}`, cut.bounds)] },
			{ index: maskIndex, name: pl.name, type: "mask", maskedBy: -1, maskMode: mode, maskBox: mode === "alpha" ? cut.bounds : undefined, items: [cut] },
		];
		if (upper.length) out.push({ ...pl, items: upper });
		prog.layers.splice(0, i + 1, ...out);
		// go on with the elements above (there may be more cuts)
		i = out.length - 2;
	}
}

function wrapLayerEffects(programs: Record<string, Program>, prog: Program, tl: TimelineData, warnings: string[]) {
	for (const pl of prog.layers) {
		const fx = tl.layers[pl.index]?.effects;
		if (!fx?.length || pl.type === "mask" || !pl.items.length) continue;
		const entries: LayerEffect[] = [...fx].sort((a, b) => a.frame - b.frame);
		const id = `${prog.id}${LAYER_FX}${pl.index}`;
		programs[id] = {
			id,
			name: `${prog.name} ${pl.name}`,
			kind: "graphic",
			frameCount: prog.frameCount,
			layers: [{ index: 0, name: pl.name, type: "normal", maskedBy: -1, items: pl.items }],
			labels: [],
			actions: {},
		};
		const hold = (v: number, t = 0): Track => [{ t, v, ease: "hold" }];
		const transform = Object.fromEntries(TRANSFORM_PROPS.map((k) => [k, hold(k === "sx" || k === "sy" ? 1 : 0)])) as TransformTracks;
		let color: ColorTracks | null = emptyTracks(COLOR_PROPS);
		for (const e of entries) {
			const c = colorProps(e.color ?? null);
			for (const k of COLOR_PROPS) {
				const t = color[k];
				if (!t.length || t[t.length - 1]!.v !== c[k]) t.push({ t: e.frame, v: c[k], ease: "hold" });
			}
		}
		for (const k of COLOR_PROPS) if (color[k][0]!.t > 0) color[k].unshift({ t: 0, v: k.endsWith("P") ? 100 : 0, ease: "hold" });
		if (COLOR_PROPS.every((k) => color![k].every((key) => key.v === (k.endsWith("P") ? 100 : 0)))) color = null;
		const filters: InstanceItem["filters"] = [];
		for (const e of entries) {
			const list = (e.filters ?? []).filter((x) => x.enabled !== false);
			if (JSON.stringify(list) !== JSON.stringify(filters[filters.length - 1]?.filters ?? [])) filters.push({ t: e.frame, filters: list });
		}
		if (filters.length && filters[0]!.t > 0) filters.unshift({ t: 0, filters: [] });
		const modes = [...new Set(entries.map((e) => e.blendMode ?? "normal"))];
		if (modes.length > 1) warnings.push(`Layer ${pl.name}: changing layer blend modes are not animated`);
		let box: { l: number; t: number; r: number; b: number } | null = null;
		for (const it of pl.items) {
			const b = it.kind === "instance" ? it.bounds : it.kind === "text" ? it.element.bounds : null;
			if (!b) continue;
			const r = { l: b.left, t: b.top, r: b.left + b.width, b: b.top + b.height };
			box = box ? { l: Math.min(box.l, r.l), t: Math.min(box.t, r.t), r: Math.max(box.r, r.r), b: Math.max(box.b, r.b) } : r;
		}
		const wrapper: InstanceItem = {
			kind: "instance",
			uid: `${prog.id}|${pl.index}|fx`,
			start: 0,
			end: prog.frameCount,
			slot: 0,
			symbol: id,
			symbolType: "graphic",
			name: "",
			transform,
			color,
			filters,
			blendMode: modes.find((m) => m !== "normal") ?? "normal",
			visible: true,
			cacheAsBitmap: false,
			bounds: box ? { left: box.l, top: box.t, width: box.r - box.l, height: box.b - box.t } : { left: 0, top: 0, width: 50, height: 50 },
			graphic: [{ start: 0, end: prog.frameCount, loop: "play once", firstFrame: 0, lastFrame: prog.frameCount - 1 }],
		};
		pl.items = [wrapper];
	}
}

export function layerIncluded(layers: LayerData[], i: number, opts: Pick<CompileOptions, "includeGuides" | "includeHiddenLayers">): boolean {
	const l = layers[i]!;
	if (l.type === "folder" || l.type === "camera") return false;
	if (l.type === "guide") {
		// a guide layer is either a plain guide or a motion guide: neither is ever drawn
		if (!opts.includeGuides) return false;
		const guides = layers.some((o) => o.parent === i && o.type === "guided");
		if (guides) return false;
	}
	if (!opts.includeHiddenLayers) {
		let p: number = i;
		while (p >= 0) {
			if (!layers[p]!.visible) return false;
			p = layers[p]!.parent;
		}
	}
	return true;
}

function buildProgram(tl: TimelineData, opts: CompileOptions, warnings: string[], doc: SceneModel["doc"]): Program {
	const prog: Program = {
		id: tl.id,
		name: tl.name,
		kind: tl.kind,
		frameCount: tl.frameCount,
		layers: [],
		labels: [],
		actions: {},
		camera: tl.camera,
	};
	for (let li = tl.layers.length - 1; li >= 0; li--) {
		const layer = tl.layers[li]!;
		for (const kf of layer.keyframes) {
			if (kf.label && kf.label.type !== "comment") prog.labels.push({ frame: kf.index, name: kf.label.name });
			if (kf.script) {
				const where = { zeroBased: doc.type !== "Flash", scene: tl.kind === "scene" ? tl.name : undefined, warn: (m: string) => warnings.push(`${tl.name}, frame ${kf.index + 1}: ${m}`) };
				// mouse handlers out first: their jumps aren't frame actions
				const parts = splitScript(kf.script, { ...where, frame: kf.index });
				const acts = parseActions(parts.frameCode, where);
				if (acts.length) (prog.actions[kf.index] ??= []).push(...acts);
				if (parts.interactions.length) (prog.interactions ??= []).push(...parts.interactions);
			}
		}
		if (!layerIncluded(tl.layers, li, opts)) continue;
		const maskedBy = layer.type === "masked" && layer.parent >= 0 && tl.layers[layer.parent]?.type === "mask" ? layer.parent : -1;
		if (maskedBy >= 0 && !layerIncluded(tl.layers, maskedBy, opts)) {
			// mask layer excluded (hidden): Animate then shows the content unmasked
		}
		const pl: ProgramLayer = {
			index: li,
			name: layer.name,
			type: layer.type,
			maskedBy: maskedBy >= 0 && layerIncluded(tl.layers, maskedBy, opts) ? maskedBy : -1,
			items: buildLayerItems(tl, layer, li, opts, warnings),
		};
		if (layer.rig) pl.rig = layer.rig;
		prog.layers.push(pl);
	}
	prog.labels.sort((a, b) => a.frame - b.frame);
	// a jump to a label the timeline doesn't have goes nowhere (Flash: error #2109, the playhead
	// stays; CreateJS ignores it): left out, so every format keeps the frame it is on
	const labelled = new Set(prog.labels.map((l) => l.name));
	for (const f in prog.actions) {
		prog.actions[f] = prog.actions[f]!.filter((a) => {
			if (a.type !== "goto" || typeof a.target !== "string" || labelled.has(a.target)) return true;
			warnings.push(`${tl.name}, frame ${+f + 1}: ${a.play ? "gotoAndPlay" : "gotoAndStop"}("${a.target}") is left out: there is no frame label "${a.target}"`);
			return false;
		});
		if (!prog.actions[f]!.length) delete prog.actions[f];
	}
	const camLayer = tl.layers.findIndex((l) => l.type === "camera");
	if (camLayer >= 0) prog.view = cameraView(tl, camLayer, opts, warnings, doc);
	return prog;
}

/**
 * The Animate camera is a hidden movie clip instance on the camera layer: its matrix places the
 * camera frame in the world. The view transform is translate(stage centre) * inverse(camera).
 */
function cameraView(tl: TimelineData, li: number, opts: CompileOptions, warnings: string[], doc: SceneModel["doc"]): TransformTracks | undefined {
	const layer = tl.layers[li]!;
	const items = buildLayerItems(tl, layer, li, { ...opts, smooth: true }, warnings).filter((i): i is InstanceItem => i.kind === "instance");
	if (!items.length) return undefined;
	const cx = doc.width / 2,
		cy = doc.height / 2;
	const view = emptyTracks(TRANSFORM_PROPS);
	let prevRot: number | undefined, prevSkw: number | undefined;
	let lastFrame = -1;
	for (let f = 0; f < tl.frameCount; f++) {
		const it = items.find((i) => f >= i.start && f < i.end);
		if (!it) continue;
		const p = {} as Record<TransformProp, number>;
		for (const k of TRANSFORM_PROPS) p[k] = valueAtTrack(it.transform[k], f);
		const cam = fromProps(p);
		const v = concatM(invertM(cam), [1, 0, 0, 1, cx, cy]);
		const props = toProps(v, { x: 0, y: 0 });
		if (prevRot !== undefined) props.rot = nearestAngle(props.rot, prevRot);
		if (prevSkw !== undefined) props.skw = nearestAngle(props.skw, prevSkw);
		prevRot = props.rot;
		prevSkw = props.skw;
		for (const k of TRANSFORM_PROPS) view[k].push({ t: f, v: props[k], ease: opts.smooth ? "linear" : "hold" });
		lastFrame = f;
	}
	if (lastFrame < 0) return undefined;
	for (const k of TRANSFORM_PROPS) {
		view[k] = simplify(view[k], TOL[k] / 2);
		closeTrack(view[k]);
	}
	return view;
}

function valueAtTrack(t: Track, f: number): number {
	if (!t.length) return 0;
	if (f <= t[0]!.t) return t[0]!.v;
	for (let i = 0; i < t.length - 1; i++) {
		const a = t[i]!,
			b = t[i + 1]!;
		if (f < b.t) {
			if (a.ease === "hold") return a.v;
			const u = (f - a.t) / (b.t - a.t);
			const p = a.ease === "linear" ? u : evalEaseBezier(a.ease, u);
			return a.v + (b.v - a.v) * p;
		}
	}
	return t[t.length - 1]!.v;
}

function invertM(m: Mat): Mat {
	const [a, b, c, d, tx, ty] = m;
	const det = a * d - b * c || 1e-12;
	const ia = d / det,
		ib = -b / det,
		ic = -c / det,
		id = a / det;
	return [ia, ib, ic, id, -(ia * tx + ic * ty), -(ib * tx + id * ty)];
}

function concatM(first: Mat, then: Mat): Mat {
	return [
		then[0] * first[0] + then[2] * first[1],
		then[1] * first[0] + then[3] * first[1],
		then[0] * first[2] + then[2] * first[3],
		then[1] * first[2] + then[3] * first[3],
		then[0] * first[4] + then[2] * first[5] + then[4],
		then[1] * first[4] + then[3] * first[5] + then[5],
	];
}

/**
 * Recognises the frame actions that matter for playback (AS3 and HTML5 Canvas syntax). Frame
 * numbers come out 1-based (HTML5 Canvas/CreateJS counts from 0: `zeroBased`).
 * Scripts aren't run. Of conditions only the banner idiom "count the passes" is understood
 * (`if (n < 3) gotoAndPlay(0); else stop();`, `if (++n == 3) stop();`): such actions get
 * the passes over the frame they apply to. Other conditional actions always run (warned).
 * Only the current `scene` is exported: jumps into other scenes are left out (warned).
 */
export function parseActions(script: string, opts: { zeroBased?: boolean; scene?: string; warn?: (m: string) => void } = {}): FrameAction[] {
	const out: FrameAction[] = [];
	// (string-aware: "//" in a label or address isn't a comment)
	const code = blankComments(script);
	// arguments may be strings with any character (labels like "a, (b)")
	const re = /(?:^|[^\w.])(?:this\s*\.\s*)?(stop|play|gotoAndPlay|gotoAndStop)\s*\(\s*((?:"[^"]*"|'[^']*'|[^)"'])*?)\s*\)/g;
	// a counter is incremented in the script: x++, ++x, x += 1, x + 1
	const counts = /\+\+|\+=\s*1\b|\+\s*1\b/.test(code);
	let m: RegExpExecArray | null;
	while ((m = re.exec(code))) {
		const fn = m[1]!;
		let action: FrameAction;
		if (fn === "stop") action = { type: "stop" };
		else if (fn === "play") action = { type: "play" };
		else {
			const args = (m[2]!.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map((a) => a.trim());
			const unquote = (a: string | undefined) => /^["'](.*)["']$/.exec(a ?? "")?.[1];
			const arg = args[0] ?? "";
			const scene = unquote(args[1]);
			if (scene !== undefined && scene !== opts.scene) {
				opts.warn?.(`${fn}() into the scene "${scene}" is left out: only the current scene is exported`);
				continue;
			}
			let target: number | string;
			const str = unquote(arg);
			if (str !== undefined) target = str;
			else if (/^\d+$/.test(arg)) target = parseInt(arg, 10) + (opts.zeroBased ? 1 : 0);
			else continue;
			action = { type: "goto", target, play: fn === "gotoAndPlay" };
		}
		const cond = conditionOf(code, m.index + m[0].indexOf(fn));
		if (cond) {
			const range = counts ? passRange(cond.test, cond.negate) : null;
			if (range) action.passes = range;
			else opts.warn?.(`${fn}() under a condition is always run (the script itself isn't evaluated)`);
		}
		out.push(action);
	}
	return out;
}

const IF_TAIL = /\bif\s*\(([\s\S]*)\)\s*$/;

/** The `if` condition around position `at` (negate: in its else branch), or null. */
function conditionOf(code: string, at: number): { test: string; negate: boolean } | null {
	let before = code.slice(0, at).replace(/this\s*\.\s*$/, "");
	// the enclosing block's header, or the start of a brace-less statement
	let depth = 0;
	let head: string | null = null;
	for (let i = before.length - 1; i >= 0 && head === null; i--) {
		const c = before[i];
		if (c === "}") depth++;
		else if (c === "{") {
			if (depth === 0) head = before.slice(0, i);
			else depth--;
		} else if ((c === ";" || c === "\n") && depth === 0) {
			const stmt = before.slice(i + 1);
			if (/^\s*$/.test(stmt)) continue;
			const own = /^\s*if\s*\(([\s\S]*)\)\s*$/.exec(stmt);
			if (own) return { test: own[1]!, negate: false };
			if (!/^\s*else\s*$/.test(stmt)) return null;
			head = before.slice(0, i + 1) + " else";
		}
	}
	if (head === null) {
		const own = /^\s*if\s*\(([\s\S]*)\)\s*$/.exec(before);
		return own ? { test: own[1]!, negate: false } : null;
	}
	if (!/\belse\s*$/.test(head)) {
		const own = IF_TAIL.exec(head);
		return own ? { test: own[1]!, negate: false } : null;
	}
	// an else branch: find the if it belongs to
	const prev = head.replace(/\belse\s*$/, "").trimEnd();
	if (prev.endsWith("}")) {
		let d = 0;
		for (let j = prev.length - 1; j >= 0; j--) {
			if (prev[j] === "}") d++;
			else if (prev[j] === "{" && --d === 0) {
				const own = IF_TAIL.exec(prev.slice(0, j));
				return own ? { test: own[1]!, negate: true } : null;
			}
		}
		return null;
	}
	const own = /\bif\s*\(([^;]*?)\)[^;]*;\s*$/.exec(prev);
	return own ? { test: own[1]!, negate: true } : null;
}

/** Passes over the frame for which "counter <op> N" holds (`from` inclusive, `before` exclusive; 0 = open). */
function passRange(test: string, negate: boolean): FrameAction["passes"] | null {
	if (/&&|\|\||!=/.test(test)) return null;
	let op: string, n: number;
	let m = /(===?|>=|<=|>|<)\s*(\d+)\s*$/.exec(test);
	if (m) {
		op = m[1]!;
		n = parseInt(m[2]!, 10);
	} else if ((m = /^\s*(\d+)\s*(===?|>=|<=|>|<)/.exec(test))) {
		op = ({ "<": ">", ">": "<", "<=": ">=", ">=": "<=" } as Record<string, string>)[m[2]!] ?? m[2]!;
		n = parseInt(m[1]!, 10);
	} else return null;
	let r: { from: number; before: number };
	if (op === ">=") r = { from: n, before: 0 };
	else if (op === ">") r = { from: n + 1, before: 0 };
	else if (op === "<") r = { from: 0, before: n };
	else if (op === "<=") r = { from: 0, before: n + 1 };
	else r = { from: n, before: n + 1 };
	if (!negate) return r;
	if (r.from && r.before) return null;
	return r.from ? { from: 0, before: r.from } : { from: r.before, before: 0 };
}

// ---------------------------------------------------------------------------------------------
// layer items

function buildLayerItems(tl: TimelineData, layer: LayerData, li: number, opts: CompileOptions, warnings: string[]): Item[] {
	const items: Item[] = [];
	const kfs = layer.keyframes;
	const uid = (s: string) => `${tl.id}|${li}|${s}`;
	// instance spans keyed by slot
	const open = new Map<number, { item: InstanceItem; kfs: Keyframe[] }>();

	const closeSpan = (slot: number) => {
		const s = open.get(slot);
		if (!s) return;
		finishInstance(s.item, s.kfs, slot, opts, warnings, tl, layer);
		items.push(s.item);
		open.delete(slot);
	};

	for (let k = 0; k < kfs.length; k++) {
		const kf = kfs[k]!;
		const kEnd = Math.min(kf.index + kf.duration, layer.frameCount, tl.frameCount);
		if (kEnd <= kf.index) continue;
		const used = new Set<number>();
		if (kf.tween?.type === "shape" && kf.tween.shapeFrames?.length) {
			for (const slot of [...open.keys()]) closeSpan(slot);
			items.push({
				kind: "artSeq",
				uid: uid(`s${kf.index}`),
				start: kf.index,
				end: kEnd,
				slot: 0,
				arts: kf.tween.shapeFrames.slice(0, kEnd - kf.index),
				ratio: shapeRatio(kf.tween, kf.index, kf.duration),
			});
			continue;
		}
		kf.elements.forEach((e, slot) => {
			switch (e.kind) {
				case "instance": {
					const s = open.get(slot);
					if (s && s.item.symbol === e.symbol && s.item.end === kf.index) {
						s.item.end = kEnd;
						s.kfs.push(kf);
					} else {
						closeSpan(slot);
						open.set(slot, { item: newInstance(e, uid(`i${kf.index}.${slot}`), kf.index, kEnd, slot), kfs: [kf] });
					}
					used.add(slot);
					break;
				}
				case "shape":
					if (e.atlas) items.push({ kind: "art", uid: uid(`a${kf.index}.${slot}`), start: kf.index, end: kEnd, slot, art: e.atlas });
					break;
				case "bitmap":
					items.push({ kind: "bitmap", uid: uid(`b${kf.index}.${slot}`), start: kf.index, end: kEnd, slot, bitmap: (e as BitmapElement).bitmap, matrix: (e as BitmapElement).matrix });
					break;
				case "text":
					items.push({ kind: "text", uid: uid(`t${kf.index}.${slot}`), start: kf.index, end: kEnd, slot, element: e as TextElement, art: (e as TextElement).atlas });
					break;
				case "video":
					items.push({ kind: "video", uid: uid(`v${kf.index}.${slot}`), start: kf.index, end: kEnd, slot, element: e as VideoElement });
					break;
			}
		});
		for (const slot of [...open.keys()]) if (!used.has(slot)) closeSpan(slot);
	}
	for (const slot of [...open.keys()]) closeSpan(slot);
	for (const it of items) if (it.kind === "instance") (it as InstanceItem).slot = it.slot;
	items.sort((a, b) => a.slot - b.slot || a.start - b.start);
	return items;
}

function newInstance(e: InstanceElement, uid: string, start: number, end: number, slot: number): InstanceItem {
	return {
		kind: "instance",
		uid,
		start,
		end,
		slot,
		symbol: e.symbol,
		symbolType: e.symbolType,
		name: e.name,
		transform: emptyTracks(TRANSFORM_PROPS),
		color: null,
		filters: [],
		blendMode: e.blendMode,
		visible: e.visible,
		cacheAsBitmap: e.cacheAsBitmap,
		bounds: e.bounds,
		...(e.acc ? { acc: e.acc } : {}),
	};
}

function emptyTracks<K extends string>(props: readonly K[]): Record<K, Track> {
	const o = {} as Record<K, Track>;
	for (const p of props) o[p] = [];
	return o;
}

// ---------------------------------------------------------------------------------------------
// per-frame truth and fitting

interface FrameTruth {
	m: Mat;
	tp: Point;
	color: ColorTransform | null;
	filters: FilterData[];
}

/** Flash-style decomposition into the tracks we emit: translate(x,y) rotate(rot) skewX(skw) scale(sx,sy) translate(-tp). */
export function toProps(m: Mat, tp: Point): Record<TransformProp, number> {
	const d = decompose(m, tp);
	const skw = d.skewY - d.skewX;
	return {
		x: d.x,
		y: d.y,
		rot: d.skewY,
		skw: normaliseSkew(skw),
		sx: d.scaleX,
		sy: d.scaleY * Math.cos((d.skewX - d.skewY) * (Math.PI / 180)),
		tpx: tp.x,
		tpy: tp.y,
	};
}

function normaliseSkew(s: number): number {
	// keep in (-90, 90]: a flip (180) is expressed through a negative scale instead
	let v = ((((s + 180) % 360) + 360) % 360) - 180;
	if (v > 90) v -= 180;
	if (v <= -90) v += 180;
	return v;
}

/** Rebuilds the matrix from emitted track values (inverse of toProps). */
export function fromProps(p: Record<TransformProp, number>): Mat {
	const r = (p.rot * Math.PI) / 180;
	const k = Math.tan((p.skw * Math.PI) / 180);
	// R(rot) * SkewX(skw) * Scale(sx, sy)
	const cos = Math.cos(r),
		sin = Math.sin(r);
	const a = cos * p.sx;
	const b = sin * p.sx;
	const c = (cos * k - sin) * p.sy;
	const d = (sin * k + cos) * p.sy;
	return [a, b, c, d, p.x - (a * p.tpx + c * p.tpy), p.y - (b * p.tpx + d * p.tpy)];
}

export function colorProps(c: ColorTransform | null): Record<ColorProp, number> {
	return c
		? { rP: c.rP, gP: c.gP, bP: c.bP, aP: c.aP, rA: c.rA, gA: c.gA, bA: c.bA, aA: c.aA }
		: { rP: 100, gP: 100, bP: 100, aP: 100, rA: 0, gA: 0, bA: 0, aA: 0 };
}

function finishInstance(
	item: InstanceItem,
	kfs: Keyframe[],
	slot: number,
	opts: CompileOptions,
	warnings: string[],
	tl: TimelineData,
	layer: LayerData,
) {
	// Per-frame truth over the span
	const n = item.end - item.start;
	const truth: FrameTruth[] = new Array(n);
	const segs: { a: number; b: number; kf: Keyframe; el: InstanceElement }[] = [];
	for (let k = 0; k < kfs.length; k++) {
		const kf = kfs[k]!;
		const el = kf.elements[slot] as InstanceElement;
		const a = kf.index - item.start;
		const b = Math.min((kfs[k + 1]?.index ?? item.end) - item.start, n);
		segs.push({ a, b, kf, el });
		const samples = kf.tween?.samples;
		for (let f = a; f < b; f++) {
			const s = samples?.[f - a];
			truth[f] = s
				? { m: s.matrix, tp: el.transformPoint, color: s.color, filters: s.filters ?? el.filters }
				: { m: el.matrix, tp: el.transformPoint, color: el.color, filters: el.filters };
		}
	}

	// Graphic frame selection
	if (item.symbolType === "graphic") {
		item.graphic = segs.map((s) => ({
			start: s.a + item.start,
			end: s.b + item.start,
			loop: s.el.loop ?? "loop",
			firstFrame: s.el.firstFrame ?? 0,
			lastFrame: s.el.lastFrame ?? -1,
		}));
	}

	// Values per frame (angles unwrapped)
	const tv = truth.map((t) => toProps(t.m, t.tp));
	const cv = truth.map((t) => colorProps(t.color));

	const transform = emptyTracks(TRANSFORM_PROPS);
	const color = emptyTracks(COLOR_PROPS);
	// value reached at the end of the previous segment, used to unwrap angles continuously
	const cursor: Partial<Record<TransformProp, number>> = {};
	const unwrap = (p: TransformProp, v: number) => {
		if (p !== "rot" && p !== "skw") return v;
		const c = cursor[p];
		return c === undefined ? v : nearestAngle(v, c);
	};

	for (let si = 0; si < segs.length; si++) {
		const s = segs[si]!;
		const next = segs[si + 1];
		const tw = s.kf.tween;
		const isTween = !!tw && (tw.type === "classic" || tw.type === "motionObject") && s.b - s.a > 1;
		// end state: for classic tweens the next keyframe in the span
		const endT = next && tw?.type === "classic" ? toProps(next.el.matrix, next.el.transformPoint) : null;
		const endC = next && tw?.type === "classic" ? colorProps(next.el.color) : null;

		tv[s.a]!.rot = unwrap("rot", tv[s.a]!.rot);
		tv[s.a]!.skw = unwrap("skw", tv[s.a]!.skw);

		if (!isTween) {
			for (const p of TRANSFORM_PROPS) {
				transform[p].push({ t: s.a, v: tv[s.a]![p], ease: "hold" });
				cursor[p] = tv[s.a]![p];
			}
			for (const p of COLOR_PROPS) color[p].push({ t: s.a, v: cv[s.a]![p], ease: "hold" });
			continue;
		}

		if (endT) {
			endT.rot = rotationEnd(tv[s.a]!.rot, endT.rot, tw!);
			endT.skw = nearestAngle(endT.skw, tv[s.a]!.skw);
		}

		// Animate eases the transformation point's *position* towards the next keyframe but keeps
		// building in-between matrices around this keyframe's point: the point itself steps.
		for (const p of ["tpx", "tpy"] as const) {
			transform[p].push({ t: s.a, v: tv[s.a]![p], ease: "hold" });
			cursor[p] = tv[s.a]![p];
		}

		for (const group of ["position", "rotation", "scale", "color"] as const) {
			const props = (group === "color" ? COLOR_PROPS : TRANSFORM_PROPS).filter(
				(p) => GROUP_OF[p] === group && p !== "tpx" && p !== "tpy",
			) as (TransformProp | ColorProp)[];
			const values = (p: TransformProp | ColorProp) => (group === "color" ? cv.map((c) => c[p as ColorProp]) : tv.map((t) => t[p as TransformProp]));
			const tracks = (p: TransformProp | ColorProp) => (group === "color" ? color[p as ColorProp] : transform[p as TransformProp]);
			const endOf = (p: TransformProp | ColorProp) => (group === "color" ? endC?.[p as ColorProp] : endT?.[p as TransformProp]);
			const curve = easeFor(tw!, group);
			const fitted = endT && curve && opts.smooth ? tryFit(props, values, endOf, curve, s.a, s.b) : null;
			if (fitted) {
				for (const p of props) {
					appendKeys(tracks(p), fitted[p]!);
					if (group !== "color") cursor[p as TransformProp] = endOf(p);
				}
			} else {
				for (const p of props) {
					const vals = values(p);
					const keys: Key[] = [];
					let prev = group === "color" ? undefined : cursor[p as TransformProp];
					for (let f = s.a; f < s.b; f++) {
						let v = vals[f]!;
						if ((p === "rot" || p === "skw") && prev !== undefined) v = nearestAngle(v, prev);
						prev = v;
						keys.push({ t: f, v, ease: opts.smooth ? "linear" : "hold" });
					}
					if (group !== "color") cursor[p as TransformProp] = prev;
					appendKeys(tracks(p), opts.smooth ? simplify(keys, TOL[p] / 2) : keys);
				}
			}
		}
	}
	// After the last key the value holds until item.end
	for (const p of TRANSFORM_PROPS) closeTrack(transform[p]);
	for (const p of COLOR_PROPS) closeTrack(color[p]);

	// Shift to parent frame time
	for (const p of TRANSFORM_PROPS) for (const k of transform[p]) k.t += item.start;
	for (const p of COLOR_PROPS) for (const k of color[p]) k.t += item.start;
	item.transform = transform;
	item.color = COLOR_PROPS.every((p) => color[p].every((k) => k.v === (p.endsWith("P") ? 100 : 0))) ? null : color;

	// Filters: record changes
	let last = "";
	for (let f = 0; f < n; f++) {
		const fs = truth[f]!.filters.filter((x) => x.enabled !== false);
		const sig = JSON.stringify(fs);
		if (sig !== last) {
			item.filters.push({ t: f + item.start, filters: fs });
			last = sig;
		}
	}
	if (item.filters.length === 1 && item.filters[0]!.filters.length === 0) item.filters = [];
	void warnings;
	void tl;
	void layer;
}

function appendKeys(track: Track, keys: Key[]) {
	for (const k of keys) {
		const last = track[track.length - 1];
		if (last && Math.abs(last.t - k.t) < 1e-9) track[track.length - 1] = k;
		else track.push(k);
	}
}

/** Nothing follows the last key: make it hold so emitters don't look for a next value. */
function closeTrack(track: Track) {
	const last = track[track.length - 1];
	if (last) last.ease = "hold";
}

function rotationEnd(r0: number, r1: number, tw: TweenData): number {
	let end = nearestAngle(r1, r0);
	const times = Math.max(0, tw.rotateTimes || 0);
	if (tw.rotate === "clockwise") {
		while (end < r0 - 1e-9) end += 360;
		end += 360 * times;
	} else if (tw.rotate === "counter-clockwise") {
		while (end > r0 + 1e-9) end -= 360;
		end -= 360 * times;
	}
	return end;
}

/** A shape tween's blend ratio from its ease: 0 at its keyframe, 1 at the next one. */
function shapeRatio(tw: TweenData, start: number, dur: number): Track {
	const ce = tw.customEase;
	const custom = ce ? ((ce.all ?? Object.values(ce)[0]) as EaseCurve | undefined) : undefined;
	const curve = custom && custom.length >= 4 ? custom : classicEase(tw.easing);
	const end = start + dur;
	if (isLinear(curve)) return [{ t: start, v: 0, ease: "linear" }, { t: end, v: 1, ease: "hold" }];
	const keys: Track = easePieces(curve, { clampY: true }).map((p) => ({ t: start + p.x0 * dur, v: p.y0, ease: p.bezier }));
	keys.push({ t: end, v: 1, ease: "hold" });
	return keys;
}

function easeFor(tw: TweenData, group: "position" | "rotation" | "scale" | "color"): EaseCurve | null {
	if (tw.type !== "classic") return null;
	const ce = tw.customEase;
	if (ce) {
		const c = (ce[group] ?? ce.all) as EaseCurve | undefined;
		if (c && c.length >= 4) return c;
	}
	return classicEase(tw.easing);
}

/**
 * Builds keys for a tween segment from its ease curve and checks every frame against the truth.
 * Returns null if Animate did something else (the caller then uses the samples).
 */
function tryFit(
	props: (TransformProp | ColorProp)[],
	values: (p: TransformProp | ColorProp) => number[],
	endOf: (p: TransformProp | ColorProp) => number | undefined,
	curve: EaseCurve,
	a: number,
	b: number,
): Record<string, Key[]> | null {
	const out: Record<string, Key[]> = {};
	const dur = b - a;
	for (const p of props) {
		const vals = values(p);
		const v0 = vals[a]!;
		const v1 = endOf(p);
		if (v1 === undefined) return null;
		for (let f = a + 1; f < b; f++) {
			const predicted = v0 + (v1 - v0) * evalEase(curve, (f - a) / dur);
			let actual = vals[f]!;
			if (p === "rot" || p === "skw") actual = nearestAngle(actual, predicted);
			if (Math.abs(predicted - actual) > TOL[p]) return null;
		}
		if (Math.abs(v1 - v0) < 1e-9) {
			out[p] = [{ t: a, v: v0, ease: "linear" }];
			continue;
		}
		if (isLinear(curve)) {
			out[p] = [{ t: a, v: v0, ease: "linear" }];
			continue;
		}
		const keys: Key[] = [];
		// split at extrema so every piece also works as a SMIL keySpline (0..1 control points)
		for (const piece of easePieces(curve, { clampY: true })) {
			const ease: Ease = piece.bezier;
			keys.push({ t: a + piece.x0 * dur, v: v0 + (v1 - v0) * piece.y0, ease });
		}
		out[p] = keys;
	}
	return out;
}

// re-export for emitters
export { compose };
