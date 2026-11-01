/**
 * Motion guides as paths (roadmap package 8). A classic tween on a guided layer moves its
 * transformation point along the guide's stroke; written as the path itself (SMIL
 * `animateMotion`, Lottie position keys with spatial tangents) it is exact at any frame rate and
 * smaller than a position per frame.
 *
 * Measured in Animate 2024 (the user guide's path demo, a curve of six quadratic pieces):
 * - the point stays on the stroke (within 0.08 px);
 * - its pace is nearly but not exactly uniform along the arc: the time each piece gets is up to
 *   ±4 % off its share of the length, and inside a sharply bent piece it runs ~8 % faster through
 *   the bend. No model matched within 0.1 px (true arc length 7.3 px off; chord, control polygon,
 *   Simpson, Gauss, flattening into 1–64 chords, knots fitted per piece 0.5–2 px) — so the pace
 *   is read from Animate's frames: the distance along the curve at every frame, simplified
 *   within the tolerance. The point stays on the curve between frames too;
 * - *Orient to path*: rotation = the tween's own rotation + (tangent − tangent at the start) −
 *   progress × (the tangent's change over the whole tween) — the orientation follows the curve
 *   and still ends at the end keyframe's rotation. Where that doesn't hold, the rotation besides
 *   the tangent is taken from the frames too.
 */
import { evalBezier, subBezier } from "./easing.ts";
import { fmt, nearestAngle, parseTransform } from "./geom.ts";
import type { Mat } from "./model.ts";
import { simplify, type Ease, type Key, type Track } from "./tracks.ts";

/** One piece of the guide: a line, quadratic or cubic, as flat [x0, y0, x1, y1, ...]. */
interface Piece {
	pts: number[];
	/** Arc length from the guide's start to this piece's start. */
	start: number;
	len: number;
	/** Arc length at parameter i / STEPS (cumulative from the piece's start). */
	table: Float64Array;
}

export interface GuideCurve {
	pieces: Piece[];
	length: number;
	/** Path data in the timeline's space (absolute M L Q C). */
	d: string;
}

const STEPS = 256;

/**
 * The guide's curve from the atlas SVG of a guide layer's drawing: one stroke without fill, a
 * single open path, in the space of the timeline it is drawn on. Anything else (fills, several strokes, closed or branching paths) is null:
 * those guides keep Animate's frames.
 */
export function guideCurve(svg: string, offset?: { x: number; y: number }): GuideCurve | null {
	const paths = [...svg.matchAll(/<path\b([^>]*)\/?>/g)].map((m) => m[1]!);
	if (paths.length !== 1) return null;
	const attrs = paths[0]!;
	const fill = /\sfill="([^"]*)"/.exec(attrs)?.[1];
	if (fill !== undefined && fill !== "none") return null;
	if (!/\sstroke="(?!none)[^"]+"/.test(attrs)) return null;
	const d = /\sd="([^"]*)"/.exec(attrs)?.[1];
	if (!d) return null;
	// the <use> of the definition sits in a group with Animate's matrix (and maybe its own)
	// (minus where Animate pasted the drawing into the atlas)
	let m: Mat = [1, 0, 0, 1, -(offset?.x ?? 0), -(offset?.y ?? 0)];
	for (const g of svg.matchAll(/<(?:g|use)\b[^>]*\stransform="([^"]*)"/g)) m = mul(m, parseTransform(g[1]));
	const pieces: Piece[] = [];
	const tok = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
	let i = 0,
		cmd = "",
		x = 0,
		y = 0,
		moved = false;
	const num = () => +tok[i++]!;
	const pt = (): [number, number] => {
		const a = num(),
			b = num();
		return [m[0] * a + m[2] * b + m[4], m[1] * a + m[3] * b + m[5]];
	};
	while (i < tok.length) {
		if (/[A-Za-z]/.test(tok[i]!)) cmd = tok[i++]!;
		if (cmd === "M") {
			// a second subpath: not one curve
			if (moved) return null;
			[x, y] = pt();
			moved = true;
			cmd = "L";
		} else if (cmd === "L") {
			const p = pt();
			pieces.push(piece([x, y, ...p]));
			[x, y] = p;
		} else if (cmd === "Q") {
			const c = pt(),
				p = pt();
			pieces.push(piece([x, y, ...c, ...p]));
			[x, y] = p;
		} else if (cmd === "C") {
			const c1 = pt(),
				c2 = pt(),
				p = pt();
			pieces.push(piece([x, y, ...c1, ...c2, ...p]));
			[x, y] = p;
		} else return null; // Z (closed) or relative commands Animate doesn't write
	}
	const kept = pieces.filter((p) => p.len > 1e-9);
	if (!kept.length) return null;
	let s = 0;
	for (const p of kept) {
		p.start = s;
		s += p.len;
	}
	const out = kept.map((p) => p.pts);
	const n = (v: number) => fmt(v, 3);
	const dd =
		`M${n(out[0]![0]!)} ${n(out[0]![1]!)}` + out.map((p) => (p.length === 4 ? "L" : p.length === 6 ? "Q" : "C") + p.slice(2).map(n).join(" ")).join("");
	return { pieces: kept, length: s, d: dd };
}

