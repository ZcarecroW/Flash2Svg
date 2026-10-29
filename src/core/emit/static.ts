/**
 * Static rendering: the scene at one frame, without animation. Used for "SVG images" export and
 * as the reference for verifying everything against Animate's own PNG renderings.
 */
import type { Context } from "../context.ts";
import { fmt, fmtMatrix } from "../geom.ts";
import type { Mat } from "../model.ts";
import { COLOR_PROPS, fromProps, TRANSFORM_PROPS, type ColorProp, type InstanceItem, type Item, type Program, type ProgramLayer, type TransformProp } from "../program.ts";
import { valueAt } from "../tracks.ts";
import { el, type XmlNode } from "../xml.ts";
import { OutputDoc, svgRoot } from "./document.ts";
import { cssBlendMode, isAlphaOnly, type ColorMatrixValues } from "./filters.ts";
import { textNode } from "./text.ts";
import { graphicFrame, playheadFrame } from "./timing.ts";

export interface StaticOptions {
	/** Root frame to render (0-based). */
	frame: number;
	/**
	 * How movie clips pick their frame. "play" = as if the movie played up to `frame`;
	 * "first" = always their first frame (what Animate's stage and PNG export show).
	 */
	movieClips: "play" | "first";
	includeBackground: boolean;
	embedImages: boolean;
	textAsOutlines: boolean;
	pretty?: boolean;
	/** Start of every id (see ExportSettings.idPrefix). */
	idPrefix?: string;
}

export function renderStatic(ctx: Context, rootId: string, opts: StaticOptions): { svg: string; assets: OutputDoc["assets"] } {
	const doc = new OutputDoc(ctx, { embedImages: opts.embedImages, idPrefix: opts.idPrefix ?? "" });
	const root = svgRoot(ctx);
	if (opts.includeBackground) {
		const d = ctx.model.doc;
		root.children.push(el("rect", { width: fmt(d.width, 2), height: fmt(d.height, 2), fill: d.backgroundColor }));
	}
	const r = new StaticRenderer(ctx, doc, opts);
	const prog = ctx.programs[rootId];
	if (!prog) throw new Error(`Unknown timeline ${rootId}`);
	root.children.push(...r.timeline(prog, opts.frame, opts.frame, 0));
	return { svg: doc.toString(root, { pretty: opts.pretty }), assets: doc.assets };
}

export class StaticRenderer {
	private symbolCache = new Map<string, string>();
	readonly ctx: Context;
	readonly doc: OutputDoc;
	readonly opts: Pick<StaticOptions, "movieClips" | "textAsOutlines">;
	constructor(ctx: Context, doc: OutputDoc, opts: Pick<StaticOptions, "movieClips" | "textAsOutlines">) {
		this.ctx = ctx;
		this.doc = doc;
		this.opts = opts;
	}

	warn = (m: string) => {
		if (!this.ctx.warnings.includes(m)) this.ctx.warnings.push(m);
	};

	/**
	 * Children of a timeline at local `frame`. `ticks` = how long the timeline has existed
	 * (drives nested movie clips).
	 */
	timeline(prog: Program, frame: number, ticks: number, depth: number): XmlNode[] {
		if (depth > 64) {
			this.warn("Symbols nested too deeply (recursive symbol?)");
			return [];
		}
		if (prog.view) {
			const p = {} as Record<TransformProp, number>;
			for (const k of TRANSFORM_PROPS) p[k] = valueAt(prog.view[k], frame);
			const t = fmtMatrix(fromProps(p), this.ctx.digits);
			const inner = this.layers(prog, frame, ticks, depth);
			return t ? [el("g", { transform: t }, inner)] : inner;
		}
		return this.layers(prog, frame, ticks, depth);
	}

	private layers(prog: Program, frame: number, ticks: number, depth: number): XmlNode[] {
		const out: XmlNode[] = [];
		const masks = new Map<number, string>();
		// mask layers come after their masked layers in bottom-to-top order; render them first
		for (const layer of prog.layers) {
			if (layer.type === "mask") {
				const content = this.layer(prog, layer, frame, ticks, depth);
				if (!content.length) continue;
				const id = this.doc.uid("mask");
				// default mask region (masked element's bounding box + 10%) is all that's needed
				this.doc.defs.push(el("mask", { id }, [el("g", { filter: this.doc.maskFilter() }, content)]));
				masks.set(layer.index, id);
			}
		}
		let group: { mask: number; nodes: XmlNode[] } | null = null;
		const flush = () => {
			if (!group) return;
			const id = masks.get(group.mask);
			if (id) out.push(el("g", { mask: `url(#${id})` }, group.nodes));
			// a mask layer with nothing on this frame hides the masked content (Animate behaviour)
			group = null;
		};
		for (const layer of prog.layers) {
			if (layer.type === "mask") continue;
			const nodes = this.layer(prog, layer, frame, ticks, depth);
			if (layer.maskedBy >= 0) {
				if (group && group.mask !== layer.maskedBy) flush();
				if (!group) group = { mask: layer.maskedBy, nodes: [] };
				group.nodes.push(...nodes);
			} else {
				flush();
				out.push(...nodes);
			}
		}
		flush();
		return out;
	}

