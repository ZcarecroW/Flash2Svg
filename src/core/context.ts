import { importArtwork, artworkPaints, artworkSignature, type Artwork } from "./artwork.ts";
import { fmt } from "./geom.ts";
import { el } from "./xml.ts";
import type { BitmapFill, SceneModel } from "./model.ts";
import { applyNineSlice } from "./nineslice.ts";
import { buildMorph, type Morph } from "./morph.ts";
import { measurePrecision, type Precision } from "./precision.ts";
import { buildPrograms, markShapeAlpha, type ArtSeqItem, type CompileOptions, type Program } from "./program.ts";
import { valueAt } from "./tracks.ts";

/** Reads files that sit next to scene.json (atlas SVGs, bitmaps, sounds). */
export interface FileSource {
	readText(rel: string): string;
	readBinary(rel: string): Uint8Array;
}

export interface Context {
	model: SceneModel;
	programs: Record<string, Program>;
	opts: CompileOptions;
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

export function createContext(model: SceneModel, files: FileSource, opts: CompileOptions & { digits?: number }): Context {
	const { programs, warnings } = buildPrograms(model, opts);
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
	// atlas id -> bitmaps used as fills
	const bitmapFills = new Map<string, BitmapFill[]>();
	const addBitmaps = (atlas: string, fills: BitmapFill[]) => {
		const list = bitmapFills.get(atlas) ?? [];
		for (const f of fills) if (!list.some((g) => g.name === f.name)) list.push(f);
		bitmapFills.set(atlas, list);
	};
	for (const tl of Object.values(model.timelines))
		for (const l of tl.layers)
			l.keyframes.forEach((kf, k) => {
				for (const e of kf.elements) {
					if (e.kind !== "shape") continue;
					if (e.linearRGB?.length) addLinear(e.atlas, e.linearRGB);
					if (e.bitmapFills?.length) addBitmaps(e.atlas, e.bitmapFills);
					if (e.fixedStrokes?.length) addFixed(e.atlas, e.fixedStrokes);
				}
				// shape tween frames: in-between gradients have in-between colours, so match them all ("*")
				const frames = kf.tween?.type === "shape" ? kf.tween.shapeFrames : undefined;
				if (!frames) return;
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
					const opts = { digits: d, linearRGB: linear.get(id), bitmapFills: bitmapFills.get(id), fixedStrokes: fixed.get(id) };
					// what else shapes the import (the same text with non-scaling strokes is another drawing)
					const how = JSON.stringify([[...(opts.linearRGB ?? [])].sort(), (opts.bitmapFills ?? []).map((b) => b.name), [...(opts.fixedStrokes ?? [])].sort()]);
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
	markShapeAlpha(programs, model.roots, (id) => {
		const a = ctx.art(id);
		return (bitmapFills.has(id) ? 4 : 0) | (a ? artworkPaints(a) : 0);
	});
	return ctx;
}