function mul(a: Mat, b: Mat): Mat {
	return [
		a[0] * b[0] + a[2] * b[1],
		a[1] * b[0] + a[3] * b[1],
		a[0] * b[2] + a[2] * b[3],
		a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4],
		a[1] * b[4] + a[3] * b[5] + a[5],
	];
}

function piece(pts: number[]): Piece {
	const table = new Float64Array(STEPS + 1);
	let [px, py] = at(pts, 0),
		l = 0;
	for (let j = 1; j <= STEPS; j++) {
		const [qx, qy] = at(pts, j / STEPS);
		l += Math.hypot(qx - px, qy - py);
		table[j] = l;
		px = qx;
		py = qy;
	}
	return { pts, start: 0, len: l, table };
}

function at(p: number[], t: number): [number, number] {
	const u = 1 - t;
	if (p.length === 4) return [u * p[0]! + t * p[2]!, u * p[1]! + t * p[3]!];
	if (p.length === 6) return [u * u * p[0]! + 2 * u * t * p[2]! + t * t * p[4]!, u * u * p[1]! + 2 * u * t * p[3]! + t * t * p[5]!];
	const a = u * u * u,
		b = 3 * u * u * t,
		c = 3 * u * t * t,
		e = t * t * t;
	return [a * p[0]! + b * p[2]! + c * p[4]! + e * p[6]!, a * p[1]! + b * p[3]! + c * p[5]! + e * p[7]!];
}

function tangent(p: number[], t: number): number {
	const h = 1e-5;
	let a = at(p, Math.max(0, t - h)),
		b = at(p, Math.min(1, t + h));
	// a zero-length derivative at an end (a control point on the end point): look further in
	if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-12) {
		a = at(p, Math.max(0, t - 1e-2));
		b = at(p, Math.min(1, t + 1e-2));
	}
	return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/** The piece and its parameter at arc length s along the guide. */
function locate(c: GuideCurve, s: number): { p: Piece; t: number } {
	let k = 0;
	while (k < c.pieces.length - 1 && s > c.pieces[k]!.start + c.pieces[k]!.len) k++;
	const p = c.pieces[k]!;
	const local = Math.min(p.len, Math.max(0, s - p.start));
	let lo = 0,
		hi = STEPS;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (p.table[mid]! < local) lo = mid;
		else hi = mid;
	}
	const l0 = p.table[lo]!,
		l1 = p.table[hi]!;
	return { p, t: (lo + (l1 > l0 ? (local - l0) / (l1 - l0) : 0)) / STEPS };
}

export function pointAtLength(c: GuideCurve, s: number): [number, number] {
	const { p, t } = locate(c, s);
	return at(p.pts, t);
}

/** The guide's direction at arc length s (degrees, as Animate's rotation: clockwise from +x). */
export function angleAtLength(c: GuideCurve, s: number): number {
	const { p, t } = locate(c, s);
	return tangent(p.pts, t);
}

