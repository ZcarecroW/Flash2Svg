/**
 * Lottie output (lottie-web, dotLottie/ThorVG, Skottie and the native players). The scene is baked
 * onto one clock as for SMIL (bake.ts), so frame scripts, movie clip playheads and graphic loop
 * modes come out the same; then:
 *  - symbols (each distinct baked timeline) become precompositions, their instances precomp layers
 *    with the transform as Lottie's own properties (p, a, s, r, sk) and eases as keyframe handles;
 *  - drawings become shape layers (one group per path; quadratic curves as cubic, exactly),
 *    gradients Lottie gradients (elliptical radials through a style transform), bitmaps image
 *    layers, bitmap fills and clip paths tiles under a track matte;
 *  - Flash masks become track mattes on a precomp of the masked layers;
 *  - shape tweens (morph.ts) become animated paths, colours and gradients.
 *  - filters become layer effects (blur, drop shadow, glow; outside the spec 1.0, but lottie-web,
 *    dotLottie, Skottie and the native players draw them), "adjust colour" a matrix in the paints.
 * Otherwise only what the Lottie spec 1.0 has is used (no expressions), so every player shows the
 * same; what Lottie lacks (other filters, colour effects on bitmaps, sounds) is left out with a
 * warning. Measured details of the players: see the "lottie" notes in docs/architecture.md.
 */
import type { ExportSettings } from "../compile.ts";
import type { Context } from "../context.ts";
import { evalBezier, subBezier } from "../easing.ts";
import { apply, concat, invert, isIdentity, parseTransform } from "../geom.ts";
import { imageMime } from "../mime.ts";
import type { FilterData, Mat } from "../model.ts";
import { channelNumbers, channelText, templateNodes, type MorphChannel } from "../morph.ts";
import { fromProps, toProps, type ColorProp, type TransformProp } from "../program.ts";
import { valueAt, type Ease, type Track } from "../tracks.ts";
import { copyArtwork, type Artwork } from "../artwork.ts";
import { isNode, walk, type XmlNode } from "../xml.ts";
import { bake, sliceTrack, type BakedInstance, type BakedMorph, type BakedNode, type BakedTimeline, type GTrack, type Interval } from "./bake.ts";
import { adjustColorMatrix, blendHides, blurSigma, gradientSampler, splitColor } from "./filters.ts";
import { Periods } from "./periods.ts";

type Json = Record<string, unknown>;

/** Axis-aligned box. */
interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** A layer before it gets its index: `td` = it is the track matte of the layer below it. */
interface LayerOut {
	json: Json;
	box: Box | null;
	td?: boolean;
}

export interface LottieResult {
	/** The animation (Lottie JSON). */
	animation: Json;
	/** Bitmaps as files: linked (next to the JSON) or for the dotLottie's `i/` folder. */
	images: { name: string; source: string }[];
	horizon: { ticks: number; fps: number; loop: boolean; tail: number };
	/** Markers added for playback: the first pass and the looping tail after a stop(), the poster. */
	segments: { intro?: string; tail?: string; poster?: string };
}

/** Where the bitmaps go: inside the JSON (data URIs), next to it, or in the dotLottie archive. */
export type LottieImages = "embed" | "link" | "dotlottie";

const EMPTY_BOX: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const BLEND: Record<string, number> = { multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, hardlight: 8, difference: 10 };

/** A gradient that needs its own space (elliptical radial): the style in space `wrap`. */
interface Wrapped {
	wrap: Mat;
	style: Json;
}
const isWrap = (x: Json | Wrapped): x is Wrapped => Array.isArray((x as Wrapped).wrap);

function round(v: number, d: number): number {
	const k = 10 ** d;
	const r = Math.round(v * k) / k;
	return r === 0 ? 0 : r;
}

/** A static property. */
const st = (k: unknown): Json => ({ a: 0, k });

