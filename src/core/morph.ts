/**
 * Shape tweens as path morphs.
 *
 * Animate's in-betweens of a shape tween are blends of the start and the end shape: the morph
 * keeps one list of edges for both ends, and every coordinate, colour and gradient value goes
 * from start to end with the eased ratio. The SVG exporter writes each frame anew, though:
 * straight edges as lines, contours starting at another point, holes in another order, and edges
 * that have shrunk to nothing left out. Here the frames are matched up again. A run of frames
 * with the same structure becomes one drawing whose values are blended (a `MorphPart`): start and
 * end values are fitted to all frames of the run (least squares) and every frame is checked
 * against Animate's own drawing, so a morph never draws what Animate didn't. Frames that don't
 * fit stay drawings of their own.
 */
import type { Artwork } from "./artwork.ts";
import { apply, concat, fmt, fmtMatrix, nearestAngle, parseTransform } from "./geom.ts";
import type { Mat } from "./model.ts";
import { toProps } from "./program.ts";
import { simplify, type Track } from "./tracks.ts";
import { isNode, type XmlNode } from "./xml.ts";

export type ChannelKind = "d" | "color" | "num" | "matrix";

/** One animated attribute of a morph's drawing. */
export interface MorphChannel {
	/** The element: index in pre-order over the template's defs, then its body (elements only). */
	node: number;
	attr: string;
	kind: ChannelKind;
	/** d: one letter per number group, M (2 numbers), L (2), Q (4), Z (0). */
	cmds?: string;
	/** Values at ratio 0 and 1: the value at ratio r is s + (e - s) * r. */
	s?: number[];
	e?: number[];
	/** Instead of s/e: the values at each frame of the part (they don't follow the ratio linearly). */
	f?: number[][];
	/** Matrix channels SMIL can animate: the rotation and skew (degrees) both ends share. */
	rs?: [number, number];
}

export interface MorphPart {
	/** Frames [from, to) of the tween span (0 = its keyframe). */
	from: number;
	to: number;
	/** The drawing whose structure the channels describe. */
	art: Artwork;
	channels: MorphChannel[];
	/** Own blend ratio (local frame time) when the frames follow no known ease. */
	ratio?: Track;
	/** SMIL can animate every channel. */
	smil: boolean;
	/** Only a gradient or pattern matrix that turns stands in the way: SMIL animates its rotation per frame. */
	turns?: boolean;
}

export interface Morph {
	/** The tween's blend ratio over local frame time. */
	ratio: Track;
	parts: MorphPart[];
}

/**
 * A subpath. Cyclic: [P0, C0, P1, C1, ..., Pn-1, Cn-1], segment k goes from Pk to Pk+1 (mod n)
 * with control point Ck. Open: [P0, C0, P1, ..., Pn] (n segments). Lines have their control
 * point in the middle.
 */
interface Sub {
	cyclic: boolean;
	pts: number[];
}

type Slot = { node: number; attr: string; kind: ChannelKind };
type Value = number[] | Sub[];

interface Scan {
	/** Structure: element names, attributes, fixed values, how many subpaths each path has. */
	sig: string;
	/** Like sig, with each subpath's number of segments. */
	fine: string;
	/** Like sig, without anything about path data. */
	loose: string;
	slots: Slot[];
	values: Value[];
	/** Elements in its defs, and where they end in `loose`. */
	defsCount: number;
	looseDefs: number;
}