/** Arc length of the guide's point nearest to (x, y), and the distance to it. */
export function project(c: GuideCurve, x: number, y: number): { s: number; dist: number } {
	let best = Infinity,
		bs = 0;
	for (const p of c.pieces) {
		let bj = 0,
			bd = Infinity;
		for (let j = 0; j <= STEPS; j++) {
			const [qx, qy] = at(p.pts, j / STEPS);
			const d = (qx - x) ** 2 + (qy - y) ** 2;
			if (d < bd) {
				bd = d;
				bj = j;
			}
		}
		// refine between the neighbouring steps
		let lo = Math.max(0, bj - 1) / STEPS,
			hi = Math.min(STEPS, bj + 1) / STEPS;
		for (let it = 0; it < 40; it++) {
			const a = lo + (hi - lo) / 3,
				b = hi - (hi - lo) / 3;
			const [ax, ay] = at(p.pts, a),
				[bx, by] = at(p.pts, b);
			if ((ax - x) ** 2 + (ay - y) ** 2 < (bx - x) ** 2 + (by - y) ** 2) hi = b;
			else lo = a;
		}
		const t = (lo + hi) / 2;
		const [qx, qy] = at(p.pts, t);
		const d = Math.hypot(qx - x, qy - y);
		if (d < best) {
			best = d;
			const f = t * STEPS,
				j = Math.min(STEPS - 1, Math.floor(f));
			bs = p.start + p.table[j]! + (p.table[j + 1]! - p.table[j]!) * (f - j);
		}
	}
	return { s: bs, dist: best };
}

export interface GuidedFit {
	/** Distance along the guide as a share of its length, over the tween's frames 0..duration. */
	at: Track;
	/** Orient to path: the rotation besides the guide's direction, over the same frames. */
	rot?: Track;
}

/**
 * Fits one guided tween: `pos` is the transformation point at frames 0..duration (the last one
 * the end keyframe's); `tol` is the pace's tolerance along the curve, `near` how far beside the
 * curve a frame may be (Animate follows its own approximation of a curve: up to 0.14 px beside
 * the true one in tight bends, measured on f60). `ease`: the tween's position ease as progress
 * keys over 0..duration (as the program builds them): the pace is then simplified against the
 * eased progress, with the ease between the keys — far fewer keys for an eased tween. With
 * `orient`, the rotations at the same frames and the rotation's ease. Null when the point leaves
 * the curve or turns back on it: those tweens keep Animate's frames.
 */
export function fitGuided(
	c: GuideCurve,
	pos: [number, number][],
	tol: number,
	orient?: { rot: number[]; ease: Track; tol: number },
	near = tol,
	ease?: Track,
): GuidedFit | null {
	const dur = pos.length - 1;
	if (dur < 1) return null;
	const s: number[] = [];
	for (const [x, y] of pos) {
		const p = project(c, x, y);
		if (p.dist > near) return null;
		s.push(p.s);
	}
	const dir = Math.sign(s[dur]! - s[0]!);
	if (!dir) return null;
	for (let f = 1; f <= dur; f++) if ((s[f]! - s[f - 1]!) * dir < -tol) return null;
	// on the curve the distance along it is the position: its error is the position's error
	const at =
		(ease && easedPace(c, s, ease, tol)) ??
		simplify(
			s.map((v, f) => ({ t: f, v: v / c.length, ease: (f === dur ? "hold" : "linear") as Ease })),
			tol / c.length,
		);
	if (!orient) return { at };
	const tan: number[] = [];
	for (const sv of s) tan.push(tan.length ? nearestAngle(angleAtLength(c, sv), tan[tan.length - 1]!) : angleAtLength(c, sv));
	// the rotation besides the curve's direction, unwrapped
	const rest: number[] = [];
	for (let f = 0; f <= dur; f++) {
		const v = orient.rot[f]! - tan[f]!;
		rest.push(rest.length ? nearestAngle(v, rest[f - 1]!) : v);
	}
	// Animate's rule: that part tweens with the rotation's ease from the start's to the end's
	const r0 = rest[0]!,
		turn = rest[dur]! - r0;
	let rule = true;
	for (let f = 0; f <= dur && rule; f++) if (Math.abs(r0 + valueOf(orient.ease, f) * turn - rest[f]!) > orient.tol) rule = false;
	const rot: Key[] = rule
		? orient.ease.map((k) => ({ ...k, v: r0 + k.v * turn }))
		: simplify(
				rest.map((v, f) => ({ t: f, v, ease: (f === dur ? "hold" : "linear") as Ease })),
				orient.tol / 2,
			);
	return { at, rot };
}

