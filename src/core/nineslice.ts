/**
 * 9-slice scaling ("Enable guides for 9-slice scaling" on movie clip symbols). Corners keep
 * their size, the top/bottom edges stretch horizontally, the left/right edges vertically and the
 * centre in both directions. Like Flash, the drawing's vertices are moved piecewise (no seams);
 * gradients, bitmaps, text and nested movie clips scale normally, graphic symbols are sliced too.
 * Flash ignores the grid on rotated or skewed instances, and so do we.
 *
 * Each sliced instance gets a derived copy of its symbol drawn at the instance's scale; the
 * instance itself keeps only its position. Instances whose scale is animated keep normal scaling.
 */
import type { Artwork } from "./artwork.ts";
import { compactPath } from "./artwork.ts";
import { apply, concat, fmt, fmtMatrix, IDENTITY, parseTransform } from "./geom.ts";
import type { Mat, Point, SceneModel } from "./model.ts";
import { fromProps, toProps, TRANSFORM_PROPS, type InstanceItem, type Item, type Program, type TransformTracks } from "./program.ts";
import { isConstant, simplify, valueAt, type Track } from "./tracks.ts";
import { clone, el, isNode, walk, type XmlNode } from "./xml.ts";

/** One axis of the grid, in the 9-slice symbol's space: content a..b, guides l..r, scale s. */
export interface Axis {
	s: number;
	a: number;
	b: number;
	l: number;
	r: number;
}

/** Maps points of some nested space (through `pre`) into the scaled 9-slice symbol space. */
export interface SliceMap {
	pre: Mat;
	x: Axis;
	y: Axis;
}

export function mapAxis(ax: Axis, v: number): number {
	const s = Math.abs(ax.s),
		sign = ax.s < 0 ? -1 : 1;
	const a = Math.min(ax.a, ax.b),
		b = Math.max(ax.a, ax.b);
	const l = Math.min(Math.max(ax.l, a), b),
		r = Math.max(Math.min(ax.r, b), l);
	const cl = l - a,
		cr = b - r,
		w = s * (b - a);
	// scaled below the size of the corners: shrink the corners, the middle collapses
	const k = cl + cr > w && cl + cr > 0 ? w / (cl + cr) : 1;
	const left = s * a + cl * k,
		right = s * b - cr * k;
	let out: number;
	if (v <= l) out = s * a + (v - a) * k;
	else if (v >= r) out = s * b - (b - v) * k;
	else out = r > l ? left + ((v - l) / (r - l)) * (right - left) : left;
	return sign * out;
}

function mapPoint(m: SliceMap, local: Mat, p: Point): Point {
	const q = apply(concat(local, m.pre), p);
	return { x: mapAxis(m.x, q.x), y: mapAxis(m.y, q.y) };
}

/** The plain (non-sliced) scaling of `m`, for things that scale normally. */
export function linearOf(m: SliceMap): Mat {
	return concat(m.pre, [m.x.s, 0, 0, m.y.s, 0, 0]);
}

