import { importArtwork, artworkPaints, artworkSignature, gradientPlan, type Artwork } from "./artwork.ts";
import { fmt } from "./geom.ts";
import type { Grade } from "./grade.ts";
import { el } from "./xml.ts";
import type { BitmapFill, SceneModel } from "./model.ts";
import { applyNineSlice } from "./nineslice.ts";
import { applyPens, type PenModes } from "./pens.ts";
import { contentBounds } from "./nineslice.ts";
import { buildMorph, type Morph } from "./morph.ts";
import { guideCurve, type GuideCurve } from "./motionpath.ts";
import { measurePrecision, type Precision } from "./precision.ts";
import { buildPrograms, markShapeAlpha, type ArtSeqItem, type CompileOptions, type Program } from "./program.ts";
import { valueAt } from "./tracks.ts";

/** Reads files that sit next to scene.json (atlas SVGs, bitmaps, sounds). */
export interface FileSource {
	readText(rel: string): string;
	readBinary(rel: string): Uint8Array;
}

/**
 * How the SVG fits the space it is given (Flash's scale modes): "fixed" at the stage size, or
 * filling it: "fit" shows all (letterboxed), "fill" leaves no border (cropped), "stretch" fits
 * exactly (distorted).
 */
export type ScaleMode = "fixed" | "fit" | "fill" | "stretch";

export interface Context {
	model: SceneModel;
	programs: Record<string, Program>;
	opts: CompileOptions;
	/** Root <svg> sizing (default "fixed"). */
	scale?: ScaleMode;
	/** The stage colour behind the stage too (letterbox areas of "fit"). */
	background?: boolean;
	files: FileSource;
	warnings: string[];
	/** Artwork for an atlas id (deduplicated: identical drawings share one Artwork). */
	art(atlasId: string): Artwork | null;
	/** A shape tween as path morphs (null: frame by frame), see morph.ts. Computed once per item. */
	morph(item: ArtSeqItem): Morph | null;
	/** Decimals asked for on screen; `precision` turns them into decimals per coordinate space. */
	digits: number;
	precision: Precision;
}

/** Where 3D instances' content is: the HTML that turns it is that size, not the size of everything. */
function placePerspective(model: SceneModel, programs: Record<string, Program>, art: (id: string) => Artwork | null) {
	for (const p of Object.values(programs))
		for (const l of p.layers)
			for (const it of l.items) {
				if (it.kind !== "instance" || !it.persp) continue;
				const child = programs[it.symbol];
				const b = child ? contentBounds(child, art) : null;
				const room = 4;
				it.persp.box = b ? [Math.floor(b.l - room), Math.floor(b.t - room), Math.ceil(b.r - b.l + 2 * room), Math.ceil(b.b - b.t + 2 * room)] : [-model.doc.width, -model.doc.height, 2 * model.doc.width, 2 * model.doc.height];
			}
}

/**
 * `grade`: colour grading of the drawings (grade.ts; the model is graded before, by gradeModel).
 */
