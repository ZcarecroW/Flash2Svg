/**
 * Strokes under an uneven scale. SVG stretches a stroke along with its drawing; Flash's pen stays
 * round, one width all around. Measured in Animate (f83, and a table of 16 scale pairs):
 *   Normal      width x sqrt((sx^2 + sy^2) / 2)
 *   Horizontal  width x sx
 *   Vertical    width x sy
 *   None        width (done with vector-effect, see artwork.ts)
 *
 * So where a drawing's scale doesn't change over time and is uneven, or its strokes are Horizontal or
 * Vertical, the stroke's path is written in the scaled space, with the width it has there, under a
 * transform that undoes the scale around it: the pen isn't stretched. Each instance like that gets
 * a copy of its symbol, as with 9-slice. Scale that changes keeps the plain stroke.
 *
 * A Lottie layer stretches its strokes whatever is inside (`move`): there the scale goes into the
 * drawings, and the instance keeps only its position. Not elsewhere: scripts read an instance's scale.
 */
import type { Artwork } from "./artwork.ts";
import { apply, concat, fmt, fmtMatrix, IDENTITY, parseTransform } from "./geom.ts";
import type { Mat } from "./model.ts";
import { mapPath, scaleArtwork, scaleTracks } from "./nineslice.ts";
import { fromProps, TRANSFORM_PROPS, type InstanceItem, type Item, type Program } from "./program.ts";
import { isConstant, valueAt, type Track } from "./tracks.ts";
import { clone, el, isNode, type XmlChild, type XmlNode } from "./xml.ts";

/** How strokes other than Normal scale: "#rrggbb|width" -> horizontal or vertical. */
export type PenModes = Map<string, string>;

const linear = (m: Mat): Mat => [m[0], m[1], m[2], m[3], 0, 0];

/** Stretches a round pen: its sides differ, or aren't square. */
function uneven(m: Mat): boolean {
	const x = Math.hypot(m[0], m[1]),
		y = Math.hypot(m[2], m[3]);
	if (!x || !y) return false;
	return Math.abs(x / y - 1) > 0.01 || Math.abs((m[0] * m[2] + m[1] * m[3]) / (x * y)) > 0.01;
}

function invert(m: Mat): Mat {
	const [a, b, c, d, e, f] = m;
	const det = a * d - b * c || 1e-12;
	return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function penScale(m: Mat, mode: string | undefined): number {
	if (mode === "horizontal") return Math.hypot(m[0], m[1]);
	if (mode === "vertical") return Math.hypot(m[2], m[3]);
	return Math.sqrt((m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3]) / 2);
}

const signature = (n: XmlNode) => `${(n.attrs.stroke ?? "").slice(0, 7).toLowerCase()}|${parseFloat(n.attrs["stroke-width"] ?? "1")}`;

/**
 * A stroke this can redraw: a path with a plain colour. One that keeps its width anyway does so by
 * itself, except in a Lottie layer (`all`).
 */
const redrawn = (n: XmlNode, all: boolean) => n.name === "path" && !!n.attrs.d && /^#/.test(n.attrs.stroke ?? "") && (all || !n.attrs["vector-effect"]);

function hasStrokes(n: XmlNode, all: boolean): boolean {
	return redrawn(n, all) || n.children.some((c) => isNode(c) && hasStrokes(c, all));
}

/** The drawing with its strokes redrawn for the scale `L` that's around it. */
function penArtwork(a: Artwork, L: Mat, modes: PenModes | undefined, id: string, digits: number, all: boolean): Artwork {
	const go = (n: XmlNode, S: Mat): XmlChild[] => {
		const here = n.attrs.transform ? concat(parseTransform(n.attrs.transform), S) : S;
		if (redrawn(n, all)) {
			const total = concat(here, L);
			const k = n.attrs["vector-effect"] ? 1 : penScale(total, modes?.get(signature(n)));
			const attrs: Record<string, string> = { ...n.attrs };
			delete attrs["vector-effect"];
			attrs.d = mapPath(n.attrs.d!, (p) => apply(total, p), digits);
			attrs.fill = "none";
			attrs["stroke-width"] = fmt(parseFloat(n.attrs["stroke-width"] ?? "1") * k, digits);
			const back = fmtMatrix(invert(concat(S, L)), 6);
			if (back) attrs.transform = back;
			else delete attrs.transform;
			const stroke = el("path", attrs);
			if (!n.attrs.fill || n.attrs.fill === "none") return [stroke];
			// (a fill and a stroke on one path: the fill stays as it is)
			const fill = clone(n);
			for (const k2 of ["stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity"]) delete fill.attrs[k2];
			return [fill, stroke];
		}
		const copy: XmlNode = { name: n.name, attrs: { ...n.attrs }, children: n.children.flatMap((c) => (isNode(c) ? go(c, here) : [c])) };
		return [copy];
	};
	const body = go(a.body, IDENTITY);
	return { id, defs: a.defs, body: body.length === 1 ? (body[0] as XmlNode) : el("g", {}, body), empty: a.empty };
}

/**
 * Gives instances whose drawings need it a copy of their symbol with the strokes redrawn. `modes`:
 * by atlas id, how its strokes scale, where not Normal.
 */