/** Rewrites path data through `fn` (absolute output; H/V/S/T expanded, arcs map their end point). */
export function mapPath(d: string, fn: (p: Point) => Point, digits: number): string {
	const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
	let i = 0;
	let cmd = "";
	let cur: Point = { x: 0, y: 0 },
		start: Point = { x: 0, y: 0 };
	let lastCtrl: Point | null = null,
		lastCmd = "";
	const out: string[] = [];
	const num = () => parseFloat(tokens[i++] ?? "0");
	const pt = (rel: boolean): Point => {
		const x = num(),
			y = num();
		return rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
	};
	const w = (p: Point) => {
		const q = fn(p);
		return `${fmt(q.x, digits + 2)} ${fmt(q.y, digits + 2)}`;
	};
	while (i < tokens.length) {
		if (/^[a-zA-Z]$/.test(tokens[i]!)) cmd = tokens[i++]!;
		else if (!cmd) {
			i++;
			continue;
		}
		const rel = cmd === cmd.toLowerCase();
		const C = cmd.toUpperCase();
		switch (C) {
			case "M": {
				cur = pt(rel);
				start = cur;
				out.push("M" + w(cur));
				cmd = rel ? "l" : "L";
				lastCtrl = null;
				break;
			}
			case "L":
				cur = pt(rel);
				out.push("L" + w(cur));
				lastCtrl = null;
				break;
			case "H": {
				const x = num();
				cur = { x: rel ? cur.x + x : x, y: cur.y };
				out.push("L" + w(cur));
				lastCtrl = null;
				break;
			}
			case "V": {
				const y = num();
				cur = { x: cur.x, y: rel ? cur.y + y : y };
				out.push("L" + w(cur));
				lastCtrl = null;
				break;
			}
			case "Q": {
				const c = pt(rel);
				const e = pt(rel);
				out.push("Q" + w(c) + " " + w(e));
				lastCtrl = c;
				cur = e;
				break;
			}
			case "T": {
				const c: Point = lastCtrl && (lastCmd === "Q" || lastCmd === "T") ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
				const e = pt(rel);
				out.push("Q" + w(c) + " " + w(e));
				lastCtrl = c;
				cur = e;
				break;
			}
			case "C": {
				const c1 = pt(rel);
				const c2 = pt(rel);
				const e = pt(rel);
				out.push("C" + w(c1) + " " + w(c2) + " " + w(e));
				lastCtrl = c2;
				cur = e;
				break;
			}
			case "S": {
				const c1: Point = lastCtrl && (lastCmd === "C" || lastCmd === "S") ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
				const c2 = pt(rel);
				const e = pt(rel);
				out.push("C" + w(c1) + " " + w(c2) + " " + w(e));
				lastCtrl = c2;
				cur = e;
				break;
			}
			case "A": {
				const rx = num(),
					ry = num(),
					rot = num(),
					large = num(),
					sweep = num();
				cur = pt(rel);
				out.push(`A${fmt(rx, digits)} ${fmt(ry, digits)} ${fmt(rot, 2)} ${large} ${sweep} ${w(cur)}`);
				lastCtrl = null;
				break;
			}
			case "Z":
				out.push("Z");
				cur = start;
				lastCtrl = null;
				break;
			default:
				i++;
		}
		lastCmd = C;
	}
	// repeated commands need no letter ("L1 2L3 4" -> "L1 2 3 4")
	let d2 = "",
		prev = "";
	for (const seg of out) {
		const c = seg[0]!;
		d2 += c === prev && c !== "M" && c !== "Z" && c !== "A" ? " " + seg.slice(1) : seg;
		prev = c;
	}
	return compactPath(d2, digits);
}

