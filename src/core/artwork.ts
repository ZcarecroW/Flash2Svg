/**
 * Imports the SVG files Animate's exporter wrote for each atlas item and turns them into
 * compact, uniquely-identified fragments the emitters can place anywhere.
 */
import { fmt, fmtMatrix, parseTransform, isIdentity } from "./geom.ts";
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
	/** Gradient signatures ("#rrggbb,..|0,255") that Animate interpolates in linear RGB. */
	linearRGB?: Set<string>;
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
	const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
	if (!tokens) return "";
	let out = "";
	let prevNum = false;
	for (const t of tokens) {
		if (/^[a-zA-Z]$/.test(t)) {
			out += t;
			prevNum = false;
		} else {
			const s = fmt(parseFloat(t), digits);
			if (prevNum && !s.startsWith("-") && !(s.startsWith(".") && /\.\d*$/.test(lastNumber(out)))) out += " ";
			out += s;
			prevNum = true;
		}
	}
	return out;
}
function lastNumber(s: string): string {
	const m = /-?[\d.]+$/.exec(s);
	return m ? m[0] : "";
}

function renameRefs(node: XmlNode, map: Map<string, string>) {
	walk(node, (n) => {
		for (const k in n.attrs) {
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
			} else if (/^(x|y|x1|y1|x2|y2|cx|cy|fx|fy|r|width|height|stroke-width)$/.test(k) && /^-?[\d.]+(px)?$/.test(v)) {
				n.attrs[k] = fmt(parseFloat(v), digits);
			} else if (k === "offset" && v.endsWith("%")) {
				n.attrs[k] = fmt(parseFloat(v) / 100, 4);
			}
		}
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

	if (opts.linearRGB?.size) {
		for (const d of keptDefs) {
			if ((d.name === "linearGradient" || d.name === "radialGradient") && opts.linearRGB.has(gradientSignature(d))) expandLinearRGB(d);
		}
	}

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