export function applyPens(
	roots: string[],
	programs: Record<string, Program>,
	art: (id: string) => Artwork | null,
	addArt: (id: string, a: Artwork | null) => void,
	digits: (id: string) => number,
	modes: Map<string, PenModes>,
	move: boolean,
): void {
	const keyOf = (m: Mat) => m.slice(0, 4).map((v) => +v.toFixed(4)).join(",");
	const madeArt = new Map<string, string>();
	const madeProg = new Map<string, string>();
	const looked = new Map<string, boolean>();
	let n = 0;
	const strokes = (id: string) => {
		let v = looked.get(id);
		if (v === undefined) {
			const a = art(id);
			looked.set(id, (v = !!a && !a.empty && hasStrokes(a.body, move)));
		}
		return v;
	};
	/** Whether a drawing looks different from a plain stroke under `L`. */
	const needs = (id: string, L: Mat) => (uneven(L) || (modes.has(id) && !same(L))) && strokes(id);
	const same = (L: Mat) => Math.abs(Math.hypot(L[0], L[1]) - 1) < 0.01 && Math.abs(Math.hypot(L[2], L[3]) - 1) < 0.01;

	const artFor = (id: string, L: Mat) => {
		const redraw = needs(id, L);
		if (!redraw && !(move && !same(L) )) return id;
		const key = `${id}|${keyOf(L)}`;
		let out = madeArt.get(key);
		if (!out) {
			out = `${id}#pen${n++}`;
			const a = art(id);
			const name = `pen${n}_${a?.id ?? "x"}`;
			const drawn = a && redraw ? penArtwork(a, L, modes.get(id), name, digits(id), move) : a;
			addArt(out, drawn && move ? scaleArtwork(drawn, L, name, digits(id) + 2) : drawn);
			madeArt.set(key, out);
		}
		return out;
	};

	/** The scale of an instance, if it stays. */
	const scaleOf = (it: InstanceItem): Mat | null => {
		const t = it.transform;
		// (in perspective a drawing is seen as a picture on a plane: its strokes go along)
		if (it.persp) return null;
		if (![t.rot, t.skw, t.sx, t.sy].every((k) => isConstant(k))) return null;
		const p = Object.fromEntries(TRANSFORM_PROPS.map((k) => [k, valueAt(t[k], it.start)])) as Parameters<typeof fromProps>[0];
		return linear(fromProps(p));
	};

	const anyIn = new Map<string, boolean>();
	/** Whether anything under a timeline changes with this scale. */
	const within = (prog: Program, L: Mat): boolean => {
		const key = `${prog.id}|${keyOf(L)}`;
		let v = anyIn.get(key);
		if (v !== undefined) return v;
		anyIn.set(key, false);
		v = prog.layers.some((l) =>
			l.items.some((it) => {
				if (it.kind === "art") return needs(it.art, L);
				if (it.kind === "artSeq") return it.arts.some((a) => needs(a, L));
				if (it.kind !== "instance") return false;
				const child = programs[it.symbol];
				const s = scaleOf(it);
				return !!child && !!s && within(child, concat(s, L));
			}),
		);
		anyIn.set(key, v);
		return v;
	};

	const programFor = (prog: Program, L: Mat): string => {
		const key = `${prog.id}|${keyOf(L)}`;
		let id = madeProg.get(key);
		if (id) return id;
		id = `${prog.id}#pen${n++}`;
		madeProg.set(key, id);
		programs[id] = { ...prog, id, source: prog.source ?? prog.id, layers: prog.layers.map((l) => ({ ...l, items: l.items.map((it) => itemFor(it, L)) })) };
		return id;
	};

	const itemFor = (it: Item, L: Mat): Item => {
		if (it.kind === "art") return { ...it, art: artFor(it.art, L) };
		if (it.kind === "artSeq") return { ...it, arts: it.arts.map((a) => artFor(a, L)) };
		if (move && !same(L)) {
			if (it.kind === "bitmap") return { ...it, matrix: concat(it.matrix, L) };
			if (it.kind === "text") return { ...it, art: it.art ? artFor(it.art, L) : it.art, element: { ...it.element, matrix: concat(it.element.matrix, L) } };
		}
		if (it.kind !== "instance") return it;
		const child = programs[it.symbol];
		if (!move) {
			const s = scaleOf(it);
			if (!child || !s) return it;
			const next = concat(s, L);
			return within(child, next) ? { ...it, symbol: programFor(child, next) } : it;
		}
		// (what is around is in the drawing already: this one's place follows it)
		const placed: InstanceItem = same(L) ? it : { ...it, transform: scaleTracks(it.transform, L, it.start, it.end) };
		const s = scaleOf(placed);
		if (!child || !s || !within(child, s)) return placed;
		const t = placed.transform;
		const hold = (v: number, like: Track): Track => [{ t: like[0]?.t ?? it.start, v, ease: "hold" }];
		const tp = { x: valueAt(t.tpx, it.start), y: valueAt(t.tpy, it.start) };
		return {
			...placed,
			symbol: programFor(child, s),
			transform: { ...t, sx: hold(1, t.sx), sy: hold(1, t.sy), rot: hold(0, t.rot), skw: hold(0, t.skw), tpx: hold(s[0] * tp.x + s[2] * tp.y, t.tpx), tpy: hold(s[1] * tp.x + s[3] * tp.y, t.tpy) },
		};
	};

	for (const r of roots) {
		const prog = programs[r];
		if (prog) for (const l of prog.layers) l.items = l.items.map((it) => itemFor(it, IDENTITY));
	}
}