function unionBox(a: Box | null, b: Box | null): Box | null {
	if (!a) return b;
	if (!b) return a;
	return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function boxOfPoints(pts: number[], m: Mat, grow = 0): Box | null {
	let b: Box | null = null;
	for (let i = 0; i + 1 < pts.length; i += 2) {
		const p = apply(m, { x: pts[i]!, y: pts[i + 1]! });
		b = unionBox(b, { x0: p.x - grow, y0: p.y - grow, x1: p.x + grow, y1: p.y + grow });
	}
	return b;
}

function transformBox(b: Box, m: Mat): Box {
	return boxOfPoints([b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1], m)!;
}

/** A matrix as Lottie transform properties (only those that aren't the default). */
function matrixProps(m: Mat, digits: number): Json {
	const t: Json = {};
	if (isIdentity(m, 1e-9)) return t;
	const p = toProps(m, { x: 0, y: 0 });
	if (Math.abs(p.x) > 1e-9 || Math.abs(p.y) > 1e-9) t.p = st([round(p.x, digits), round(p.y, digits)]);
	if (Math.abs(p.sx - 1) > 1e-9 || Math.abs(p.sy - 1) > 1e-9) t.s = st([round(p.sx * 100, 4), round(p.sy * 100, 4)]);
	if (Math.abs(p.rot) > 1e-9) t.r = st(round(p.rot, 4));
	if (Math.abs(p.skw) > 1e-9) {
		t.sk = st(round(-p.skw, 4));
		t.sa = st(0);
	}
	return t;
}

/** A shape group's transform; lottie-web needs `o` in every one (it hangs without). */
const groupTransform = (m: Mat, digits: number, opacity = 1): Json => ({ ty: "tr", ...matrixProps(m, digits), o: st(round(opacity * 100, 2)) });

function parseColor(s: string | undefined): [number, number, number, number] | null {
	if (!s || s[0] !== "#") return null;
	let h = s.slice(1);
	if (h.length === 3) h = h[0]! + h[0] + h[1] + h[1] + h[2] + h[2];
	const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
	return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
}

const num = (s: string | undefined, d = 0) => {
	if (s === undefined) return d;
	const v = parseFloat(s);
	return Number.isFinite(v) ? (s.endsWith("%") ? v / 100 : v) : d;
};

// ------------------------------------------------------------------------------------- paths

interface Bez {
	c: boolean;
	v: number[][];
	i: number[][];
	o: number[][];
}

const PATH_TOKENS = /[MmLlHhVvQqCcZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * SVG path data as Lottie Bezier contours (tangents relative to their vertex; quadratic curves as
 * the cubic that is the same curve). `fill`: contours are closed anyway. `structural`: a closed
 * contour always ends on its start point (morph paths, see morph.ts), so every keyframe drops
 * that point alike.
 */
function bezierPaths(d: string, fill: boolean, digits: number, structural = false): Bez[] {
	const t = d.match(PATH_TOKENS) ?? [];
	const out: Bez[] = [];
	let cur: Bez | null = null;
	let x = 0,
		y = 0,
		sx = 0,
		sy = 0;
	let cmd = "";
	const r = (v: number) => round(v, digits);
	const finish = (closed: boolean) => {
		if (!cur) return;
		const n = cur.v.length;
		if (n > 1) {
			const a = cur.v[0]!,
				b = cur.v[n - 1]!;
			const back = structural ? closed : Math.abs(a[0]! - b[0]!) < 1e-9 && Math.abs(a[1]! - b[1]!) < 1e-9;
			if ((closed || fill) && back) {
				// the end point is the start point again: its in-tangent belongs to the start
				cur.i[0] = cur.i[n - 1]!;
				cur.v.pop();
				cur.i.pop();
				cur.o.pop();
			}
			cur.c = closed || fill;
			if (cur.v.length > 1) out.push(cur);
		}
		cur = null;
	};
	const lineTo = (nx: number, ny: number) => {
		if (!cur) return;
		cur.v.push([r(nx), r(ny)]);
		cur.i.push([0, 0]);
		cur.o.push([0, 0]);
		x = nx;
		y = ny;
	};
	const curveTo = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => {
		if (!cur) return;
		cur.o[cur.o.length - 1] = [r(c1x - x), r(c1y - y)];
		cur.v.push([r(nx), r(ny)]);
		cur.i.push([r(c2x - nx), r(c2y - ny)]);
		cur.o.push([0, 0]);
		x = nx;
		y = ny;
	};
	let i = 0;
	const nextNum = () => +t[i++]!;
	while (i < t.length) {
		const tok = t[i]!;
		if (/[A-Za-z]/.test(tok)) {
			i++;
			cmd = tok;
			if (cmd === "Z" || cmd === "z") {
				finish(true);
				x = sx;
				y = sy;
			}
			continue;
		}
		const rel = cmd === cmd.toLowerCase();
		const ox = rel ? x : 0,
			oy = rel ? y : 0;
		switch (cmd.toUpperCase()) {
			case "M": {
				finish(false);
				x = nextNum() + ox;
				y = nextNum() + oy;
				sx = x;
				sy = y;
				cur = { c: false, v: [[r(x), r(y)]], i: [[0, 0]], o: [[0, 0]] };
				cmd = rel ? "l" : "L";
				break;
			}
			case "L":
				lineTo(nextNum() + ox, nextNum() + oy);
				break;
			case "H":
				lineTo(nextNum() + ox, y);
				break;
			case "V":
				lineTo(x, nextNum() + (rel ? y : 0));
				break;
			case "Q": {
				const qx = nextNum() + ox,
					qy = nextNum() + oy,
					nx = nextNum() + ox,
					ny = nextNum() + oy;
				curveTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny);
				break;
			}
			case "C": {
				const c1x = nextNum() + ox,
					c1y = nextNum() + oy,
					c2x = nextNum() + ox,
					c2y = nextNum() + oy;
				curveTo(c1x, c1y, c2x, c2y, nextNum() + ox, nextNum() + oy);
				break;
			}
			default:
				i++;
		}
	}
	finish(false);
	return out;
}

/** Vertices and handle points of contours (for bounds). */
function bezPoints(list: Bez[]): number[] {
	const pts: number[] = [];
	for (const b of list)
		b.v.forEach((v, k) => {
			pts.push(v[0]!, v[1]!, v[0]! + b.i[k]![0]!, v[1]! + b.i[k]![1]!, v[0]! + b.o[k]![0]!, v[1]! + b.o[k]![1]!);
		});
	return pts;
}

// ---------------------------------------------------------------------------------- drawings

/**
 * A Flash colour transform as multipliers and offsets in 0..1 units:
 * [rm, gm, bm, am, ro, go, bo, ao], c' = c * m + o (per channel, clamped); or a colour matrix
 * (the "adjust colour" filter): 20 numbers, rows r, g, b, a of [cr, cg, cb, ca, offset].
 */
type CT = number[];

const MATRIX_ID = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

function asMatrix(ct: CT): number[] {
	if (ct.length === 20) return ct;
	const [rm, gm, bm, am, ro, go, bo, ao] = ct as [number, number, number, number, number, number, number, number];
	return [rm, 0, 0, 0, ro, 0, gm, 0, 0, go, 0, 0, bm, 0, bo, 0, 0, 0, am, ao];
}

function applyCT(ct: CT | null | undefined, c: [number, number, number, number]): [number, number, number, number] {
	if (!ct) return c;
	const clamp = (v: number) => Math.max(0, Math.min(1, v));
	if (ct.length === 20) {
		const row = (r: number) => clamp(ct[r]! * c[0] + ct[r + 1]! * c[1] + ct[r + 2]! * c[2] + ct[r + 3]! * c[3] + ct[r + 4]!);
		return [row(0), row(5), row(10), row(15)];
	}
	const f = (i: number) => clamp(c[i]! * ct[i]! + ct[i + 4]!);
	return [f(0), f(1), f(2), f(3)];
}

/** True if a colour transform changes colours (not only alpha). */
const tintsColour = (ct: CT) =>
	ct.length === 20
		? ct.slice(0, 15).some((v, i) => Math.abs(v - MATRIX_ID[i]!) > 1e-6)
		: [0, 1, 2].some((i) => Math.abs(ct[i]! - 1) > 1e-6 || Math.abs(ct[i + 4]!) > 1e-6);

const isIdentityCT = (ct: CT) => ct.every((x, i) => Math.abs(x - (ct.length === 20 ? MATRIX_ID[i]! : i < 4 ? 1 : 0)) < 1e-9);

interface DrawingOptions {
	/** Content of a Flash mask: everything opaque (alpha x9, as Flash's mask filter). */
	matte: boolean;
	/** Morph keys: the structure must not depend on the values (they are merged into keyframes). */
	stable: boolean;
	/** Screen pixels per unit (hairlines keep their width in pixels). */
	scale?: number;
	/** Colour transform pushed into every paint (as Flash applies it: to each shape). */
	paint?: CT | null;
}

/** Turns an imported artwork (SVG nodes, see artwork.ts) into layers in its own coordinates. */
class DrawingBuilder {
	readonly layers: LayerOut[] = [];
	private groups: Json[] = [];
	private box: Box | null = null;
	private readonly w: LottieWriter;
	private readonly defs: Map<string, XmlNode>;
	private readonly o: DrawingOptions;
	constructor(w: LottieWriter, defs: Map<string, XmlNode>, o: DrawingOptions) {
		this.w = w;
		this.defs = defs;
		this.o = o;
	}

	private get digits() {
		return this.w.digits;
	}

	/** Ends the current shape layer (before a layer of another kind goes on top). */
	flush() {
		if (!this.groups.length) return;
		this.layers.push({ json: { ty: 4, ks: {}, shapes: [...this.groups].reverse() }, box: this.box });
		this.groups = [];
		this.box = null;
	}

	node(n: XmlNode, m: Mat, opacity: number) {
		switch (n.name) {
			case "g": {
				const gm = concat(parseTransform(n.attrs.transform), m);
				const op = opacity * num(n.attrs.opacity, 1);
				const clip = /url\(#([^)]+)\)/.exec(n.attrs["clip-path"] ?? "")?.[1];
				if (clip && this.defs.get(clip)) this.clipped(n.children.filter(isNode), gm, op, this.defs.get(clip)!);
				else for (const c of n.children) if (isNode(c)) this.node(c, gm, op);
				return;
			}
			case "path":
				this.path(n, n.attrs.d ?? "", concat(parseTransform(n.attrs.transform), m), opacity);
				return;
			case "rect": {
				const x = num(n.attrs.x),
					y = num(n.attrs.y),
					w = num(n.attrs.width),
					h = num(n.attrs.height);
				this.path(n, `M${x} ${y}H${x + w}V${y + h}H${x}Z`, concat(parseTransform(n.attrs.transform), m), opacity);
				return;
			}
			case "use": {
				const ref = this.defs.get((n.attrs["xlink:href"] ?? n.attrs.href ?? "").slice(1));
				if (!ref) return;
				// x/y move the referenced content inside the use's own transform
				const t = concat(concat([1, 0, 0, 1, num(n.attrs.x), num(n.attrs.y)], parseTransform(n.attrs.transform)), m);
				this.node(ref, t, opacity * num(n.attrs.opacity, 1));
				return;
			}
			case "image":
				this.image(n, concat(parseTransform(n.attrs.transform), m), opacity);
				return;
			case "svg":
				this.viewport(n, m, opacity);
				return;
			case "text":
				this.w.warn("Text drawn as text inside a drawing isn't exported to Lottie (it needs outlines)");
				return;
			default:
				// defs, gradients, patterns, clip paths: not drawn by themselves
				return;
		}
	}

	private path(n: XmlNode, d: string, m: Mat, opacity: number) {
		const fill = n.attrs.fill ?? "#000000";
		const stroke = n.attrs.stroke;
		const hasStroke = !!stroke && stroke !== "none";
		const hasFill = fill !== "none";
		if (!hasFill && !hasStroke) return;
		const fillRef = /url\(#([^)]+)\)/.exec(fill)?.[1];
		const fillDef = fillRef ? this.defs.get(fillRef) : undefined;
		if (hasFill && fillDef?.name === "pattern" && !this.o.matte) {
			this.patternFill(d, m, opacity, fillDef);
			if (!hasStroke) return;
		}
		// morph paths (see drawingAt) have a fixed structure: a closed contour ends on its start
		const shapes = bezierPaths(d, !hasStroke || hasFill, this.digits, this.o.stable && n.attrs["data-morph"] === "1");
		if (!shapes.length) return;
		const it: Json[] = shapes.map((b) => ({ ty: "sh", ks: st(b) }));
		const pts = bezPoints(shapes);
		let local = boxOfPoints(pts, [1, 0, 0, 1, 0, 0]);
		let group: Json | null = null;
		if (hasStroke) {
			const s = this.stroke(n, stroke, opacity);
			if (s) {
				it.push(s);
				const w = num(n.attrs["stroke-width"], 1);
				if (local) local = { x0: local.x0 - w, y0: local.y0 - w, x1: local.x1 + w, y1: local.y1 + w };
			}
		}
		if (hasFill && !(fillDef?.name === "pattern" && !this.o.matte)) {
			const f = this.fill(fill, fillDef, opacity, local, n.attrs["fill-opacity"]);
			if (f && isWrap(f)) {
				// elliptical radial: the gradient in its own (circular) space G, the paths inside mapped
				// back by G^-1 (a style's transform is its group's; its shapes may sit deeper)
				const inner = { ty: "gr", it: [...it, groupTransform(invert(f.wrap), this.digits)] };
				group = { ty: "gr", it: [inner, f.style, groupTransform(concat(f.wrap, m), this.digits)] };
			} else if (f) it.push(f);
		}
		group ??= { ty: "gr", it: [...it, groupTransform(m, this.digits)] };
		this.groups.push(group);
		if (local) this.box = unionBox(this.box, transformBox(local, m));
	}

	private paintColor(c: [number, number, number, number]): { rgb: number[]; a: number } {
		if (this.o.matte) return { rgb: [1, 1, 1], a: c[3] > 0 ? Math.min(1, c[3] * 9) : 0 };
		const p = applyCT(this.o.paint, c);
		return { rgb: [round(p[0], 3), round(p[1], 3), round(p[2], 3)], a: p[3] };
	}

	private stroke(n: XmlNode, stroke: string, opacity: number): Json | null {
		const w = num(n.attrs["stroke-width"], 1);
		// a hairline keeps its width in pixels; Lottie strokes scale with their symbol: the width
		// at the scale the symbol starts with
		const hair = !!n.attrs["vector-effect"];
		if (hair)
			this.w.warn("Hairlines (strokes that keep their width when scaled) get the width they have at the first frame (a Lottie stroke scales with its symbol)");
		const base: Json = {
			w: st(round(hair ? w / (this.o.scale || 1) : w, Math.max(this.digits, 3))),
			lc: { butt: 1, round: 2, square: 3 }[n.attrs["stroke-linecap"] ?? "butt"] ?? 1,
			lj: { miter: 1, round: 2, bevel: 3 }[n.attrs["stroke-linejoin"] ?? "miter"] ?? 1,
			ml: num(n.attrs["stroke-miterlimit"], 4),
		};
		const ref = /url\(#([^)]+)\)/.exec(stroke)?.[1];
		if (ref) {
			const def = this.defs.get(ref);
			if (!def || def.name === "pattern") {
				this.w.warn("Bitmap strokes aren't exported to Lottie");
				return null;
			}
			const g = this.gradient(def, null, opacity * num(n.attrs["stroke-opacity"], 1), true);
			return g && !isWrap(g) ? { ty: "gs", ...g, ...base } : null;
		}
		const c = parseColor(stroke);
		if (!c) return null;
		const p = this.paintColor(c);
		return { ty: "st", c: st(p.rgb), o: st(round(p.a * opacity * 100, 2)), ...base };
	}

	private fill(fill: string, def: XmlNode | undefined, opacity: number, local: Box | null, fillOpacity: string | undefined): Json | Wrapped | null {
		const op = opacity * num(fillOpacity, 1);
		if (def) {
			const g = this.gradient(def, local, op, false);
			if (!g) return null;
			if (isWrap(g)) return { wrap: g.wrap, style: { ty: "gf", ...g.style, r: 1 } };
			return { ty: "gf", ...g, r: 1 };
		}
		const c = parseColor(fill);
		if (!c) return null;
		const p = this.paintColor(c);
		return { ty: "fl", c: st(p.rgb), o: st(round(p.a * op * 100, 2)), r: 1 };
	}

	/** A gradient's Lottie properties; elliptical radials: in their own space (`wrap`: that space). */
	private gradient(def: XmlNode, local: Box | null, opacity: number, stroke: boolean): Json | Wrapped | null {
		const stops = def.children.filter((c): c is XmlNode => isNode(c) && c.name === "stop");
		if (!stops.length) return null;
		const G = parseTransform(def.attrs.gradientTransform);
		let list = stops.map((s) => {
			const c = parseColor(s.attrs["stop-color"]) ?? [0, 0, 0, 1];
			const p = this.paintColor([c[0], c[1], c[2], c[3] * num(s.attrs["stop-opacity"], 1)]);
			return { off: Math.max(0, Math.min(1, num(s.attrs.offset))), rgb: p.rgb, a: p.a * (this.o.matte ? 1 : opacity) };
		});
		const spread = def.attrs.spreadMethod ?? "pad";
		const d = this.digits;
		if (def.name === "linearGradient") {
			const p1 = { x: num(def.attrs.x1), y: num(def.attrs.y1) },
				p2 = { x: num(def.attrs.x2, 1), y: num(def.attrs.y2) };
			// the gradient's value is affine in the point: v(q) = (G^-1 q - p1).dir / |dir|^2, so in the
			// drawing's space it runs from G(p1) along g = A^T dir / |dir|^2 (A: the inverse's linear part)
			const dir = { x: p2.x - p1.x, y: p2.y - p1.y };
			const len2 = dir.x * dir.x + dir.y * dir.y || 1;
			const A = invert(G);
			const g = { x: (A[0] * dir.x + A[1] * dir.y) / len2, y: (A[2] * dir.x + A[3] * dir.y) / len2 };
			const g2 = g.x * g.x + g.y * g.y || 1;
			let s = apply(G, p1);
			let e = { x: s.x + g.x / g2, y: s.y + g.y / g2 };
			if (spread !== "pad" && local && !this.o.stable) {
				// reflect/repeat: copies of the stops over the part of the axis the shape covers
				const u = (q: { x: number; y: number }) => (q.x - s.x) * g.x + (q.y - s.y) * g.y;
				const us = [u({ x: local.x0, y: local.y0 }), u({ x: local.x1, y: local.y0 }), u({ x: local.x1, y: local.y1 }), u({ x: local.x0, y: local.y1 })];
				const k0 = Math.floor(Math.min(...us)),
					k1 = Math.ceil(Math.max(...us));
				if (k0 < 0 || k1 > 1) {
					const from = Math.max(k0, -32),
						to = Math.min(k1, from + 64);
					list = repeatStops(list, from, to, spread === "reflect");
					const ds = { x: e.x - s.x, y: e.y - s.y };
					e = { x: s.x + ds.x * to, y: s.y + ds.y * to };
					s = { x: s.x + ds.x * from, y: s.y + ds.y * from };
				}
			}
			return { t: 1, o: st(100), s: st([round(s.x, d), round(s.y, d)]), e: st([round(e.x, d), round(e.y, d)]), g: gradientStops(list, this.o.stable) };
		}
		// radial
		const c = { x: num(def.attrs.cx), y: num(def.attrs.cy) };
		const r = num(def.attrs.r, 0.5);
		const f = { x: num(def.attrs.fx, c.x), y: num(def.attrs.fy, c.y) };
		const similar = Math.abs(G[0] - G[3]) < 1e-6 && Math.abs(G[1] + G[2]) < 1e-6;
		const mirrored = Math.abs(G[0] + G[3]) < 1e-6 && Math.abs(G[1] - G[2]) < 1e-6;
		if (spread !== "pad" && !this.o.stable && local) {
			// repeat/reflect: rings of stops out to the farthest corner
			const inv = invert(G);
			const far = Math.max(
				...[
					apply(inv, { x: local.x0, y: local.y0 }),
					apply(inv, { x: local.x1, y: local.y0 }),
					apply(inv, { x: local.x1, y: local.y1 }),
					apply(inv, { x: local.x0, y: local.y1 }),
				].map((q) => Math.hypot(q.x - c.x, q.y - c.y)),
			);
			const n = Math.min(64, Math.ceil(far / (r || 1)));
			if (n > 1) {
				list = repeatStops(list, 0, n, spread === "reflect");
				return this.radial(G, c, r * n, { x: c.x + (f.x - c.x), y: c.y + (f.y - c.y) }, list, (similar || mirrored) && !this.o.stable, stroke);
			}
		}
		return this.radial(G, c, r, f, list, (similar || mirrored) && !this.o.stable, stroke);
	}

	private radial(G: Mat, c: { x: number; y: number }, r: number, f: { x: number; y: number }, list: Stop[], similar: boolean, stroke: boolean): Json | Wrapped {
		const d = this.digits;
		const props = (cc: { x: number; y: number }, ff: { x: number; y: number }, rr: number): Json => {
			const fd = Math.hypot(ff.x - cc.x, ff.y - cc.y);
			const dir = fd > 1e-9 ? { x: (ff.x - cc.x) / fd, y: (ff.y - cc.y) / fd } : { x: 1, y: 0 };
			const out: Json = {
				t: 2,
				o: st(100),
				s: st([round(cc.x, d), round(cc.y, d)]),
				e: st([round(cc.x + dir.x * rr, d), round(cc.y + dir.y * rr, d)]),
				g: gradientStops(list, this.o.stable),
			};
			if (fd > 1e-9 || this.o.stable) {
				out.h = st(round(Math.min(99, (fd / (rr || 1)) * 100), 2));
				out.a = st(0);
			}
			return out;
		};
		if (similar) {
			const k = Math.sqrt(Math.abs(G[0] * G[3] - G[1] * G[2]));
			return props(apply(G, c), apply(G, f), r * k);
		}
		if (stroke) {
			// strokes can't use a style transform (their width would follow it): the nearest circle
			const k = Math.sqrt(Math.abs(G[0] * G[3] - G[1] * G[2]));
			return props(apply(G, c), apply(G, f), r * k);
		}
		return { wrap: G, style: props(c, f, r) };
	}

	/** Repeating bitmap fill: tiles of the pattern under a matte of the path. */
	private patternFill(d: string, m: Mat, opacity: number, pat: XmlNode) {
		const shapes = bezierPaths(d, true, this.digits);
		if (!shapes.length) return;
		const local = boxOfPoints(bezPoints(shapes), [1, 0, 0, 1, 0, 0]);
		if (!local) return;
		this.flush();
		const P = parseTransform(pat.attrs.patternTransform);
		const pw = num(pat.attrs.width),
			ph = num(pat.attrs.height);
		const tiles = new DrawingBuilder(this.w, this.defs, this.o);
		if (pw > 0 && ph > 0) {
			const pb = transformBox(local, invert(P));
			let i0 = Math.floor(pb.x0 / pw),
				i1 = Math.ceil(pb.x1 / pw),
				j0 = Math.floor(pb.y0 / ph),
				j1 = Math.ceil(pb.y1 / ph);
			if ((i1 - i0) * (j1 - j0) > 400) {
				this.w.warn("A bitmap fill repeats more than 400 times: Lottie shows the first 400 tiles");
				i1 = Math.min(i1, i0 + 20);
				j1 = Math.min(j1, j0 + 20);
			}
			// (dotLottie smooths image edges: thin seams between the tiles; growing them shifts
			// pixel-art patterns visibly in the other players, measured)
			for (let j = j0; j < j1; j++)
				for (let i = i0; i < i1; i++) {
					const tm = concat(concat([1, 0, 0, 1, i * pw, j * ph], P), m);
					for (const c of pat.children) if (isNode(c)) tiles.node(c, tm, 1);
				}
		}
		tiles.flush();
		const matte = {
			ty: "gr",
			it: [...shapes.map((b) => ({ ty: "sh", ks: st(b) })), { ty: "fl", c: st([1, 1, 1]), o: st(100), r: 1 }, groupTransform(m, this.digits)],
		};
		this.matted(tiles.layers, [matte], transformBox(local, m), opacity);
	}

	/** Content under a clip path (the clip as a track matte). */
	private clipped(children: XmlNode[], m: Mat, opacity: number, clip: XmlNode) {
		this.flush();
		const inner = new DrawingBuilder(this.w, this.defs, this.o);
		for (const c of children) inner.node(c, m, 1);
		inner.flush();
		const groups: Json[] = [];
		let box: Box | null = null;
		const cm = concat(parseTransform(clip.attrs.transform), m);
		const add = (n: XmlNode, mm: Mat) => {
			let d = n.attrs.d;
			if (n.name === "rect") {
				const x = num(n.attrs.x),
					y = num(n.attrs.y),
					w = num(n.attrs.width),
					h = num(n.attrs.height);
				d = `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
			}
			if (n.name === "use") {
				const ref = this.defs.get((n.attrs["xlink:href"] ?? "").slice(1));
				if (ref) add(ref, concat(parseTransform(n.attrs.transform), mm));
				return;
			}
			if (!d) return;
			const tm = concat(parseTransform(n.attrs.transform), mm);
			const shapes = bezierPaths(d, true, this.digits);
			if (!shapes.length) return;
			groups.push({
				ty: "gr",
				it: [...shapes.map((b) => ({ ty: "sh", ks: st(b) })), { ty: "fl", c: st([1, 1, 1]), o: st(100), r: 1 }, groupTransform(tm, this.digits)],
			});
			box = unionBox(box, boxOfPoints(bezPoints(shapes), tm));
		};
		for (const c of clip.children) if (isNode(c)) add(c, cm);
		if (!groups.length) return;
		this.matted(inner.layers, groups, box, opacity);
	}

	/** Layers (bottom first) shown only where the matte groups paint. */
	private matted(content: LayerOut[], matte: Json[], box: Box | null, opacity: number) {
		if (!content.length) return;
		let layer: LayerOut;
		if (content.length === 1 && !content[0]!.td) layer = content[0]!;
		else {
			const ref = this.w.precomp(null, "", () => [...content].reverse());
			layer = { json: { ty: 0, refId: ref.id, w: ref.w, h: ref.h, ks: { a: st([ref.ox, ref.oy]) } }, box: ref.box };
		}
		if (opacity < 1) (layer.json.ks as Json).o = st(round(opacity * 100, 2));
		layer.json.tt = 1;
		layer.box =
			box && layer.box
				? { x0: Math.max(box.x0, layer.box.x0), y0: Math.max(box.y0, layer.box.y0), x1: Math.min(box.x1, layer.box.x1), y1: Math.min(box.y1, layer.box.y1) }
				: (box ?? layer.box);
		this.layers.push(layer, { json: { ty: 4, ks: {}, shapes: [...matte].reverse() }, box, td: true });
	}

	private image(n: XmlNode, m: Mat, opacity: number) {
		const id = n.attrs["data-bitmap"];
		const img = id ? this.w.image(id) : null;
		if (!img) return;
		this.flush();
		const w = num(n.attrs.width, img.w),
			h = num(n.attrs.height, img.h);
		const tm = concat([w / img.w, 0, 0, h / img.h, num(n.attrs.x), num(n.attrs.y)], m);
		const ks = matrixProps(tm, Math.max(this.digits, 3));
		// a colour transform can't recolour a bitmap in Lottie: its alpha still applies
		const paint = this.o.matte ? null : this.o.paint;
		if (paint && tintsColour(paint)) this.w.warn("Colour effects on bitmaps can't be shown in Lottie: only their alpha");
		const a = this.o.matte ? 1 : opacity * applyCT(paint, [0, 0, 0, 1])[3];
		if (a < 1 || this.o.matte) ks.o = st(round(a * 100, 2));
		this.layers.push({ json: { ty: 2, refId: img.id, ks }, box: transformBox({ x0: 0, y0: 0, x1: img.w, y1: img.h }, tm) });
	}

	/** A nested <svg> viewport: its content scaled from the viewBox and clipped (by a precomp). */
	private viewport(n: XmlNode, m: Mat, opacity: number) {
		const x = num(n.attrs.x),
			y = num(n.attrs.y),
			w = num(n.attrs.width),
			h = num(n.attrs.height);
		if (w <= 0 || h <= 0) return;
		const vb = (n.attrs.viewBox ?? `0 0 ${w} ${h}`).split(/[\s,]+/).map(Number);
		const [vx, vy, vw, vh] = [vb[0] ?? 0, vb[1] ?? 0, vb[2] || w, vb[3] || h];
		this.flush();
		// The precomp's box is whole pixels: the viewBox mapped onto W x H, that scaled to w x h.
		// The box follows the viewBox, not the viewport: the edge strips Animate stretches out of a
		// bitmap fill (a viewBox of 0.02 px over 3000 px) would otherwise need a scale of 150000
		// inside, too much for float32 players (dotLottie drew them washed out).
		const W = Math.max(1, Math.ceil(Math.min(w, vw))),
			H = Math.max(1, Math.ceil(Math.min(h, vh)));
		const inner = new DrawingBuilder(this.w, this.defs, this.o);
		const base: Mat = [W / vw, 0, 0, H / vh, (-vx * W) / vw, (-vy * H) / vh];
		for (const c of n.children) if (isNode(c)) inner.node(c, base, 1);
		inner.flush();
		if (!inner.layers.length) return;
		const asset = this.w.rawPrecomp([...inner.layers].reverse());
		const pm = concat([w / W, 0, 0, h / H, x, y], m);
		const ks = matrixProps(pm, Math.max(this.digits, 3));
		if (opacity < 1) ks.o = st(round(opacity * 100, 2));
		this.layers.push({ json: { ty: 0, refId: asset, w: W, h: H, ks }, box: transformBox({ x0: 0, y0: 0, x1: W, y1: H }, pm) });
	}
}

interface Stop {
	off: number;
	rgb: number[];
	a: number;
}

function repeatStops(list: Stop[], from: number, to: number, reflect: boolean): Stop[] {
	const out: Stop[] = [];
	const span = to - from;
	for (let k = from; k < to; k++) {
		const flip = reflect && ((k % 2) + 2) % 2 === 1;
		const seq = flip ? [...list].reverse().map((s) => ({ ...s, off: 1 - s.off })) : list;
		for (const s of seq) {
			// where one repeat ends and the next begins, two stops meet: the second a hair later
			// (Skottie orders stops at the same offset differently from the others)
			const prev = out[out.length - 1];
			let off = (k - from + s.off) / span;
			if (prev && off <= prev.off + 5e-5) off = Math.min(1, prev.off + 1e-4);
			out.push({ ...s, off });
		}
	}
	return out;
}

function gradientStops(list: Stop[], stable: boolean): Json {
	const k: number[] = [];
	for (const s of list) k.push(round(s.off, 4), ...s.rgb);
	if (stable || list.some((s) => s.a < 0.9995)) for (const s of list) k.push(round(s.off, 4), round(s.a, 3));
	return { p: list.length, k: st(k) };
}

// ------------------------------------------------------------------------------- keyframes

/** Value of a track at `t` and the ease of the stretch [t, t2) of it (cut exactly). */
function easeBetween(track: GTrack, t: number, t2: number): Ease {
	if (!track.length || t < track[0]!.t - 1e-9) return "hold";
	let i = 0;
	while (i < track.length - 1 && track[i + 1]!.t <= t + 1e-9) i++;
	const a = track[i]!,
		b = track[i + 1];
	if (!b) return "hold";
	if (typeof a.ease === "string") return a.ease;
	const span = b.t - a.t;
	const u0 = (t - a.t) / span,
		u1 = (t2 - a.t) / span;
	if (u0 < 1e-9 && u1 > 1 - 1e-9) return a.ease;
	return subBezier(a.ease, Math.max(0, u0), Math.min(1, u1)).bezier;
}

const isConst = (t: GTrack) => t.every((k) => Math.abs(k.v - t[0]!.v) < 1e-9);

/**
 * A Lottie property from one track per dimension: value = v * scale + offset (per dimension).
 * Keys at the union of the tracks' key times; eases cut exactly where another dimension has a key.
 */
function trackProp(tracks: GTrack[], scale: number[], offset: number[], digits: number, scalar = false): Json {
	const value = (t: number) => tracks.map((tr, d) => round(valueAt(tr as Track, t) * scale[d]! + offset[d]!, digits));
	if (tracks.every(isConst)) {
		const v = tracks.map((tr, d) => round((tr[0]?.v ?? 0) * scale[d]! + offset[d]!, digits));
		return st(scalar ? v[0] : v);
	}
	const times = [...new Set(tracks.flatMap((tr) => tr.map((k) => Math.round(k.t * 1e6) / 1e6)))].sort((a, b) => a - b);
	const k: Json[] = [];
	for (let i = 0; i < times.length; i++) {
		const t = times[i]!;
		const kf: Json = { t: round(t, 4), s: value(t) };
		const t2 = times[i + 1];
		if (t2 === undefined) {
			k.push(kf);
			break;
		}
		const eases = tracks.map((tr) => easeBetween(tr, t, t2));
		const holds = eases.map((e) => e === "hold");
		if (holds.every(Boolean)) kf.h = 1;
		else if (holds.some(Boolean)) {
			// some dimensions jump at t2, others move: move to just before t2, then jump
			const tj = t2 - 1e-3;
			setEase(
				kf,
				eases.map((e) => (e === "hold" ? "linear" : e)),
				tracks.map((tr, d) => (holds[d] ? 0 : 1)),
			);
			k.push(kf);
			const mid: number[] = tracks.map((tr, d) => (holds[d] ? (kf.s as number[])[d]! : round(valueAt(tr as Track, tj) * scale[d]! + offset[d]!, digits)));
			k.push({ t: round(tj, 4), s: mid, h: 1 });
			continue;
		} else setEase(kf, eases, null);
		k.push(kf);
	}
	return { a: 1, k };
}

/** Sets a keyframe's easing handles (scalars when all dimensions agree); `still`: dims that stay. */
function setEase(kf: Json, eases: Ease[], still: number[] | null) {
	const hs = eases.map((e, d) => {
		if (still && !still[d]) return [0, 0, 1, 0];
		return e === "linear" || e === "hold" ? [0, 0, 1, 1] : e.map((x) => round(x, 4));
	});
	const same = hs.every((h) => h.every((x, j) => x === hs[0]![j]));
	if (same) {
		const h = hs[0]!;
		kf.o = { x: h[0], y: h[1] };
		kf.i = { x: h[2], y: h[3] };
	} else {
		kf.o = { x: hs.map((h) => h[0]!), y: hs.map((h) => h[1]!) };
		kf.i = { x: hs.map((h) => h[2]!), y: hs.map((h) => h[3]!) };
	}
}

/** The part of a track in [a, b) at its own times (eases cut exactly). */
function cut(track: GTrack, a: number, b: number): GTrack {
	if (track.length <= 1) return track;
	return sliceTrack(track, a, b).map((k) => ({ ...k, t: k.t + a }));
}

// ---------------------------------------------------------------------------------- writer

interface PrecompRef {
	id: string;
	w: number;
	h: number;
	ox: number;
	oy: number;
	/** Content bounds in the precomp's own (unshifted) coordinates. */
	box: Box;
}

class LottieWriter {
	readonly ctx: Context;
	readonly digits: number;
	readonly H: number;
	readonly images: LottieImages;
	readonly fps: number;
	readonly periods: Periods;
	readonly assets: Json[] = [];
	readonly files: { name: string; source: string }[] = [];
	private imageAssets = new Map<string, { id: string; w: number; h: number } | null>();
	private precomps = new Map<string, PrecompRef>();
	private drawings = new Map<string, { layers: LayerOut[]; size: number }>();
	private uses = new Map<string, number>();
	private n = 0;

	constructor(ctx: Context, H: number, images: LottieImages) {
		this.ctx = ctx;
		this.digits = ctx.digits;
		this.H = H;
		this.images = images;
		this.fps = ctx.model.doc.frameRate || 24;
		this.periods = new Periods(ctx, H);
	}

	warn = (m: string) => {
		if (!this.ctx.warnings.includes(m)) this.ctx.warnings.push(m);
	};

	/** The image asset of a bitmap (once per bitmap). */
	image(bitmapId: string): { id: string; w: number; h: number } | null {
		if (this.imageAssets.has(bitmapId)) return this.imageAssets.get(bitmapId)!;
		const b = this.ctx.model.bitmaps[bitmapId];
		let r: { id: string; w: number; h: number } | null = null;
		if (b) {
			const [pw, ph] = b.pixels ?? [b.width, b.height];
			const id = `i${this.imageAssets.size + 1}`;
			const asset: Json = { id, w: pw, h: ph };
			const name = b.file.slice(b.file.lastIndexOf("/") + 1);
			if (this.images === "embed") Object.assign(asset, { u: "", p: `data:${imageMime(b.file)};base64,${toBase64(this.ctx.files.readBinary(b.file))}`, e: 1 });
			else if (this.images === "dotlottie") {
				const file = `${id}_${name}`;
				Object.assign(asset, { u: "/i/", p: file, e: 0 });
				this.files.push({ name: file, source: b.file });
			} else {
				const dir = b.file.slice(0, b.file.lastIndexOf("/") + 1);
				Object.assign(asset, { u: dir, p: name, e: 0 });
				this.files.push({ name: b.file, source: b.file });
			}
			this.assets.push(asset);
			if (!b.smoothing) this.warn("Bitmaps without smoothing (pixel art) are drawn smoothed in Lottie");
			r = { id, w: pw, h: ph };
		}
		this.imageAssets.set(bitmapId, r);
		return r;
	}

	/** A precomposition of layers (top first) moved into its box; cached by `key` when given. */
	precomp(key: string | null, nm: string, build: () => LayerOut[]): PrecompRef {
		if (key) {
			const hit = this.precomps.get(key);
			if (hit) return hit;
		}
		const layers = build();
		let box: Box | null = null;
		for (const l of layers) box = unionBox(box, l.box);
		if (!box || !Number.isFinite(box.x0 + box.x1 + box.y0 + box.y1)) box = EMPTY_BOX;
		// precomps clip to [0, w] x [0, h] in every player: shift the content into that box
		const ox = 1 - Math.floor(box.x0),
			oy = 1 - Math.floor(box.y0);
		const w = Math.max(1, Math.ceil(box.x1) + ox + 1),
			h = Math.max(1, Math.ceil(box.y1) + oy + 1);
		for (const l of layers) shiftLayer(l.json, ox, oy);
		const id = `c${++this.n}`;
		const asset: Json = { id, layers: finalize(layers, this.H) };
		if (nm) asset.nm = nm;
		this.assets.push(asset);
		const ref = { id, w, h, ox, oy, box };
		if (key) this.precomps.set(key, ref);
		return ref;
	}

	/** A precomposition kept at its own coordinates (its box is set by the caller). */
	rawPrecomp(layers: LayerOut[]): string {
		const id = `c${++this.n}`;
		this.assets.push({ id, layers: finalize(layers, this.H) });
		return id;
	}

	// ---------------------------------------------------------------- timelines

	/** Counts how often each drawing is placed (shared ones go into a precomp). */
	countUses(bt: BakedTimeline, seen = new Set<string>()) {
		if (seen.has(bt.key)) return;
		seen.add(bt.key);
		for (const bl of bt.layers)
			for (const n of bl.nodes) {
				const art = n.kind === "art" ? n.art : n.kind === "text" ? (n.item as { art?: string }).art : undefined;
				if (art) this.uses.set(art, (this.uses.get(art) ?? 0) + n.vis.length);
				if (n.kind === "instance" && n.child) this.countUses(n.child, seen);
			}
	}

	private hairlineTimelines = new Map<string, boolean>();
	/** True if a timeline draws hairlines (strokes that keep their width), here or deeper. */
	hairlines(bt: BakedTimeline): boolean {
		let r = this.hairlineTimelines.get(bt.key);
		if (r !== undefined) return r;
		this.hairlineTimelines.set(bt.key, false); // (cycle guard)
		r = false;
		for (const bl of bt.layers)
			for (const n of bl.nodes) {
				const id = n.kind === "art" ? n.art : n.kind === "text" ? (n.item as { art?: string }).art : undefined;
				const a = id ? this.ctx.art(id) : n.kind === "morph" ? n.part.art : null;
				if ((a && artHairlines(a)) || (n.kind === "instance" && n.child && this.hairlines(n.child))) r = true;
			}
		this.hairlineTimelines.set(bt.key, r);
		return r;
	}

	/**
	 * The layers of a baked timeline over the ticks [0, W), top first, in its own coordinates.
	 * Runs of nodes that repeat sooner (the content of a looping movie clip) go into a precomp
	 * of one period that a time remap plays over and over.
	 */
	timeline(bt: BakedTimeline, mode: Mode, W: number): LayerOut[] {
		const out: LayerOut[] = []; // bottom first
		const masks = new Map<number, LayerOut[]>();
		for (const bl of bt.layers) {
			if (bl.layer.type !== "mask") continue;
			// a plain mask only gives its shape; "alpha"/"erase" masks their alpha
			const keep = bl.layer.maskMode !== undefined && !mode.opaque;
			const content = this.nodes(bl.nodes, { opaque: !keep, paint: keep ? mode.paint : null, scale: mode.scale }, W);
			if (content.length) masks.set(bl.layer.index, content);
		}
		let group: { mask: number; layers: LayerOut[] } | null = null;
		const flush = () => {
			const g = group;
			group = null;
			if (!g || !g.layers.length) return;
			const mask = masks.get(g.mask);
			const ml = bt.layers.find((l) => l.layer.index === g.mask)?.layer;
			if (!mask || !ml) return; // an empty mask hides what it masks
			out.push(...this.masked(`${bt.key}#${modeKey(mode)}#${W}`, g.mask, g.layers, mask, ml.maskMode, ml.maskBox));
		};
		let slice: { p: number; nodes: BakedNode[] } | null = null;
		const flushSlice = () => {
			const s = slice;
			slice = null;
			if (s) out.push(...this.slice(s.nodes, s.p, mode, W));
		};
		for (const bl of bt.layers) {
			if (bl.layer.type === "mask") continue;
			if (bl.layer.maskedBy >= 0) {
				flushSlice();
				const layers = this.nodes(bl.nodes, mode, W);
				if (group && group.mask !== bl.layer.maskedBy) flush();
				if (!group) group = { mask: bl.layer.maskedBy, layers: [] };
				group.layers.push(...layers);
				continue;
			}
			flush();
			for (const n of bl.nodes) {
				const p = this.repeats(n, mode, W);
				if (p) {
					if (slice && slice.p !== p) flushSlice();
					slice ??= { p, nodes: [] };
					slice.nodes.push(n);
				} else {
					flushSlice();
					out.push(...this.node(n, mode, W));
				}
			}
		}
		flushSlice();
		flush();
		return out.reverse();
	}

	/**
	 * The period after which a node changing within [0, W) repeats, if it is worth playing one
	 * period again (0: draw it over the whole window).
	 */
	private repeats(n: BakedNode, mode: Mode, W: number): number {
		if (mode.paint && !paintConstant(mode.paint)) return 0;
		const p = this.periods.node(n);
		if (p * 2 > W) return 0;
		// a node that never changes gains nothing (the content inside repeats on its own)
		const still =
			n.vis.length === 1 &&
			n.vis[0]![0] <= 0 &&
			n.vis[0]![1] >= W &&
			(n.kind === "art" ||
				n.kind === "bitmap" ||
				n.kind === "text" ||
				(n.kind === "instance" && Object.values(n.transform).every(isConst) && (!n.color || Object.values(n.color).every(isConst))));
		return still ? 0 : p;
	}

	/** Nodes that repeat every `p` ticks: drawn for one period, played again by a time remap. */
	private slice(nodes: BakedNode[], p: number, mode: Mode, W: number): LayerOut[] {
		const key = `slice#${nodes.map((n) => n.uid).join(",")}#${p}#${modeKey(mode)}`;
		const ref = this.precomp(key, "", () => this.nodes(nodes, mode, p).reverse());
		return [
			{
				json: { ty: 0, refId: ref.id, w: ref.w, h: ref.h, ip: 0, op: W, st: 0, ks: { a: st([ref.ox, ref.oy]) }, tm: sawtooth(0, W, p, this.fps) },
				box: ref.box,
			},
		];
	}

	/** Masked layers (bottom first) under a track matte made of the mask layer's content. */
	private masked(
		key: string,
		maskIndex: number,
		content: LayerOut[],
		mask: LayerOut[],
		mode: "alpha" | "erase" | undefined,
		box?: { left: number; top: number; width: number; height: number },
	): LayerOut[] {
		// a matte must exist all the time (outside its own frames it would mask nothing); ThorVG
		// ignores a track matte on a layer with effects: those go one level down
		const one = (list: LayerOut[], key: string, whole: boolean): LayerOut => {
			const l = list[0]!;
			if (
				list.length === 1 &&
				!l.td &&
				!l.json.ef &&
				(!whole || (((l.json.ip as number | undefined) ?? 0) === 0 && ((l.json.op as number | undefined) ?? this.H) >= this.H))
			)
				return l;
			const ref = this.precomp(key, "", () => [...list].reverse());
			return { json: { ty: 0, refId: ref.id, w: ref.w, h: ref.h, ip: 0, op: this.H, st: 0, ks: { a: st([ref.ox, ref.oy]) } }, box: ref.box };
		};
		const matteLayers = [...mask];
		if (mode === "alpha" && box) {
			// Flash blends "alpha" only inside the element's bounds: everything else stays. The
			// frame around them covers what it masks (a precomp clips to its content's box).
			let around: Box | null = null;
			for (const l of content) around = unionBox(around, l.box);
			const f = unionBox(around ?? { x0: -1e4, y0: -1e4, x1: 1e4, y1: 1e4 }, {
				x0: box.left,
				y0: box.top,
				x1: box.left + box.width,
				y1: box.top + box.height,
			})!;
			const z = [
				[0, 0],
				[0, 0],
				[0, 0],
				[0, 0],
			];
			const frame = {
				c: true,
				v: [
					[f.x0 - 1, f.y0 - 1],
					[f.x1 + 1, f.y0 - 1],
					[f.x1 + 1, f.y1 + 1],
					[f.x0 - 1, f.y1 + 1],
				],
				i: z,
				o: z,
			};
			const hole = {
				c: true,
				v: [
					[box.left, box.top],
					[box.left, box.top + box.height],
					[box.left + box.width, box.top + box.height],
					[box.left + box.width, box.top],
				],
				i: z,
				o: z,
			};
			const shapes = [
				{
					ty: "gr",
					it: [
						{ ty: "sh", ks: st(frame) },
						{ ty: "sh", ks: st(hole) },
						{ ty: "fl", c: st([1, 1, 1]), o: st(100), r: 1 },
						{ ty: "tr", o: st(100) },
					],
				},
			];
			matteLayers.push({ json: { ty: 4, ip: 0, op: this.H, st: 0, ks: {}, shapes }, box: { x0: f.x0 - 1, y0: f.y0 - 1, x1: f.x1 + 1, y1: f.y1 + 1 } });
		}
		const c = one(content, `${key}#masked${maskIndex}`, false);
		const m = one(matteLayers, `${key}#mask${maskIndex}`, true);
		c.json.tt = mode === "erase" ? 2 : 1;
		if (m.json.ip === undefined) Object.assign(m.json, { ip: 0, op: this.H, st: 0 });
		return [c, { ...m, td: true }];
	}

	private nodes(list: BakedNode[], mode: Mode, W: number): LayerOut[] {
		const out: LayerOut[] = [];
		for (const n of list) out.push(...this.node(n, mode, W));
		return out;
	}

	private node(n: BakedNode, mode: Mode, W: number): LayerOut[] {
		const vis = clipVis(n.vis, W);
		if (!vis.length) return [];
		switch (n.kind) {
			case "art":
				return this.art(n.art, vis, mode);
			case "text": {
				const art = (n.item as { art?: string }).art;
				return art ? this.art(art, vis, mode) : [];
			}
			case "bitmap": {
				const it = n.item as Extract<typeof n.item, { kind: "bitmap" }>;
				const img = this.image(it.bitmap);
				const b = this.ctx.model.bitmaps[it.bitmap];
				if (!img || !b) return [];
				const tm = concat([b.width / img.w, 0, 0, b.height / img.h, 0, 0], it.matrix);
				const box = transformBox({ x0: 0, y0: 0, x1: img.w, y1: img.h }, tm);
				return vis.map(([a, e]) => {
					const ks = matrixProps(tm, Math.max(this.digits, 3));
					const p = mode.opaque ? null : mode.paint;
					if (p) {
						if (p.values.some(tintsColour)) this.warn("Colour effects on bitmaps can't be shown in Lottie: only their alpha");
						ks.o = paintOpacity(p, a, e);
					}
					return { json: { ty: 2, refId: img.id, ip: a, op: e, st: 0, ks }, box };
				});
			}
			case "instance":
				return this.instance(n, vis, mode, W);
			case "morph":
				return this.morph(n, vis, mode);
		}
	}

	/** A drawing, placed on each of its intervals (shared drawings as one precomp). */
	private art(atlasId: string, vis: Interval[], mode: Mode): LayerOut[] {
		const a = this.ctx.art(atlasId);
		if (!a) return [];
		const paint = mode.opaque ? null : mode.paint;
		const out: LayerOut[] = [];
		for (const [s, e] of vis) {
			// a colour transform that changes while the drawing shows: keyed paints
			if (paint && !paintConstantIn(paint, s, e)) {
				out.push(...this.animatedArt(a, s, e, paint, mode.scale));
				continue;
			}
			const ct = paint ? paintAt(paint, s) : null;
			const key =
				a.id +
				(mode.opaque ? "#m" : "") +
				(ct ? "#" + ct.map((v) => round(v, 4)).join(",") : "") +
				(mode.scale !== 1 && artHairlines(a) ? "@" + round(mode.scale, 4) : "");
			let d = this.drawings.get(key);
			if (!d) {
				const b = drawingOf(this, a, { matte: mode.opaque, stable: false, paint: ct, scale: mode.scale });
				d = { layers: b.layers, size: JSON.stringify(b.layers.map((l) => l.json)).length };
				this.drawings.set(key, d);
			}
			if (!d.layers.length) continue;
			const uses = this.uses.get(atlasId) ?? 1;
			if (d.layers.length > 1 || (uses > 1 && d.size > 300) || d.layers.some((l) => l.td)) {
				const dd = d;
				const ref = this.precomp(key, "", () => [...dd.layers].reverse().map((l) => ({ ...l, json: { ...l.json, ip: 0, op: this.H, st: 0 } })));
				out.push({ json: { ty: 0, refId: ref.id, w: ref.w, h: ref.h, ip: s, op: e, st: 0, ks: { a: st([ref.ox, ref.oy]) } }, box: ref.box });
				continue;
			}
			const l = d.layers[0]!;
			out.push({ json: { ...l.json, ip: s, op: e, st: 0 }, box: l.box });
		}
		return out;
	}

	/**
	 * A drawing under a colour transform that changes over [s, e): converted at every key of the
	 * transform, the paints merged into keyframes with its eases (exact: the colours are linear in
	 * the transform's values); where clamping bends them, keyed on every tick.
	 */
	private animatedArt(a: Artwork, s: number, e: number, p: Paint, scale: number): LayerOut[] {
		let g = paintGrid(p, s, e);
		const at = (t: number) => drawingOf(this, a, { matte: false, stable: true, paint: paintAt(p, t), scale });
		let frames = g.times.map(at);
		const first = frames[0]!.layers;
		if (first.length !== 1 || first[0]!.json.ty !== 4) {
			this.warn("A colour effect that changes over a drawing with bitmap fills or clipping is shown at its first value in Lottie");
			const b = drawingOf(this, a, { matte: false, stable: false, paint: paintAt(p, s), scale });
			return b.layers.length === 1 ? [{ ...b.layers[0]!, json: { ...b.layers[0]!.json, ip: s, op: e, st: 0 } }] : [];
		}
		const bent = new Set<string>();
		for (let i = 0; i + 1 < g.times.length; i++) {
			const t0 = g.times[i]!,
				t1 = g.times[i + 1]!;
			if (g.eases[i] === "hold" || t1 - t0 < 1.5) continue;
			const tm = (t0 + t1) / 2;
			const u = easeProgress(g.eases[i]!, 0.5);
			nonLinearAt(frames[i]!.layers[0]!.json.shapes, frames[i + 1]!.layers[0]!.json.shapes, at(tm).layers[0]!.json.shapes, u, "", bent);
		}
		if (bent.size) {
			g = ticksOf(s, e);
			frames = g.times.map(at);
		}
		const shapes = mergeKeyframes(
			frames.map((f) => f.layers[0]!.json.shapes as Json[]),
			g.times,
			g.eases,
			new Set(),
			g.times,
			g.eases,
		);
		return [{ json: { ty: 4, ip: s, op: e, st: 0, ks: {}, shapes }, box: frames[0]!.layers[0]!.box }];
	}

	private instance(n: BakedInstance, vis: Interval[], mode: Mode, W: number): LayerOut[] {
		if (!n.item.visible || !n.child) return [];
		if (blendHides(n.item.blendMode)) return [];
		const child = n.child;
		const t = n.transform;
		const color = n.color;
		const alphaOnly =
			!color ||
			((["rP", "gP", "bP"] as ColorProp[]).every((p) => color[p].every((k) => Math.abs(k.v - 100) < 1e-6)) &&
				(["rA", "gA", "bA"] as ColorProp[]).every((p) => color[p].every((k) => Math.abs(k.v) < 1e-6)));
		// Flash colours (and fades) each shape inside, not the instance as a whole: pushed into the
		// paints, as markShapeAlpha found it right; else a group opacity (filters, blends, bitmaps)
		const baked = !!color && !mode.opaque && (!alphaOnly || !!n.item.shapeAlpha);
		let bm = 0;
		const blend = (n.item.blendMode ?? "").toLowerCase();
		// Blends Lottie lacks, as a blend it has applied to recoloured content: invert (the
		// background turned round where the instance is) = difference with the instance painted
		// white, exact (as the SVG output does it); subtract (bg - c) ~ multiply by the inverted
		// colours, bg * (1 - c); add (bg + c) ~ screen, bg + c - bg * c (both exact at 0 and 1)
		let recolour: CT | null = null;
		if (!mode.opaque && blend === "invert") {
			bm = 10;
			recolour = [0, 0, 0, 1, 1, 1, 1, 0];
		} else if (!mode.opaque && blend === "subtract") {
			bm = 1;
			recolour = [-1, -1, -1, 1, 1, 1, 1, 0];
			this.warn('The blend mode "subtract" is drawn as multiply by the inverted colours in Lottie (close, not exact)');
		} else if (!mode.opaque && blend === "add") {
			bm = 2;
			this.warn('The blend mode "add" is drawn as screen in Lottie (close, not exact)');
		} else if (blend && blend !== "normal" && blend !== "layer") {
			bm = BLEND[blend] ?? 0;
			if (!bm) this.warn(`The blend mode "${n.item.blendMode}" has no Lottie equivalent: drawn normally`);
		}
		// a looping movie clip: one loop of its content, played again by a time remap
		const period = this.periods.timeline(child);
		const out: LayerOut[] = [];
		for (const run of this.filterRuns(n, vis, mode)) {
			const { a, b, fx } = run;
			// Animate fades an instance after its filters (content and shadow together, the content
			// opaque over its shadow): with effects, its alpha is the effects layer's opacity and only
			// its tint goes into the paints
			const effects = fx.stages.length > 0;
			const own = effects && color ? withoutAlpha(color) : color;
			const bakeOwn = effects ? !!color && !mode.opaque && !alphaOnly : baked;
			// the colour after the filters (the shadows' too): own colour, blend recolour, parents'
			let after = bakeOwn ? composePaint(mode.paint, own!, a, b) : mode.paint;
			if (recolour) after = paintThen(after, recolour, a);
			// an "adjust colour" filter: its matrix applied to every paint inside, before the rest
			const paint = fx.matrix ? paintFirst(after, fx.matrix, a) : after;
			// hairlines inside: their width in pixels at the scale the instance starts with
			const scale = this.hairlines(child) ? mode.scale * Math.sqrt(Math.abs(valueAt(t.sx as Track, a) * valueAt(t.sy as Track, a))) : 1;
			const sub: Mode = { opaque: mode.opaque, paint, scale };
			// (a colour change can't follow the remapped time)
			const loop = child.animated && period > 1 && period * 2 <= Math.min(W, b) && (!paint || paintConstant(paint));
			const cw = loop ? period : W;
			const ref = this.precomp(`${child.key}#${modeKey(sub)}#${cw}`, child.program.name, () => this.timeline(child, sub, cw));
			const tr = (p: TransformProp) => cut(t[p], a, b);
			const ks: Json = {
				a: trackProp([tr("tpx"), tr("tpy")], [1, 1], [ref.ox, ref.oy], this.digits),
				p: position(tr("x"), tr("y"), this.digits),
				s: trackProp([tr("sx"), tr("sy")], [100, 100], [0, 0], 4),
				r: trackProp([tr("rot")], [1], [0], 3, true),
			};
			const skw = tr("skw");
			if (!isConst(skw) || Math.abs(skw[0]?.v ?? 0) > 1e-9) {
				ks.sk = trackProp([skw], [-1], [0], 3, true);
				ks.sa = st(0);
			}
			let opacity: Json | null = null;
			if (color && (effects || !baked) && !mode.opaque) {
				const aP = cut(color.aP, a, b),
					aA = cut(color.aA, a, b);
				const o = isConst(aA) ? trackProp([aP], [1], [(aA[0]?.v ?? 0) / 2.55], 2, true) : trackProp([aP], [1], [0], 2, true);
				opacity = clampOpacity(o);
			}
			if (opacity && !effects) ks.o = opacity;
			const json: Json = { ty: 0, refId: ref.id, w: ref.w, h: ref.h, ip: a, op: b, st: 0, ks };
			if (loop) json.tm = sawtooth(a, b, period, this.fps);
			const box = this.instanceBox(n, ref.box, a, b);
			// the filters go around the instance: see filtersLayer
			const top = effects ? this.filtersLayer({ json, box }, run, after, opacity) : { json, box };
			if (n.item.name) top.json.nm = n.item.name;
			if (bm) top.json.bm = bm;
			out.push(top);
		}
		return out;
	}

	/**
	 * Splits an instance's intervals where its filters change their make-up (which Lottie effects,
	 * the colour matrix); within a run only effect values change (keyframed).
	 */
	private filterRuns(n: BakedInstance, vis: Interval[], mode: Mode): FilterRun[] {
		const none: LottieFilters = { stages: [], matrix: null, sig: "" };
		if (mode.opaque || !n.filters.some((f) => f.filters.length)) return vis.map(([a, b]) => ({ a, b, fx: none, sets: [] }));
		const mapped = new Map<FilterData[], LottieFilters>();
		const map = (fs: FilterData[]) => {
			let m = mapped.get(fs);
			if (!m) mapped.set(fs, (m = lottieFilters(fs, this.warn)));
			return m;
		};
		const sets = n.filters;
		const at = (t: number) => {
			let s = sets[0]!;
			for (const x of sets) if (x.t <= t) s = x;
			return s;
		};
		const out: FilterRun[] = [];
		for (const [a, b] of vis) {
			const times = [a, ...sets.map((s) => s.t).filter((t) => t > a && t < b)];
			let run: FilterRun | null = null;
			for (const t of times) {
				const fx = map(at(t).filters);
				if (run && run.fx.sig === fx.sig) {
					run.sets.push({ t, fx });
					continue;
				}
				if (run) run.b = t;
				run = { a: t, b, fx, sets: [{ t, fx }] };
				out.push(run);
			}
		}
		return out;
	}

	/**
	 * An instance with its filters, in their order: runs of Lottie effects on a wrapper layer each
	 * (effectsLayer), the others built from layers and track mattes (builtLayer). Animate fades an
	 * instance after its filters; ThorVG fades a layer before its effects (a half transparent
	 * instance over its own shadow): after effects the opacity goes one level up.
	 */
	private filtersLayer(inner: LayerOut, run: FilterRun, after: Paint | null, opacity: Json | null): LayerOut {
		let cur = inner;
		run.fx.stages.forEach((stage, j) => {
			const per = run.sets.map((s) => s.fx.stages[j]!);
			cur = stage.kind === "fx" ? this.effectsLayer(cur, run, per as FxStage[], after) : this.builtLayer(cur, run, per as Built[], after);
		});
		if (!opacity) return cur;
		if (run.fx.stages[run.fx.stages.length - 1]!.kind !== "fx") {
			(cur.json.ks as Json).o = opacity;
			return cur;
		}
		const up = this.precomp(null, "", () => [cur]);
		return { json: { ty: 0, refId: up.id, w: up.w, h: up.h, ip: run.a, op: run.b, st: 0, ks: { a: st([up.ox, up.oy]), o: opacity } }, box: up.box };
	}

	/**
	 * A layer with filters as Lottie effects. Players differ in the space of effect values
	 * (lottie-web and ThorVG: the layer's own, with its transform and parents; Skottie: the
	 * composition's), so the effects sit on a precomp layer without a transform (the parent's
	 * space, where Animate's filters work) that holds the source. ThorVG clips effects to the
	 * precomp and lottie-web its drop shadows to the layer's bounding box: the precomp gets room for
	 * the effects and a transparent rectangle over all of it.
	 */
	private effectsLayer(src: LayerOut, run: FilterRun, per: FxStage[], after: Paint | null): LayerOut {
		const { a, b } = run;
		const g = growBox(src.box ?? EMPTY_BOX, Math.max(...per.map((s) => s.margin)));
		const ref = this.precomp(null, "", () => [src, rectLayer(g, st([1, 1, 1]), st(0), a, b)]);
		const ef = effectsJson(run, per, after);
		return { json: { ty: 0, refId: ref.id, w: ref.w, h: ref.h, ip: a, op: b, st: 0, ks: { a: st([ref.ox, ref.oy]) }, ef }, box: ref.box };
	}

	/**
	 * A filter Lottie has no effect for, built from layers (in the parent's space, as effects) on
	 * the source (the instance, or it with the filters before): its silhouette is a rectangle in
	 * the filter's colour under a track matte of the source (the inverted matte for inner ones),
	 * blurred by Gaussian blur effects and moved. Shadows and glows: inner ones under a matte of
	 * the source, knockouts under its inverse, the source over (outer), under (inner) or left out.
	 * Bevels: the blurred silhouette moved by -d and +d as grey levels o1 and o2, the highlight by
	 * max(0, o1 - o2) (blend modes), the shadow the other way round (a matte product o1 (1 - o2)
	 * would be off along edges in the light's direction). Gradient filters: the glow or bevel as grey levels mapped
	 * to the gradient's colours and alpha by Tritone effects (a lookup at 0, 1/2 and 1) and luma
	 * mattes. Stronger than 100 %: the alpha as grey levels in colour dodge with a grey, as a luma
	 * matte (exact). Values change with held keys.
	 */
	private builtLayer(src: LayerOut, run: FilterRun, per: Built[], after: Paint | null): LayerOut {
		const { a, b } = run;
		const times = run.sets.map((s) => s.t);
		const f = per[0]!;
		const G = growBox(src.box ?? EMPTY_BOX, Math.max(...per.map((s) => s.margin)));
		const pre = (layers: LayerOut[]) => this.precomp(null, "", () => layers);
		const use = (r: PrecompRef, ks: Json = {}, extra: Json = {}): LayerOut => ({
			json: { ty: 0, refId: r.id, w: r.w, h: r.h, ip: a, op: b, st: 0, ks: { a: st([r.ox, r.oy]), ...ks }, ...extra },
			box: r.box,
		});
		const matte = (m: LayerOut, content: LayerOut, tt: 1 | 2 | 3): LayerOut[] => [
			{ ...m, td: true },
			{ ...content, json: { ...content.json, tt } },
		];
		const x = pre([src]);
		const solid = (c: Json, o: Json) => rectLayer(G, c, o, a, b);
		const fixed = (v: number) => st([v, v, v]);
		const blur = blurEffects(per, times);
		const moves = per.some((s) => s.dx || s.dy);
		/** `r` moved by sign x the offset (held keys), its box with every offset. */
		const moved = (r: PrecompRef, sign: number, extra: Json = {}): LayerOut => {
			const l = use(
				r,
				{
					p: heldKeys(
						times,
						per.map((s) => [sign * s.dx, sign * s.dy]),
					),
				},
				extra,
			);
			let box: Box | null = null;
			for (const s of per)
				box = unionBox(box, { x0: r.box.x0 + sign * s.dx, y0: r.box.y0 + sign * s.dy, x1: r.box.x1 + sign * s.dx, y1: r.box.y1 + sign * s.dy });
			l.box = box;
			return l;
		};
		/** The source's silhouette (or the inverse) in a colour, blurred and moved by sign x the offset. */
		const silhouette = (c: Json, o: Json, inverted: boolean, sign: number): PrecompRef => {
			const sil = pre(matte(use(x), solid(c, o), inverted ? 2 : 1));
			if (!blur.length && !(sign && moves)) return sil;
			const ef = blur.length ? { ef: blur } : {};
			const l = sign && moves ? moved(sil, sign, ef) : use(sil, {}, ef);
			return pre([l, rectLayer(unionBox(G, l.box)!, st([1, 1, 1]), st(0), a, b)]);
		};
		const strengths = per.map((s) => (s.kind === "shadow" ? s.m : s.s));
		const strong = Math.max(...strengths) > 1 + 1e-6;
		const opacityOf = (v: number[]) => (v.every((o) => o === 100) ? null : heldKeys(times, v));
		const q = heldKeys(
			times,
			strengths.map((v) => round(Math.min(1, v) * 100, 2)),
		);
		/**
		 * A white image's alpha A as grey levels min(1, m A) over black, for a luma matte: under black
		 * at 1 - m (m < 1; a fill: ThorVG ignores the opacity of layers right inside a layer with
		 * effects) and grey 1 - 1/m in colour dodge (m > 1: L / (1 - c), one pass, all three players).
		 */
		const strengthened = (white: PrecompRef, ms: number[]): PrecompRef => {
			const cover = ms.map((m) => round((1 - Math.min(1, m)) * 100, 2));
			const dodge = ms.map((m) => round(Math.max(0, 1 - 1 / Math.max(m, 1e-9)), 4));
			const layers: LayerOut[] = [];
			if (dodge.some((c) => c > 0)) {
				const l = solid(
					heldKeys(
						times,
						dodge.map((c) => [c, c, c]),
					),
					st(100),
				);
				l.json.bm = 6;
				layers.push(l);
			}
			if (cover.some((v) => v > 0)) layers.push(solid(fixed(0), heldKeys(times, cover)));
			return pre([...layers, use(white), solid(fixed(0), st(100))]);
		};
		/** A colour where a white image is, its alpha strengthened (shadows: m, bevels: s; exact). */
		const coloured = (white: PrecompRef, c: Json) => use(pre(matte(use(strengthened(white, strengths)), solid(c, st(100)), 3)));
		const colour = (pick: (s: Built) => RGB) =>
			colourKeys(
				run,
				after,
				per.map((s) => pick(s)),
				per.map((s) => s.after),
			);
		const white = st([1, 1, 1, 1]),
			black = st([0, 0, 0, 1]);
		/**
		 * Grey levels mapped by a Tritone effect, for a luma matte or a colour (one level down twice:
		 * ThorVG ignores the matte of a layer with effects, and the opacity and blending of the
		 * layers right inside one).
		 */
		const lookup = (plain: PrecompRef, to: Json[]) => pre([use(plain, {}, { ef: [tritone(to)] })]);
		/**
		 * A bevel as grey levels L = 1/2 + k (o1 - o2) / 2 (k <= 1; o1, o2 the blurred silhouette moved
		 * by -d and +d): o1 at k/2 over grey 1/2 / (1 - k/2), the difference with o2 at k/2 over
		 * black (|.| is exact: the first is at least 1/2, the second at most). Each copy is blurred
		 * once per use of L (a matte product o1 (1 - o2) would be off along edges in the light's
		 * direction). Ready for `lookup`.
		 */
		const bevelGreys = (ks: number[]): PrecompRef => {
			const blurred = silhouette(fixed(1), st(100), false, 0);
			const grey = (sign: number) => pre([moved(blurred, sign), solid(fixed(0), st(100))]);
			const half = heldKeys(
				times,
				ks.map((k) => round(k * 50, 2)),
			);
			const base = heldKeys(
				times,
				ks.map((k) => {
					const g = round(0.5 / (1 - k / 2), 4);
					return [g, g, g];
				}),
			);
			const low = pre([use(grey(1), { o: half }), solid(fixed(0), st(100))]);
			return pre([use(pre([use(low, {}, { bm: 10 }), use(grey(-1), { o: half }), solid(base, st(100))]))]);
		};
		/** A bevel's highlight max(0, 2L - 1) = max(0, o1 - o2) and shadow max(0, 1 - 2L), coloured and strengthened. */
		const bevelSides = (L: PrecompRef, hi: Json, sh: Json, hiAlpha: Json | null, shAlpha: Json | null) => {
			const side = (to: Json[], c: Json, o: Json | null) => {
				const l = coloured(lookup(L, to), c);
				if (o) (l.json.ks as Json).o = o;
				return l;
			};
			return { hi: side([white, black, black], hi, hiAlpha), sh: side([black, black, white], sh, shAlpha) };
		};
		const typed = (l: LayerOut, type: BevelType): LayerOut[] => (type === "full" ? [l] : matte(use(x), l, type === "inner" ? 1 : 2));
		let layers: LayerOut[];
		if (f.kind === "shadow") {
			const c = colour((s) => (s as ShadowBuilt).rgb);
			const shadow = strong && blur.length ? coloured(silhouette(fixed(1), st(100), f.inner, 1), c) : use(silhouette(c, q, f.inner, 1));
			if (f.inner) layers = [...matte(use(x), shadow, 1), ...(f.knockout || f.hide ? [] : [use(x)])];
			else if (f.knockout) layers = matte(use(x), shadow, 2);
			else layers = [...(f.hide ? [] : [use(x)]), shadow];
		} else if (f.kind === "bevel") {
			const alpha = (pick: (s: BevelBuilt) => number) => opacityOf(per.map((s) => round(pick(s as BevelBuilt) * 100, 2)));
			const { hi, sh } = bevelSides(
				bevelGreys(per.map(() => 1)),
				colour((s) => (s as BevelBuilt).hi.rgb),
				colour((s) => (s as BevelBuilt).sh.rgb),
				alpha((s) => s.hi.a),
				alpha((s) => s.sh.a),
			);
			layers = [...typed(sh, f.type), ...typed(hi, f.type), ...(f.knockout ? [] : [use(x)])];
		} else {
			// grey levels: the glow's strengthened blurred alpha over black; the bevel's
			// 1/2 + s (o1 - o2) / 2 (stronger than 100 %: from its two sides, strengthened)
			let lum: PrecompRef;
			if (f.bevel && !strong) lum = bevelGreys(strengths);
			else if (f.bevel) {
				const { hi, sh } = bevelSides(bevelGreys(per.map(() => 1)), white, black, null, null);
				lum = pre([use(pre([sh, hi, solid(fixed(0.5), st(100))]))]);
			} else lum = pre([use(strengthened(silhouette(fixed(1), st(100), false, 1), strengths))]);
			const gs = per as GradientBuilt[];
			const greys = (pick: (s: GradientBuilt) => number[]) =>
				[2, 1, 0].map((i) =>
					heldKeys(
						times,
						gs.map((s) => {
							const v = round(pick(s)[i]!, 4);
							return [v, v, v, 1];
						}),
					),
				);
			const colours = [2, 1, 0].map((i) =>
				colourKeys(
					run,
					after,
					gs.map((s) => s.rgb[i]!),
					gs.map((s) => s.after),
				),
			);
			const eff = use(
				pre(
					matte(
						use(
							lookup(
								lum,
								greys((s) => s.alpha),
							),
						),
						use(lookup(lum, colours)),
						3,
					),
				),
			);
			if (f.bevel) layers = [...typed(eff, f.type), ...(f.knockout ? [] : [use(x)])];
			else if (f.type === "inner") layers = [...matte(use(x), eff, 1), ...(f.knockout ? [] : [use(x)])];
			else layers = f.knockout ? matte(use(x), eff, 2) : [use(x), eff];
		}
		return use(pre(layers));
	}

	/** Where an instance draws in its parent over [a, b): its content's box, sampled every tick. */
	private instanceBox(n: BakedInstance, box: Box, a: number, b: number): Box {
		const t = n.transform;
		let out: Box | null = null;
		const keys = new Set<number>();
		for (let k = a; k < b; k++) keys.add(k);
		for (const p of Object.values(t)) for (const k of p) if (k.t >= a && k.t <= b) keys.add(k.t);
		for (const time of keys) {
			const v = {} as Record<TransformProp, number>;
			for (const p of Object.keys(t) as TransformProp[]) v[p] = valueAt(t[p] as Track, time);
			out = unionBox(out, transformBox(box, fromProps(v)));
		}
		out ??= transformBox(box, [1, 0, 0, 1, 0, 0]);
		// rotation between the samples can reach a little further
		const g = 0.03 * Math.max(out.x1 - out.x0, out.y1 - out.y0) + 2;
		return { x0: out.x0 - g, y0: out.y0 - g, x1: out.x1 + g, y1: out.y1 + g };
	}

	/**
	 * A shape tween part: the drawing converted at every key of its ratio (or frame) track, the
	 * values that change merged into keyframes with the track's eases. Lottie blends keyframes
	 * linearly like the morph, so this is exact; values that aren't linear in the ratio (an
	 * elliptical gradient's inverse transform) are keyed on every tick.
	 */
	private morph(n: BakedMorph, vis: Interval[], mode: Mode): LayerOut[] {
		const p = n.part;
		const out: LayerOut[] = [];
		for (const [a, b] of vis) {
			const paint = mode.opaque ? null : mode.paint;
			if (paint && !paintConstantIn(paint, a, b)) this.warn("A colour effect that changes over a shape tween is shown at its first value in Lottie");
			const ct = paint ? paintAt(paint, a) : null;
			const ratio = cut(n.ratio, a, b);
			const frame = n.frame.length ? cut(n.frame, a, b) : [];
			const track = frame.length ? frame : ratio;
			const times = [...new Set([a, ...track.map((k) => k.t).filter((t) => t >= a && t <= b)])].sort((x, y) => x - y);
			const at = (t: number) =>
				drawingAt(this, p.art, p.channels, valueAt(ratio as Track, t), frame.length ? valueAt(frame as Track, t) : 0, mode.opaque, ct, mode.scale);
			const frames = times.map(at);
			if (frames.some((f) => f.layers.length !== 1 || f.layers[0]!.json.ty !== 4)) {
				this.warn("A shape tween with bitmap fills or clipping is drawn frame by frame");
				continue;
			}
			const eases = times.map((t, i) => (i + 1 < times.length ? easeBetween(track, t, times[i + 1]!) : "hold"));
			// values off the straight line between keys: key them on every tick
			const dense = new Set<string>();
			for (let i = 0; i + 1 < times.length; i++) {
				if (eases[i] === "hold" || times[i + 1]! - times[i]! < 1.5) continue;
				const tm = (times[i]! + times[i + 1]!) / 2;
				const v0 = valueAt(track as Track, times[i]!),
					v1 = valueAt(track as Track, times[i + 1]!);
				const u = Math.abs(v1 - v0) > 1e-12 ? (valueAt(track as Track, tm) - v0) / (v1 - v0) : 0.5;
				nonLinearAt(frames[i]!.layers[0]!.json.shapes, frames[i + 1]!.layers[0]!.json.shapes, at(tm).layers[0]!.json.shapes, u, "", dense);
			}
			let keyTimes = times,
				keyFrames = frames,
				keyEases: Ease[] = eases;
			if (dense.size) {
				const ticks: number[] = [];
				for (let t = Math.ceil(a); t < b; t++) ticks.push(t);
				const all = [...new Set([...times, ...ticks])].sort((x, y) => x - y);
				keyTimes = all;
				keyFrames = all.map((t) => (times.includes(t) ? frames[times.indexOf(t)]! : at(t)));
				keyEases = all.map((t, i) => (i + 1 < all.length ? easeBetween(track, t, all[i + 1]!) : "hold"));
			}
			const shapes = mergeKeyframes(
				keyFrames.map((f) => f.layers[0]!.json.shapes as Json[]),
				keyTimes,
				keyEases,
				dense,
				times,
				eases,
			);
			let box: Box | null = null;
			for (const f of frames) box = unionBox(box, f.layers[0]!.box);
			out.push({ json: { ty: 4, ip: a, op: b, st: 0, ks: {}, shapes }, box });
		}
		return out;
	}
}

/** Intervals within [0, W). */
function clipVis(vis: Interval[], W: number): Interval[] {
	const out: Interval[] = [];
	for (const [a, b] of vis) {
		const e = Math.min(b, W);
		if (e > a) out.push([a, e]);
	}
	return out;
}

/**
 * A time remap that plays ticks [0, P) over and over during [a, b), in step with the global clock
 * (local time = t mod P). Each loop ends a thousandth of a tick early on a hold, then jumps back.
 * Local time runs LEAD ahead: rounding (seconds, the players' floats) must not land a frame
 * boundary just before the frame (a layer starting at local 4 would miss 3.99998).
 */
function sawtooth(a: number, b: number, P: number, fps: number): Json {
	const LEAD = 2e-4,
		END = 1e-3;
	const k: Json[] = [];
	const sec = (f: number) => round((f + LEAD) / fps, 8);
	for (let c = Math.floor(a / P) * P; c < b; c += P) {
		const s = Math.max(a, c),
			e = Math.min(b, c + P);
		k.push({ t: round(s, 4), s: [sec(s - c)], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } });
		if (e === c + P) k.push({ t: round(e - END, 4), s: [sec(P - END)], h: 1 });
		else k.push({ t: round(e, 4), s: [sec(e - c)], h: 1 });
	}
	delete k[k.length - 1]!.h;
	return { a: 1, k };
}

/** How a subtree is drawn: as mask content (all opaque), and under which colour transform. */
interface Mode {
	opaque: boolean;
	paint: Paint | null;
	/** Screen pixels per unit here (at the first frame): hairlines keep a width in pixels. */
	scale: number;
}

const modeKey = (m: Mode) => (m.opaque ? "m" : "") + (m.paint ? m.paint.key : "") + (m.scale !== 1 ? "@" + round(m.scale, 4) : "");

/**
 * A colour transform over time, pushed into the paints of a subtree: its values at key times and
 * the ease of each stretch to the next (all channels move together, else it is keyed every tick).
 */
interface Paint {
	key: string;
	times: number[];
	eases: Ease[];
	values: CT[];
}

const paintConstant = (p: Paint) => p.values.every((v) => v.every((x, i) => Math.abs(x - p.values[0]![i]!) < 1e-9));

function easeProgress(e: Ease, u: number): number {
	return e === "hold" ? 0 : e === "linear" ? u : evalBezier(e, u);
}

function paintAt(p: Paint, t: number): CT {
	const { times, eases, values } = p;
	if (t <= times[0]!) return values[0]!;
	for (let i = 0; i + 1 < times.length; i++) {
		if (t < times[i + 1]!) {
			const u = easeProgress(eases[i]!, (t - times[i]!) / (times[i + 1]! - times[i]!));
			return values[i]!.map((v, k) => v + (values[i + 1]![k]! - v) * u);
		}
	}
	return values[values.length - 1]!;
}

/** The colour transform of tracks (Flash units: multipliers in %, offsets 0..255) at `t`. */
function ctOf(c: Record<ColorProp, GTrack>, t: number): CT {
	const v = (p: ColorProp) => valueAt(c[p] as Track, t);
	return [v("rP") / 100, v("gP") / 100, v("bP") / 100, v("aP") / 100, v("rA") / 255, v("gA") / 255, v("bA") / 255, v("aA") / 255];
}

/** A colour transform's tint without its alpha. */
function withoutAlpha(c: Record<ColorProp, GTrack>): Record<ColorProp, GTrack> {
	return { ...c, aP: c.aP.map((k) => ({ ...k, v: 100 })), aA: c.aA.map((k) => ({ ...k, v: 0 })) };
}

/** `inner` applied first, then `outer` (as Flash nests colour transforms). */
function composeCT(inner: CT, outer: CT): CT {
	if (inner.length === 8 && outer.length === 8)
		return [0, 1, 2, 3].flatMap((i) => [inner[i]! * outer[i]!]).concat([0, 1, 2, 3].map((i) => inner[i + 4]! * outer[i]! + outer[i + 4]!));
	const I = asMatrix(inner),
		O = asMatrix(outer);
	const out: number[] = [];
	for (let r = 0; r < 4; r++)
		for (let c = 0; c < 5; c++) {
			let v = c === 4 ? O[r * 5 + 4]! : 0;
			for (let k = 0; k < 4; k++) v += O[r * 5 + k]! * I[k * 5 + c]!;
			out.push(v);
		}
	return out;
}

/** Key times (and eases) of a set of tracks over [a, b]: shared ones, "dense" or "const". */
function gridOfTracks(tracks: GTrack[], a: number, b: number): { times: number[]; eases: Ease[] } | "dense" | "const" {
	const moving = tracks.filter((t) => !isConst(t));
	if (!moving.length) return "const";
	const lead = moving[0]!;
	const sig = (t: GTrack) => t.map((k) => `${k.t.toFixed(6)}|${JSON.stringify(k.ease)}`).join(";");
	if (moving.some((t) => sig(t) !== sig(lead))) return "dense";
	const times = [...new Set([a, ...lead.map((k) => k.t).filter((t) => t > a && t <= b)])].sort((x, y) => x - y);
	return { times, eases: times.map((t, i) => (i + 1 < times.length ? easeBetween(lead, t, times[i + 1]!) : "hold")) };
}

function ticksOf(a: number, b: number): { times: number[]; eases: Ease[] } {
	const times: number[] = [a];
	for (let t = Math.floor(a) + 1; t < b; t++) times.push(t);
	times.push(b);
	return { times, eases: times.map((_, i) => (i + 1 < times.length ? "linear" : "hold")) };
}

/** The colour transform of an instance over [a, b), nested inside `outer` (the parent's). */
function composePaint(outer: Paint | null, color: Record<ColorProp, GTrack>, a: number, b: number): Paint | null {
	const own = {} as Record<ColorProp, GTrack>;
	for (const p of Object.keys(color) as ColorProp[]) own[p] = cut(color[p], a, b);
	const og = gridOfTracks(Object.values(own), a, b);
	const pg = outer ? (paintConstant(outer) ? "const" : "moving") : "const";
	let grid: { times: number[]; eases: Ease[] };
	if (og === "const" && pg === "const") grid = { times: [a], eases: ["hold"] };
	else if (pg === "const") grid = og === "dense" || og === "const" ? ticksOf(a, b) : og;
	else if (og === "const") grid = paintGrid(outer!, a, b);
	else grid = ticksOf(a, b);
	const values = grid.times.map((t) => (outer ? composeCT(ctOf(own, t), paintAt(outer, t)) : ctOf(own, t)));
	if (values.every(isIdentityCT)) return null;
	const key = hashString(JSON.stringify([grid.times.map((t) => round(t, 4)), grid.eases, values.map((v) => v.map((x) => round(x, 4)))]));
	return { key, times: grid.times, eases: grid.eases, values };
}

/** A paint with a fixed colour transform applied after it (`a`: the start, if there is none yet). */
function paintThen(p: Paint | null, ct: CT, a: number): Paint {
	const base = p ?? { key: "", times: [a], eases: ["hold" as Ease], values: [[1, 1, 1, 1, 0, 0, 0, 0]] };
	const values = base.values.map((v) => composeCT(v, ct));
	return { ...base, key: hashString(base.key + "|" + ct.join(",")), values };
}

/** A paint with a fixed colour matrix applied before it (a filter of the instance it paints). */
function paintFirst(p: Paint | null, ct: CT, a: number): Paint {
	const base = p ?? { key: "", times: [a], eases: ["hold" as Ease], values: [[1, 1, 1, 1, 0, 0, 0, 0]] };
	const values = base.values.map((v) => composeCT(ct, v));
	return { ...base, key: hashString(base.key + "|first|" + ct.map((v) => round(v, 5)).join(",")), values };
}

// ---------------------------------------------------------------- filters

type RGB = [number, number, number];
type BevelType = "inner" | "outer" | "full";

/** One Lottie effect: a Gaussian blur (both directions or one) or a drop shadow (also glows). */
type Slot =
	{ kind: "blur"; dim: 1 | 2 | 3; sigma: number } | { kind: "shadow"; rgb: RGB; alpha: number; dx: number; dy: number; sigma: number; after: CT | null };
type ShadowSlot = Extract<Slot, { kind: "shadow" }>;

/** Filters in a row that are Lottie effects (on one wrapper layer); `margin`: the room they need. */
interface FxStage {
	kind: "fx";
	slots: Slot[];
	margin: number;
}

/** What a built filter blurs and moves (Flash's whole pixels), the colour transforms after it. */
interface Spread {
	dx: number;
	dy: number;
	sx: number;
	sy: number;
	after: CT | null;
	margin: number;
}
/** Shadows and glows that aren't effects (inner, knockout, hidden object, strong, uneven blur); m = strength x alpha. */
type ShadowBuilt = Spread & { kind: "shadow"; inner: boolean; knockout: boolean; hide: boolean; rgb: RGB; m: number };
type BevelBuilt = Spread & { kind: "bevel"; type: BevelType; knockout: boolean; s: number; hi: { rgb: RGB; a: number }; sh: { rgb: RGB; a: number } };
/** Gradient glows and bevels: colour, alpha and (glows) the strengthened alpha at grey levels 0, 1/2 and 1. */
type GradientBuilt = Spread & { kind: "gradient"; bevel: boolean; type: BevelType; knockout: boolean; s: number; rgb: [RGB, RGB, RGB]; alpha: number[] };
/** A filter Lottie has no effect for, drawn with layers and mattes. */
type Built = ShadowBuilt | BevelBuilt | GradientBuilt;
type Stage = FxStage | Built;

/** Animate filters in Lottie terms: effects and built filters in order, a colour matrix for the paints inside. */
interface LottieFilters {
	stages: Stage[];
	matrix: CT | null;
	/** What stays the same within a run (stage kinds and flags, matrices): values may change. */
	sig: string;
}

/** A stretch of an instance's interval with filters of one make-up, and the filter sets in it. */
interface FilterRun {
	a: number;
	b: number;
	fx: LottieFilters;
	sets: { t: number; fx: LottieFilters }[];
}

/** Gaussian blur: Lottie's blurriness is 1 / 0.3 of the standard deviation (lottie-web, ThorVG and Skottie agree). */
const BLUR_TO_SIGMA = 0.3;

/**
 * Maps Animate filters (in the instance's parent space) to Lottie: blur -> Gaussian blur (two
 * directional ones when blurX and blurY differ), outer drop shadow and glow -> drop shadow
 * (Flash's integer pixel offset as direction and distance), adjust colour -> a colour matrix in
 * every paint inside (and in the colours of the filters before it). Inner, knockout and "hide
 * object" shadows and glows, strong or unevenly blurred ones, bevels and gradient filters are
 * built from layers (builtLayer).
 */
function lottieFilters(filters: FilterData[], warn: (m: string) => void): LottieFilters {
	const stages: Stage[] = [];
	let matrix: CT | null = null;
	const tinted: { after: CT | null }[] = [];
	const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
	const effects = (): FxStage => {
		const last = stages[stages.length - 1];
		if (last?.kind === "fx") return last;
		const s: FxStage = { kind: "fx", slots: [], margin: 2 };
		stages.push(s);
		return s;
	};
	const rgbOf = (c: unknown): { rgb: RGB; a: number } => {
		const { hex, alpha } = splitColor(c);
		const p = parseColor(hex) ?? [0, 0, 0, 1];
		return { rgb: [p[0], p[1], p[2]], a: alpha };
	};
	for (const f of filters) {
		if (f.enabled === false) continue;
		const sx = blurSigma(num(f.blurX, 5), f.quality),
			sy = blurSigma(num(f.blurY, 5), f.quality);
		const blurred = sx + sy > 0;
		const dist = num(f.distance, 4);
		const ang = (num(f.angle, 45) * Math.PI) / 180;
		const s = num(f.strength, 100) / 100;
		// a glow is a shadow that isn't moved
		const moves = f.name !== "glowFilter";
		const spread = (after: CT | null = null): Spread => {
			const dx = moves ? Math.round(Math.cos(ang) * dist) : 0,
				dy = moves ? Math.round(Math.sin(ang) * dist) : 0;
			return { dx, dy, sx, sy, after, margin: 3 * Math.max(sx, sy) + Math.abs(dx) + Math.abs(dy) + 2 };
		};
		switch (f.name) {
			case "blurFilter": {
				const fx = effects();
				if (Math.abs(sx - sy) < 1e-3) {
					if (sx > 0) fx.slots.push({ kind: "blur", dim: 1, sigma: sx });
				} else {
					if (sx > 0) fx.slots.push({ kind: "blur", dim: 2, sigma: sx });
					if (sy > 0) fx.slots.push({ kind: "blur", dim: 3, sigma: sy });
				}
				fx.margin += 3 * Math.max(sx, sy);
				break;
			}
			case "dropShadowFilter":
			case "glowFilter": {
				const { rgb, a } = rgbOf(f.color);
				const m = a * s;
				const hide = f.name === "dropShadowFilter" && !!f.hideObject;
				const sp = spread();
				if (!f.inner && !f.knockout && !hide && !(m > 1 + 1e-6 && blurred) && Math.abs(sx - sy) <= 0.5) {
					const slot: ShadowSlot = { kind: "shadow", rgb, alpha: Math.min(1, m), dx: sp.dx, dy: sp.dy, sigma: (sx + sy) / 2, after: null };
					const fx = effects();
					fx.slots.push(slot);
					fx.margin += sp.margin - 2;
					tinted.push(slot);
					break;
				}
				const b: ShadowBuilt = { ...sp, kind: "shadow", inner: !!f.inner, knockout: !!f.knockout, hide, rgb, m };
				stages.push(b);
				tinted.push(b);
				break;
			}
			case "bevelFilter": {
				const b: BevelBuilt = {
					...spread(),
					kind: "bevel",
					type: bevelType(f.type, "inner"),
					knockout: !!f.knockout,
					s,
					hi: rgbOf(f.highlightColor ?? "#FFFFFF"),
					sh: rgbOf(f.shadowColor ?? "#000000"),
				};
				if (blurred && Math.hypot(b.dx, b.dy) < 0.6 * Math.max(sx, sy)) warn("Bevels blurred more than their distance come out a little stronger in Lottie");
				stages.push(b);
				tinted.push(b);
				break;
			}
			case "gradientGlowFilter":
			case "gradientBevelFilter": {
				const bevel = f.name === "gradientBevelFilter";
				const g = gradientSampler(f);
				// colour and alpha at grey level L: glows' min(1, s x the blurred alpha), bevels'
				// 1/2 + s (o1 - o2) / 2 (builtLayer draws the grey levels)
				const rgbAt = (L: number): RGB => {
					const c = g(L);
					return [c.r, c.g, c.b];
				};
				const alphaAt = (L: number) => g(L).a;
				const b: GradientBuilt = {
					...spread(),
					kind: "gradient",
					bevel,
					type: bevel ? bevelType(f.type, "inner") : f.type === "inner" ? "inner" : "outer",
					knockout: !!f.knockout,
					s,
					rgb: [rgbAt(0), rgbAt(0.5), rgbAt(1)],
					alpha: [0, 0.5, 1].map(alphaAt),
				};
				// the 3 point lookup: exact when the gradient is straight in between
				const lerp = (v: number[], L: number) => (L < 0.5 ? v[0]! + (v[1]! - v[0]!) * 2 * L : v[1]! + (v[2]! - v[1]!) * (2 * L - 1));
				let err = 0;
				for (let i = 0; i <= 32; i++) {
					const L = i / 32;
					const c = rgbAt(L);
					for (let ch = 0; ch < 3; ch++)
						err = Math.max(
							err,
							Math.abs(
								c[ch]! -
									lerp(
										b.rgb.map((v) => v[ch]!),
										L,
									),
							),
						);
					err = Math.max(err, Math.abs(alphaAt(L) - lerp(b.alpha, L)));
				}
				if (err > 0.02) warn("Gradient glows and bevels are drawn with their colours at 0, 50 and 100% in Lottie (close, not exact here)");
				stages.push(b);
				tinted.push(b);
				break;
			}
			case "adjustColorFilter": {
				const m = adjustColorMatrix(f);
				if (isIdentityCT(m)) break;
				matrix = matrix ? composeCT(matrix, m) : m;
				for (const t of tinted) t.after = t.after ? composeCT(t.after, m) : m;
				break;
			}
			default:
				warn(`The ${f.name} filter is not supported`);
		}
	}
	const r5 = (ct: CT | null) => (ct ? ct.map((v) => round(v, 5)).join(",") : "");
	const sig = JSON.stringify([
		stages.map((s) => {
			if (s.kind === "fx") return s.slots.map((x) => (x.kind === "blur" ? `b${x.dim}` : `s${r5(x.after)}`)).join(" ");
			const flags = s.kind === "shadow" ? [s.inner, s.knockout, s.hide] : [s.type, s.knockout, s.kind === "gradient" && s.bevel];
			return `${s.kind} ${flags.join(" ")} ${r5(s.after)}`;
		}),
		r5(matrix),
	]);
	return { stages: stages.filter((s) => s.kind !== "fx" || s.slots.length), matrix, sig };
}

const bevelType = (v: unknown, d: BevelType): BevelType => (v === "inner" || v === "outer" || v === "full" ? v : d);

/**
 * The effects of a filter run, values held from each filter set to the next (as Animate shows
 * them). Drop shadow: opacity 0..255, direction clockwise from up (Flash's angle + 90),
 * softness = sigma / 0.3 (ThorVG and Skottie; lottie-web blurs shadows by softness / 4, a little
 * less); its colour goes through the colour transforms after the filter (`after`).
 */
function effectsJson(run: FilterRun, per: FxStage[], after: Paint | null): Json[] {
	const times = run.sets.map((s) => s.t);
	const held = (vals: (number | number[])[]) => heldKeys(times, vals);
	return per[0]!.slots.map((slot, i): Json => {
		if (slot.kind === "blur") {
			const v = per.map((s) => (s.slots[i] as Extract<Slot, { kind: "blur" }>).sigma);
			return blurEffect(slot.dim, held(v.map((x) => round(x / BLUR_TO_SIGMA, 2))));
		}
		const sl = per.map((s) => s.slots[i] as ShadowSlot);
		return {
			ty: 25,
			nm: "Drop Shadow",
			en: 1,
			ef: [
				{
					ty: 2,
					nm: "Shadow Color",
					v: colourKeys(
						run,
						after,
						sl.map((s) => s.rgb),
						sl.map((s) => s.after),
					),
				},
				{ ty: 0, nm: "Opacity", v: held(sl.map((s) => round(s.alpha * 255, 1))) },
				{ ty: 1, nm: "Direction", v: held(sl.map((s) => (s.dx || s.dy ? round((Math.atan2(s.dx, -s.dy) * 180) / Math.PI, 2) : 0))) },
				{ ty: 0, nm: "Distance", v: held(sl.map((s) => round(Math.hypot(s.dx, s.dy), 2))) },
				{ ty: 0, nm: "Softness", v: held(sl.map((s) => round(s.sigma / BLUR_TO_SIGMA, 2))) },
			],
		};
	});
}

/** Values from each filter set to the next, held (as Animate shows them). */
function heldKeys(times: number[], vals: (number | number[])[]): Json {
	const keys: { t: number; v: number | number[] }[] = [];
	vals.forEach((v, i) => {
		if (!keys.length || JSON.stringify(keys[keys.length - 1]!.v) !== JSON.stringify(v)) keys.push({ t: times[i]!, v });
	});
	if (keys.length === 1) return st(keys[0]!.v);
	return { a: 1, k: keys.map((k, i) => ({ t: round(k.t, 4), s: Array.isArray(k.v) ? k.v : [k.v], ...(i + 1 < keys.length ? { h: 1 } : {}) })) };
}

/**
 * A filter colour through the colour transforms after the filter (`cts`, per filter set) and the
 * paint: held per set, or keyed on every tick when the paint changes.
 */
function colourKeys(run: FilterRun, after: Paint | null, rgbs: RGB[], cts: (CT | null)[]): Json {
	const times = run.sets.map((s) => s.t);
	const at = (k: number, t: number) => {
		const c = applyCT(after ? paintAt(after, t) : null, applyCT(cts[k], [...rgbs[k]!, 1]));
		return [round(c[0], 4), round(c[1], 4), round(c[2], 4), 1];
	};
	if (!after || paintConstantIn(after, run.a, run.b))
		return heldKeys(
			times,
			times.map((t, k) => at(k, t)),
		);
	const ticks: number[] = [];
	for (let t = run.a; t < run.b; t = Math.floor(t) + 1) ticks.push(t);
	const setAt = (t: number) => {
		let k = 0;
		while (k + 1 < times.length && times[k + 1]! <= t) k++;
		return k;
	};
	return heldKeys(
		ticks,
		ticks.map((t) => at(setAt(t), t)),
	);
}

function blurEffect(dim: 1 | 2 | 3, blurriness: Json): Json {
	return {
		ty: 29,
		nm: "Gaussian Blur",
		en: 1,
		ef: [
			{ ty: 0, nm: "Blurriness", v: blurriness },
			{ ty: 7, nm: "Blur Dimensions", v: st(dim) },
			{ ty: 7, nm: "Repeat Edge Pixels", v: st(0) },
		],
	};
}

/** A built filter's blur: none, even, or horizontal and vertical apart (when any set differs). */
function blurEffects(per: Spread[], times: number[]): Json[] {
	if (per.every((s) => s.sx <= 0 && s.sy <= 0)) return [];
	const one = (dim: 1 | 2 | 3, pick: (s: Spread) => number) =>
		blurEffect(
			dim,
			heldKeys(
				times,
				per.map((s) => round(pick(s) / BLUR_TO_SIGMA, 2)),
			),
		);
	return per.some((s) => Math.abs(s.sx - s.sy) > 1e-3) ? [one(2, (s) => s.sx), one(3, (s) => s.sy)] : [one(1, (s) => s.sx)];
}

/** Tritone: grey levels 1, 1/2 and 0 to colours (straight in between, in sRGB values; all three players). */
function tritone([hi, mid, lo]: Json[]): Json {
	return {
		ty: 23,
		nm: "Tritone",
		en: 1,
		ef: [
			{ ty: 2, nm: "Highlights", v: hi },
			{ ty: 2, nm: "Midtones", v: mid },
			{ ty: 2, nm: "Shadows", v: lo },
			{ ty: 0, nm: "Blend With Original", v: st(0) },
		],
	};
}

function growBox(b: Box, m: number): Box {
	return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
}

/** A rectangle over `box` in colour `c` and opacity `o` (0: room for effects). */
function rectLayer(box: Box, c: Json, o: Json, a: number, b: number): LayerOut {
	// a rectangle shape without a group (a third smaller than a path in one; all three players)
	const w = round(box.x1 - box.x0, 2),
		h = round(box.y1 - box.y0, 2);
	return {
		json: {
			ty: 4,
			ip: a,
			op: b,
			st: 0,
			ks: {},
			shapes: [
				{ ty: "rc", p: st([round(box.x0 + w / 2, 2), round(box.y0 + h / 2, 2)]), s: st([w, h]), r: st(0) },
				{ ty: "fl", c, o, r: 1 },
			],
		},
		box,
	};
}

/** The paint's key times within [s, e] and the eases between them (cut exactly). */
function paintGrid(p: Paint, s: number, e: number): { times: number[]; eases: Ease[] } {
	const times = [...new Set([s, ...p.times.filter((t) => t > s && t <= e)])].sort((x, y) => x - y);
	const eases = times.map((t, i) => {
		const t2 = times[i + 1];
		if (t2 === undefined) return "hold" as Ease;
		let j = 0;
		while (j < p.times.length - 1 && p.times[j + 1]! <= t + 1e-9) j++;
		const e0 = p.eases[j]!;
		if (j + 1 >= p.times.length || t < p.times[0]! - 1e-9) return "hold" as Ease;
		if (typeof e0 === "string") return e0;
		const span = p.times[j + 1]! - p.times[j]!;
		const u0 = (t - p.times[j]!) / span,
			u1 = (t2 - p.times[j]!) / span;
		return u0 < 1e-9 && u1 > 1 - 1e-9 ? e0 : subBezier(e0, Math.max(0, u0), Math.min(1, u1)).bezier;
	});
	return { times, eases };
}

/** True if the paint stays the same over [s, e]. */
function paintConstantIn(p: Paint, s: number, e: number): boolean {
	const v0 = paintAt(p, s);
	return paintGrid(p, s, e).times.every((t) => paintAt(p, t).every((x, i) => Math.abs(x - v0[i]!) < 1e-9));
}

/** A bitmap's opacity under a paint: its alpha channel applied to opaque pixels. */
function paintOpacity(p: Paint, s: number, e: number): Json {
	const g = paintConstant(p) ? { times: [s], eases: ["hold" as Ease] } : paintGrid(p, s, e);
	const vals = g.times.map((t) => round(applyCT(paintAt(p, t), [0, 0, 0, 1])[3] * 100, 2));
	if (vals.every((v) => v === vals[0])) return st(vals[0]);
	return {
		a: 1,
		k: g.times.map((t, i) => {
			const kf: Json = { t: round(t, 4), s: [vals[i]] };
			if (i + 1 < g.times.length) {
				if (g.eases[i] === "hold") kf.h = 1;
				else setEase(kf, [g.eases[i]!], null);
			}
			return kf;
		}),
	};
}

function hashString(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(36);
}

const hairlineArt = new WeakMap<Artwork, boolean>();
/** True if a drawing has hairlines (strokes that keep their width when scaled). */
function artHairlines(a: Artwork): boolean {
	let r = hairlineArt.get(a);
	if (r === undefined) {
		r = false;
		for (const n of [a.body, ...a.defs]) walk(n, (x) => void (x.attrs["vector-effect"] && (r = true)));
		hairlineArt.set(a, r);
	}
	return r;
}

/** Screen scale of a camera view at its first frame. */
function viewScale(v: Record<TransformProp, GTrack>): number {
	return Math.sqrt(Math.abs(valueAt(v.sx as Track, 0) * valueAt(v.sy as Track, 0))) || 1;
}

/** Lays out the converted drawing of an artwork. */
function drawingOf(w: LottieWriter, a: Artwork, o: DrawingOptions): DrawingBuilder {
	const defs = new Map<string, XmlNode>();
	const index = (n: XmlNode) => {
		if (n.attrs.id) defs.set(n.attrs.id, n);
		for (const c of n.children) if (isNode(c)) index(c);
	};
	for (const d of a.defs) index(d);
	index(a.body);
	const b = new DrawingBuilder(w, defs, o);
	b.node(a.body, [1, 0, 0, 1, 0, 0], 1);
	b.flush();
	return b;
}

/** A morph's drawing at blend ratio `r` (frame position `fi` for per-frame channels). */
function drawingAt(
	w: LottieWriter,
	art: Artwork,
	channels: MorphChannel[],
	r: number,
	fi: number,
	matte: boolean,
	paint: CT | null,
	scale = 1,
): DrawingBuilder {
	const copy = copyArtwork(art, (id) => id);
	const nodes = templateNodes(copy.defs, copy.body);
	for (const ch of channels) {
		const node = nodes[ch.node]!;
		node.attrs[ch.attr] = channelText(ch, channelNumbers(ch, r, fi), Math.max(w.digits, 3));
		if (ch.kind === "d") node.attrs["data-morph"] = "1";
	}
	return drawingOf(w, copy, { matte, stable: true, paint, scale });
}

/**
 * Finds the properties (paths as mergeKeyframes counts them) whose value in the middle of a
 * stretch isn't where blending the two ends by `u` (the ease's progress there) puts it.
 */
function nonLinearAt(a: unknown, b: unknown, mid: unknown, u: number, path: string, out: Set<string>) {
	if (Array.isArray(a)) {
		a.forEach((x, i) => nonLinearAt(x, (b as unknown[])[i], (mid as unknown[])[i], u, path + "/" + i, out));
		return;
	}
	if (!a || typeof a !== "object") return;
	const o = a as Json;
	if ("k" in o && "a" in o && o.a === 0) {
		const fa = flat(o.k),
			fb = flat((b as Json).k),
			fm = flat((mid as Json).k);
		for (let i = 0; i < fa.length; i++) if (Math.abs(fa[i]! + (fb[i]! - fa[i]!) * u - fm[i]!) > 0.05) out.add(path);
		return;
	}
	for (const key of Object.keys(o)) nonLinearAt(o[key], (b as Json)[key], (mid as Json)[key], u, path + "/" + key, out);
}

function flat(v: unknown): number[] {
	if (typeof v === "number") return [v];
	if (Array.isArray(v)) return v.flatMap(flat);
	if (v && typeof v === "object") return Object.values(v as Json).flatMap(flat);
	return [];
}

/**
 * Merges drawings of the same structure into one with keyframes where the values differ.
 * `dense` paths are keyed at every time given, the others only at `coarse` times.
 */
function mergeKeyframes(frames: Json[][], times: number[], eases: Ease[], dense: Set<string>, coarse: number[], coarseEases: Ease[]): Json[] {
	const coarseIdx = coarse.map((t) => times.indexOf(t));
	const walk = (vals: unknown[], path: string): unknown => {
		const a = vals[0];
		if (Array.isArray(a))
			return a.map((_, i) =>
				walk(
					vals.map((v) => (v as unknown[])[i]),
					path + "/" + i,
				),
			);
		if (!a || typeof a !== "object") return a;
		const o = a as Json;
		if ("k" in o && "a" in o && o.a === 0) {
			const first = JSON.stringify(o.k);
			if (vals.every((v) => JSON.stringify((v as Json).k) === first)) return o;
			const useAll = dense.has(path);
			const idx = useAll ? times.map((_, i) => i) : coarseIdx;
			const es = useAll ? eases : coarseEases;
			const k: Json[] = idx.map((fi, j) => {
				const val = (vals[fi] as Json).k;
				const kf: Json = { t: round(times[fi]!, 4), s: Array.isArray(val) && typeof val[0] === "number" ? val : [val] };
				if (j + 1 < idx.length) {
					const e = es[j]!;
					if (e === "hold") kf.h = 1;
					else setEase(kf, [e], null);
				}
				return kf;
			});
			return { a: 1, k };
		}
		const r: Json = {};
		for (const key of Object.keys(o))
			r[key] = walk(
				vals.map((v) => (v as Json)[key]),
				path + "/" + key,
			);
		return r;
	};
	return walk(frames, "") as Json[];
}

function position(x: GTrack, y: GTrack, digits: number): Json {
	const same = x.length === y.length && x.every((k, i) => Math.abs(k.t - y[i]!.t) < 1e-9 && JSON.stringify(k.ease) === JSON.stringify(y[i]!.ease));
	if (same || (isConst(x) && isConst(y))) return trackProp([x, y], [1, 1], [0, 0], digits);
	return { s: true, x: trackProp([x], [1], [0], digits, true), y: trackProp([y], [1], [0], digits, true) };
}

function clampOpacity(p: Json): Json {
	if (p.a === 0) return st(Math.max(0, Math.min(100, p.k as number)));
	for (const kf of p.k as Json[]) kf.s = (kf.s as number[]).map((v) => Math.max(0, Math.min(100, v)));
	return p;
}

/** Moves a layer by (dx, dy) in its composition (new objects: drawings share theirs). */
function shiftLayer(l: Json, dx: number, dy: number) {
	if (l.parent !== undefined || (!dx && !dy)) return;
	const ks: Json = { ...((l.ks as Json | undefined) ?? {}) };
	l.ks = ks;
	const p = ks.p as Json | undefined;
	if (!p) {
		ks.p = st([dx, dy]);
		return;
	}
	const add = (prop: Json, d: number[]): Json => {
		if (prop.a === 0) {
			const k = prop.k;
			return { ...prop, k: Array.isArray(k) ? k.map((v, i) => round((v as number) + (d[i] ?? 0), 6)) : round((k as number) + d[0]!, 6) };
		}
		return { ...prop, k: (prop.k as Json[]).map((kf) => ({ ...kf, s: (kf.s as number[]).map((v, i) => round(v + (d[i] ?? 0), 6)) })) };
	};
	ks.p = p.s === true ? { ...p, x: add(p.x as Json, [dx]), y: add(p.y as Json, [dy]) } : add(p, [dx, dy]);
}

/** Gives a composition's layers (top first) their indices and links the track mattes. */
function finalize(layers: LayerOut[], H: number): Json[] {
	return layers.map((l, i) => {
		const j = l.json;
		const out: Json = { ty: j.ty, ind: i + 1, ...j };
		out.ip ??= 0;
		out.op ??= H;
		// lottie-web needs a start time on every layer (the spec has it on precomp layers only)
		out.st ??= 0;
		if (l.td) out.td = 1;
		const above = layers[i - 1];
		if (above?.td && j.tt) out.tp = i;
		return out;
	});
}

function toBase64(bytes: Uint8Array): string {
	const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
	if (B) return B.from(bytes).toString("base64");
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
	return btoa(s);
}

/** The scene as a Lottie animation. */
export function renderLottie(ctx: Context, rootId: string, s: ExportSettings, images: LottieImages): LottieResult {
	const { horizon, root, frames } = bake(ctx, rootId, {
		smooth: s.smooth,
		loop: s.loop,
		startFrame: s.startFrame,
		endFrame: s.endFrame,
		morph: s.morph !== false,
	});
	const H = horizon.ticks;
	const w = new LottieWriter(ctx, H, images);
	w.countUses(root);
	const d = ctx.model.doc;
	const out = finalize(w.timeline(root, { opaque: false, paint: null, scale: root.view ? viewScale(root.view) : 1 }, H), H);
	if (root.view) {
		// the camera: every layer of the scene follows a null layer with the view transform
		const v = root.view;
		const ind = out.length + 1;
		const ks: Json = {
			p: position(v.x, v.y, ctx.digits),
			s: trackProp([v.sx, v.sy], [100, 100], [0, 0], 4),
			r: trackProp([v.rot], [1], [0], 3, true),
		};
		if (!isConst(v.skw) || Math.abs(v.skw[0]?.v ?? 0) > 1e-9) {
			ks.sk = trackProp([v.skw], [-1], [0], 3, true);
			ks.sa = st(0);
		}
		for (const l of out) l.parent = ind;
		out.push({ ty: 3, ind, ip: 0, op: H, st: 0, ks, nm: "Camera" });
	}
	if (s.includeBackground) {
		const bg = parseColor(d.backgroundColor) ?? [1, 1, 1, 1];
		out.push({
			ty: 1,
			ind: out.length + 1,
			ip: 0,
			op: H,
			st: 0,
			ks: {},
			sw: d.width,
			sh: d.height,
			sc:
				"#" +
				[bg[0], bg[1], bg[2]]
					.map((c) =>
						Math.round(c * 255)
							.toString(16)
							.padStart(2, "0"),
					)
					.join(""),
			nm: "Background",
		});
	}
	if (Object.keys(ctx.model.sounds).length) w.warn("Sounds aren't exported to Lottie");
	const animation: Json = {
		v: "5.12.0",
		fr: horizon.fps,
		ip: 0,
		op: H,
		w: d.width,
		h: d.height,
		nm: d.name.replace(/\.[^.]+$/, ""),
		assets: w.assets,
		layers: out,
	};
	const markers = labelsAsMarkers(ctx, rootId, frames, H);
	// segments for the state machine (statemachine.ts) and for players told to play markers
	const segments: LottieResult["segments"] = {};
	const add = (base: string, tm: number, dr: number) => {
		let cm = base;
		for (let k = 2; markers.some((m) => m.cm === cm); k++) cm = `${base} ${k}`;
		markers.push({ cm, tm, dr });
		return cm;
	};
	const tail = horizon.loop ? 0 : horizon.tail;
	if (tail) {
		// dotLottie players (dotlottie-rs) play a marker's last frame too, [tm, tm + dr], as they play
		// a whole animation over [0, op - 1]; lottie-web plays [tm, tm + dr)
		const end = images === "dotlottie" ? 1 : 0;
		segments.intro = add("intro", 0, tail - end);
		segments.tail = add("loop", tail, H - tail - end);
		if (images !== "dotlottie")
			w.warn(
				`The root timeline stops (stop()) while movie clips keep running: play the marker "${segments.intro}" once, then "${segments.tail}" in a loop (a .lottie file's state machine does that)`,
			);
	}
	if (images === "dotlottie" && s.begin !== "auto" && H > 1) segments.poster = add("poster", s.posterFrame === "last" ? H - 1 : 0, 1);
	if (markers.length) animation.markers = markers;
	return { animation, images: w.files, horizon, segments };
}

/** Frame labels of the root timeline as markers, at the tick where the playhead first shows them. */
function labelsAsMarkers(ctx: Context, rootId: string, frames: Int32Array, H: number): Json[] {
	const prog = ctx.programs[rootId]!;
	const at = prog.labels
		.map((l) => {
			const t = frames.indexOf(l.frame);
			return t >= 0 ? { cm: l.name, tm: t } : null;
		})
		.filter((m): m is { cm: string; tm: number } => !!m)
		.sort((a, b) => a.tm - b.tm);
	return at.map((m, i) => ({ cm: m.cm, tm: m.tm, dr: (at[i + 1]?.tm ?? H) - m.tm }));
}

/** Splits the size of a Lottie file into drawing, animation (keyframes) and images. */
export function lottieParts(animation: Json, total: number): { drawing: number; animation: number; images: number } {
	let anim = 0,
		img = 0;
	for (const a of (animation.assets as Json[]) ?? []) if (typeof a.p === "string" && a.p.startsWith("data:")) img += a.p.length;
	const visit = (v: unknown) => {
		if (Array.isArray(v)) {
			for (const x of v) visit(x);
			return;
		}
		if (!v || typeof v !== "object") return;
		const o = v as Json;
		if (o.a === 1 && Array.isArray(o.k)) {
			anim += JSON.stringify(o).length;
			return;
		}
		for (const k in o) visit(o[k]);
	};
	visit(animation);
	return { drawing: Math.max(0, total - anim - img), animation: anim, images: img };
}

/** For tests. */
export const internals = { bezierPaths, trackProp, sawtooth, lottieFilters, effectsJson, composeCT, applyCT };