function valueOf(track: Track, t: number): number {
	if (t <= track[0]!.t) return track[0]!.v;
	for (let i = 0; i < track.length - 1; i++) {
		const a = track[i]!,
			b = track[i + 1]!;
		if (t <= b.t) {
			if (a.ease === "hold") return t < b.t ? a.v : b.v;
			const x = (t - a.t) / (b.t - a.t);
			return a.v + (b.v - a.v) * (a.ease === "linear" ? x : evalBezier(a.ease, x));
		}
	}
	return track[track.length - 1]!.v;
}

/** A key of the motion in space (Lottie position): the point, and the cubic to the next key. */
export interface SpatialKey {
	t: number;
	s: [number, number];
	/** Out tangent (from `s`) and in tangent (from the next key's point) of the curve to the next key. */
	to?: [number, number];
	ti?: [number, number];
	/** Timing to the next key, as distance along the curve: linear, a cubic ease, or "hold". */
	ease: Ease;
}

/**
 * The motion as keys in space: at every key of `at` (distance along the curve, share of its
 * length, linear or held between keys) and wherever the motion passes from one piece of the
 * curve to the next; between two keys the piece's part, exactly, as a cubic. Players that move
 * along such a cubic by its arc length (Lottie) then follow the curve as the SVG does.
 */
export function spatialKeys(c: GuideCurve, at: { t: number; v: number; ease: Ease }[]): SpatialKey[] {
	const out: SpatialKey[] = [];
	const bounds = c.pieces.slice(1).map((p) => p.start);
	for (let i = 0; i < at.length; i++) {
		const a = at[i]!,
			b = at[i + 1];
		const sa = a.v * c.length;
		if (!b || a.ease === "hold" || Math.abs(b.v - a.v) * c.length < 1e-9) {
			out.push({ t: a.t, s: pointAtLength(c, sa), ease: "hold" });
			continue;
		}
		const sb = b.v * c.length;
		// where the motion crosses piece boundaries: the time from the key's ease, which is cut there
		const cross = bounds.filter((x) => x > Math.min(sa, sb) + 1e-9 && x < Math.max(sa, sb) - 1e-9).sort((x, y) => (x - y) * Math.sign(sb - sa));
		const stops = [sa, ...cross, sb];
		const times = stops.map((v, j) => (j === 0 ? 0 : j === stops.length - 1 ? 1 : timeOf(a.ease, (v - sa) / (sb - sa))));
		for (let j = 0; j < stops.length - 1; j++) {
			const s0 = stops[j]!,
				s1 = stops[j + 1]!;
			const cub = cubicBetween(c, s0, s1);
			const x0 = times[j]!,
				x1 = times[j + 1]!;
			out.push({
				t: a.t + (b.t - a.t) * x0,
				s: [cub[0]!, cub[1]!],
				to: [cub[2]! - cub[0]!, cub[3]! - cub[1]!],
				ti: [cub[4]! - cub[6]!, cub[5]! - cub[7]!],
				ease: a.ease === "linear" || (x0 <= 0 && x1 >= 1) ? a.ease : subBezier(a.ease, x0, x1).bezier,
			});
		}
	}
	return out;
}

/** The curve between distances s0 and s1 (inside one piece) as a cubic [x0 y0 x1 y1 x2 y2 x3 y3]. */
function cubicBetween(c: GuideCurve, s0: number, s1: number): number[] {
	const mid = (s0 + s1) / 2;
	let k = 0;
	while (k < c.pieces.length - 1 && mid > c.pieces[k]!.start + c.pieces[k]!.len) k++;
	const p = c.pieces[k]!;
	const t0 = paramAt(p, s0 - p.start),
		t1 = paramAt(p, s1 - p.start);
	const sub = part(p.pts, Math.min(t0, t1), Math.max(t0, t1));
	const cubic = toCubic(sub);
	return t0 <= t1 ? cubic : [cubic[6]!, cubic[7]!, cubic[4]!, cubic[5]!, cubic[2]!, cubic[3]!, cubic[0]!, cubic[1]!];
}