export function createContext(model: SceneModel, files: FileSource, opts: CompileOptions & { digits?: number; grade?: Grade }): Context {
	const grade = opts.grade && !opts.grade.empty ? opts.grade : undefined;
	// guide layers' drawings as curves (motion guides followed along the path, motionpath.ts)
	const guides = new Map<string, GuideCurve | null>();
	const guide = (id: string): GuideCurve | null => {
		if (!guides.has(id)) {
			const item = model.atlas[id];
			let c: GuideCurve | null = null;
			try {
				if (item) c = guideCurve(files.readText(item.file), item.offset);
			} catch {
				c = null;
			}
			guides.set(id, c);
		}
		return guides.get(id)!;
	};
	const { programs, warnings } = buildPrograms(model, { ...opts, guide: opts.guide ?? guide });
	const cache = new Map<string, Artwork | null>();
	// artworks made by the compiler itself (9-slice copies), keyed like atlas ids
	const derived = new Map<string, Artwork | null>();
	const byKey = new Map<string, Artwork[]>();
	const sigs = new WeakMap<Artwork, string>();
	const signatureOf = (a: Artwork) => {
		let s = sigs.get(a);
		if (s === undefined) sigs.set(a, (s = artworkSignature(a)));
		return s;
	};
	const digits = opts.digits ?? 2;
	const precision = measurePrecision(model, programs, digits);
	// the source text and decimals of each imported artwork (an identical drawing reuses it)
	const sources = new WeakMap<Artwork, { text: string; digits: number; how: string }>();
	// atlas id -> gradients that use linear RGB interpolation
	const linear = new Map<string, Set<string>>();
	const addLinear = (atlas: string, sigs: Iterable<string>) => {
		const s = linear.get(atlas) ?? new Set<string>();
		for (const g of sigs) s.add(g);
		linear.set(atlas, s);
	};
	// atlas id -> strokes that keep their width when scaled
	const fixed = new Map<string, Set<string>>();
	const addFixed = (atlas: string, sigs: string[]) => {
		const s = fixed.get(atlas) ?? new Set<string>();
		for (const g of sigs) s.add(g);
		fixed.set(atlas, s);
	};
	// atlas id -> strokes that scale one way only
	const pens = new Map<string, PenModes>();
	const addPens = (atlas: string, sigs: string[]) => {
		const m = pens.get(atlas) ?? new Map<string, string>();
		for (const g of sigs) {
			const at = g.lastIndexOf("|");
			m.set(g.slice(0, at), g.slice(at + 1));
		}
		pens.set(atlas, m);
	};
	// atlas id -> bitmaps used as fills
	const bitmapFills = new Map<string, BitmapFill[]>();
	const addBitmaps = (atlas: string, fills: BitmapFill[]) => {
		const list = bitmapFills.get(atlas) ?? [];
		for (const f of fills) if (!list.some((g) => g.name === f.name)) list.push(f);
		bitmapFills.set(atlas, list);
	};
	// graded shape tweens: the drawings of one tween (its frames and both keyframes) share their
	// gradients' extra stops (union-find over atlas ids; a keyframe can end one tween and start the next)
	const tweenOf = new Map<string, string>();
	const rootOf = (id: string): string => {
		let r = id;
		while (tweenOf.has(r) && tweenOf.get(r) !== r) r = tweenOf.get(r)!;
		tweenOf.set(id, r);
		return r;
	};
	const join = (ids: string[]) => {
		if (!grade || ids.length < 2) return;
		for (const id of ids) if (!tweenOf.has(id)) tweenOf.set(id, id);
		const r = rootOf(ids[0]!);
		for (const id of ids.slice(1)) tweenOf.set(rootOf(id), r);
	};
	for (const tl of Object.values(model.timelines))
		for (const l of tl.layers)
			l.keyframes.forEach((kf, k) => {
				for (const e of kf.elements) {
					if (e.kind !== "shape") continue;
					if (e.linearRGB?.length) addLinear(e.atlas, e.linearRGB);
					if (e.bitmapFills?.length) addBitmaps(e.atlas, e.bitmapFills);
					if (e.fixedStrokes?.length) addFixed(e.atlas, e.fixedStrokes);
					if (e.penStrokes?.length) addPens(e.atlas, e.penStrokes);
				}
				// shape tween frames: in-between gradients have in-between colours, so match them all ("*")
				const frames = kf.tween?.type === "shape" ? kf.tween.shapeFrames : undefined;
				if (!frames) return;
				const shapesOf = (els: typeof kf.elements | undefined) => (els ?? []).flatMap((e) => (e.kind === "shape" ? [e.atlas] : []));
				join([...shapesOf(kf.elements), ...frames, ...shapesOf(l.keyframes[k + 1]?.elements)]);
				const bmps = [...kf.elements, ...(l.keyframes[k + 1]?.elements ?? [])].flatMap((e) => (e.kind === "shape" ? (e.bitmapFills ?? []) : []));
				if (bmps.length) for (const id of frames) addBitmaps(id, bmps);
				const fx = [...kf.elements, ...(l.keyframes[k + 1]?.elements ?? [])].flatMap((e) => (e.kind === "shape" ? (e.fixedStrokes ?? []) : []));
				if (fx.length) for (const id of frames) addFixed(id, fx);
				const lin = (els: typeof kf.elements | undefined) => (els ?? []).flatMap((e) => (e.kind === "shape" ? (e.linearRGB ?? []) : []));
				const a = lin(kf.elements),
					b = lin(l.keyframes[k + 1]?.elements);
				if (!a.length && !b.length) return;
				for (const id of frames) addLinear(id, a.length && (b.length || !l.keyframes[k + 1]) ? [...a, ...b, "*"] : [...a, ...b]);
			});
	const plans = new Map<string, Map<number, number[][]>>();
	/** The merged stop plan of the shape tween drawing `id` belongs to (gradientPlan), or undefined. */
	const planOf = (id: string): Map<number, number[][]> | undefined => {
		if (!grade || !tweenOf.has(id)) return undefined;
		const root = rootOf(id);
		let plan = plans.get(root);
		if (!plan) {
			plan = new Map();
			for (const member of tweenOf.keys()) {
				if (rootOf(member) !== root) continue;
				const item = model.atlas[member];
				if (!item) continue;
				let text: string;
				try {
					text = files.readText(item.file);
				} catch {
					continue;
				}
				for (const [g, knots] of gradientPlan(text, grade, linear.get(member))) {
					const had = plan.get(g) ?? [];
					const n = Math.max(had.length, knots.length);
					plan.set(
						g,
						Array.from({ length: n }, (_, i) => [...new Set([...(had[i] ?? []), ...(knots[i] ?? [])])].sort((x, y) => x - y)),
					);
				}
			}
			plans.set(root, plan);
		}
		return plan;
	};
	const morphs = new WeakMap<ArtSeqItem, Morph | null>();
	const ctx: Context = {
		model,
		programs,
		opts,
		files,
		warnings,
		digits,
		precision,
		art(id) {
			if (derived.has(id)) return derived.get(id)!;
			if (cache.has(id)) return cache.get(id)!;
			const item = model.atlas[id];
			let result: Artwork | null = null;
			if (!item) {
				warnings.push(`Missing artwork ${id}`);
			} else {
				try {
					const text = files.readText(item.file);
					const off = item.offset;
					// duplicates: full signatures only among artworks whose source text has the same length
					const key = `${text.length}|${off?.x ?? 0},${off?.y ?? 0}`;
					const same = byKey.get(key);
					const d = precision.art(id);
					const opts = { digits: d, linearRGB: linear.get(id), bitmapFills: bitmapFills.get(id), fixedStrokes: fixed.get(id), grade, stopPlan: planOf(id) };
					// what else shapes the import (the same text with non-scaling strokes is another drawing)
					const how = JSON.stringify([
						[...(opts.linearRGB ?? [])].sort(),
						(opts.bitmapFills ?? []).map((b) => b.name),
						[...(opts.fixedStrokes ?? [])].sort(),
						opts.stopPlan ? [...opts.stopPlan] : 0,
					]);
					// the same drawing, imported the same way with at least these decimals
					const twin = same?.find((b) => {
						const s = sources.get(b)!;
						return s.text === text && s.how === how && s.digits >= d;
					});
					if (twin) result = twin;
					else {
						const a = importArtwork(text, "s" + id.replace(/[^A-Za-z0-9_]/g, "_"), opts);
						if (off && (Math.abs(off.x) > 1e-6 || Math.abs(off.y) > 1e-6)) {
							a.body = el("g", { transform: `translate(${fmt(-off.x, d)} ${fmt(-off.y, d)})` }, [a.body]);
						}
						sources.set(a, { text, digits: d, how });
						if (!a.empty) {
							if (!same) {
								byKey.set(key, [a]);
								result = a;
							} else {
								const sig = artworkSignature(a);
								result = same.find((b) => signatureOf(b) === sig) ?? a;
								if (result === a) {
									sigs.set(a, sig);
									same.push(a);
								}
							}
						}
					}
				} catch (e) {
					warnings.push(`Could not read artwork ${id} (${item.file}): ${(e as Error).message}`);
				}
			}
			cache.set(id, result);
			return result;
		},
		morph(item) {
			if (!item.ratio) return null;
			let m = morphs.get(item);
			if (m === undefined) {
				const ratios = item.arts.map((_, k) => valueAt(item.ratio!, item.start + k));
				m = buildMorph(
					item.arts.map((id) => ctx.art(id)),
					ratios,
					item.ratio,
					item.start,
					precision.art(item.arts[0] ?? ""),
				);
				morphs.set(item, m);
			}
			return m;
		},
	};
	const warn = (m: string) => {
		if (!warnings.includes(m)) warnings.push(m);
	};
	const addArt = (id: string, a: Artwork | null) => derived.set(id, a);
	applyNineSlice(model, programs, ctx.art, addArt, digits, warn, opts.smooth);
	applyPens(model.roots, programs, ctx.art, addArt, (id) => precision.art(id), pens, !!opts.pensInDrawings);
	placePerspective(model, programs, ctx.art);
	markShapeAlpha(programs, model.roots, (id) => {
		const a = ctx.art(id);
		return (bitmapFills.has(id) ? 4 : 0) | (a ? artworkPaints(a) : 0);
	});
	return ctx;
}
