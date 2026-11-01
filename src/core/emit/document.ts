/**
 * Output SVG document under construction: collects <defs> (artwork, filters, masks, symbols)
 * with unique ids and serialises the result.
 */
import { copyArtwork, type Artwork } from "../artwork.ts";
import { templateNodes } from "../morph.ts";
import type { Context } from "../context.ts";
import { fmt, fmtMatrix } from "../geom.ts";
import { imageMime } from "../mime.ts";
import { fontKey, type EmbeddedFont } from "../fonts.ts";
import type { AccInfo, FilterData, Mat, VideoElement } from "../model.ts";
import type { FontSet } from "./text.ts";
import { cdata, clone, el, serialize, walk, type XmlNode } from "../xml.ts";
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
	private imageIds = new Map<string, string>();
	private maskFilterId: string | null = null;
	/** Which <defs> entries each artwork wrote (for `drawingBytes`). */
	private artRanges: { key: string; from: number; to: number }[] = [];
	/** Bytes each artwork takes in the output (key: the artwork's id before prefixing), set by toString. */
	readonly drawingBytes = new Map<string, number>();
	private solidFilters = new Map<string, string>();
	readonly ctx: Context;
	readonly opts: { embedImages: boolean; idPrefix: string };

	constructor(ctx: Context, opts: { embedImages: boolean; idPrefix: string }) {
		this.ctx = ctx;
		this.opts = opts;
		// embedded fonts, their CSS family with this export's prefix (inlined SVGs don't share subsets)
		for (const f of ctx.model.fonts ?? []) this.fontMap.set(fontKey(f.face, f.bold, f.italic), { ...f, family: opts.idPrefix + f.family });
	}

	private fontMap = new Map<string, EmbeddedFont>();
	private usedFonts = new Set<EmbeddedFont>();
	/** The embedded fonts for text; those asked for get an @font-face rule. */
	readonly fonts: FontSet = {
		get: (face, bold, italic) => {
			const f = this.fontMap.get(fontKey(face, bold, italic));
			if (f) this.usedFonts.add(f);
			return f;
		},
	};

	/**
	 * A video component as an HTML <video> in a <foreignObject> over its bounds, its file copied
	 * next to the output. Autoplay needs `muted` in browsers, so a playing video is muted; `play`
	 * false (still frames): no autoplay.
	 */
	video(e: VideoElement, play: boolean): XmlNode {
		if (e.file && !this.assets.some((a) => a.path === e.file)) this.assets.push({ path: e.file, source: e.file });
		const b = e.bounds;
		const autoplay = play && e.autoplay;
		// (XHTML: a boolean attribute has its own name as its value)
		const flag = (on: boolean, name: string) => (on ? name : undefined);
		return el("foreignObject", { x: fmt(b.left, 2), y: fmt(b.top, 2), width: fmt(b.width, 2), height: fmt(b.height, 2) }, [
			el(
				"video",
				{
					xmlns: "http://www.w3.org/1999/xhtml",
					src: e.file ?? e.src,
					poster: e.poster,
					autoplay: flag(autoplay, "autoplay"),
					muted: flag(autoplay || e.muted, "muted"),
					loop: flag(e.loop, "loop"),
					controls: flag(e.controls, "controls"),
					playsinline: "playsinline",
					preload: autoplay ? "auto" : "metadata",
					style: "display:block;width:100%;height:100%;object-fit:contain",
					// an end tag, not "/>": inlined in an HTML page the parser would leave <video/> open
				},
				[""],
			),
		]);
	}

	/** A new document-unique id; every id starts with `opts.idPrefix` (never added twice). */
	uid(base: string): string {
		const p = this.opts.idPrefix;
		let id = (p && base.startsWith(p) ? "" : p) + base.replace(/[^A-Za-z0-9_-]/g, "_");
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
		const key = a.id;
		// artwork-internal ids (gradients...) get the document prefix too, and are kept clear of
		// the ids taken before (a morph's copy of the same drawing)
		a = { ...copyArtwork(a, (id) => this.uid(id)), id: this.opts.idPrefix + a.id };
		const from = this.defs.length;
		a = this.linkImages(a);
		for (const d of a.defs) this.defs.push(d);
		const id = this.uid(a.id);
		const body = a.body.name === "g" ? { ...a.body, attrs: { ...a.body.attrs, id } } : el("g", { id }, [a.body]);
		this.defs.push(body);
		// (a bitmap's shared <image>, which linkImages may add, counts as the bitmap, not the drawing)
		this.artRanges.push({ key, from, to: this.defs.length });
		this.artDone.set(key, id);
		return id;
	}

	/**
	 * Points bitmap-fill images (`data-bitmap`, see importArtwork) at this document's bitmaps: the
	 * artwork's <image> becomes a <use> of the bitmap's one shared <image> (see bitmapImage), so a
	 * bitmap filling several drawings is in the file once.
	 */
	private linkImages(a: Artwork): Artwork {
		const has = (n: XmlNode): boolean => (n.name === "image" && "data-bitmap" in n.attrs) || n.children.some((c) => typeof c !== "string" && has(c));
		if (!a.defs.some(has)) return a;
		const defs = a.defs.map((d) => {
			if (!has(d)) return d;
			const c = clone(d);
			walk(c, (n) => {
				const id = n.attrs["data-bitmap"];
				if (n.name !== "image" || id === undefined) return;
				delete n.attrs["data-bitmap"];
				const b = this.bitmap(id);
				if (!b) return;
				const same = (k: string, v: number) => Math.abs(parseFloat(n.attrs[k] ?? String(v)) - v) < 1e-6;
				if (same("width", b.width) && same("height", b.height)) {
					const attrs: Record<string, string> = {};
					for (const k of ["id", "x", "y", "transform"]) {
						const v = n.attrs[k];
						if (v !== undefined && v !== "0") attrs[k] = v;
					}
					attrs["xlink:href"] = "#" + this.bitmapImage(id)!;
					n.name = "use";
					n.attrs = attrs;
					n.children = [];
					return;
				}
				n.attrs["xlink:href"] = b.href;
				if (!b.smoothing) n.attrs["image-rendering"] = "pixelated";
				if (b.scaled) n.attrs.preserveAspectRatio = "none";
			});
			return c;
		});
		return { ...a, defs };
	}

	/**
	 * A copy of an artwork to change (a morph's drawing): its own document-unique ids, bitmap fills
	 * linked; `nodes` are its elements in the order morph channels count them. Nothing is added
	 * to the document.
	 */
	morphCopy(a: Artwork): { defs: XmlNode[]; body: XmlNode; nodes: XmlNode[] } {
		const c = this.linkImages(copyArtwork(a, (id) => this.uid(id.replace(/_\d+$/, ""))));
		return { defs: c.defs, body: c.body, nodes: templateNodes(c.defs, c.body) };
	}

	/**
	 * Puts a morph's drawing into <defs> as one group the player copies (its gradients inside);
	 * returns the group's id. In the copy's elements (`querySelectorAll("*")`), the drawing's
	 * nodes start after the inner <defs> element, if there is one.
	 */
	morphTemplate(key: string, defs: XmlNode[], body: XmlNode): string {
		const id = this.uid(key + "m");
		const from = this.defs.length;
		this.defs.push(el("g", { id }, defs.length ? [el("defs", {}, defs), body] : [body]));
		this.artRanges.push({ key, from, to: this.defs.length });
		return id;
	}

	/** Counts bytes of a drawing written outside <defs> (morphs in SMIL) for `drawingBytes`. */
	addDrawingBytes(key: string, n: number) {
		this.drawingBytes.set(key, (this.drawingBytes.get(key) ?? 0) + n);
	}

	useArt(atlasId: string): XmlNode | null {
		const a = this.ctx.art(atlasId);
		if (!a) return null;
		return el("use", { "xlink:href": "#" + this.artwork(a) });
	}

	/** `scaled`: the file has fewer pixels (encodeImages): it is stretched over width x height. */
	bitmap(bitmapId: string): { href: string; width: number; height: number; smoothing: boolean; scaled: boolean } | null {
		const b = this.ctx.model.bitmaps[bitmapId];
		if (!b) return null;
		let href = this.bitmapDone.get(bitmapId);
		if (!href) {
			if (this.opts.embedImages) {
				href = `data:${imageMime(b.file)};base64,${toBase64(this.ctx.files.readBinary(b.file))}`;
			} else {
				href = b.file;
				this.assets.push({ path: b.file, source: b.file });
			}
			this.bitmapDone.set(bitmapId, href);
		}
		return { href, width: b.width, height: b.height, smoothing: b.smoothing, scaled: !!b.pixels };
	}

	/**
	 * The bitmap's <image> in <defs>, once per document (an embedded bitmap is often the biggest
	 * part of the file; every place it is drawn refers to this one); returns its id.
	 */
	private bitmapImage(bitmapId: string): string | null {
		let id = this.imageIds.get(bitmapId);
		if (id) return id;
		const b = this.bitmap(bitmapId);
		if (!b) return null;
		id = this.uid("bmp");
		this.defs.push(
			el("image", {
				id,
				"xlink:href": b.href,
				width: b.width,
				height: b.height,
				"image-rendering": b.smoothing ? undefined : "pixelated",
				// the rounded pixel size may differ a little from the shape: fill the box exactly
				preserveAspectRatio: b.scaled ? "none" : undefined,
			}),
		);
		this.imageIds.set(bitmapId, id);
		return id;
	}

	/** A bitmap element: a <use> of the bitmap's shared <image> (null if the bitmap is missing). */
	image(bitmapId: string, matrix: Mat, digits = this.ctx.digits): XmlNode | null {
		const id = this.bitmapImage(bitmapId);
		if (!id) return null;
		// the linear part maps pixels: as precise as the bitmap's width spans
		const w = this.ctx.model.bitmaps[bitmapId]?.width ?? 100;
		return el("use", {
			"xlink:href": "#" + id,
			transform: fmtMatrix(matrix, digits, Math.max(4, digits + Math.ceil(Math.log10(Math.max(1, w))))) || undefined,
		});
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
		let margin = { x: 0, y: 0 };
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
		const node = filterNode(prims, margin, size);
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

	/** A filter of its own (animated: never shared); returns url(#id). */
	ownFilter(node: XmlNode): string {
		node.attrs.id = this.uid("f");
		this.defs.push(node);
		return `url(#${node.attrs.id})`;
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

	/** Shared filter that paints everything white (or black) and keeps the alpha (`solid`: any alpha becomes opaque). */
	whiteFilter(black = false, solid = false): string {
		const key = (black ? "blackf" : "whitef") + (solid ? "s" : "");
		let id = this.solidFilters.get(key);
		if (!id) {
			id = this.uid(key);
			const v = black ? "0" : "1";
			this.defs.push(
				el("filter", { id, "color-interpolation-filters": "sRGB" }, [
					el("feColorMatrix", { type: "matrix", values: `0 0 0 0 ${v} 0 0 0 0 ${v} 0 0 0 0 ${v} 0 0 0 ${solid ? 255 : 1} 0` }),
				]),
			);
			this.solidFilters.set(key, id);
		}
		return `url(#${id})`;
	}

	/** A <mask> showing `content` as a mask layer (Animate: shape only), or by its alpha. */
	/** `own`: the mask sits inside an instance whose alpha the shapes inherit; masks ignore it. */
	maskElement(
		id: string,
		content: XmlNode[],
		mode?: "alpha" | "erase",
		box?: { left: number; top: number; width: number; height: number },
		own?: boolean,
	): XmlNode {
		if (own) content = [el("g", { "fill-opacity": "1", "stroke-opacity": "1" }, content)];
		if (!mode) return el("mask", { id }, [el("g", { filter: this.maskFilter() }, content)]);
		const area = { x: -1e5, y: -1e5, width: 2e5, height: 2e5 };
		const all = el("rect", { ...area, fill: "#fff" });
		const attrs = { id, maskUnits: "userSpaceOnUse", ...area };
		// erase: everything but the element; alpha: the element's alpha inside its bounds, all elsewhere
		if (mode === "erase") return el("mask", attrs, [all, el("g", { filter: this.whiteFilter(true) }, content)]);
		const d = this.ctx.digits;
		const hole = box ? [el("rect", { x: fmt(box.left, d), y: fmt(box.top, d), width: fmt(box.width, d), height: fmt(box.height, d) })] : [];
		return el("mask", attrs, [...(box ? [all] : []), ...hole, el("g", { filter: this.whiteFilter() }, content)]);
	}

	toString(root: XmlNode, opts: { pretty?: boolean; xmlDeclaration?: boolean; shareStops?: boolean } = {}): string {
		const children: XmlNode[] = [];
		const faces = [...this.usedFonts].map(
			(f) =>
				`@font-face{font-family:"${f.family}";src:url(data:font/woff2;base64,${f.woff2}) format("woff2");font-weight:${f.bold ? 700 : 400};font-style:${f.italic ? "italic" : "normal"}}`,
		);
		if (faces.length || this.styles.length) children.push(el("style", {}, [cdata([...faces, ...this.styles].join("\n"))]));
		if (this.defs.length) {
			// serialized one by one, which also tells what each drawing costs
			const parts = this.defs.map((d) => serialize(d, { pretty: opts.pretty }, 2));
			if (opts.shareStops !== false) this.shareStops(parts, opts.pretty);
			for (const r of this.artRanges) {
				let n = 0;
				for (let i = r.from; i < r.to; i++) if (this.defs[i]!.name !== "image") n += parts[i]!.length;
				this.drawingBytes.set(r.key, (this.drawingBytes.get(r.key) ?? 0) + n);
			}
			children.push(el("defs", {}, [{ name: "#raw", attrs: {}, children: [parts.join("")] }]));
		}
		// <title> and <desc> stay the first children (assistive technology looks there)
		const lead = root.children.findIndex((c) => typeof c === "string" || (c.name !== "title" && c.name !== "desc"));
		const at = lead < 0 ? root.children.length : lead;
		const svg = { ...root, children: [...root.children.slice(0, at), ...children, ...root.children.slice(at)] };
		for (const s of this.scripts) svg.children.push(el("script", {}, [cdata(s)]));
		let out = serialize(svg, { pretty: opts.pretty });
		// UTF-8 is XML's default: the declaration only costs bytes (kept in indented files, for reading)
		if (opts.xmlDeclaration ?? opts.pretty) out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
		return out;
	}

	/**
	 * Gradients with the same stops (a shape tween's frames, copies of a drawing) take them from
	 * one stop-only gradient through `xlink:href`, so each set of stops is in the file once. The
	 * template has no other attributes, so nothing else is inherited from it. Only gradients
	 * straight in <defs> with plain stops: a morph's template keeps its own (the player counts its
	 * nodes). Changes `parts` (the serialized defs) where that makes the file smaller.
	 */
	private shareStops(parts: string[], pretty?: boolean) {
		const groups = new Map<string, number[]>();
		this.defs.forEach((d, i) => {
			if ((d.name !== "linearGradient" && d.name !== "radialGradient") || "xlink:href" in d.attrs || "href" in d.attrs || !d.children.length) return;
			if (!d.children.every((c) => typeof c !== "string" && c.name === "stop" && !c.children.length && !("id" in c.attrs))) return;
			const key = d.children.map((c) => serialize(c)).join("");
			const at = groups.get(key);
			if (at) at.push(i);
			else groups.set(key, [i]);
		});
		for (const at of groups.values()) {
			if (at.length < 2) continue;
			const first = this.defs[at[0]!]!;
			const id = this.uid("stops");
			const template = serialize(el("linearGradient", { id }, first.children), { pretty }, 2);
			const linked = at.map((i) => serialize({ ...this.defs[i]!, attrs: { ...this.defs[i]!.attrs, "xlink:href": "#" + id }, children: [] }, { pretty }, 2));
			let before = 0;
			for (const i of at) before += parts[i]!.length;
			if (template.length + linked.reduce((n, s) => n + s.length, 0) >= before) {
				this.ids.delete(id);
				continue;
			}
			at.forEach((i, k) => (parts[i] = linked[k]!));
			parts[at[0]!] = template + parts[at[0]!];
		}
	}
}

/**
 * The root <svg>. With a name or description in Animate's Accessibility panel it gets <title>,
 * <desc> and a role: "img", or "group" when parts of it are accessible themselves (named
 * instances, buttons); "Make movie accessible" off hides it from assistive technology.
 */
/**
 * A <filter> of `prims`, its region relative to the element's bounding box (`size`, its own units)
 * grown by the effect's reach (`margin`).
 */
export function filterNode(prims: XmlNode[], margin: { x: number; y: number }, size: { w: number; h: number }): XmlNode {
	const node = el("filter", { "color-interpolation-filters": "sRGB" }, prims);
	if (margin.x > 0 || margin.y > 0) {
		const mx = Math.min(5, margin.x / Math.max(1, size.w) + 0.05);
		const my = Math.min(5, margin.y / Math.max(1, size.h) + 0.05);
		Object.assign(node.attrs, { x: fmt(-mx, 3), y: fmt(-my, 3), width: fmt(1 + 2 * mx, 3), height: fmt(1 + 2 * my, 3) });
	}
	return node;
}

export function svgRoot(ctx: Context, attrs: Record<string, string | number> = {}): XmlNode {
	const d = ctx.model.doc;
	const scale = ctx.scale ?? "fixed";
	const fixed = scale === "fixed";
	const svg = el("svg", {
		xmlns: "http://www.w3.org/2000/svg",
		"xmlns:xlink": "http://www.w3.org/1999/xlink",
		version: "1.1",
		width: fixed ? fmt(d.width, 2) : "100%",
		height: fixed ? fmt(d.height, 2) : "100%",
		viewBox: `0 0 ${fmt(d.width, 2)} ${fmt(d.height, 2)}`,
		preserveAspectRatio: scale === "fill" ? "xMidYMid slice" : scale === "stretch" ? "none" : undefined,
		// the stage colour fills the letterbox too, as in Flash
		style: !fixed && ctx.background ? `background:${d.backgroundColor}` : undefined,
		...attrs,
	});
	const acc = d.acc;
	if (acc?.silent) svg.attrs["aria-hidden"] = "true";
	else if (acc?.name || acc?.description) {
		const parts = Object.values(ctx.model.timelines).some((t) =>
			t.layers.some((l) => l.keyframes.some((k) => k.elements.some((e) => e.kind === "instance" && (e.acc?.name || e.symbolType === "button")))),
		);
		svg.attrs.role = parts ? "group" : "img";
		if (acc.name) svg.children.push(el("title", {}, [acc.name]));
		if (acc.description) svg.children.push(el("desc", {}, [acc.description]));
	}
	return svg;
}

/**
 * ARIA of a symbol instance from the Accessibility panel, or null: hidden ("Make object
 * accessible" off), or a named image / button (its children then count as part of it), with its
 * shortcut and tab index (buttons).
 */
export function accAttrs(acc: AccInfo | undefined, button: boolean): Record<string, string> | null {
	if (!acc) return null;
	if (acc.silent) return { "aria-hidden": "true" };
	const a: Record<string, string> = {};
	if (acc.name) {
		a.role = button ? "button" : "img";
		a["aria-label"] = acc.name;
	}
	if (acc.shortcut) a["aria-keyshortcuts"] = acc.shortcut;
	if (button && acc.tabIndex) a.tabindex = String(acc.tabIndex);
	return Object.keys(a).length ? a : null;
}

/** An instance with its accessibility settings (a group with ARIA and a <desc>). */
export function withAcc(node: XmlNode, acc: AccInfo | undefined, button: boolean): XmlNode {
	const a = accAttrs(acc, button);
	if (!a) return node;
	const desc = acc!.description && !acc!.silent ? [el("desc", {}, [acc!.description])] : [];
	return el("g", a, [...desc, node]);
}

function toBase64(bytes: Uint8Array): string {
	const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
	if (B) return B.from(bytes).toString("base64");
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
	return btoa(s);
}