function paramAt(p: Piece, local: number): number {
	const l = Math.min(p.len, Math.max(0, local));
	let lo = 0,
		hi = STEPS;
	while (hi - lo > 1) {
		const m = (lo + hi) >> 1;
		if (p.table[m]! < l) lo = m;
		else hi = m;
	}
	const l0 = p.table[lo]!,
		l1 = p.table[hi]!;
	let t = (lo + (l1 > l0 ? (l - l0) / (l1 - l0) : 0)) / STEPS;
	// refine against the exact arc length (Gauss–Legendre), a few Newton steps
	for (let it = 0; it < 4; it++) {
		const f = arc(p.pts, t) - l;
		const d = speed(p.pts, t);
		if (d < 1e-12) break;
		t = Math.min(1, Math.max(0, t - f / d));
	}
	return t;
}

const GL = [
	[-0.906179845938664, 0.2369268850561891],
	[-0.5384693101056831, 0.4786286704993665],
	[0, 0.5688888888888889],
	[0.5384693101056831, 0.4786286704993665],
	[0.906179845938664, 0.2369268850561891],
];

/** Arc length of a piece from 0 to t (5-point Gauss–Legendre in two halves). */
function arc(pts: number[], t: number): number {
	let s = 0;
	for (const [a0, a1] of [
		[0, t / 2],
		[t / 2, t],
	] as [number, number][])
		for (const [x, w] of GL) s += ((a1 - a0) / 2) * w! * speed(pts, ((a1 - a0) / 2) * x! + (a0 + a1) / 2);
	return s;
}

function speed(p: number[], t: number): number {
	const u = 1 - t;
	let dx: number, dy: number;
	if (p.length === 4) {
		dx = p[2]! - p[0]!;
		dy = p[3]! - p[1]!;
	} else if (p.length === 6) {
		dx = 2 * u * (p[2]! - p[0]!) + 2 * t * (p[4]! - p[2]!);
		dy = 2 * u * (p[3]! - p[1]!) + 2 * t * (p[5]! - p[3]!);
	} else {
		dx = 3 * u * u * (p[2]! - p[0]!) + 6 * u * t * (p[4]! - p[2]!) + 3 * t * t * (p[6]! - p[4]!);
		dy = 3 * u * u * (p[3]! - p[1]!) + 6 * u * t * (p[5]! - p[3]!) + 3 * t * t * (p[7]! - p[5]!);
	}
	return Math.hypot(dx, dy);
}

/** The part of a Bézier (any degree, flat points) between parameters t0 <= t1. */
function part(pts: number[], t0: number, t1: number): number[] {
	const right = split(pts, t0)[1];
	if (t1 >= 1 - 1e-12) return right;
	return split(right, (t1 - t0) / (1 - t0))[0];
}

function split(pts: number[], t: number): [number[], number[]] {
	const n = pts.length / 2;
	let row = pts.slice();
	const left: number[] = [pts[0]!, pts[1]!],
		right: number[] = [pts[pts.length - 2]!, pts[pts.length - 1]!];
	for (let r = 1; r < n; r++) {
		const next: number[] = [];
		for (let i = 0; i < row.length - 2; i += 2) next.push(row[i]! + (row[i + 2]! - row[i]!) * t, row[i + 1]! + (row[i + 3]! - row[i + 1]!) * t);
		left.push(next[0]!, next[1]!);
		right.unshift(next[next.length - 2]!, next[next.length - 1]!);
		row = next;
	}
	return [left, right];
}

function toCubic(p: number[]): number[] {
	if (p.length === 8) return p;
	if (p.length === 4)
		return [
			p[0]!,
			p[1]!,
			p[0]! + (p[2]! - p[0]!) / 3,
			p[1]! + (p[3]! - p[1]!) / 3,
			p[0]! + ((p[2]! - p[0]!) * 2) / 3,
			p[1]! + ((p[3]! - p[1]!) * 2) / 3,
			p[2]!,
			p[3]!,
		];
	return [
		p[0]!,
		p[1]!,
		p[0]! + ((p[2]! - p[0]!) * 2) / 3,
		p[1]! + ((p[3]! - p[1]!) * 2) / 3,
		p[4]! + ((p[2]! - p[4]!) * 2) / 3,
		p[5]! + ((p[3]! - p[5]!) * 2) / 3,
		p[4]!,
		p[5]!,
	];
}

