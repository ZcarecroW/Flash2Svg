/**
 * How large each bitmap is shown at most, so encodeImages (images.ts) can make it smaller without
 * a visible change. For every place a bitmap is drawn (bitmap elements, bitmap fills, inside nested
 * symbols, in tweens, under layer parenting and the camera) the scale of its own x and y axis on
 * the stage is taken (1 = one bitmap pixel per stage pixel), the largest over all frames.
 *
 * Read from the scene model directly (no programs are built): element matrices at keyframes and
 * the per-frame tween samples Animate computed. Nested timelines multiply by the largest scale of
 * their instances, which is an upper bound (the levels may animate independently), so a bitmap is
 * never made smaller than it is shown.
 */
import { safeName } from "./artwork.ts";
import type { FileSource } from "./context.ts";
import { parseTransform } from "./geom.ts";
import type { BitmapFill, Keyframe, LayerData, Mat, SceneModel } from "./model.ts";
import { layerIncluded } from "./program.ts";

export interface BitmapScale {
	/** Largest scale of the bitmap's x and y axis on the stage. */
	x: number;
	y: number;
	/** Used as a repeating fill: the tiles must keep their pixels (resizing would blur the seams). */
	tiled: boolean;
}

type Scales = Map<string, BitmapScale>;

/** Largest stretch of a matrix (its largest singular value). */
function norm(m: Mat): number {
	const [a, b, c, d] = m;
	const t = a * a + b * b + c * c + d * d;
	const det = a * d - b * c;
	return Math.sqrt((t + Math.sqrt(Math.max(0, t * t - 4 * det * det))) / 2);
}

/** Smallest stretch of a matrix (its smallest singular value). */
function minNorm(m: Mat): number {
	const [a, b, c, d] = m;
	const t = a * a + b * b + c * c + d * d;
	const det = a * d - b * c;
	return Math.sqrt(Math.max(0, (t - Math.sqrt(Math.max(0, t * t - 4 * det * det))) / 2));
}

function add(out: Scales, bitmap: string, x: number, y: number, tiled: boolean) {
	const o = out.get(bitmap);
	if (!o) out.set(bitmap, { x, y, tiled });
	else {
		o.x = Math.max(o.x, x);
		o.y = Math.max(o.y, y);
		o.tiled ||= tiled;
	}
}

/** The matrices an instance has in a keyframe: its own and, in tweens, one per frame. */
function matricesOf(kf: Keyframe, own: Mat): Mat[] {
	const s = kf.tween?.samples;
	return s?.length ? [own, ...s.map((x) => x.matrix)] : [own];
}

