import { importArtwork, artworkSignature, type Artwork } from "./artwork.ts";
import { fmt } from "./geom.ts";
import { el } from "./xml.ts";
import type { SceneModel } from "./model.ts";
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
	const bySig = new Map<string, Artwork>();
	const digits = opts.digits ?? 2;
	// atlas id -> gradients that use linear RGB interpolation
	const linear = new Map<string, Set<string>>();
	for (const tl of Object.values(model.timelines))
		for (const l of tl.layers)
			for (const kf of l.keyframes)
				for (const e of kf.elements)
					if (e.kind === "shape" && e.linearRGB?.length) {
						const s = linear.get(e.atlas) ?? new Set<string>();
						e.linearRGB.forEach((g) => s.add(g));
						linear.set(e.atlas, s);
					}
	const ctx: Context = {
		model,
		programs,
		opts,
		files,
		warnings,
		digits,
		art(id) {
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
	return ctx;
}
