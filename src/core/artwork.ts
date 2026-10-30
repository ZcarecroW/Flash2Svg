/**
 * Imports the SVG files Animate's exporter wrote for each atlas item and turns them into
 * compact, uniquely-identified fragments the emitters can place anywhere.
 */
import { apply, fmt, fmtMatrix, invert, isIdentity, parseTransform } from "./geom.ts";
import type { BitmapFill, Mat } from "./model.ts";
import { clone, el, isNode, parseXml, stripWhitespace, walk, type XmlNode } from "./xml.ts";

export interface Artwork {
	/** Stable id used in the output document. */
	id: string;
	/** Gradients, patterns, images... (ids already prefixed). */
	defs: XmlNode[];
	/** The drawing, as a single <g> (or single element). */
	body: XmlNode;
	/** True when nothing visible was found. */
	empty: boolean;
}

export interface ArtworkOptions {
	digits: number;
	/** Gradient signatures ("#rrggbb,..|0,255") that Animate interpolates in linear RGB; "*" = all. */
	linearRGB?: Set<string>;
	/** Bitmaps the drawing uses as fills. */
	bitmapFills?: BitmapFill[];
	/** Strokes that keep their width when scaled (scale "none"): "#rrggbb|width". */
	fixedStrokes?: Set<string>;
}

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function gradientSignature(g: XmlNode): string {
	const stops = g.children.filter((c): c is XmlNode => isNode(c) && c.name === "stop");
	const cols = stops.map((s) => (s.attrs["stop-color"] ?? "#000000").toLowerCase());
	const pos = stops.map((s) => {
		const o = s.attrs.offset ?? "0";
		const v = o.endsWith("%") ? parseFloat(o) / 100 : parseFloat(o);
		return Math.round(v * 255);
	});
	return cols.join(",") + "|" + pos.join(",");
}

/**
 * Browsers ignore color-interpolation on gradients, so emulate Animate's "Linear RGB" option by
 * inserting stops sampled in linear light between each pair of stops.
 */
function expandLinearRGB(g: XmlNode) {
	const stops = g.children.filter((c): c is XmlNode => isNode(c) && c.name === "stop");
	const parse = (s: XmlNode) => {
		const hex = (s.attrs["stop-color"] ?? "#000000").replace("#", "");
		const o = s.attrs.offset ?? "0";
		return {
			off: o.endsWith("%") ? parseFloat(o) / 100 : parseFloat(o),
			rgb: [0, 2, 4].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255)),
			a: s.attrs["stop-opacity"] !== undefined ? parseFloat(s.attrs["stop-opacity"]) : 1,
		};
	};
	const out: XmlNode[] = [];
	const STEPS = 8;
	for (let i = 0; i < stops.length; i++) {
		const a = parse(stops[i]!);
		out.push(stops[i]!);
		const nb = stops[i + 1];
		if (!nb) continue;
		const b = parse(nb);
		for (let s = 1; s < STEPS; s++) {
			const u = s / STEPS;
			const hex = a.rgb
				.map((c, k) => Math.round(linearToSrgb(c + (b.rgb[k]! - c) * u) * 255).toString(16).padStart(2, "0"))
				.join("");
			const alpha = a.a + (b.a - a.a) * u;
			out.push(el("stop", { offset: fmt(a.off + (b.off - a.off) * u, 4), "stop-color": "#" + hex, "stop-opacity": alpha < 1 ? fmt(alpha, 3) : undefined }));
		}
	}
	g.children = out;
}

