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

export type Item = InstanceItem | ArtItem | ArtSeqItem | BitmapItem | TextItem;

export interface ProgramLayer {
	index: number;
	name: string;
	type: string;
	/** For masked layers: index of the mask layer. */
	maskedBy: number;
	items: Item[];
	rig?: (Mat | null)[];
}

/** Layer effects (advanced layers) are applied by wrapping the layer in a synced graphic. */
const LAYER_FX = "#fx";

export type FrameAction =
	| { type: "stop" }
	| { type: "play" }
	| { type: "goto"; target: number | string; play: boolean };

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
	camera?: TimelineData["camera"];
	/** Camera (root scenes): transform applied to all layers, in this timeline's frame time. */
	view?: TransformTracks;
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
	for (const id in model.timelines) {
		wrapLayerEffects(programs, programs[id]!, model.timelines[id]!, warnings);
		wrapRigs(programs, programs[id]!, opts);
	}
	return { programs, warnings };
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

function layerIncluded(layers: LayerData[], i: number, opts: CompileOptions): boolean {
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
				const acts = parseActions(kf.script);
				if (acts.length) (prog.actions[kf.index] ??= []).push(...acts);
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

/** Recognises the frame actions that matter for playback (AS3 and HTML5 Canvas syntax). */
export function parseActions(script: string): FrameAction[] {
	const out: FrameAction[] = [];
	const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	const re = /(?:^|[^\w.])(?:this\s*\.\s*)?(stop|play|gotoAndPlay|gotoAndStop)\s*\(\s*([^)]*?)\s*\)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(code))) {
		const fn = m[1]!;
		if (fn === "stop") out.push({ type: "stop" });
		else if (fn === "play") out.push({ type: "play" });
		else {
			const arg = m[2]!.split(",")[0]!.trim();
			let target: number | string;
			const str = /^["'](.*)["']$/.exec(arg);
			if (str) target = str[1]!;
			else if (/^\d+$/.test(arg)) target = parseInt(arg, 10);
			else continue;
			out.push({ type: "goto", target, play: fn === "gotoAndPlay" });
		}
	}
	return out;
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
