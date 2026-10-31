/**
 * Decimals from the displayed size. `digits` is the precision asked for on screen (in pixels of
 * the document). A coordinate space shown at most P times larger needs log10(P) decimals more,
 * one shown smaller fewer; an angle or a scale factor needs as many as the content it turns or
 * stretches spans on screen. Measured from the programs, before anything is drawn: the largest
 * scale each timeline is shown at (over all its uses and all frames, bounded from the keys) and
 * how far its content reaches from its origin.
 */
import type { SceneModel } from "./model.ts";
import type { InstanceItem, Program, TransformProp } from "./program.ts";
import type { Track } from "./tracks.ts";

export interface Precision {
	/** Decimals of coordinates in a program's own space (its drawings, its children's positions). */
	space(programId: string): number;
	/** Decimals of an atlas drawing: for the largest scale any program shows it at. */
	art(atlasId: string): number;
	/** Decimals of each transform property of an instance placed in program `parent`. */
	instance(item: InstanceItem, parent: string): Record<TransformProp, number>;
	/** The same for a timeline's camera (placed on the stage). */
	view(programId: string): Record<TransformProp, number>;
}

const RAD = Math.PI / 180;

/**
 * Decimals for a quantity one unit of which spans `px` screen pixels: rounded on the log scale,
 * so the error on screen stays within about 3 times what `D` decimals give at 1:1 (0.016 px for
 * 2) either way.
 */
export function decimalsFor(D: number, px: number): number {
	if (!(px > 0) || !Number.isFinite(px)) return D;
	return Math.max(0, Math.min(D + 4, Math.max(D, 8), Math.round(D + Math.log10(px))));
}

/**
 * Angles (degrees) and scale factors: as many decimals as the content they turn or stretch spans
 * on screen, but never fewer than 3 and 4: their error lands on the whole outline at once, and
 * they are a small part of the output.
 */
function factorDecimals(D: number, px: number, least: number): number {
	return Math.max(least, decimalsFor(D, px));
}

/** Smallest and largest value of a track (eased pieces: their control points bound them). */
function range(t: Track): [number, number] {
	let lo = Infinity,
		hi = -Infinity;
	for (let i = 0; i < t.length; i++) {
		const k = t[i]!;
		lo = Math.min(lo, k.v);
		hi = Math.max(hi, k.v);
		const n = t[i + 1];
		if (n && Array.isArray(k.ease)) {
			for (const y of [k.ease[1], k.ease[3]]) {
				const v = k.v + (n.v - k.v) * y;
				lo = Math.min(lo, v);
				hi = Math.max(hi, v);
			}
		}
	}
	return t.length ? [lo, hi] : [0, 0];
}

const absMax = (t: Track) => {
	const [lo, hi] = range(t);
	return Math.max(Math.abs(lo), Math.abs(hi));
};

interface Reach {
	/** Largest stretch of the linear part (its largest singular value), bounded. */
	scale: number;
	/** Largest distance of the transformation point from the origin (local units). */
	tp: number;
	/** Largest distance of the position from the parent's origin. */
	pos: number;
}

function reachOf(tr: Record<TransformProp, Track>): Reach {
	// R * SkewX * Scale: |SkewX * Scale| <= max(|sx|, |sy|) * (1 + |tan skew|)
	const [k0, k1] = range(tr.skw);
	const tan = Math.min(10, Math.max(Math.abs(Math.tan(k0 * RAD)), Math.abs(Math.tan(k1 * RAD))));
	return {
		scale: Math.max(absMax(tr.sx), absMax(tr.sy)) * (1 + tan),
		tp: Math.hypot(absMax(tr.tpx), absMax(tr.tpy)),
		pos: Math.hypot(absMax(tr.x), absMax(tr.y)),
	};
}

export function measurePrecision(model: SceneModel, programs: Record<string, Program>, D: number): Precision {
	const reach = new WeakMap<object, Reach>();
	const reachOfItem = (o: { transform: Record<TransformProp, Track> }) => {
		let r = reach.get(o);
		if (!r) reach.set(o, (r = reachOf(o.transform)));
		return r;
	};
	const find = (id: string) => programs[id] ?? (programs[id.replace(/#.*$/, "")] as Program | undefined);

	// how far each program's content reaches from its origin (its own units)
	const extent = new Map<string, number>();
	const corner = (b: { left: number; top: number; width: number; height: number }) =>
		Math.max(
			Math.hypot(b.left, b.top),
			Math.hypot(b.left + b.width, b.top),
			Math.hypot(b.left, b.top + b.height),
			Math.hypot(b.left + b.width, b.top + b.height),
		);
	const extentOf = (id: string): number => {
		const known = extent.get(id);
		if (known !== undefined) return known;
		extent.set(id, 0); // a symbol inside itself
		const prog = find(id);
		let e = 0;
		const tl = prog ? model.timelines[prog.source ?? prog.id] : undefined;
		if (tl) for (const l of tl.layers) for (const kf of l.keyframes) for (const el of kf.elements) e = Math.max(e, corner(el.bounds));
		if (prog)
			for (const l of prog.layers)
				for (const it of l.items) {
					if (it.kind === "instance") {
						const r = reachOfItem(it);
						e = Math.max(e, r.pos + r.scale * (r.tp + extentOf(it.symbol)));
					} else if (it.kind === "text") e = Math.max(e, corner(it.element.bounds));
				}
		extent.set(id, e);
		return e;
	};

	// the largest scale each program is shown at; the drawings' too
	const scale = new Map<string, number>();
	const artScale = new Map<string, number>();
	const show = (id: string, P: number, depth: number) => {
		const prog = programs[id];
		if (!prog || depth > 64 || !(P > 0) || P <= (scale.get(id) ?? 0) * 1.01) return;
		scale.set(id, P);
		const art = (a: string) => artScale.set(a, Math.max(artScale.get(a) ?? 0, P));
		for (const l of prog.layers)
			for (const it of l.items) {
				if (it.kind === "art") art(it.art);
				else if (it.kind === "artSeq") it.arts.forEach(art);
				else if (it.kind === "text") art(it.art);
				else if (it.kind === "instance") show(it.symbol, P * reachOfItem(it).scale, depth + 1);
			}
	};
	for (const root of model.roots) {
		const v = programs[root]?.view;
		show(root, v ? reachOf(v).scale : 1, 0);
	}
	const scaleOf = (id: string) => scale.get(id) ?? scale.get(find(id)?.source ?? id.replace(/#.*$/, "")) ?? 1;

	const props = (P: number, r: Reach, E: number): Record<TransformProp, number> => {
		const pos = decimalsFor(D, P),
			tp = decimalsFor(D, P * r.scale),
			angle = factorDecimals(D, P * r.scale * (E + r.tp) * RAD, 3),
			factor = factorDecimals(D, P * (E + r.tp), 4);
		return { x: pos, y: pos, tpx: tp, tpy: tp, rot: angle, skw: angle, sx: factor, sy: factor };
	};
	const cache = new WeakMap<InstanceItem, Record<TransformProp, number>>();
	return {
		space: (id) => decimalsFor(D, scaleOf(id)),
		art: (id) => decimalsFor(D, artScale.get(id) ?? 1),
		instance(item, parent) {
			let d = cache.get(item);
			if (!d) cache.set(item, (d = props(scaleOf(parent), reachOfItem(item), extentOf(item.symbol))));
			return d;
		},
		view(id) {
			const v = programs[id]?.view;
			return v ? props(1, reachOf(v), extentOf(id)) : props(1, { scale: 1, tp: 0, pos: 0 }, extentOf(id));
		},
	};
}
