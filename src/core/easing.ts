import type { Point } from "./model.ts";

/**
 * Ease curves are Animate's custom-ease representation: a list of points
 * [anchor, control, control, anchor, control, control, anchor, ...] in (x = time, y = progress)
 * space, starting at (0,0) and ending at (1,1). y may leave 0..1 (overshoot, bounce, elastic).
 */
export type EaseCurve = Point[];

export const LINEAR: EaseCurve = [
	{ x: 0, y: 0 },
	{ x: 1 / 3, y: 1 / 3 },
	{ x: 2 / 3, y: 2 / 3 },
	{ x: 1, y: 1 },
];

/**
 * Classic tween ease (Properties panel "Ease" -100..100). Animate uses a quadratic curve:
 * p(t) = t + k·t·(1-t) with k = ease/100 (negative = ease in / accelerate,
 * positive = ease out / decelerate). As a cubic Bezier: (1/3, (1+k)/3), (2/3, (2+k)/3).
 */
export function classicEase(amount: number): EaseCurve {
	const k = Math.max(-100, Math.min(100, amount)) / 100;
	return [
		{ x: 0, y: 0 },
		{ x: 1 / 3, y: (1 + k) / 3 },
		{ x: 2 / 3, y: (2 + k) / 3 },
		{ x: 1, y: 1 },
	];
}

export function isLinear(curve: EaseCurve, eps = 1e-6): boolean {
	for (const p of curve) if (Math.abs(p.x - p.y) > eps) return false;
	return true;
}

/** One cubic Bezier piece of a curve. */
export interface Segment {
	p0: Point;
	c1: Point;
	c2: Point;
	p1: Point;
}

export function segments(curve: EaseCurve): Segment[] {
	const out: Segment[] = [];
	for (let i = 0; i + 3 < curve.length; i += 3) {
		out.push({ p0: curve[i]!, c1: curve[i + 1]!, c2: curve[i + 2]!, p1: curve[i + 3]! });
	}
	return out;
}

function bez(a: number, b: number, c: number, d: number, s: number): number {
	const u = 1 - s;
	return u * u * u * a + 3 * u * u * s * b + 3 * u * s * s * c + s * s * s * d;
}
function bezD(a: number, b: number, c: number, d: number, s: number): number {
	const u = 1 - s;
	return 3 * u * u * (b - a) + 6 * u * s * (c - b) + 3 * s * s * (d - c);
}

/** Parameter s in [0,1] for which the segment's x(s) equals x (x must be monotonic). */
export function solveX(seg: Segment, x: number): number {
	const { p0, c1, c2, p1 } = seg;
	if (x <= p0.x) return 0;
	if (x >= p1.x) return 1;
	let s = (x - p0.x) / (p1.x - p0.x || 1);
	for (let i = 0; i < 8; i++) {
		const err = bez(p0.x, c1.x, c2.x, p1.x, s) - x;
		if (Math.abs(err) < 1e-9) return s;
		const d = bezD(p0.x, c1.x, c2.x, p1.x, s);
		if (Math.abs(d) < 1e-9) break;
		s -= err / d;
		if (s < 0 || s > 1) break;
	}
	// bisection fallback
	let lo = 0,
		hi = 1;
	s = 0.5;
	for (let i = 0; i < 60; i++) {
		const v = bez(p0.x, c1.x, c2.x, p1.x, s);
		if (Math.abs(v - x) < 1e-10) break;
		if (v < x) lo = s;
		else hi = s;
		s = (lo + hi) / 2;
	}
	return s;
}

/** Progress (y) of the curve at time x (0..1). */
export function evalEase(curve: EaseCurve, x: number): number {
	if (x <= 0) return curve[0]?.y ?? 0;
	if (x >= 1) return curve[curve.length - 1]?.y ?? 1;
	for (const seg of segments(curve)) {
		if (x <= seg.p1.x) {
			const s = solveX(seg, x);
			return bez(seg.p0.y, seg.c1.y, seg.c2.y, seg.p1.y, s);
		}
	}
	return 1;
}

export function pointAt(seg: Segment, s: number): Point {
	return {
		x: bez(seg.p0.x, seg.c1.x, seg.c2.x, seg.p1.x, s),
		y: bez(seg.p0.y, seg.c1.y, seg.c2.y, seg.p1.y, s),
	};
}

/** de Casteljau split of a segment at parameter s. */
export function splitSegment(seg: Segment, s: number): [Segment, Segment] {
	const lerp = (a: Point, b: Point): Point => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
	const p01 = lerp(seg.p0, seg.c1);
	const p12 = lerp(seg.c1, seg.c2);
	const p23 = lerp(seg.c2, seg.p1);
	const p012 = lerp(p01, p12);
	const p123 = lerp(p12, p23);
	const mid = lerp(p012, p123);
	return [
		{ p0: seg.p0, c1: p01, c2: p012, p1: mid },
		{ p0: mid, c1: p123, c2: p23, p1: seg.p1 },
	];
}