const COLOR_ATTRS = new Set(["fill", "stroke", "stop-color", "flood-color"]);
const NUM_ATTRS = new Set(["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "fx", "fy", "r", "width", "height", "stroke-width", "offset", "stop-opacity", "fill-opacity", "stroke-opacity", "opacity"]);
const MATRIX_ATTRS = new Set(["transform", "gradientTransform", "patternTransform"]);
const OPACITY_ATTRS = new Set(["stop-opacity", "fill-opacity", "stroke-opacity", "opacity"]);
const NUM_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/;
const PATH_RE = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;
/** Frames a part needs at least: two fix its ends, the others check them. */
const MIN_FRAMES = 3;

/**
 * Finds the morph parts of a shape tween span. `arts[k]` is the drawing of frame k (null if
 * missing), `ratios[k]` the blend ratio at that frame, `start` the span's first frame (local time).
 */
export function buildMorph(arts: (Artwork | null)[], ratios: number[], ratio: Track, start: number, digits: number, log?: (m: string) => void): Morph | null {
	const scans = arts.map((a) => (a ? scan(a) : null));
	const parts: MorphPart[] = [];
	const runs = (from: number, to: number, key: (s: Scan) => string, then: (a: number, b: number) => void) => {
		let k = from;
		while (k < to) {
			const s = scans[k];
			let j = k + 1;
			if (s) while (j < to && scans[j] && key(scans[j]!) === key(s)) j++;
			if (s && j - k >= MIN_FRAMES) then(k, j);
			else log?.(`frames [${k},${j}): ${s ? "too few frames of one structure" : "no drawing"}`);
			k = j;
		}
	};
	const fit = (a: number, b: number) => {
		const part = fitRun(arts as Artwork[], scans as Scan[], ratios, a, b, start, digits, log);
		if (typeof part === "number") {
			// a frame whose paths don't match its neighbour's: the runs on either side
			if (part - a >= MIN_FRAMES) fit(a, part);
			if (b - part >= MIN_FRAMES) fit(part, b);
		} else if (part) parts.push(part);
		// not a blend over all of them: try the runs of equal edge counts
		else runs(a, b, (s) => s.fine, (c, d) => {
			if (c === a && d === b) return;
			const p = fitRun(arts as Artwork[], scans as Scan[], ratios, c, d, start, digits, log);
			if (p && typeof p !== "number") parts.push(p);
		});
	};
	// The keyframe is often written with fewer edges than the morph has (a rectangle's 4 lines vs
	// the in-betweens' 11 curves): it is checked against the part's start shape afterwards.
	const lead = scans[0] && scans[1] && scans[0].fine !== scans[1].fine ? 1 : 0;
	runs(lead, scans.length, (s) => s.sig, fit);
	parts.sort((x, y) => x.from - y.from);
	const first = parts[0];
	if (first && first.from === 1 && !first.ratio && scans[0]) {
		if (startsWith(first, scans[first.from]!, scans[0], arts[0]!, ratios[0]!, digits, log)) first.from = 0;
	}
	return parts.length ? { ratio, parts } : null;
}

// ---------------------------------------------------------------------------------- scanning

function scan(a: Artwork): Scan {
	const slots: Slot[] = [];
	const values: Value[] = [];
	let sig = "",
		fine = "",
		loose = "";
	const add = (s: string, f = s, l = s) => {
		sig += s;
		fine += f;
		loose += l;
	};
	let index = 0;
	const idPrefix = a.id + "_";
	const norm = (v: string) => v.split(idPrefix).join("#");
	const visit = (n: XmlNode) => {
		const node = index++;
		add("<" + n.name);
		const radial = n.name === "radialGradient" ? radialScale(n) : 0;
		for (const k of Object.keys(n.attrs).sort()) {
			const raw = n.attrs[k]!;
			let kind: ChannelKind | null = null;
			let v: Value | null = null;
			if (k === "d" && n.name === "path") {
				const subs = parsePath(raw);
				if (subs) {
					kind = "d";
					v = subs;
					const cyc = subs.filter((s) => s.cyclic).length;
					add(` d~${cyc}z${subs.length - cyc}`, ` d~${subs.map((s) => s.pts.length + (s.cyclic ? "z" : "")).sort().join(",")}`, " d");
					slots.push({ node, attr: k, kind });
					values.push(v);
					continue;
				}
			} else if (radial && (k === "gradientTransform" || k === "r" || k === "cx" || k === "cy" || k === "fx" || k === "fy")) {
				// radial gradients in canonical form (radius 1, the size in the matrix): Animate
				// writes the gradient's x scale as the radius and divides the matrix by it, which
				// doesn't blend linearly
				if (k === "gradientTransform") {
					const m = parseTransform(raw);
					kind = "matrix";
					v = [m[0] * radial, m[1] * radial, m[2] * radial, m[3] * radial, m[4], m[5]];
				} else {
					kind = "num";
					v = [k === "r" ? 1 : parseFloat(raw) / radial];
				}
			} else if (COLOR_ATTRS.has(k)) {
				const c = parseColor(raw);
				if (c) {
					kind = "color";
					v = c;
				}
			} else if (NUM_ATTRS.has(k) && NUM_RE.test(raw)) {
				kind = "num";
				v = [parseFloat(raw)];
			} else if (MATRIX_ATTRS.has(k)) {
				kind = "matrix";
				v = [...parseTransform(raw)];
			}
			if (kind && v) {
				slots.push({ node, attr: k, kind });
				values.push(v);
				add(` ${k}~${kind}`);
			} else add(` ${k}=${norm(raw)}`);
		}
		// a radial gradient without a matrix still needs one in canonical form
		if (radial && n.attrs.gradientTransform === undefined) {
			slots.push({ node, attr: "gradientTransform", kind: "matrix" });
			values.push([radial, 0, 0, radial, 0, 0]);
			add(" gradientTransform~matrix");
		}
		add(">");
		for (const c of n.children) {
			if (isNode(c)) visit(c);
			else add(c);
		}
		add("</>");
	};
	for (const d of a.defs) visit(d);
	const defsCount = index,
		looseDefs = loose.length;
	visit(a.body);
	return { sig, fine, loose, slots, values, defsCount, looseDefs };
}

/** The radius of a user-space radial gradient (0 if not one). */
function radialScale(n: XmlNode): number {
	if (n.attrs.gradientUnits !== "userSpaceOnUse") return 0;
	const r = parseFloat(n.attrs.r ?? "");
	return r > 0 ? r : 0;
}

function parseColor(s: string): number[] | null {
	const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(s);
	if (!m) return null;
	let h = m[1]!;
	if (h.length === 3) h = h[0]! + h[0] + h[1] + h[1] + h[2] + h[2];
	const out = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
	out.push(h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255);
	return out;
}

/** Absolute M/L/Q/Z path data (what Animate writes) as subpaths; null for anything else. */
export function parsePath(d: string): Sub[] | null {
	const t = d.match(PATH_RE);
	if (!t) return null;
	const subs: Sub[] = [];
	let cur: Sub | null = null;
	let cmd = "";
	let x = 0,
		y = 0;
	let i = 0;
	const finish = (closed: boolean) => {
		if (!cur) return;
		const p = cur.pts;
		const n = p.length;
		if (n <= 2) {
			cur = null;
			return;
		}
		const back = Math.abs(p[n - 2]! - p[0]!) < 1e-9 && Math.abs(p[n - 1]! - p[1]!) < 1e-9;
		if (closed && !back) {
			// the closing line, written out
			p.push((p[n - 2]! + p[0]!) / 2, (p[n - 1]! + p[1]!) / 2, p[0]!, p[1]!);
		}
		if (closed || back) {
			// cyclic: the last point is the first again
			p.length -= 2;
			cur.cyclic = true;
		}
		subs.push(cur);
		cur = null;
	};
	while (i < t.length) {
		const tok = t[i]!;
		if (tok.charCodeAt(0) >= 65) {
			i++;
			if (tok === "Z") {
				finish(true);
				cmd = "";
			} else if (tok === "M" || tok === "L" || tok === "Q") cmd = tok;
			else return null;
			continue;
		}
		if (cmd === "M") {
			finish(false);
			x = +t[i++]!;
			y = +t[i++]!;
			cur = { cyclic: false, pts: [x, y] };
			cmd = "L";
		} else if (cmd === "L" && cur) {
			const nx = +t[i++]!,
				ny = +t[i++]!;
			cur.pts.push((x + nx) / 2, (y + ny) / 2, nx, ny);
			x = nx;
			y = ny;
		} else if (cmd === "Q" && cur) {
			const cx = +t[i++]!,
				cy = +t[i++]!;
			x = +t[i++]!;
			y = +t[i++]!;
			cur.pts.push(cx, cy, x, y);
		} else return null;
		if (Number.isNaN(x) || Number.isNaN(y)) return null;
	}
	finish(false);
	return subs;
}

// ---------------------------------------------------------------------------------- matching paths

/** Bounding box of a subpath's points [x0, y0, x1, y1] (a hole and its outline share their centre, not their box). */
function box(s: Sub): number[] {
	const b = [Infinity, Infinity, -Infinity, -Infinity];
	for (let i = 0; i + 1 < s.pts.length; i += 4) {
		const x = s.pts[i]!,
			y = s.pts[i + 1]!;
		if (x < b[0]!) b[0] = x;
		if (y < b[1]!) b[1] = y;
		if (x > b[2]!) b[2] = x;
		if (y > b[3]!) b[3] = y;
	}
	return b;
}

/** `cur`'s subpaths in the order of their nearest counterparts in `prev`. */
function matchSubs(prev: Sub[], cur: Sub[]): Sub[] | null {
	const used = new Array<boolean>(cur.length).fill(false);
	const boxes = cur.map(box);
	const out: Sub[] = [];
	for (const p of prev) {
		const pb = box(p);
		let best = -1,
			bd = Infinity;
		cur.forEach((c, j) => {
			if (used[j] || c.cyclic !== p.cyclic) return;
			const d = cost(boxes[j]!, pb);
			if (d < bd) {
				bd = d;
				best = j;
			}
		});
		if (best < 0) return null;
		used[best] = true;
		out.push(cur[best]!);
	}
	return out;
}

/** Cyclic subpath `s` started at point j, forwards or backwards. */
function rotated(p: number[], j: number, reverse: boolean): number[] {
	const n = p.length / 4;
	const out = new Array<number>(p.length);
	for (let m = 0; m < n; m++) {
		const pi = (reverse ? (((j - m) % n) + n) % n : (j + m) % n) * 4;
		const ci = (reverse ? (((j - m - 1) % n) + n) % n : (j + m) % n) * 4;
		out[m * 4] = p[pi]!;
		out[m * 4 + 1] = p[pi + 1]!;
		out[m * 4 + 2] = p[ci + 2]!;
		out[m * 4 + 3] = p[ci + 3]!;
	}
	return out;
}

function cost(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) {
		const d = a[i]! - b[i]!;
		s += d * d;
	}
	return s;
}

/**
 * `cur` with the layout of `ref` (the same subpath in a neighbouring frame, possibly with more
 * segments): started and directed like it, and with the segments it lacks put back as edges of
 * no length (Animate leaves out edges that have shrunk to nothing). Null if they don't match.
 */
function fitTo(ref: number[], cur: Sub, refCyclic: boolean): number[] | null {
	if (!refCyclic) {
		if (cur.pts.length !== ref.length) return null;
		const back: number[] = [];
		for (let i = cur.pts.length - 2; i >= 0; i -= 2) back.push(cur.pts[i]!, cur.pts[i + 1]!);
		return cost(back, ref) < cost(cur.pts, ref) ? back : cur.pts;
	}
	const n = ref.length / 4,
		m = cur.pts.length / 4;
	// (a few edges a frame; the matching below grows with the fourth power of the edges left out)
	if (m > n || n - m > 8) return null;
	// candidate starts: where cur's points run closest to ref's first three (one point alone is
	// ambiguous where several coincide), both directions
	const p = cur.pts;
	const near: { j: number; reverse: boolean; d: number }[] = [];
	for (const reverse of [false, true])
		for (let j = 0; j < m; j++) {
			let d = 0;
			for (let s = 0; s < Math.min(3, n); s++) {
				const at = (((reverse ? j - s : j + s) % m) + m) % m;
				d += (p[at * 4]! - ref[s * 4]!) ** 2 + (p[at * 4 + 1]! - ref[s * 4 + 1]!) ** 2;
			}
			if (near.length < 6 || d < near[near.length - 1]!.d) {
				near.push({ j, reverse, d });
				near.sort((x, y) => x.d - y.d);
				if (near.length > 6) near.pop();
			}
		}
	let best: number[] | null = null,
		bc = Infinity;
	for (const { j, reverse } of near) {
		const r = insertEdges(ref, rotated(p, j, reverse));
		if (r.cost < bc) {
			bc = r.cost;
			best = r.pts;
		}
	}
	return best;
}

/**
 * Matches the points of cyclic `cur` (m segments, starting where `ref` starts) to `ref`'s n >= m
 * points in order (dynamic programming); each run of ref points cur lacks becomes copies of the
 * cur points on either side, and one of the ref segments between two cur points is the real one.
 */
function insertEdges(ref: number[], cur: number[]): { pts: number[]; cost: number } {
	const n = ref.length / 4,
		m = cur.length / 4,
		g = n - m;
	const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
	const P = (i: number, c: number) => cur[(i % m) * 4 + c]!;
	const Q = (j: number, c: number) => ref[(j % n) * 4 + c]!;
	// cost of cur segment ip -> i covering ref segments jp .. j-1, the real one at `real`
	const span = (ip: number, jp: number, i: number, j: number, real: number) => {
		let c = d2(P(ip, 2), P(ip, 3), Q(real, 2), Q(real, 3));
		for (let t = jp + 1; t < j; t++) c += t <= real ? d2(P(ip, 0), P(ip, 1), Q(t, 0), Q(t, 1)) : d2(P(i, 0), P(i, 1), Q(t, 0), Q(t, 1));
		for (let t = jp; t < j; t++) if (t !== real) c += t < real ? d2(P(ip, 0), P(ip, 1), Q(t, 2), Q(t, 3)) : d2(P(i, 0), P(i, 1), Q(t, 2), Q(t, 3));
		return c;
	};
	// best[i][o]: cur point i at ref point i + o (o = 0..g); i = m is cur point 0 again at ref n
	const W = g + 1;
	const best = new Float64Array((m + 1) * W).fill(Infinity);
	const from = new Int32Array((m + 1) * W);
	const realAt = new Int32Array((m + 1) * W);
	best[0] = d2(P(0, 0), P(0, 1), Q(0, 0), Q(0, 1));
	for (let i = 1; i <= m; i++)
		for (let o = 0; o <= g; o++) {
			const j = i + o;
			if (i === m && j !== n) continue;
			const here = i < m ? d2(P(i, 0), P(i, 1), Q(j, 0), Q(j, 1)) : 0;
			for (let op = 0; op <= o; op++) {
				const prev = best[(i - 1) * W + op]!;
				if (prev === Infinity) continue;
				const jp = i - 1 + op;
				for (let real = jp; real < j; real++) {
					const c = prev + span(i - 1, jp, i, j, real) + here;
					if (c < best[i * W + o]!) {
						best[i * W + o] = c;
						from[i * W + o] = op;
						realAt[i * W + o] = real;
					}
				}
			}
		}
	const total = best[m * W + g]!;
	const pts = new Array<number>(n * 4);
	let o = g;
	for (let i = m; i >= 1; i--) {
		const op = from[i * W + o]!,
			real = realAt[i * W + o]!;
		const jp = i - 1 + op,
			j = i + o;
		for (let t = jp; t < j; t++) {
			const at = t <= real ? i - 1 : i;
			pts[t * 4] = P(at, 0);
			pts[t * 4 + 1] = P(at, 1);
			pts[t * 4 + 2] = t === real ? P(i - 1, 2) : P(at, 0);
			pts[t * 4 + 3] = t === real ? P(i - 1, 3) : P(at, 1);
		}
		o = op;
	}
	return { pts, cost: total };
}

/**
 * Path numbers per frame for one path element, all frames in one layout: subpaths matched frame
 * to frame, each brought to the most segments it has in the run. If a frame doesn't match its
 * neighbour: where to split the run (index into `frames`). `r`: the frames' blend ratios.
 */
function pathRows(frames: Sub[][], r: number[]): { rows: number[][]; shape: Sub[] } | number {
	const ordered: Sub[][] = [frames[0]!];
	for (let k = 1; k < frames.length; k++) {
		const m = matchSubs(ordered[k - 1]!, frames[k]!);
		if (!m) return k;
		ordered.push(m);
	}
	const norm: number[][][] = ordered.map(() => []);
	const shape: Sub[] = [];
	// Each frame is matched to where the two frames before it say it should be: points can move
	// further in a frame than they are apart (a fast turn), the blend is linear in the ratio.
	const expect = (q: number, k: number, step: number) => {
		const a = norm[k - step]![q]!,
			b = norm[k - 2 * step]?.[q];
		const dr = r[k - step]! - r[k - 2 * step]!;
		if (!b || b.length !== a.length || Math.abs(dr) < 1e-9) return a;
		const u = (r[k]! - r[k - step]!) / dr;
		return a.map((v, i) => v + (v - b[i]!) * u);
	};
	for (let q = 0; q < frames[0]!.length; q++) {
		const seq = ordered.map((f) => f[q]!);
		let a = 0;
		for (let k = 1; k < seq.length; k++) if (seq[k]!.pts.length > seq[a]!.pts.length) a = k;
		const cyclic = seq[a]!.cyclic;
		norm[a]![q] = seq[a]!.pts;
		for (let k = a + 1; k < seq.length; k++) {
			const p = fitTo(expect(q, k, 1), seq[k]!, cyclic);
			if (!p) return k;
			norm[k]![q] = p;
		}
		for (let k = a - 1; k >= 0; k--) {
			const p = fitTo(expect(q, k, -1), seq[k]!, cyclic);
			if (!p) return k + 1;
			norm[k]![q] = p;
		}
		shape.push({ cyclic, pts: norm[0]![q]! });
	}
	return { rows: norm.map((f) => f.flat()), shape };
}

// ---------------------------------------------------------------------------------- fitting

/** Largest difference from the frame's value that still counts as the same (rounding). */
function tolerance(slot: Slot, i: number, v: number, digits: number): number {
	const pos = 0.06 + 10 ** -digits;
	switch (slot.kind) {
		case "d":
			return pos;
		case "color":
			return 1.6;
		case "matrix":
			return i < 4 ? 0.002 + 0.002 * Math.abs(v) : pos;
		default:
			return slot.attr === "offset" ? 0.006 : OPACITY_ATTRS.has(slot.attr) ? 0.008 : pos;
	}
}

/** Least-squares start and end values for rows[k] = s + (e - s) * r[k]; null if a frame is off. */
function fitLinear(rows: number[][], r: number[], tol: (i: number, v: number) => number): { s: number[]; e: number[] } | null {
	const n = rows.length;
	let s1 = 0,
		s2 = 0;
	for (const x of r) {
		s1 += x;
		s2 += x * x;
	}
	const det = n * s2 - s1 * s1;
	const width = rows[0]!.length;
	const s = new Array<number>(width),
		e = new Array<number>(width);
	for (let i = 0; i < width; i++) {
		let b0 = 0,
			b1 = 0;
		for (let k = 0; k < n; k++) {
			b0 += rows[k]![i]!;
			b1 += r[k]! * rows[k]![i]!;
		}
		let a: number, b: number;
		if (Math.abs(det) < 1e-12) {
			a = b0 / n;
			b = 0;
		} else {
			a = (s2 * b0 - s1 * b1) / det;
			b = (n * b1 - s1 * b0) / det;
		}
		for (let k = 0; k < n; k++) if (Math.abs(a + b * r[k]! - rows[k]![i]!) > tol(i, rows[k]![i]!)) return null;
		s[i] = a;
		e[i] = a + b;
	}
	return { s, e };
}

/** The part for frames [from, to), null if they are no blend, or the frame to split the run at. */
function fitRun(arts: Artwork[], scans: Scan[], ratios: number[], from: number, to: number, start: number, digits: number, log?: (m: string) => void): MorphPart | number | null {
	const first = scans[from]!;
	const rows: number[][][] = [];
	const shapes: Sub[][] = [];
	for (let i = 0; i < first.slots.length; i++) {
		const vals = scans.slice(from, to).map((s) => s.values[i]!);
		if (first.slots[i]!.kind === "d") {
			const p = pathRows(vals as Sub[][], ratios.slice(from, to));
			if (typeof p === "number") {
				log?.(`frames [${from},${to}): paths of frame ${from + p} don't match up`);
				return from + p;
			}
			rows.push(p.rows);
			shapes[i] = p.shape;
		} else rows.push(vals as number[][]);
	}
	const tol = (slot: Slot) => (i: number, v: number) => tolerance(slot, i, v, digits);
	let r = ratios.slice(from, to);
	let own: Track | undefined;
	const fitD = (rr: number[]) => first.slots.map((slot, i) => (slot.kind === "d" ? fitLinear(rows[i]!, rr, tol(slot)) : null));
	let dFits = fitD(r);
	if (first.slots.some((slot, i) => slot.kind === "d" && !dFits[i])) {
		// not the tween's ease (an ease Animate doesn't tell): each frame's ratio from the shapes
		log?.(`frames [${from},${to}): paths don't follow the ease`);
		const free = freeRatio(rows, first.slots);
		if (!free) return null;
		r = free;
		dFits = fitD(r);
		if (first.slots.some((slot, i) => slot.kind === "d" && !dFits[i])) {
			log?.(`frames [${from},${to}): paths are no blend`);
			return null;
		}
		const keys: Track = r.map((v, k) => ({ t: start + from + k, v, ease: "linear" as const }));
		keys[keys.length - 1]!.ease = "hold";
		let span = 1e-9;
		first.slots.forEach((slot, i) => {
			const f = dFits[i];
			if (slot.kind === "d" && f) for (let x = 0; x < f.s.length; x++) span = Math.max(span, Math.abs(f.e[x]! - f.s[x]!));
		});
		own = simplify(keys, tolerance({ node: 0, attr: "d", kind: "d" }, 0, 0, digits) / span / 2);
	}
	const channels: MorphChannel[] = [];
	let smil = true;
	let turns = false;
	first.slots.forEach((slot, i) => {
		const ch: MorphChannel = { node: slot.node, attr: slot.attr, kind: slot.kind };
		if (slot.kind === "d") Object.assign(ch, pathChannel(shapes[i]!, dFits[i]!));
		else {
			const fit = fitLinear(rows[i]!, r, tol(slot));
			if (fit) {
				ch.s = fit.s;
				ch.e = fit.e;
			} else ch.f = rows[i]!;
		}
		if (slot.kind === "matrix") {
			const rs = ch.s ? sharedRotation(ch.s as unknown as Mat, ch.e as unknown as Mat) : null;
			// (WebKit draws an animated pattern that is turned and scaled a little off: patterns that
			// turn keep their frames; gradients animate)
			const pattern = slot.attr === "patternTransform";
			if (rs && !(pattern && (Math.abs(rs[0]) > 1e-6 || Math.abs(rs[1]) > 1e-6))) ch.rs = rs;
			else if (pattern) smil = false;
			else turns = true;
		}
		channels.push(ch);
	});
	return { from, to, art: arts[from]!, channels, ratio: own, smil: smil && !turns, ...(turns ? { turns } : {}) };
}

/** Each frame's position between the run's first and last frame, from all path numbers. */
function freeRatio(rows: number[][][], slots: Slot[]): number[] | null {
	const n = rows[0]!.length;
	const frame = (k: number) => slots.flatMap((s, i) => (s.kind === "d" ? rows[i]![k]! : []));
	const a = frame(0),
		b = frame(n - 1);
	let dd = 0;
	for (let i = 0; i < a.length; i++) dd += (b[i]! - a[i]!) ** 2;
	if (dd < 1e-6) return null;
	const out: number[] = [];
	for (let k = 0; k < n; k++) {
		const v = frame(k);
		let p = 0;
		for (let i = 0; i < a.length; i++) p += (v[i]! - a[i]!) * (b[i]! - a[i]!);
		out.push(p / dd);
	}
	return out;
}

/** A d channel: commands and numbers, lines where the segment is straight at both ends. */
function pathChannel(subs: Sub[], fit: { s: number[]; e: number[] }): Pick<MorphChannel, "cmds" | "s" | "e"> {
	let cmds = "";
	const s: number[] = [],
		e: number[] = [];
	let off = 0;
	for (const sub of subs) {
		const len = sub.pts.length;
		const at = (arr: number[], i: number) => arr[off + (sub.cyclic ? i % len : i)]!;
		const segs = sub.cyclic ? len / 4 : (len - 2) / 4;
		cmds += "M";
		s.push(at(fit.s, 0), at(fit.s, 1));
		e.push(at(fit.e, 0), at(fit.e, 1));
		for (let k = 0; k < segs; k++) {
			const b = k * 4;
			const straight = (arr: number[]) =>
				Math.abs(at(arr, b + 2) - (at(arr, b) + at(arr, b + 4)) / 2) < 0.01 && Math.abs(at(arr, b + 3) - (at(arr, b + 1) + at(arr, b + 5)) / 2) < 0.01;
			if (straight(fit.s) && straight(fit.e)) cmds += "L";
			else {
				cmds += "Q";
				s.push(at(fit.s, b + 2), at(fit.s, b + 3));
				e.push(at(fit.e, b + 2), at(fit.e, b + 3));
			}
			s.push(at(fit.s, b + 4), at(fit.s, b + 5));
			e.push(at(fit.e, b + 4), at(fit.e, b + 5));
		}
		if (sub.cyclic) cmds += "Z";
		off += len;
	}
	return { cmds, s, e };
}

/** Rotation and skew both matrices share (then a blend only scales and moves), else null. */
function sharedRotation(a: Mat, b: Mat): [number, number] | null {
	const pa = toProps(a, { x: 0, y: 0 }),
		pb = toProps(b, { x: 0, y: 0 });
	if (Math.abs(nearestAngle(pb.rot, pa.rot) - pa.rot) > 0.01 || Math.abs(pb.skw - pa.skw) > 0.01) return null;
	// a scale through zero flips the decomposition
	if (Math.sign(pa.sx) !== Math.sign(pb.sx) || Math.sign(pa.sy) !== Math.sign(pb.sy)) return null;
	return [pa.rot, pa.skw];
}

/** The scale of a matrix channel value whose rotation and skew are fixed (`rs`), for SMIL. */
export function matrixScale(m: number[]): [number, number] {
	const p = toProps(m as unknown as Mat, { x: 0, y: 0 });
	return [p.sx, p.sy];
}

// ---------------------------------------------------------------------------------- the keyframe

/**
 * Does the keyframe (scan `s0` of `art0`) show the part's drawing at ratio r0? Then the part can
 * start there. Same structure: every value is compared. Otherwise (the keyframe's shapes sit in a
 * group of their own, say), the outlines and colours of the whole drawing are.
 */
function startsWith(part: MorphPart, s1: Scan, s0: Scan, art0: Artwork, r0: number, digits: number, log?: (m: string) => void): boolean {
	const no = (why: string) => {
		log?.("frame 0: " + why);
		return false;
	};
	const extra: number[][] = [];
	const same = s0.loose === s1.loose;
	// defs (gradients...) usually keep their structure even when the body changes
	const defsSame = same || (s0.defsCount === s1.defsCount && s0.loose.slice(0, s0.looseDefs) === s1.loose.slice(0, s1.looseDefs));
	const byKey = new Map(s0.slots.map((sl, i) => [sl.node + "|" + sl.attr, s0.values[i]!]));
	for (const ch of part.channels) {
		const inDefs = ch.node < s1.defsCount;
		if (!same && !(inDefs && defsSame)) continue;
		// (positions in the defs are in the user space of what uses them, which differs then)
		if (!same && (ch.kind === "matrix" || (ch.kind === "num" && ch.attr !== "offset" && !OPACITY_ATTRS.has(ch.attr)))) continue;
		const v = byKey.get(ch.node + "|" + ch.attr);
		if (!v) return no("no " + ch.attr);
		if (ch.kind === "d") {
			const tol = 0.25 + 10 ** -digits;
			const dist = outlineDistance(subsAt(ch, r0), v as Sub[], tol);
			if (dist > tol) return no(`other outline (${dist.toFixed(3)} px)`);
			continue;
		}
		const nums = v as number[];
		if (ch.f) {
			extra[part.channels.indexOf(ch)] = nums;
			continue;
		}
		const slot = { node: ch.node, attr: ch.attr, kind: ch.kind };
		for (let j = 0; j < nums.length; j++) {
			const want = ch.s![j]! + (ch.e![j]! - ch.s![j]!) * r0;
			if (Math.abs(want - nums[j]!) > tolerance(slot, j, nums[j]!, digits)) return no(`${ch.attr} ${nums[j]} instead of ${want}`);
		}
	}
	if (!same) {
		// channels in the body: compare the drawings as a whole
		if (part.channels.some((ch, i) => ch.f && extra[i] === undefined)) return no("unknown values");
		const a = summary(part.art, part.channels, r0),
			b = summary(art0, [], 0);
		const tol = 0.25 + 10 ** -digits;
		if (!a.box.every((x, i) => Math.abs(x - b.box[i]!) <= tol)) return no(`box ${a.box.map((x) => x.toFixed(2))} instead of ${b.box.map((x) => x.toFixed(2))}`);
		if (a.colors.length !== b.colors.length || a.colors.some((c, i) => c.some((x, j) => Math.abs(x - b.colors[i]![j]!) > 1.6))) return no("other colours");
	}
	part.channels.forEach((ch, i) => {
		if (ch.f) ch.f = [extra[i]!, ...ch.f];
	});
	return true;
}

/** Bounding box of the outlines (all transforms applied) and the solid paint colours, in order. */
function summary(art: Artwork, channels: MorphChannel[], r: number): { box: number[]; colors: number[][] } {
	const byNode = new Map<number, MorphChannel[]>();
	for (const ch of channels) (byNode.get(ch.node) ?? byNode.set(ch.node, []).get(ch.node)!).push(ch);
	const box = [Infinity, Infinity, -Infinity, -Infinity];
	const colors: number[][] = [];
	let index = 0;
	const countDefs = (n: XmlNode) => {
		index++;
		for (const c of n.children) if (isNode(c)) countDefs(c);
	};
	art.defs.forEach(countDefs);
	const visit = (n: XmlNode, m: Mat) => {
		const chs = byNode.get(index++);
		const val = (attr: string) => chs?.find((c) => c.attr === attr);
		const tch = val("transform");
		const t = tch ? (channelNumbers(tch, r, 0) as unknown as Mat) : n.attrs.transform ? parseTransform(n.attrs.transform) : null;
		if (t) m = concat(t, m);
		if (n.name === "path") {
			for (const attr of ["fill", "stroke"]) {
				const ch = val(attr);
				const c = ch ? channelNumbers(ch, r, 0) : parseColor(n.attrs[attr] ?? "");
				if (c) colors.push(c);
			}
			const dch = val("d");
			const subs = dch ? subsAt(dch, r) : parsePath(n.attrs.d ?? "");
			for (const line of outline(subs ?? [], 1))
				for (let i = 0; i + 1 < line.length; i += 2) {
					const p = apply(m, { x: line[i]!, y: line[i + 1]! });
					box[0] = Math.min(box[0]!, p.x);
					box[1] = Math.min(box[1]!, p.y);
					box[2] = Math.max(box[2]!, p.x);
					box[3] = Math.max(box[3]!, p.y);
				}
		}
		for (const c of n.children) if (isNode(c)) visit(c, m);
	};
	visit(art.body, [1, 0, 0, 1, 0, 0]);
	return { box, colors };
}

/** A d channel's subpaths at ratio r. */
function subsAt(ch: MorphChannel, r: number): Sub[] {
	const out: Sub[] = [];
	let cur: Sub | null = null;
	let i = 0;
	let x = 0,
		y = 0;
	const num = () => {
		const v = ch.s![i]! + (ch.e![i]! - ch.s![i]!) * r;
		i++;
		return v;
	};
	for (const c of ch.cmds!) {
		if (c === "M") {
			x = num();
			y = num();
			cur = { cyclic: false, pts: [x, y] };
			out.push(cur);
		} else if (c === "L") {
			const nx = num(),
				ny = num();
			cur!.pts.push((x + nx) / 2, (y + ny) / 2, nx, ny);
			x = nx;
			y = ny;
		} else if (c === "Q") {
			cur!.pts.push(num(), num());
			x = num();
			y = num();
			cur!.pts.push(x, y);
		} else if (c === "Z") {
			cur!.cyclic = true;
			cur!.pts.length -= 2;
		}
	}
	return out;
}

/** Points along the outlines, at most `step` apart: [x, y, x, y, ...] per subpath. */
function outline(subs: Sub[], step: number): number[][] {
	return subs.map((s) => {
		const p = s.pts;
		const segs = s.cyclic ? p.length / 4 : (p.length - 2) / 4;
		const pt = (i: number) => (s.cyclic ? i % p.length : i);
		const out: number[] = [p[0]!, p[1]!];
		for (let k = 0; k < segs; k++) {
			const b = k * 4;
			const x0 = p[pt(b)]!,
				y0 = p[pt(b + 1)]!,
				cx = p[pt(b + 2)]!,
				cy = p[pt(b + 3)]!,
				x1 = p[pt(b + 4)]!,
				y1 = p[pt(b + 5)]!;
			const len = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
			const m = Math.max(1, Math.ceil(len / step));
			for (let j = 1; j <= m; j++) {
				const t = j / m,
					u = 1 - t;
				out.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
			}
		}
		return out;
	});
}

/** Every point of each outline lies within `tol` of the other outline. */
/** How far the outlines are apart at most (each point to the other outline), up to `tol`. */
function outlineDistance(a: Sub[], b: Sub[], tol: number): number {
	const pa = outline(a, 1),
		pb = outline(b, 1);
	return Math.max(near(pa, pb, tol), near(pb, pa, tol));
}

/** The largest distance of a point of `from` to the polylines `to` (Infinity once past `tol`). */
function near(from: number[][], to: number[][], tol: number): number {
	const cell = 8;
	const grid = new Map<string, number[]>();
	for (const line of to)
		for (let i = 0; i + 3 < line.length; i += 2) {
			const x0 = Math.floor((Math.min(line[i]!, line[i + 2]!) - tol) / cell),
				x1 = Math.floor((Math.max(line[i]!, line[i + 2]!) + tol) / cell),
				y0 = Math.floor((Math.min(line[i + 1]!, line[i + 3]!) - tol) / cell),
				y1 = Math.floor((Math.max(line[i + 1]!, line[i + 3]!) + tol) / cell);
			for (let gx = x0; gx <= x1; gx++)
				for (let gy = y0; gy <= y1; gy++) {
					const key = gx + "," + gy;
					const list = grid.get(key) ?? grid.set(key, []).get(key)!;
					list.push(line[i]!, line[i + 1]!, line[i + 2]!, line[i + 3]!);
				}
		}
	let worst = 0;
	for (const line of from) {
		// a subpath shrunk to a point (a shape growing from nothing) draws nothing
		let w = 0;
		for (let i = 2; i < line.length; i += 2) w = Math.max(w, Math.abs(line[i]! - line[0]!), Math.abs(line[i + 1]! - line[1]!));
		if (w < tol) continue;
		for (let i = 0; i + 1 < line.length; i += 2) {
			const x = line[i]!,
				y = line[i + 1]!;
			const segs = grid.get(Math.floor(x / cell) + "," + Math.floor(y / cell));
			if (!segs) return Infinity;
			let best = Infinity;
			for (let j = 0; j < segs.length; j += 4) best = Math.min(best, segDist(x, y, segs[j]!, segs[j + 1]!, segs[j + 2]!, segs[j + 3]!));
			if (best > tol) return best;
			worst = Math.max(worst, best);
		}
	}
	return worst;
}

function segDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
	const dx = x1 - x0,
		dy = y1 - y0;
	const l = dx * dx + dy * dy;
	const t = l ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l)) : 0;
	return Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
}