export function bitmapScales(model: SceneModel, files: FileSource, opts: { includeHiddenLayers?: boolean; includeGuides?: boolean } = {}): Scales {
	const include = { includeHiddenLayers: opts.includeHiddenLayers ?? true, includeGuides: opts.includeGuides ?? false };
	const memo = new Map<string, Scales>();
	const fills = new Map<string, Scales>();

	/** Bitmap fills of an atlas drawing: Animate's SVG export places each as a pattern. */
	const fillScales = (atlas: string, used: BitmapFill[]): Scales => {
		const key = atlas + "|" + used.map((f) => f.bitmap).join(",");
		let out = fills.get(key);
		if (out) return out;
		out = new Map();
		fills.set(key, out);
		let text = "";
		try {
			const item = model.atlas[atlas];
			if (item) text = files.readText(item.file);
		} catch {
			/* unreadable: the fills keep their full size below */
		}
		const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
		const images = new Map<string, string>();
		for (const m of text.matchAll(/<image\b[^>]*>/g)) {
			const id = attr(m[0], "id");
			const href = attr(m[0], "xlink:href") ?? attr(m[0], "href");
			if (id && href) images.set(id, href.replace(/^.*\//, "").replace(/\.[^.]*$/, ""));
		}
		// the drawing's own transforms (groups, drawing objects): the largest, as a bound
		let body = 1;
		for (const m of text.matchAll(/\stransform="([^"]*)"/g)) body = Math.max(body, norm(parseTransform(m[1])));
		for (const m of text.matchAll(/<pattern\b([^>]*)>([\s\S]*?)<\/pattern>/g)) {
			const use = /href="#([^"]+)"/.exec(m[2]!)?.[1];
			const file = use ? images.get(use) : undefined;
			const f = used.length === 1 ? used[0] : used.find((b) => safeName(b.name) === file);
			if (!f) continue;
			const p = parseTransform(attr(m[1]!, "patternTransform"));
			add(out, f.bitmap, Math.hypot(p[0], p[1]) * body, Math.hypot(p[2], p[3]) * body, !f.clipped);
		}
		// a fill the drawing doesn't show as expected: keep it as it is
		for (const f of used) if (!out.has(f.bitmap)) add(out, f.bitmap, Infinity, Infinity, !f.clipped);
		return out;
	};

	const inner = (id: string): Scales => {
		let out = memo.get(id);
		if (out) return out;
		out = new Map();
		memo.set(id, out); // (also guards against cycles)
		const tl = model.timelines[id];
		if (!tl) return out;
		tl.layers.forEach((layer: LayerData, li) => {
			if (layer.type === "camera" || !layerIncluded(tl.layers, li, include)) return;
			// layer parenting: the parent's matrix per frame (none = not parented in that frame)
			let rig = layer.rig?.length ? 0 : 1;
			for (const m of layer.rig ?? []) rig = Math.max(rig, m ? norm(m) : 1);
			layer.keyframes.forEach((kf, k) => {
				for (const e of kf.elements) {
					if (e.kind === "bitmap") {
						const [a, b, c, d] = e.matrix;
						add(out, e.bitmap, Math.hypot(a, b) * rig, Math.hypot(c, d) * rig, false);
					} else if (e.kind === "instance") {
						// (3D: the perspective can magnify more than the matrix tells)
						let s = e.is3D ? Infinity : 0;
						for (const m of matricesOf(kf, e.matrix)) s = Math.max(s, norm(m));
						s *= rig;
						for (const [b, v] of inner(e.symbol)) add(out, b, v.x * s, v.y * s, v.tiled);
					} else if (e.kind === "shape" && e.bitmapFills?.length) {
						for (const [b, v] of fillScales(e.atlas, e.bitmapFills)) add(out, b, v.x * rig, v.y * rig, v.tiled);
					}
				}
				// shape tweens: one drawing per frame, with the fills of both ends
				const frames = kf.tween?.type === "shape" ? kf.tween.shapeFrames : undefined;
				if (!frames?.length) return;
				const used = [...kf.elements, ...(layer.keyframes[k + 1]?.elements ?? [])].flatMap((e) => (e.kind === "shape" ? (e.bitmapFills ?? []) : []));
				if (!used.length) return;
				const unique = used.filter((f, i) => used.findIndex((g) => g.bitmap === f.bitmap) === i);
				for (const atlas of frames) for (const [b, v] of fillScales(atlas, unique)) add(out, b, v.x * rig, v.y * rig, v.tiled);
			});
		});
		return out;
	};

	const result: Scales = new Map();
	for (const root of model.roots) {
		const tl = model.timelines[root];
		if (!tl) continue;
		// the camera: the view is the inverse of the camera's matrix, so it magnifies by 1 / its
		// smallest stretch
		let view = 0;
		const cam = tl.layers.find((l) => l.type === "camera");
		for (const kf of cam?.keyframes ?? [])
			for (const e of kf.elements) if (e.kind === "instance") for (const m of matricesOf(kf, e.matrix)) view = Math.max(view, 1 / Math.max(1e-6, minNorm(m)));
		// frames without a camera show the stage as it is
		if (!view || (cam && cam.keyframes.some((kf) => !kf.elements.some((e) => e.kind === "instance")))) view = Math.max(view, 1);
		for (const [b, v] of inner(root)) add(result, b, v.x * view, v.y * view, v.tiled);
	}
	return result;
}