/** Parameters (0<s<1) where y'(s) = 0. */
function yExtrema(seg: Segment): number[] {
	const a = seg.p0.y,
		b = seg.c1.y,
		c = seg.c2.y,
		d = seg.p1.y;
	// derivative / 3: A s^2 + B s + C
	const A = -a + 3 * b - 3 * c + d;
	const B = 2 * (a - 2 * b + c);
	const C = b - a;
	const roots: number[] = [];
	if (Math.abs(A) < 1e-12) {
		if (Math.abs(B) > 1e-12) roots.push(-C / B);
	} else {
		const disc = B * B - 4 * A * C;
		if (disc >= 0) {
			const q = Math.sqrt(disc);
			roots.push((-B + q) / (2 * A), (-B - q) / (2 * A));
		}
	}
	return roots.filter((s) => s > 1e-4 && s < 1 - 1e-4).sort((x, y) => x - y);
}

/**
 * A piece of an ease between two keys, normalised to its own box: the timing function
 * from (0,0) to (1,1), plus the absolute time/progress of its end points.
 * `bezier` is [x1, y1, x2, y2] as in CSS cubic-bezier() / SMIL keySplines.
 */
export interface EasePiece {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	bezier: [number, number, number, number];
}

export interface PieceOptions {
	/** SMIL keySplines require control points inside 0..1: split at extrema and clamp. */
	clampY: boolean;
}

/** Converts an ease curve into pieces that can be written as keySplines / cubic-bezier(). */
export function easePieces(curve: EaseCurve, opts: PieceOptions): EasePiece[] {
	const out: EasePiece[] = [];
	for (const seg of segments(curve)) {
		let parts: Segment[] = [seg];
		const ext = yExtrema(seg);
		const flat = Math.abs(seg.p1.y - seg.p0.y) < 1e-9;
		if (ext.length && (opts.clampY || flat)) {
			parts = [];
			let rest = seg;
			let consumed = 0;
			for (const s of ext) {
				const local = (s - consumed) / (1 - consumed);
				const [a, b] = splitSegment(rest, local);
				parts.push(a);
				rest = b;
				consumed = s;
			}
			parts.push(rest);
		}
		for (const p of parts) out.push(normalise(p, opts.clampY));
	}
	return out;
}

function normalise(seg: Segment, clampY: boolean): EasePiece {
	const dx = seg.p1.x - seg.p0.x || 1;
	const dy = seg.p1.y - seg.p0.y;
	let b: [number, number, number, number];
	if (Math.abs(dy) < 1e-9) {
		b = [0, 0, 1, 1];
	} else {
		b = [(seg.c1.x - seg.p0.x) / dx, (seg.c1.y - seg.p0.y) / dy, (seg.c2.x - seg.p0.x) / dx, (seg.c2.y - seg.p0.y) / dy];
	}
	b[0] = Math.min(1, Math.max(0, b[0]));
	b[2] = Math.min(1, Math.max(0, b[2]));
	if (clampY) {
		b[1] = Math.min(1, Math.max(0, b[1]));
		b[3] = Math.min(1, Math.max(0, b[3]));
	}
	return { x0: seg.p0.x, y0: seg.p0.y, x1: seg.p1.x, y1: seg.p1.y, bezier: b };
}

/** Evaluates a normalised timing function (CSS cubic-bezier semantics). */
export function evalBezier(b: readonly [number, number, number, number], x: number): number {
	return evalEase(
		[
			{ x: 0, y: 0 },
			{ x: b[0], y: b[1] },
			{ x: b[2], y: b[3] },
			{ x: 1, y: 1 },
		],
		x,
	);
}

/**
 * The part of a timing function between times u0 and u1 (0 <= u0 < u1 <= 1), renormalised to
 * its own box. Returns the new timing function and the progress values at u0 and u1, so that
 * value(t) = v0 + (v1 - v0) * (p0 + (p1 - p0) * sub(t')) stays exactly the same curve.
 */
export function subBezier(b: readonly [number, number, number, number], u0: number, u1: number): { bezier: [number, number, number, number]; p0: number; p1: number } {
	let seg: Segment = { p0: { x: 0, y: 0 }, c1: { x: b[0], y: b[1] }, c2: { x: b[2], y: b[3] }, p1: { x: 1, y: 1 } };
	if (u1 < 1) {
		const s1 = solveX(seg, u1);
		seg = splitSegment(seg, s1)[0];
	}
	if (u0 > 0) {
		// re-solve on the (possibly shortened) segment
		const s0 = solveX(seg, u0);
		seg = splitSegment(seg, s0)[1];
	}
	const p = normalise(seg, false);
	return { bezier: p.bezier, p0: seg.p0.y, p1: seg.p1.y };
}

export function isLinearBezier(b: readonly number[], eps = 1e-4): boolean {
	return Math.abs(b[0]! - b[1]!) < eps && Math.abs(b[2]! - b[3]!) < eps;
}