const URL_RE = /url\(#([^)]+)\)/g;

/** Rewrites path data with fewer characters: "M 100 50\nL 100 0 0 0" -> "M100 50L100 0 0 0". */
export function compactPath(d: string, digits: number): string {
	const re = /[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;
	let out = "";
	// a number needs a space before it unless it starts with "-", or with "." after a number with a "."
	let prevNum = false,
		prevDot = false;
	let m: RegExpExecArray | null;
	while ((m = re.exec(d))) {
		const t = m[0];
		const c = t.charCodeAt(0);
		if (c !== 45 && c !== 46 && (c < 48 || c > 57)) {
			out += t;
			prevNum = false;
			continue;
		}
		const s = fmt(parseFloat(t), digits);
		const dot = s.indexOf(".") >= 0;
		if (prevNum && s[0] !== "-" && !(s[0] === "." && prevDot)) out += " ";
		out += s;
		prevNum = true;
		prevDot = dot;
	}
	return out;
}

function renameRefs(node: XmlNode, map: Map<string, string>) {
	walk(node, (n) => {
		for (const k in n.attrs) {
			if (k === "d") continue; // path data never refers to ids
			let v = n.attrs[k]!;
			if ((k === "xlink:href" || k === "href") && v.startsWith("#")) {
				const t = map.get(v.slice(1));
				if (t) n.attrs[k] = "#" + t;
			} else if (v.indexOf("url(#") >= 0) {
				v = v.replace(URL_RE, (m, id: string) => {
					const t = map.get(id);
					return t ? `url(#${t})` : m;
				});
				n.attrs[k] = v;
			}
		}
	});
}

function compactNumbers(node: XmlNode, digits: number) {
	walk(node, (n) => {
		for (const k in n.attrs) {
			const v = n.attrs[k]!;
			if (k === "d") n.attrs[k] = compactPath(v, digits);
			else if (k === "transform" || k === "gradientTransform" || k === "patternTransform") {
				const m = parseTransform(v);
				const s = fmtMatrix(m, digits);
				if (s) n.attrs[k] = s;
				else delete n.attrs[k];
			} else if (/^(x|y|x1|y1|x2|y2|cx|cy|fx|fy|r|width|height|stroke-width)$/.test(k) && /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(px)?$/.test(v)) {
				n.attrs[k] = fmt(parseFloat(v), digits);
				// Animate draws strokes thinner than a pixel as 1 px hairlines
				if (k === "stroke-width" && parseFloat(v) < 1 && n.attrs.stroke !== "none") {
					n.attrs[k] = "1";
					n.attrs["vector-effect"] = "non-scaling-stroke";
				}
			} else if (k === "offset" && v.endsWith("%")) {
				n.attrs[k] = fmt(parseFloat(v) / 100, 4);
			}
		}
		// alpha as part of the colour (#rrggbbaa): an own fill-opacity would block the alpha that
		// shapes inherit from their instance (see markShapeAlpha), and the colour is shorter
		for (const p of ["fill", "stroke"]) {
			const o = n.attrs[p + "-opacity"];
			const c = n.attrs[p];
			if (o === undefined || !c || !/^#[0-9a-fA-F]{6}$/.test(c)) continue;
			const a = Math.round(Math.max(0, Math.min(1, parseFloat(o) || 0)) * 255);
			if (a < 255) n.attrs[p] = c + (a < 16 ? "0" : "") + a.toString(16);
			delete n.attrs[p + "-opacity"];
		}
	});
}

/** Strokes with scale "none" keep their width however the instance is scaled. */
function markFixedStrokes(nodes: XmlNode[], sigs: Set<string>) {
	const widths = new Map<string, number[]>();
	for (const s of sigs) {
		const [col, w] = s.split("|") as [string, string];
		(widths.get(col) ?? widths.set(col, []).get(col)!).push(parseFloat(w));
	}
	for (const n of nodes)
		walk(n, (x) => {
			const c = x.attrs.stroke;
			const list = c && c[0] === "#" ? widths.get(c.slice(0, 7).toLowerCase()) : undefined;
			if (!list) return;
			const w = parseFloat(x.attrs["stroke-width"] ?? "1");
			if (list.some((t) => Math.abs(t - w) < 0.01)) x.attrs["vector-effect"] = "non-scaling-stroke";
		});
}

/** Parses one exported SVG. `prefix` makes every id unique in the output document. */
export function importArtwork(svgText: string, id: string, opts: ArtworkOptions): Artwork {
	const root = stripWhitespace(parseXml(svgText));
	const defsNode = root.children.find((c): c is XmlNode => isNode(c) && c.name === "defs");
	const content = root.children.filter((c): c is XmlNode => isNode(c) && c.name !== "defs" && c.name !== "title" && c.name !== "desc");

	// Index defs; drop SVG fonts (unsupported by browsers; text is converted to outlines upstream).
	const defs: XmlNode[] = [];
	const byId = new Map<string, XmlNode>();
	if (defsNode) {
		for (const c of defsNode.children) {
			if (!isNode(c) || c.name === "font" || c.name === "font-face") continue;
			defs.push(c);
			if (c.attrs.id) byId.set(c.attrs.id, c);
		}
	}

	// Count references so single-use drawing defs can be inlined.
	const refCount = new Map<string, number>();
	const countRefs = (n: XmlNode) =>
		walk(n, (x) => {
			const h = x.attrs["xlink:href"] ?? x.attrs.href;
			if (h && h.startsWith("#")) refCount.set(h.slice(1), (refCount.get(h.slice(1)) ?? 0) + 1);
		});
	content.forEach(countRefs);
	defs.forEach(countRefs);

	const inlinable = (d: XmlNode) => d.name === "g" || d.name === "path" || d.name === "use";
	const inline = (n: XmlNode): XmlNode => {
		for (let i = 0; i < n.children.length; i++) {
			const c = n.children[i];
			if (!isNode(c)) continue;
			if (c.name === "use") {
				const ref = (c.attrs["xlink:href"] ?? c.attrs.href ?? "").slice(1);
				const target = byId.get(ref);
				if (target && inlinable(target) && (refCount.get(ref) ?? 0) === 1) {
					const copy = clone(target);
					delete copy.attrs.id;
					const t = c.attrs.transform;
					let replacement: XmlNode = copy;
					if (t && !isIdentity(parseTransform(t))) {
						if (copy.name === "g" && !copy.attrs.transform) copy.attrs.transform = t;
						else replacement = el("g", { transform: t }, [copy]);
					}
					n.children[i] = inline(replacement);
					byId.delete(ref);
					continue;
				}
			}
			inline(c);
		}
		return n;
	};
	let body: XmlNode = inline(el("g", {}, content));
	const keptDefs = defs.filter((d) => !d.attrs.id || byId.has(d.attrs.id));
	if (opts.bitmapFills?.length) linkBitmapFills(keptDefs, body, opts.bitmapFills);

	if (opts.linearRGB?.size) {
		for (const d of keptDefs) {
			const gradient = d.name === "linearGradient" || d.name === "radialGradient";
			if (gradient && (opts.linearRGB.has("*") || opts.linearRGB.has(gradientSignature(d)))) expandLinearRGB(d);
		}
	}

	if (opts.fixedStrokes?.size) markFixedStrokes([...keptDefs, body], opts.fixedStrokes);

	// Unique ids
	const map = new Map<string, string>();
	let n = 0;
	const allDefsAndBody = [...keptDefs, body];
	for (const d of allDefsAndBody)
		walk(d, (x) => {
			if (x.attrs.id) {
				const nid = `${id}_${n++}`;
				map.set(x.attrs.id, nid);
				x.attrs.id = nid;
			}
		});
	for (const d of allDefsAndBody) renameRefs(d, map);
	for (const d of allDefsAndBody) compactNumbers(d, opts.digits);

	// Collapse empty transform groups: <g><g transform="identity">..</g></g>
	body = collapse(body);
	const empty = !hasDrawing(body);
	return { id, defs: keptDefs, body, empty };
}

const safeName = (s: string) => s.replace(/^.*\//, "").replace(/[^A-Za-z0-9]/g, "_");

/**
 * Animate links bitmap fills as external files ("./images/name_png.png"): mark each <image> with
 * the model bitmap it shows (`data-bitmap`, resolved by OutputDoc) and emulate clipped fills,
 * which SVG patterns can't do: Animate draws the bitmap once and extends its edge pixels.
 */
function linkBitmapFills(defs: XmlNode[], body: XmlNode, fills: BitmapFill[]) {
	const images = new Map<string, BitmapFill>();
	for (const d of defs)
		walk(d, (n) => {
			const href = n.attrs["xlink:href"] ?? n.attrs.href ?? "";
			if (n.name !== "image" || href.startsWith("#") || href.startsWith("data:")) return;
			const file = href.replace(/^.*\//, "").replace(/\.[^.]*$/, "");
			const f = fills.length === 1 ? fills[0] : fills.find((b) => safeName(b.name) === file);
			if (!f) return;
			n.attrs["data-bitmap"] = f.bitmap;
			delete n.attrs["xlink:href"];
			delete n.attrs.href;
			if (n.attrs.id) images.set(n.attrs.id, f);
		});
	if (![...images.values()].some((f) => f.clipped)) return;
	// clipped patterns: id -> image id, tile size, transform
	const clipped = new Map<string, { img: string; w: number; h: number; m: Mat }>();
	for (const d of defs) {
		if (d.name !== "pattern" || !d.attrs.id) continue;
		let img = "";
		walk(d, (n) => {
			const h = n.attrs["xlink:href"] ?? n.attrs.href ?? "";
			if (n.name === "use" && h.startsWith("#") && images.get(h.slice(1))?.clipped) img = h.slice(1);
		});
		if (img) clipped.set(d.attrs.id, { img, w: parseFloat(d.attrs.width ?? "0"), h: parseFloat(d.attrs.height ?? "0"), m: parseTransform(d.attrs.patternTransform) });
	}
	if (!clipped.size) return;
	let n = 0;
	const replace = (node: XmlNode) => {
		node.children = node.children.map((c) => {
			if (!isNode(c)) return c;
			const m = c.name === "path" ? /^url\(#([^)]+)\)$/.exec(c.attrs.fill ?? "") : null;
			const p = m ? clipped.get(m[1]!) : undefined;
			if (!p) {
				replace(c);
				return c;
			}
			const clipId = `bmpclip${n++}`;
			defs.push(el("clipPath", { id: clipId }, [el("path", { d: c.attrs.d, "clip-rule": c.attrs["fill-rule"] })]));
			return el("g", { "clip-path": `url(#${clipId})`, transform: c.attrs.transform, opacity: c.attrs["fill-opacity"] }, [
				el("g", { transform: fmtMatrix(p.m, 6) || undefined }, clampedImage(p.img, p.w, p.h, pathBox(c.attrs.d ?? ""), p.m)),
			]);
		});
	};
	for (const d of defs) if (d.name !== "clipPath") replace(d);
	replace(body);
	// drop the replaced patterns unless something else still fills with them
	const used = new Set<string>();
	const collect = (n: XmlNode) => walk(n, (x) => Object.values(x.attrs).forEach((v) => v.replace(URL_RE, (_m, id: string) => (used.add(id), ""))));
	defs.forEach(collect);
	collect(body);
	for (let i = defs.length - 1; i >= 0; i--) if (clipped.has(defs[i]!.attrs.id ?? "") && !used.has(defs[i]!.attrs.id!)) defs.splice(i, 1);
}

/** The bitmap plus its edge pixels stretched over `box` (given in the fill's parent space). */
function clampedImage(img: string, w: number, h: number, box: { x0: number; y0: number; x1: number; y1: number } | null, m: Mat): XmlNode[] {
	const use = () => el("use", { "xlink:href": "#" + img });
	if (!box) return [use()];
	const inv = invert(m);
	const pts = [apply(inv, { x: box.x0, y: box.y0 }), apply(inv, { x: box.x1, y: box.y0 }), apply(inv, { x: box.x0, y: box.y1 }), apply(inv, { x: box.x1, y: box.y1 })];
	// Extend only the sides the shape reaches past, by at least 2 px (resvg crashes on sub-pixel pieces).
	const min = 2 / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1);
	const ext = (v: number) => (v > 1e-3 ? Math.max(v, min) + 0.5 : 0);
	const L = ext(-Math.min(...pts.map((p) => p.x))),
		T = ext(-Math.min(...pts.map((p) => p.y))),
		R = ext(Math.max(...pts.map((p) => p.x)) - w),
		B = ext(Math.max(...pts.map((p) => p.y)) - h);
	// A sliver around a pixel centre, stretched; pieces overlap the bitmap by half a pixel (no seams).
	const out: XmlNode[] = [];
	const piece = (x: number, y: number, pw: number, ph: number, vx: number, vy: number, vw: number, vh: number) =>
		out.push(el("svg", { x: fmt(x, 3), y: fmt(y, 3), width: fmt(pw, 3), height: fmt(ph, 3), viewBox: `${fmt(vx, 3)} ${fmt(vy, 3)} ${fmt(vw, 3)} ${fmt(vh, 3)}`, preserveAspectRatio: "none" }, [use()]));
	const s = 0.02,
		lo = 0.5 - s / 2,
		hiX = w - 0.5 - s / 2,
		hiY = h - 0.5 - s / 2;
	if (L && T) piece(0.5 - L, 0.5 - T, L, T, lo, lo, s, s);
	if (R && T) piece(w - 0.5, 0.5 - T, R, T, hiX, lo, s, s);
	if (L && B) piece(0.5 - L, h - 0.5, L, B, lo, hiY, s, s);
	if (R && B) piece(w - 0.5, h - 0.5, R, B, hiX, hiY, s, s);
	if (T) piece(0, 0.5 - T, w, T, 0, lo, w, s);
	if (B) piece(0, h - 0.5, w, B, 0, hiY, w, s);
	if (L) piece(0.5 - L, 0, L, h, lo, 0, s, h);
	if (R) piece(w - 0.5, 0, R, h, hiX, 0, s, h);
	out.push(use());
	return out;
}

/** Bounding box of absolute path data with point pairs only (control points included). */
function pathBox(d: string): { x0: number; y0: number; x1: number; y1: number } | null {
	if (/[a-zHVA]/.test(d.replace(/\de[-+]?\d/g, "0"))) return null;
	const nums = d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
	if (!nums || nums.length < 2) return null;
	let x0 = Infinity,
		y0 = Infinity,
		x1 = -Infinity,
		y1 = -Infinity;
	for (let i = 0; i + 1 < nums.length; i += 2) {
		const x = parseFloat(nums[i]!),
			y = parseFloat(nums[i + 1]!);
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
		y0 = Math.min(y0, y);
		y1 = Math.max(y1, y);
	}
	return { x0, y0, x1, y1 };
}

function collapse(node: XmlNode): XmlNode {
	node.children = node.children.map((c) => (isNode(c) ? collapse(c) : c));
	// <g> with no attributes and a single element child -> that child
	if (node.name === "g" && Object.keys(node.attrs).length === 0) {
		const els = node.children.filter(isNode);
		if (els.length === 1 && node.children.length === 1) return els[0]!;
	}
	// <g transform=T><g>..</g></g> where inner has no transform -> merge
	if (node.name === "g" && node.children.length === 1) {
		const only = node.children[0];
		if (isNode(only) && only.name === "g" && Object.keys(only.attrs).length === 0) {
			node.children = only.children;
		}
	}
	return node;
}

function hasDrawing(node: XmlNode): boolean {
	let found = false;
	walk(node, (n) => {
		if (n.name === "path" || n.name === "use" || n.name === "image" || n.name === "rect" || n.name === "circle" || n.name === "ellipse" || n.name === "polygon" || n.name === "polyline" || n.name === "line" || n.name === "text") found = true;
	});
	return found;
}

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text"]);
const paintsCache = new WeakMap<Artwork, number>();

/** What the artwork paints: 1 = fills, 2 = strokes (3 = both); images are not counted. */
export function artworkPaints(a: Artwork): number {
	let r = paintsCache.get(a);
	if (r !== undefined) return r;
	r = 0;
	const visit = (n: XmlNode, fill: boolean, stroke: boolean) => {
		if (n.attrs.fill !== undefined) fill = n.attrs.fill !== "none";
		if (n.attrs.stroke !== undefined) stroke = n.attrs.stroke !== "none";
		if (SHAPES.has(n.name)) r! |= (fill ? 1 : 0) | (stroke ? 2 : 0);
		for (const c of n.children) if (isNode(c)) visit(c, fill, stroke);
	};
	// SVG defaults: black fill, no stroke
	for (const n of [...a.defs, a.body]) visit(n, true, false);
	paintsCache.set(a, r);
	return r;
}

/** A copy of the artwork whose ids (and references to them) start with `prefix`. */
export function prefixArtwork(a: Artwork, prefix: string): Artwork {
	if (!prefix) return a;
	const defs = a.defs.map(clone);
	const body = clone(a.body);
	const map = new Map<string, string>();
	for (const root of [...defs, body])
		walk(root, (n) => {
			if (n.attrs.id) {
				map.set(n.attrs.id, prefix + n.attrs.id);
				n.attrs.id = prefix + n.attrs.id;
			}
		});
	if (map.size) for (const root of [...defs, body]) renameRefs(root, map);
	return { ...a, id: prefix + a.id, defs, body };
}

/** Canonical text of an artwork with ids replaced, used to find duplicates. */
export function artworkSignature(a: Artwork): string {
	const parts: string[] = [];
	const idRe = new RegExp(a.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "_(\\d+)", "g");
	const ser = (n: XmlNode): string => {
		let s = "<" + n.name;
		for (const k of Object.keys(n.attrs).sort()) s += " " + k + "=" + n.attrs[k]!.replace(idRe, "#$1");
		s += ">";
		for (const c of n.children) s += typeof c === "string" ? c : ser(c);
		return s + "</>";
	};
	for (const d of a.defs) parts.push(ser(d));
	parts.push(ser(a.body));
	return parts.join("|");
}
