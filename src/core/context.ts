import { importArtwork, artworkSignature, type Artwork } from "./artwork.ts";
import { fmt } from "./geom.ts";
import { el } from "./xml.ts";
import type { SceneModel } from "./model.ts";
import { applyNineSlice } from "./nineslice.ts";
import { buildPrograms, type CompileOptions, type Program } from "./program.ts";

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
	digits: number;
}

export function createContext(model: SceneModel, files: FileSource, opts: CompileOptions & { digits?: number }): Context {
	const { programs, warnings } = buildPrograms(model, opts);
	const cache = new Map<string, Artwork | null>();
	// artworks made by the compiler itself (9-slice copies), keyed like atlas ids
	const derived = new Map<string, Artwork | null>();
	const bySig = new Map<string, Artwork>();
	const digits = opts.digits ?? 2;
	// atlas id -> gradients that use linear RGB interpolation
	const linear = new Map<string, Set<string>>();
	const addLinear = (atlas: string, sigs: Iterable<string>) => {
		const s = linear.get(atlas) ?? new Set<string>();
		for (const g of sigs) s.add(g);
		linear.set(atlas, s);
	};
	for (const tl of Object.values(model.timelines))
		for (const l of tl.layers)
			l.keyframes.forEach((kf, k) => {
				for (const e of kf.elements) if (e.kind === "shape" && e.linearRGB?.length) addLinear(e.atlas, e.linearRGB);
				// shape tween frames: in-between gradients have in-between colours, so match them all ("*")
				const frames = kf.tween?.type === "shape" ? kf.tween.shapeFrames : undefined;
				if (!frames) return;
				const lin = (els: typeof kf.elements | undefined) => (els ?? []).flatMap((e) => (e.kind === "shape" ? (e.linearRGB ?? []) : []));
				const a = lin(kf.elements),
					b = lin(l.keyframes[k + 1]?.elements);
				if (!a.length && !b.length) return;
				for (const id of frames) addLinear(id, a.length && (b.length || !l.keyframes[k + 1]) ? [...a, ...b, "*"] : [...a, ...b]);
			});
	const ctx: Context = {
		model,
		programs,
		opts,
		files,
		warnings,
		digits,
		art(id) {
			if (derived.has(id)) return derived.get(id)!;
			if (cache.has(id)) return cache.get(id)!;
			const item = model.atlas[id];
			let result: Artwork | null = null;
			if (!item) {
				warnings.push(`Missing artwork ${id}`);
			} else {
				try {
					const a = importArtwork(files.readText(item.file), "s" + id.replace(/[^A-Za-z0-9_]/g, "_"), { digits, linearRGB: linear.get(id) });
					const off = item.offset;
					if (off && (Math.abs(off.x) > 1e-6 || Math.abs(off.y) > 1e-6)) {
						a.body = el("g", { transform: `translate(${fmt(-off.x, digits)} ${fmt(-off.y, digits)})` }, [a.body]);
					}
					if (!a.empty) {
						const sig = artworkSignature(a);
						result = bySig.get(sig) ?? a;
						bySig.set(sig, result);
					}
				} catch (e) {
					warnings.push(`Could not read artwork ${id} (${item.file}): ${(e as Error).message}`);
				}
			}
			cache.set(id, result);
			return result;
		},
	};
	const warn = (m: string) => {
		if (!warnings.includes(m)) warnings.push(m);
	};
	const addArt = (id: string, a: Artwork | null) => derived.set(id, a);
	applyNineSlice(model, programs, ctx.art, addArt, digits, warn, opts.smooth);
	return ctx;
}