/**
 * The pace against the tween's eased progress u: distance = g(u) with g piecewise linear (knots
 * by Ramer–Douglas–Peucker over (u, distance) within `tol`), as keys where u passes a knot and
 * the ease cut between them (exact pieces of a cubic ease are cubic). Null when the ease is
 * linear (time-based is the same), turns back, or the result misses a frame.
 */
function easedPace(c: GuideCurve, s: number[], ease: Track, tol: number): Track | null {
	const dur = s.length - 1;
	if (ease.every((k) => k.ease === "linear" || k.ease === "hold")) return null;
	const u = s.map((_, f) => valueOf(ease, f));
	for (let f = 1; f <= dur; f++) {
		if (u[f]! < u[f - 1]! - 1e-9) return null;
		// a flat stretch of the ease can't tell distances apart
		if (u[f]! - u[f - 1]! < 1e-9 && Math.abs(s[f]! - s[f - 1]!) > tol) return null;
	}
	const pts: Key[] = [];
	for (let f = 0; f <= dur; f++) if (!pts.length || u[f]! > pts[pts.length - 1]!.t + 1e-9) pts.push({ t: u[f]!, v: s[f]!, ease: "linear" });
	const kept = simplify(pts, tol);
	const U = kept.map((k) => k.t),
		S = kept.map((k) => k.v);
	if (U[0]! > 1e-9 || U[U.length - 1]! < 1 - 1e-9) return null;
	const g = (uv: number) => {
		let i = 0;
		while (i < U.length - 2 && uv > U[i + 1]!) i++;
		const w = (uv - U[i]!) / (U[i + 1]! - U[i]! || 1);
		return (S[i]! + (S[i + 1]! - S[i]!) * w) / c.length;
	};
	const at = mapTrack(ease, U, g);
	for (let f = 0; f <= dur; f++) if (Math.abs(valueOf(at, f) * c.length - s[f]!) > tol) return null;
	return at;
}

/**
 * A track of g(progress) from the progress track: g is linear between the knots U, so each key
 * segment is cut where the progress passes a knot and the values are mapped.
 */
function mapTrack(ease: Track, U: number[], g: (u: number) => number): Track {
	const out: Key[] = [];
	for (let i = 0; i < ease.length; i++) {
		const a = ease[i]!,
			b = ease[i + 1];
		if (!b || a.ease === "hold") {
			out.push({ t: a.t, v: g(a.v), ease: "hold" });
			continue;
		}
		const cuts = [0];
		for (const k of U) {
			if (k <= Math.min(a.v, b.v) + 1e-12 || k >= Math.max(a.v, b.v) - 1e-12) continue;
			cuts.push(timeOf(a.ease, (k - a.v) / (b.v - a.v)));
		}
		cuts.push(1);
		cuts.sort((x, y) => x - y);
		for (let j = 0; j < cuts.length - 1; j++) {
			const x0 = cuts[j]!,
				x1 = cuts[j + 1]!;
			const v = a.v + (b.v - a.v) * (a.ease === "linear" ? x0 : evalBezier(a.ease, x0));
			const e: Ease = a.ease === "linear" || (x0 <= 0 && x1 >= 1) ? a.ease : subBezier(a.ease, x0, x1).bezier;
			out.push({ t: a.t + (b.t - a.t) * x0, v: g(v), ease: e });
		}
	}
	return out;
}

/** The time (0..1) at which a monotone timing function reaches progress y. */
function timeOf(e: Ease, y: number): number {
	if (e === "linear" || e === "hold") return y;
	let lo = 0,
		hi = 1;
	for (let it = 0; it < 60; it++) {
		const mid = (lo + hi) / 2;
		if (evalBezier(e, mid) < y) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}