	layer(prog: Program, layer: ProgramLayer, frame: number, ticks: number, depth: number): XmlNode[] {
		const out: XmlNode[] = [];
		for (const item of layer.items) {
			if (frame < item.start || frame >= item.end) continue;
			const node = this.item(prog, item, frame, ticks, depth);
			if (node) out.push(node);
		}
		const rig = layer.rig?.[frame];
		if (rig && out.length) {
			const t = fmtMatrix(rig, this.ctx.digits);
			return t ? [el("g", { transform: t }, out)] : out;
		}
		return out;
	}

	item(prog: Program, item: Item, frame: number, ticks: number, depth: number): XmlNode | null {
		switch (item.kind) {
			case "art":
				return this.doc.useArt(item.art);
			case "artSeq": {
				const art = item.arts[Math.min(item.arts.length - 1, frame - item.start)];
				return art ? this.doc.useArt(art) : null;
			}
			case "bitmap": {
				return this.doc.image(item.bitmap, item.matrix);
			}
			case "text":
				if (this.opts.textAsOutlines || item.element.textType === "static") return item.art ? this.doc.useArt(item.art) : null;
				return textNode(item.element, this.ctx.digits);
			case "instance":
				return this.instance(prog, item, frame, ticks, depth);
		}
	}

	instance(prog: Program, item: InstanceItem, frame: number, ticks: number, depth: number): XmlNode | null {
		if (!item.visible) return null;
		const child = this.ctx.programs[item.symbol];
		if (!child) return null;
		const m = matrixAt(item, frame);
		const color = colorAt(item, frame);

		let childFrame: number;
		let childTicks: number;
		if (item.symbolType === "graphic") {
			childFrame = graphicFrame(item, frame, child.frameCount);
			childTicks = childFrame;
		} else if (item.symbolType === "button") {
			childFrame = 0;
			childTicks = 0;
		} else {
			// how long this instance has existed
			const age = frame - item.start + (ticks - frame);
			childTicks = this.opts.movieClips === "first" ? 0 : Math.max(0, age);
			childFrame = playheadFrame(child, childTicks);
		}

		const key = `${item.symbol}@${childFrame}@${childTicks}`;
		let symId = this.symbolCache.get(key);
		if (!symId) {
			const content = this.timeline(child, childFrame, childTicks, depth + 1);
			symId = this.doc.uid(`${child.name}_${childFrame}`);
			this.doc.defs.push(el("g", { id: symId }, content));
			this.symbolCache.set(key, symId);
		}
		const attrs: Record<string, string | undefined> = {
			"xlink:href": "#" + symId,
			transform: fmtMatrix(m, this.ctx.digits) || undefined,
		};
		const filters = activeFilters(item, frame);
		let colorForFilter: ColorMatrixValues | null = null;
		if (color && isAlphaOnly(color)) {
			if (color.aP !== 100) attrs.opacity = fmt(Math.max(0, color.aP) / 100, 3);
		} else if (color) colorForFilter = color;
		const sx = Math.hypot(m[0], m[1]),
			sy = Math.hypot(m[2], m[3]);
		const size = { w: item.bounds.width / Math.max(1e-3, sx), h: item.bounds.height / Math.max(1e-3, sy) };
		const filter = filters.length || colorForFilter ? this.doc.filter(filters, colorForFilter, { x: sx, y: sy }, this.warn, size) : null;
		const blend = cssBlendMode(item.blendMode, this.warn);
		const style: string[] = [];
		if (blend) style.push(`mix-blend-mode:${blend}`);
		if (item.blendMode === "layer") style.push("isolation:isolate");
		const use = el("use", attrs);
		if (!filter && !style.length) return use;
		// Filters apply in the element's user space before its transform: wrap so the filter sees
		// the transformed content? No - Animate filters are applied in the instance's space too.
		if (filter) use.attrs.filter = filter;
		if (style.length) use.attrs.style = style.join(";");
		return use;
	}
}

export function matrixAt(item: InstanceItem, frame: number): Mat {
	const p = {} as Record<TransformProp, number>;
	for (const k of TRANSFORM_PROPS) p[k] = valueAt(item.transform[k], frame);
	return fromProps(p);
}

export function colorAt(item: InstanceItem, frame: number): ColorMatrixValues | null {
	if (!item.color) return null;
	const c = {} as Record<ColorProp, number>;
	for (const k of COLOR_PROPS) c[k] = valueAt(item.color[k], frame);
	if (c.rP === 100 && c.gP === 100 && c.bP === 100 && c.aP === 100 && !c.rA && !c.gA && !c.bA && !c.aA) return null;
	return c;
}

function activeFilters(item: InstanceItem, frame: number) {
	let fs = item.filters[0]?.filters ?? [];
	for (const f of item.filters) if (f.t <= frame) fs = f.filters;
	return fs;
}