const URL_RE = /url\(#([^)]+)\)/;

/**
 * A sliced copy of an artwork. `id` is the new artwork's id. Paint servers (gradients, bitmap
 * patterns) and clip paths are copied per use and transformed so they scale normally.
 */
export function sliceArtwork(a: Artwork, m: SliceMap, id: string, digits: number): Artwork {
	const byId = new Map<string, XmlNode>();
	for (const d of a.defs) if (d.attrs.id) byId.set(d.attrs.id, d);
	const defs: XmlNode[] = [];
	let n = 0;
	const lin = linearOf(m);
	// stroke widths keep their size (Flash doesn't scale strokes of 9-slice symbols)
	const strokeScale = (local: Mat) => {
		const t = concat(local, m.pre);
		return Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2])) || 1;
	};
	const paintRef = (value: string, local: Mat): string => {
		const r = URL_RE.exec(value);
		if (!r) return value;
		const src = byId.get(r[1]!);
		if (!src) return value;
		const copy = clone(src);
		const nid = `${id}_${n++}`;
		copy.attrs.id = nid;
		const userSpace = (copy.attrs.gradientUnits ?? copy.attrs.patternUnits) === "userSpaceOnUse" || copy.name === "pattern" || copy.name === "clipPath";
		if (copy.name === "clipPath") {
			copy.children = copy.children.map((c) => (isNode(c) ? node(c, local) : c));
		} else if (userSpace) {
			const key = copy.name === "pattern" ? "patternTransform" : "gradientTransform";
			const t = fmtMatrix(concat(parseTransform(copy.attrs[key]), concat(local, lin)), digits + 2);
			if (t) copy.attrs[key] = t;
			else delete copy.attrs[key];
		}
		defs.push(copy);
		return value.replace(URL_RE, `url(#${nid})`);
	};
	const node = (src: XmlNode, parent: Mat): XmlNode => {
		const local = src.attrs.transform ? concat(parseTransform(src.attrs.transform), parent) : parent;
		// inline references to drawings so every vertex can be moved
		if (src.name === "use") {
			const ref = (src.attrs["xlink:href"] ?? src.attrs.href ?? "").slice(1);
			const target = byId.get(ref);
			if (target && (target.name === "g" || target.name === "path")) {
				const copy = clone(target);
				delete copy.attrs.id;
				const g = el("g", {}, [copy]);
				for (const k in src.attrs) if (k !== "transform" && k !== "href" && k !== "xlink:href" && k !== "x" && k !== "y") g.attrs[k] = src.attrs[k]!;
				const x = parseFloat(src.attrs.x ?? "0") || 0,
					y = parseFloat(src.attrs.y ?? "0") || 0;
				return node(g, concat([1, 0, 0, 1, x, y], local));
			}
		}
		const out: XmlNode = { name: src.name, attrs: { ...src.attrs }, children: [] };
		delete out.attrs.transform;
		for (const k of ["fill", "stroke", "clip-path", "mask"]) if (out.attrs[k]?.includes("url(#")) out.attrs[k] = paintRef(out.attrs[k]!, local);
		if (src.name === "path") {
			out.attrs.d = mapPath(src.attrs.d ?? "", (p) => mapPoint(m, local, p), digits);
			if (out.attrs.stroke && out.attrs.stroke !== "none") {
				const sw = parseFloat(src.attrs["stroke-width"] ?? "1");
				const k = strokeScale(local);
				if (Math.abs(k - 1) > 1e-6) out.attrs["stroke-width"] = fmt(sw * k, digits);
			}
		} else if (src.name === "g" || src.name === "clipPath" || src.name === "mask" || src.name === "a" || src.name === "switch") {
			out.children = src.children.map((c) => (isNode(c) ? node(c, local) : c));
		} else {
			// images, primitives, text: scale normally
			const t = fmtMatrix(concat(local, lin), digits + 2);
			if (t) out.attrs.transform = t;
			out.children = src.children.map((c) => (isNode(c) ? clone(c) : c));
		}
		return out;
	};
	const body = node(a.body, IDENTITY);
	// anything else referenced (stops inherited from another gradient, images in patterns...) is
	// copied under a new id, so the sliced and the original artwork can share a document
	const have = new Set(defs.map((d) => d.attrs.id));
	const renamed = new Map<string, string>();
	const pull = (ref: string): string => {
		if (have.has(ref)) return ref;
		const done = renamed.get(ref);
		if (done) return done;
		const src = byId.get(ref);
		if (!src) return ref;
		const c = clone(src);
		const nid = `${id}_${n++}`;
		c.attrs.id = nid;
		renamed.set(ref, nid);
		have.add(nid);
		defs.push(c);
		return nid;
	};
	const fix = (root: XmlNode) =>
		walk(root, (x) => {
			for (const k in x.attrs) {
				const v = x.attrs[k]!;
				if ((k === "xlink:href" || k === "href") && v.startsWith("#")) x.attrs[k] = "#" + pull(v.slice(1));
				else if (v.includes("url(#")) x.attrs[k] = v.replace(/url\(#([^)]+)\)/g, (_, r: string) => `url(#${pull(r)})`);
			}
		});
	fix(body);
	for (let i = 0; i < defs.length; i++) fix(defs[i]!);
	return { id, defs, body, empty: a.empty };
}

interface Box {
	l: number;
	t: number;
	r: number;
	b: number;
}

function grow(box: Box | null, l: number, t: number, r: number, b: number): Box {
	return box ? { l: Math.min(box.l, l), t: Math.min(box.t, t), r: Math.max(box.r, r), b: Math.max(box.b, b) } : { l, t, r, b };
}

/** Bounds of an artwork's paths including half their stroke width (control points count too). */
export function artworkBounds(a: Artwork): Box | null {
	let box: Box | null = null;
	const visit = (n: XmlNode, parent: Mat) => {
		const local = n.attrs.transform ? concat(parseTransform(n.attrs.transform), parent) : parent;
		if (n.name === "path" && n.attrs.d) {
			const stroked = n.attrs.stroke && n.attrs.stroke !== "none";
			const k = Math.sqrt(Math.abs(local[0] * local[3] - local[1] * local[2]));
			const h = stroked ? (parseFloat(n.attrs["stroke-width"] ?? "1") * k) / 2 : 0;
			mapPath(
				n.attrs.d,
				(p) => {
					const q = apply(local, p);
					box = grow(box, q.x - h, q.y - h, q.x + h, q.y + h);
					return p;
				},
				2,
			);
		}
		for (const c of n.children) if (isNode(c)) visit(c, local);
	};
	visit(a.body, IDENTITY);
	return box;
}

/** Bounds of everything a symbol ever shows, in its own space (Flash slices against these). */
function contentBounds(prog: Program, art: (id: string) => Artwork | null): Box | null {
	let box: Box | null = null;
	const addArt = (id: string) => {
		const a = art(id);
		const b = a ? artworkBounds(a) : null;
		if (b) box = grow(box, b.l, b.t, b.r, b.b);
	};
	for (const l of prog.layers)
		for (const it of l.items) {
			if (it.kind === "art") addArt(it.art);
			else if (it.kind === "artSeq") it.arts.forEach(addArt);
			else if (it.kind === "instance") box = grow(box, it.bounds.left, it.bounds.top, it.bounds.left + it.bounds.width, it.bounds.top + it.bounds.height);
			else if (it.kind === "text") {
				const e = it.element.bounds;
				box = grow(box, e.left, e.top, e.left + e.width, e.top + e.height);
			}
		}
	return box;
}

/** A copy of an artwork that scales normally (text outlines, things that are never sliced). */
function scaleArtwork(a: Artwork, t: Mat, id: string, digits: number): Artwork {
	const s = fmtMatrix(t, digits + 2);
	return { ...a, id, body: s ? el("g", { transform: s }, [a.body]) : a.body };
}

const ANGLE_EPS = 0.01;

function isZeroAngle(t: Track): boolean {
	return t.every((k) => Math.abs(((((k.v + 180) % 360) + 360) % 360) - 180) < ANGLE_EPS);
}

function constTrack(v: number, like: Track): Track {
	return [{ t: like[0]?.t ?? 0, v, ease: "hold" }];
}

function constantTransform(tr: TransformTracks): boolean {
	return TRANSFORM_PROPS.every((k) => isConstant(tr[k], 1e-6));
}

function matrixOf(tr: TransformTracks, t: number): Mat {
	const p = {} as Record<(typeof TRANSFORM_PROPS)[number], number>;
	for (const k of TRANSFORM_PROPS) p[k] = valueAt(tr[k], t);
	return fromProps(p);
}

/** Transform tracks for L * M(t) (an instance inside a 9-slice symbol that scales normally). */
function scaleTracks(tr: TransformTracks, L: Mat, start: number, end: number): TransformTracks {
	const diag = Math.abs(L[1]) < 1e-9 && Math.abs(L[2]) < 1e-9;
	const uniform = diag && Math.abs(L[0] - L[3]) < 1e-9;
	const unrotated = isZeroAngle(tr.rot) && isZeroAngle(tr.skw);
	if (uniform || (diag && unrotated)) {
		const mul = (t: Track, f: number, o = 0) => t.map((k) => ({ ...k, v: k.v * f + o }));
		return { ...tr, x: mul(tr.x, L[0], L[4]), y: mul(tr.y, L[3], L[5]), sx: mul(tr.sx, L[0]), sy: mul(tr.sy, L[3]) };
	}
	// general case: sample every frame
	const out = Object.fromEntries(TRANSFORM_PROPS.map((k) => [k, [] as Track])) as TransformTracks;
	const tp = { x: valueAt(tr.tpx, start), y: valueAt(tr.tpy, start) };
	for (let f = start; f < Math.max(start + 1, end); f++) {
		const p = toProps(concat(matrixOf(tr, f), L), tp);
		for (const k of TRANSFORM_PROPS) out[k].push({ t: f, v: p[k], ease: "linear" });
	}
	for (const k of TRANSFORM_PROPS) out[k] = simplify(out[k], k === "sx" || k === "sy" ? 0.001 : 0.05);
	return out;
}

/**
 * Rewrites every 9-slice movie clip instance in `programs` to use a sliced copy of its symbol.
 * `addArt` registers the derived artworks under new atlas ids.
 */
export function applyNineSlice(
	model: SceneModel,
	programs: Record<string, Program>,
	art: (id: string) => Artwork | null,
	addArt: (id: string, a: Artwork | null) => void,
	digits: number,
	warn: (m: string) => void,
	smooth = true,
): void {
	if (!Object.values(model.timelines).some((t) => t.scalingGrid)) return;
	const derivedArt = new Map<string, string>();
	const derivedProg = new Map<string, string>();
	let counter = 0;
	const mapKey = (m: SliceMap) => [...m.pre, m.x.s, m.x.a, m.x.b, m.x.l, m.x.r, m.y.s, m.y.a, m.y.b, m.y.l, m.y.r].map((v) => +v.toFixed(5)).join(",");

	const artFor = (artId: string, m: SliceMap, slice: boolean): string => {
		const key = `${artId}|${slice ? "s" : "n"}|${mapKey(m)}`;
		let id = derivedArt.get(key);
		if (id) return id;
		id = `${artId}#9s${counter++}`;
		const src = art(artId);
		const newId = `s9_${counter}_${src?.id ?? "x"}`;
		addArt(id, src ? (slice ? sliceArtwork(src, m, newId, digits) : scaleArtwork(src, linearOf(m), newId, digits)) : null);
		derivedArt.set(key, id);
		return id;
	};

	const sliceItem = (it: Item, m: SliceMap): Item => {
		const L = linearOf(m);
		switch (it.kind) {
			case "art":
				return { ...it, art: artFor(it.art, m, true) };
			case "artSeq":
				return { ...it, arts: it.arts.map((a) => artFor(a, m, true)) };
			case "bitmap":
				return { ...it, matrix: concat(it.matrix, L) };
			case "video":
				return it;
			case "text":
				return { ...it, art: it.art ? artFor(it.art, m, false) : it.art, element: { ...it.element, matrix: concat(it.element.matrix, L) } };
			case "instance": {
				const child = programs[it.symbol];
				if (it.symbolType === "graphic" && child && constantTransform(it.transform)) {
					// graphic symbols are sliced along with the drawing
					const inner: SliceMap = { ...m, pre: concat(matrixOf(it.transform, it.start), m.pre) };
					const tr = Object.fromEntries(TRANSFORM_PROPS.map((k) => [k, constTrack(k === "sx" || k === "sy" ? 1 : 0, it.transform[k])])) as TransformTracks;
					return { ...it, symbol: programFor(child, inner), transform: tr };
				}
				return { ...it, transform: scaleTracks(it.transform, L, it.start, it.end) };
			}
		}
	};

	const programFor = (prog: Program, m: SliceMap): string => {
		const key = `${prog.id}|${mapKey(m)}`;
		let id = derivedProg.get(key);
		if (id) return id;
		id = `${prog.id}#9s${counter++}`;
		derivedProg.set(key, id);
		const copy: Program = {
			...prog,
			id,
			source: prog.source ?? prog.id,
			layers: prog.layers.map((l) => {
				if (l.rig) warn(`Layer parenting inside the 9-slice symbol ${prog.name} is not sliced`);
				return { ...l, items: l.items.map((it) => sliceItem(it, m)) };
			}),
		};
		programs[id] = copy;
		return id;
	};

	/**
	 * Animated scale: a drawing-only symbol becomes a graphic that shows the drawing sliced for
	 * the scale of each frame (Flash slices every frame anew); the instance keeps its position.
	 */
	const animatedSlice = (it: InstanceItem, child: Program, mapAt: (sx: number, sy: number) => SliceMap): InstanceItem | null => {
		const staticArt = child.layers.every((l) => l.items.every((i) => i.kind === "art" && i.start <= 0 && i.end >= child.frameCount));
		if (!staticArt || it.name) {
			warn(`9-slice symbol ${child.name}: animated scaling is exported without 9-slice`);
			return null;
		}
		const tr = it.transform;
		const n = it.end - it.start;
		const scales = Array.from({ length: n }, (_, i) => [valueAt(tr.sx, it.start + i), valueAt(tr.sy, it.start + i)] as const);
		const id = `${child.id}#9s${counter++}`;
		programs[id] = {
			...child,
			id,
			source: child.source ?? child.id,
			kind: "graphic",
			frameCount: n,
			labels: [],
			actions: {},
			layers: child.layers.map((l) => ({
				...l,
				items: l.items.map((i): Item =>
					i.kind === "art"
						? { kind: "artSeq", uid: i.uid, start: 0, end: n, slot: i.slot, arts: scales.map(([sx, sy]) => artFor(i.art, mapAt(sx, sy), true)) }
						: i,
				),
			})),
		};
		// one key per frame: tx = x - sx * tpx stays the same with sx = 1 and tpx' = sx * tpx
		const perFrame = (fn: (f: number) => number): Track =>
			scales.map((_, i) => ({ t: it.start + i, v: fn(it.start + i), ease: smooth ? ("linear" as const) : ("hold" as const) }));
		const transform: TransformTracks = {
			...tr,
			sx: constTrack(1, tr.sx),
			sy: constTrack(1, tr.sy),
			tpx: simplify(
				perFrame((f) => valueAt(tr.sx, f) * valueAt(tr.tpx, f)),
				0.05,
			),
			tpy: simplify(
				perFrame((f) => valueAt(tr.sy, f) * valueAt(tr.tpy, f)),
				0.05,
			),
		};
		for (const k of ["tpx", "tpy"] as const) transform[k][transform[k].length - 1]!.ease = "hold";
		return {
			...it,
			symbol: id,
			symbolType: "graphic",
			transform,
			graphic: [{ start: it.start, end: it.end, loop: "play once", firstFrame: 0, lastFrame: n - 1 }],
		};
	};

	for (const prog of Object.values(programs)) {
		for (const layer of prog.layers) {
			layer.items = layer.items.map((it) => {
				if (it.kind !== "instance" || it.symbolType !== "movie clip") return it;
				const grid = model.timelines[it.symbol]?.scalingGrid;
				const child = programs[it.symbol];
				if (!grid || !child) return it;
				const tr = it.transform;
				if (!isZeroAngle(tr.rot) || !isZeroAngle(tr.skw)) return it; // Flash ignores the grid when rotated
				const animated = !isConstant(tr.sx, 1e-4) || !isConstant(tr.sy, 1e-4);
				const sx = valueAt(tr.sx, it.start),
					sy = valueAt(tr.sy, it.start);
				if (!animated && Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4) return it;
				// content bounds in the symbol's own space (with strokes, as Animate measures them)
				const mat = matrixOf(tr, it.start);
				const box = contentBounds(child, art) ?? {
					l: (it.bounds.left - mat[4]) / sx,
					r: (it.bounds.left + it.bounds.width - mat[4]) / sx,
					t: (it.bounds.top - mat[5]) / sy,
					b: (it.bounds.top + it.bounds.height - mat[5]) / sy,
				};
				const mapAt = (sx: number, sy: number): SliceMap => ({
					pre: IDENTITY,
					x: { s: sx, a: Math.min(box.l, box.r), b: Math.max(box.l, box.r), l: grid.left, r: grid.right },
					y: { s: sy, a: Math.min(box.t, box.b), b: Math.max(box.t, box.b), l: grid.top, r: grid.bottom },
				});
				if (animated) return animatedSlice(it, child, mapAt) ?? it;
				const symbol = programFor(child, mapAt(sx, sy));
				// keep the position: tx = x - sx * tpx stays the same with sx = 1, tpx' = sx * tpx
				const transform: TransformTracks = {
					...tr,
					sx: tr.sx.map((k) => ({ ...k, v: 1 })),
					sy: tr.sy.map((k) => ({ ...k, v: 1 })),
					tpx: tr.tpx.map((k) => ({ ...k, v: k.v * sx })),
					tpy: tr.tpy.map((k) => ({ ...k, v: k.v * sy })),
				};
				return { ...it, symbol, transform } satisfies InstanceItem;
			});
		}
	}
}