// ---------------------------------------------------------------------------------- values

/** Numbers of a channel at blend ratio r, or (channels with per-frame values) at frame position fi. */
export function channelNumbers(ch: MorphChannel, r: number, fi: number): number[] {
	if (ch.s) return ch.s.map((v, i) => v + (ch.e![i]! - v) * r);
	const f = ch.f!;
	const k = Math.max(0, Math.min(f.length - 1, fi));
	const k0 = Math.floor(k),
		k1 = Math.min(f.length - 1, k0 + 1),
		u = k - k0;
	return f[k0]!.map((v, i) => v + (f[k1]![i]! - v) * u);
}

/** The attribute text of a channel's numbers. */
export function channelText(ch: MorphChannel, v: number[], digits: number): string {
	switch (ch.kind) {
		case "d": {
			let out = "";
			let i = 0;
			let prevNum = false,
				prevDot = false;
			for (const c of ch.cmds!) {
				out += c;
				prevNum = false;
				const n = c === "Q" ? 4 : c === "Z" ? 0 : 2;
				for (let j = 0; j < n; j++) {
					const s = fmt(v[i++]!, digits);
					const dot = s.indexOf(".") >= 0;
					// a number needs a space before it unless it starts with "-", or with "." after one with a "."
					if (prevNum && s[0] !== "-" && !(s[0] === "." && prevDot)) out += " ";
					out += s;
					prevNum = true;
					prevDot = dot;
				}
			}
			return out;
		}
		case "color": {
			const hex = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
			const a = Math.round(v[3]!);
			return "#" + hex(v[0]!) + hex(v[1]!) + hex(v[2]!) + (a < 255 ? hex(a) : "");
		}
		case "matrix":
			return fmtMatrix(v as unknown as Mat, digits) || "matrix(1 0 0 1 0 0)";
		default:
			return fmt(v[0]!, ch.attr === "offset" || OPACITY_ATTRS.has(ch.attr) ? 4 : Math.max(digits, 2));
	}
}

/** True if the channel's value changes over the part. */
export function channelVaries(ch: MorphChannel): boolean {
	if (ch.s) return ch.s.some((v, i) => Math.abs(ch.e![i]! - v) > 1e-9);
	return ch.f!.some((row) => row.some((v, i) => Math.abs(v - ch.f![0]![i]!) > 1e-9));
}

/** Elements of a drawing in the order channels count them (pre-order: defs, then body). */
export function templateNodes(defs: XmlNode[], body: XmlNode): XmlNode[] {
	const out: XmlNode[] = [];
	const visit = (n: XmlNode) => {
		out.push(n);
		for (const c of n.children) if (isNode(c)) visit(c);
	};
	for (const d of defs) visit(d);
	visit(body);
	return out;
}

/** For tests. */
export const internals = { pathRows, fitLinear, insertEdges, outlineDistance };
