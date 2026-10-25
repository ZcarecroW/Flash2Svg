/**
 * Output SVG document under construction: collects <defs> (artwork, filters, masks, symbols)
 * with unique ids and serialises the result.
 */
import type { Artwork } from "../artwork.ts";
import type { Context } from "../context.ts";
import { fmt } from "../geom.ts";
import type { FilterData } from "../model.ts";
import { el, serialize, type XmlNode } from "../xml.ts";
import { buildFilters, colorMatrix, matrixString, type ColorMatrixValues } from "./filters.ts";

export interface Asset {
	/** Path relative to the output SVG. */
	path: string;
	/** Path relative to scene.json (source to copy). */
	source: string;
}

export class OutputDoc {
	readonly defs: XmlNode[] = [];
	readonly assets: Asset[] = [];
	readonly styles: string[] = [];
	readonly scripts: string[] = [];
	private ids = new Set<string>();
	private artDone = new Map<string, string>();
	private filterCache = new Map<string, string>();
	private bitmapDone = new Map<string, string>();
	private maskFilterId: string | null = null;
	readonly ctx: Context;
	readonly opts: { embedImages: boolean; idPrefix: string };

	constructor(ctx: Context, opts: { embedImages: boolean; idPrefix: string }) {
		this.ctx = ctx;
		this.opts = opts;
	}

	uid(base: string): string {
		let id = this.opts.idPrefix + base.replace(/[^A-Za-z0-9_-]/g, "_");
		if (!/^[A-Za-z_]/.test(id)) id = "_" + id;
		let candidate = id;
		let i = 1;
		while (this.ids.has(candidate)) candidate = `${id}_${i++}`;
		this.ids.add(candidate);
		return candidate;
	}

	/** Puts an artwork's defs and body into <defs> once; returns the id to <use>. */
	artwork(a: Artwork): string {
		const done = this.artDone.get(a.id);
		if (done) return done;
		for (const d of a.defs) this.defs.push(d);
		const id = this.uid(a.id);
		const body = a.body.name === "g" ? { ...a.body, attrs: { ...a.body.attrs, id } } : el("g", { id }, [a.body]);
		this.defs.push(body);
		this.artDone.set(a.id, id);
		return id;
	}

	useArt(atlasId: string): XmlNode | null {
		const a = this.ctx.art(atlasId);
		if (!a) return null;
		return el("use", { "xlink:href": "#" + this.artwork(a) });
	}

	bitmap(bitmapId: string): { href: string; width: number; height: number; smoothing: boolean } | null {
		const b = this.ctx.model.bitmaps[bitmapId];
		if (!b) return null;
		let href = this.bitmapDone.get(bitmapId);
		if (!href) {
			if (this.opts.embedImages) {
				const bytes = this.ctx.files.readBinary(b.file);
				const mime = b.file.endsWith(".jpg") ? "image/jpeg" : "image/png";
				href = `data:${mime};base64,${toBase64(bytes)}`;
			} else {
				href = b.file;
				this.assets.push({ path: b.file, source: b.file });
			}
			this.bitmapDone.set(bitmapId, href);
		}
		return { href, width: b.width, height: b.height, smoothing: b.smoothing };
	}

	/** Filter for Animate filters + colour transform; returns url(#id) or null. */
	filter(
		filters: FilterData[],
		color: ColorMatrixValues | null,
		scale: { x: number; y: number },
		warn: (m: string) => void,
		/** Approximate size of the element in its own units, to size the filter region. */
		size: { w: number; h: number } = { w: 100, h: 100 },
	): string | null {
		const prims: XmlNode[] = [];
		let margin = 0;
		if (filters.length) {
			const b = buildFilters(filters, scale, warn);
			prims.push(...b.primitives);
			margin = b.margin;
		}
		if (color) {
			const last = prims.length ? prims[prims.length - 1]!.attrs.result : undefined;
			prims.push(el("feColorMatrix", { ...(last ? { in: last } : {}), type: "matrix", values: matrixString(colorMatrix(color)) }));
		}
		if (!prims.length) return null;
		const node = el("filter", { "color-interpolation-filters": "sRGB" }, prims);
		if (margin > 0) {
			// region relative to the element's bounding box, grown by the effect's reach
			const mx = Math.min(5, margin / Math.max(1, size.w) + 0.05);
			const my = Math.min(5, margin / Math.max(1, size.h) + 0.05);
			Object.assign(node.attrs, { x: fmt(-mx, 3), y: fmt(-my, 3), width: fmt(1 + 2 * mx, 3), height: fmt(1 + 2 * my, 3) });
		}
		const key = serialize(node);
		let id = this.filterCache.get(key);
		if (!id) {
			id = this.uid("f");
			node.attrs.id = id;
			this.defs.push(node);
			this.filterCache.set(key, id);
		}
		return `url(#${id})`;
	}

	/** Shared filter that turns any painted pixel opaque white (Animate masks ignore colour/alpha). */
	maskFilter(): string {
		if (!this.maskFilterId) {
			this.maskFilterId = this.uid("maskf");
			this.defs.push(
				el("filter", { id: this.maskFilterId, "color-interpolation-filters": "sRGB" }, [
					el("feColorMatrix", { type: "matrix", values: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 9 0" }),
				]),
			);
		}
		return `url(#${this.maskFilterId})`;
	}

	toString(root: XmlNode, opts: { pretty?: boolean; xmlDeclaration?: boolean } = {}): string {
		const children: XmlNode[] = [];
		if (this.styles.length) children.push(el("style", {}, [this.styles.join("\n")]));
		if (this.defs.length) children.push(el("defs", {}, this.defs));
		const svg = { ...root, children: [...children, ...root.children] };
		for (const s of this.scripts) svg.children.push(el("script", {}, [s]));
		let out = serialize(svg, { pretty: opts.pretty });
		if (opts.xmlDeclaration !== false) out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
		return out;
	}
}

export function svgRoot(ctx: Context, attrs: Record<string, string | number> = {}): XmlNode {
	const d = ctx.model.doc;
	return el("svg", {
		xmlns: "http://www.w3.org/2000/svg",
		"xmlns:xlink": "http://www.w3.org/1999/xlink",
		version: "1.1",
		width: fmt(d.width, 2),
		height: fmt(d.height, 2),
		viewBox: `0 0 ${fmt(d.width, 2)} ${fmt(d.height, 2)}`,
		...attrs,
	});
}

function toBase64(bytes: Uint8Array): string {
	const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
	if (B) return B.from(bytes).toString("base64");
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
	return btoa(s);
}
