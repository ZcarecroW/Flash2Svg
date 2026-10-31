/**
 * Static rendering: the scene at one frame, without animation. Used for "SVG images" export and
 * as the reference for verifying everything against Animate's own PNG renderings.
 */
import type { Context } from "../context.ts";
import { fmt, fmtMatrix } from "../geom.ts";
import type { Mat } from "../model.ts";
import { COLOR_PROPS, fromProps, TRANSFORM_PROPS, type ColorProp, type InstanceItem, type Item, type Program, type ProgramLayer, type TransformProp } from "../program.ts";
import { valueAt } from "../tracks.ts";
import { clone, el, type XmlNode } from "../xml.ts";
import { OutputDoc, svgRoot, withAcc } from "./document.ts";
import { blendHides, blendSubtract, blendWhite, cssBlendMode, isAlphaOnly, type ColorMatrixValues } from "./filters.ts";
import { outlineText, textField, textNode } from "./text.ts";
import { clickLink } from "../snippets.ts";
import { graphicFrame, playheadFrame } from "./timing.ts";

export interface StaticOptions {
	/** Root frame to render (0-based). */
	frame: number;
	/** Ticks since the start (default `frame`): differs once the root timeline stopped or jumped. */
	ticks?: number;
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

export function renderStatic(ctx: Context, rootId: string, opts: StaticOptions): { svg: string; assets: OutputDoc["assets"]; drawingBytes: OutputDoc["drawingBytes"] } {
	const doc = new OutputDoc(ctx, { embedImages: opts.embedImages, idPrefix: opts.idPrefix ?? "" });
	const root = svgRoot(ctx);
	if (opts.includeBackground) {
		const d = ctx.model.doc;
		root.children.push(el("rect", { width: fmt(d.width, 2), height: fmt(d.height, 2), fill: d.backgroundColor }));
	}
	const r = new StaticRenderer(ctx, doc, opts);
	const prog = ctx.programs[rootId];
	if (!prog) throw new Error(`Unknown timeline ${rootId}`);
	root.children.push(...r.timeline(prog, opts.frame, opts.ticks ?? opts.frame, 0));
	return { svg: doc.toString(root, { pretty: opts.pretty }), assets: doc.assets, drawingBytes: doc.drawingBytes };
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
			const dig = this.ctx.precision.view(prog.id);
			const t = fmtMatrix(fromProps(p), dig.x, dig.sx);
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
				this.doc.defs.push(this.doc.maskElement(id, content, layer.maskMode, layer.maskBox));
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
			const t = fmtMatrix(rig, this.ctx.precision.space(prog.id));
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
				return this.doc.image(item.bitmap, item.matrix, this.ctx.precision.space(prog.id));
			}
			case "video":
				return this.doc.video(item.element, false);
			case "text": {
				const node = this.opts.textAsOutlines || item.element.textType === "static" ? (item.art ? outlineText(item.element, this.doc.useArt(item.art)) : null) : textNode(item.element, this.ctx.precision.space(prog.id), this.doc.fonts);
				return textField(item.element, node, this.ctx.precision.space(prog.id), (fs, size) => this.doc.filter(fs, null, { x: 1, y: 1 }, this.warn, size), this.warn);
			}
			case "instance": {
				const node = this.instance(prog, item, frame, ticks, depth);
				const link = node && clickLink(prog.interactions, item.name);
				const linked = link ? el("a", { "xlink:href": link.href, target: link.target }, [node!]) : node;
				return linked && withAcc(linked, item.acc, item.symbolType === "button");
			}
		}
	}

	instance(prog: Program, item: InstanceItem, frame: number, ticks: number, depth: number): XmlNode | null {
		if (!item.visible) return null;
		if (blendHides(item.blendMode)) {
			cssBlendMode(item.blendMode, this.warn);
			return null;
		}
		const child = this.ctx.programs[item.symbol];
		if (!child) return null;
		const m = matrixAt(item, frame);
		const color = colorAt(item, frame);

		let childFrame: number;
		let childTicks: number;
		if (item.symbolType === "graphic") {
			childFrame = graphicFrame(item, frame, child.frameCount);
			// movie clips inside keep counting ticks while the parent holds a frame (stop())
			childTicks = childFrame + Math.max(0, ticks - frame);
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
		const dig = this.ctx.precision.instance(item, prog.id);
		const attrs: Record<string, string | undefined> = {
			"xlink:href": "#" + symId,
			transform: fmtMatrix(m, dig.x, dig.sx) || undefined,
		};
		const filters = activeFilters(item, frame);
		let colorForFilter: ColorMatrixValues | null = null;
		if (color && isAlphaOnly(color)) {
			const a = color.aP !== 100 ? fmt(Math.max(0, color.aP) / 100, 3) : undefined;
			if (!item.shapeAlpha) attrs.opacity = a;
			else {
				if (item.shapeAlpha & 1) attrs["fill-opacity"] = a;
				if (item.shapeAlpha & 2) attrs["stroke-opacity"] = a;
			}
		} else if (color) colorForFilter = color;
		// Animate filters work in the parent's orientation and units (a rotated instance keeps its
		// shadow direction): applied on a group around the transformed <use>
		const size = { w: item.bounds.width, h: item.bounds.height };
		const filter = filters.length || colorForFilter ? this.doc.filter(filters, colorForFilter, { x: 1, y: 1 }, this.warn, size) : null;
		const blend = cssBlendMode(item.blendMode, this.warn);
		const style: string[] = [];
		if (blend) style.push(`mix-blend-mode:${blend}`);
		if (item.blendMode === "layer") style.push("isolation:isolate");
		let node: XmlNode = el("use", attrs);
		if (filter) {
			const opacity = attrs.opacity;
			delete node.attrs.opacity;
			node = el("g", { filter, opacity }, [node]);
		}
		if (!style.length) return node;
		if (blendWhite(item.blendMode)) return el("g", { filter: this.doc.whiteFilter(), style: style.join(";") }, [node]);
		if (blendSubtract(item.blendMode)) {
			const white = () => el("g", { filter: this.doc.whiteFilter(false, true), style: "mix-blend-mode:difference" }, [clone(node)]);
			const first = white();
			node.attrs.style = style.join(";");
			return el("g", {}, [first, node, white()]);
		}
		node.attrs.style = style.join(";");
		return node;
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
