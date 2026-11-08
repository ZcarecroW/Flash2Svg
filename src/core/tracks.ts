/**
 * Animation tracks: a value over (fractional) frame time, as a list of keys with the timing
 * function used to reach the next key.
 */

/** "hold": jump at the next key; "linear"; or a cubic timing function [x1, y1, x2, y2]. */
export type Ease = "hold" | "linear" | [number, number, number, number];

export interface Key {
	t: number;
	v: number;
	ease: Ease;
}

export type Track = Key[];

import { evalBezier } from "./easing.ts";

export function valueAt(track: Track, t: number): number {
	if (!track.length) return 0;
	if (t <= track[0]!.t) return track[0]!.v;
	for (let i = 0; i < track.length - 1; i++) {
		const a = track[i]!,
			b = track[i + 1]!;
		if (t < b.t) {
			if (a.ease === "hold") return a.v;
			const u = (t - a.t) / (b.t - a.t);
			const p = a.ease === "linear" ? u : evalBezier(a.ease, u);
			return a.v + (b.v - a.v) * p;
		}
	}
	return track[track.length - 1]!.v;
}

export function isConstant(track: Track, eps = 1e-9): boolean {
	for (const k of track) if (Math.abs(k.v - track[0]!.v) > eps) return false;
	return true;
}

/**
 * Removes keys that linear interpolation can reproduce within `tol` (Ramer-Douglas-Peucker
 * over runs of linear keys). Hold and eased keys are kept.
 */
export function simplify(track: Track, tol: number): Track {
	if (track.length <= 2) return track;
	const n = track.length;
	const keep = new Array<boolean>(n).fill(true);
	let i = 0;
	while (i < n - 1) {
		if (track[i]!.ease !== "linear") {
			i++;
			continue;
		}
		let j = i;
		while (j < n - 1 && track[j]!.ease === "linear") j++;
		for (let k = i + 1; k < j; k++) keep[k] = false;
		rdp(track, i, j, tol, keep);
		i = j;
	}
	// also drop repeated holds of the same value
	const out: Track = [];
	for (let i = 0; i < track.length; i++) {
		if (!keep[i]) continue;
		const k = track[i]!;
		const prev = out[out.length - 1];
		if (prev && prev.ease === "hold" && k.ease === "hold" && Math.abs(prev.v - k.v) < 1e-12 && i < track.length - 1) continue;
		out.push(k);
	}
	return out;
}

function rdp(track: Track, a: number, b: number, tol: number, keep: boolean[]) {
	if (b - a < 2) return;
	const ka = track[a]!,
		kb = track[b]!;
	let maxD = -1,
		idx = -1;
	for (let i = a + 1; i < b; i++) {
		const k = track[i]!;
		const u = (k.t - ka.t) / (kb.t - ka.t || 1);
		const d = Math.abs(ka.v + (kb.v - ka.v) * u - k.v);
		if (d > maxD) {
			maxD = d;
			idx = i;
		}
	}
	if (maxD > tol) {
		keep[idx] = true;
		rdp(track, a, idx, tol, keep);
		rdp(track, idx, b, tol, keep);
	}
}

/** Shifts and clips a track to local time window [from, to) and re-bases it to start at `offset`. */
export function window(track: Track, from: number, to: number, offset: number): Track {
	const out: Track = [];
	const startV = valueAt(track, from);
	out.push({ t: offset, v: startV, ease: easeAt(track, from) });
	for (const k of track) {
		if (k.t > from && k.t < to) out.push({ t: k.t - from + offset, v: k.v, ease: k.ease });
	}
	const endV = valueAt(track, to);
	out.push({ t: to - from + offset, v: endV, ease: "hold" });
	// An eased segment cut in the middle can't keep its bezier: approximate the cut parts linearly
	// by sampling, so the visible curve stays right.
	return fixCutEases(track, out, from, offset);
}

function easeAt(track: Track, t: number): Ease {
	for (let i = track.length - 1; i >= 0; i--) if (track[i]!.t <= t) return track[i]!.ease;
	return "hold";
}

function fixCutEases(src: Track, out: Track, from: number, offset: number): Track {
	const res: Track = [];
	for (let i = 0; i < out.length; i++) {
		const k = out[i]!;
		const next = out[i + 1];
		res.push(k);
		if (!next || typeof k.ease === "string") continue;
		// Is [k, next] an exact original segment?
		const t0 = k.t - offset + from,
			t1 = next.t - offset + from;
		const exact = src.some((s, j) => Math.abs(s.t - t0) < 1e-9 && src[j + 1] && Math.abs(src[j + 1]!.t - t1) < 1e-9);
		if (exact) continue;
		// resample the partial segment
		k.ease = "linear";
		const steps = Math.max(2, Math.ceil(t1 - t0) * 2);
		for (let s = 1; s < steps; s++) {
			const t = t0 + ((t1 - t0) * s) / steps;
			res.push({ t: t - from + offset, v: valueAt(src, t), ease: "linear" });
		}
	}
	return res;
}

/**
 * Keys through values sampled at frames t0, t0 + 1, … that pass every one within `tol`, as few as
 * it takes: straight runs linear, curved ones cubic timing functions. Every piece is monotonic
 * (keys at the turning points, between frames where the values peak there, as a curve from
 * Animate's Motion Editor does), so its control points stay inside 0..1 as SMIL's keySplines
 * need; one of the Motion Editor's curves takes a key per such piece. Where one curve doesn't fit,
 * a key goes in at the frame it misses most; afterwards each such key is tried away again. `curve`: what a curved key costs in straight keys (SMIL and CSS write its timing
 * function out, Lottie keys carry their handles anyway): where the frames of a curved piece take
 * no more straight keys than that, they are written straight. The last key is linear, towards
 * whatever follows.
 */
export function fitCurve(vals: readonly number[], t0: number, tol: number, curve = 1): Track {
	const n = vals.length;
	if (!n) return [];
	const v = vals;
	// the slope (value per frame) at a frame, second order
	const slope = (i: number): number => {
		if (n === 2) return v[1]! - v[0]!;
		if (i === 0) return (-3 * v[0]! + 4 * v[1]! - v[2]!) / 2;
		if (i === n - 1) return (3 * v[n - 1]! - 4 * v[n - 2]! + v[n - 3]!) / 2;
		return (v[i + 1]! - v[i - 1]!) / 2;
	};
	const at = (k: number): End => ({ t: k, v: v[k]!, s: slope(k) });
	// a turning point at frame k: where the parabola through it and its neighbours peaks, when that
	// is clearly between frames
	const turning = (k: number, a: End, b: End): End => {
		if (k > 0 && k < n - 1) {
			const p = v[k - 1]!,
				q = v[k]!,
				r = v[k + 1]!,
				den = p - 2 * q + r;
			if (Math.abs(den) > 1e-12) {
				const dt = Math.round(Math.max(-0.5, Math.min(0.5, (p - r) / (2 * den))) * 1000) / 1000;
				const t = k + dt;
				if (Math.abs(dt) > 0.05 && t > a.t + 0.05 && t < b.t - 0.05) return { t, v: q - ((p - r) * dt) / 4, s: 0, flat: true };
			}
		}
		return { t: k, v: v[k]!, s: 0, flat: true };
	};
	// one piece from a to b: its ease, or where to split it
	const one = (a: End, b: End): { ease: Ease } | { split: End } => {
		const len = b.t - a.t,
			d = b.v - a.v;
		let dev = 0;
		for (let k = Math.floor(a.t) + 1; k < b.t; k++) dev = Math.max(dev, Math.abs(a.v + (d * (k - a.t)) / len - v[k]!));
		if (dev <= tol) return { ease: "linear" };
		// a turning point: the value furthest beyond the ends' range
		const lo = Math.min(a.v, b.v) - tol,
			hi = Math.max(a.v, b.v) + tol;
		let turn = -1,
			far = 0;
		for (let k = Math.floor(a.t) + 1; k < b.t; k++) {
			const o = v[k]! > hi ? v[k]! - hi : v[k]! < lo ? lo - v[k]! : 0;
			if (o > far) [far, turn] = [o, k];
		}
		if (turn >= 0) return { split: turning(turn, a, b) };
		const m0 = Math.max(0, (a.s * len) / d),
			m1 = Math.max(0, (b.s * len) / d);
		// (flat at a turning point first; its frame may be a little off the true one: free then)
		let fit = cubicFit(v, a, b, m0, m1, !a.flat, !b.flat, tol / 2);
		if (fit.err > tol && (a.flat || b.flat)) {
			const free = cubicFit(v, a, b, m0, m1, true, true, tol / 2);
			if (free.err < fit.err) fit = free;
		}
		return fit.err <= tol ? { ease: fit.ease } : { split: at(fit.worst) };
	};
	// keys: where, ease to the next
	let out: { e: End; ease: Ease }[] = [];
	const piece = (a: End, b: End): void => {
		const r = one(a, b);
		if ("ease" in r) {
			out.push({ e: a, ease: r.ease });
			return;
		}
		piece(a, r.split);
		piece(r.split, b);
	};
	if (n > 1) {
		const last = at(n - 1);
		piece(at(0), last);
		out.push({ e: last, ease: "linear" });
		for (let k = 1; k < out.length - 1;) {
			const r = one(out[k - 1]!.e, out[k + 1]!.e);
			if ("ease" in r) {
				out[k - 1]!.ease = r.ease;
				out.splice(k, 1);
			} else k++;
		}
	} else out.push({ e: at(0), ease: "linear" });
	if (curve > 1) {
		const res: typeof out = [];
		for (let k = 0; k < out.length; k++) {
			const o = out[k]!;
			res.push(o);
			if (!Array.isArray(o.ease)) continue;
			const kept: number[] = [];
			straight(v, o.e, out[k + 1]!.e, tol, kept);
			if (kept.length + 1 > curve) continue;
			o.ease = "linear";
			for (const i of kept.sort((a, b) => a - b)) res.push({ e: at(i), ease: "linear" });
		}
		out = res;
	}
	return out.map((o) => ({ t: t0 + o.e.t, v: o.e.v, ease: o.ease }));
}

/** A piece's end: its (frame) time, value and the slope the frames suggest there (value per frame); flat: a turning point, which keeps its slope (0) where it can. */
interface End {
	t: number;
	v: number;
	s: number;
	flat?: boolean;
}

/** The frames between a and b that straight keys need to pass all within `tol` (Ramer-Douglas-Peucker), into `kept`. */
function straight(v: readonly number[], a: { t: number; v: number }, b: { t: number; v: number }, tol: number, kept: number[]) {
	let far = tol,
		at = -1;
	for (let k = Math.floor(a.t) + 1; k < b.t; k++) {
		const e = Math.abs(a.v + ((b.v - a.v) * (k - a.t)) / (b.t - a.t) - v[k]!);
		if (e > far) [far, at] = [e, k];
	}
	if (at < 0) return;
	kept.push(at);
	straight(v, a, { t: at, v: v[at]! }, tol, kept);
	straight(v, { t: at, v: v[at]! }, b, tol, kept);
}

/**
 * The timing function from a to b (the frames between them sampled in v) that passes those frames
 * closest (least squares; err: its largest miss). An end that is a turning point keeps its slope
 * (`m0`, `m1`, normalised: 0) with its control point on that tangent unless `free`; elsewhere the control point is
 * free inside the unit box, starting from the slopes the frames suggest. The search: the cubic
 * polynomial, a coarse grid along those slopes, then Levenberg-Marquardt down the valley; it stops
 * once no frame is missed by more than `enough`.
 */
function cubicFit(
	v: readonly number[],
	a: { t: number; v: number },
	b: { t: number; v: number },
	m0: number,
	m1: number,
	free0: boolean,
	free1: boolean,
	enough: number,
): { ease: [number, number, number, number]; err: number; worst: number } {
	const len = b.t - a.t,
		vi = a.v,
		d = b.v - vi,
		k0 = Math.floor(a.t) + 1,
		m = Math.max(0, Math.ceil(b.t) - k0);
	const max0 = m0 > 1 ? 1 / m0 : 1,
		max1 = m1 > 1 ? 1 / m1 : 1;
	// the parameters: per end its control point (free), or its distance along the tangent
	const lo: number[] = [],
		hi: number[] = [];
	if (free0) (lo.push(0, 0), hi.push(1, 1));
	else (lo.push(1e-4), hi.push(max0));
	if (free1) (lo.push(0, 0), hi.push(1, 1));
	else (lo.push(1e-4), hi.push(max1));
	const P = lo.length;
	const easeOf = (p: readonly number[]): [number, number, number, number] => {
		let i = 0;
		const x1 = p[i++]!,
			y1 = free0 ? p[i++]! : x1 * m0;
		const q = p[i++]!,
			x2 = free1 ? q : 1 - q,
			y2 = free1 ? p[i++]! : 1 - q * m1;
		return [x1, y1, x2, y2];
	};
	// control points at distances h0, h1 along the slopes
	const along = (h0: number, h1: number): number[] => {
		const p: number[] = free0 ? [h0, Math.min(1, h0 * m0)] : [h0];
		if (free1) p.push(1 - h1, Math.max(0, 1 - h1 * m1));
		else p.push(h1);
		return p;
	};
	let worst = k0,
		miss = 0;
	// the misses at the frames between into `out` (and their derivatives by the parameters into
	// `jac`); returns their sum of squares
	const misses = (p: readonly number[], out: Float64Array, jac?: Float64Array[]): number => {
		const [x1, y1, x2, y2] = easeOf(p);
		// x(u) = c1 u + c2 u² + c3 u³
		const c1 = 3 * x1,
			c2 = 3 * x2 - 6 * x1,
			c3 = 1 + 3 * x1 - 3 * x2;
		let sum = 0,
			u = 0,
			prev = 0;
		miss = 0;
		for (let k = 0; k < m; k++) {
			const sk = (k0 + k - a.t) / len;
			// Newton from the last frame's parameter, moved on by the slope there (times grow)
			let du = c1 + u * (2 * c2 + 3 * c3 * u);
			u = du > 1e-9 ? Math.min(1, u + (sk - prev) / du) : sk;
			let ok = false;
			for (let it = 0; it < 6; it++) {
				const x = u * (c1 + u * (c2 + c3 * u)) - sk;
				if (Math.abs(x) < 1e-9) {
					ok = true;
					break;
				}
				du = c1 + u * (2 * c2 + 3 * c3 * u);
				if (du < 1e-9) break;
				const next = u - x / du;
				if (next < 0 || next > 1) break;
				u = next;
			}
			if (!ok) u = solveTime(x1, x2, sk);
			prev = sk;
			const w = 1 - u;
			const e = vi + d * (3 * w * w * u * y1 + 3 * w * u * u * y2 + u * u * u) - v[k0 + k]!;
			out[k] = e;
			sum += e * e;
			if (Math.abs(e) > miss) {
				miss = Math.abs(e);
				worst = k0 + k;
			}
			if (jac) {
				// (x and y by the control points; u moves with the x's: du/dx1 = -dx/dx1 / x'(u))
				const bx1 = 3 * w * w * u,
					bx2 = 3 * w * u * u;
				const xd = Math.max(1e-9, 3 * w * w * x1 + 6 * w * u * (x2 - x1) + 3 * u * u * (1 - x2));
				const yd = 3 * w * w * y1 + 6 * w * u * (y2 - y1) + 3 * u * u * (1 - y2);
				const dX1 = (-d * yd * bx1) / xd,
					dX2 = (-d * yd * bx2) / xd,
					dY1 = d * bx1,
					dY2 = d * bx2;
				let c = 0;
				if (free0) {
					jac[c++]![k] = dX1;
					jac[c++]![k] = dY1;
				} else jac[c++]![k] = dX1 + m0 * dY1;
				if (free1) {
					jac[c++]![k] = dX2;
					jac[c++]![k] = dY2;
				} else jac[c++]![k] = -dX2 - m1 * dY2;
			}
		}
		return sum;
	};
	const r = new Float64Array(m),
		trial = new Float64Array(m);
	const cols = Array.from({ length: P }, () => new Float64Array(m));
	let bp = along(Math.min(max0, 1 / 3), Math.min(max1, 1 / 3)),
		best = misses(bp, r),
		bestMiss = miss,
		bestWorst = worst;
	const take = (p: number[], e: number) => {
		[bp, best, bestMiss, bestWorst] = [p, e, miss, worst];
	};
	const done = () => {
		const box = (x: number) => Math.min(1, Math.max(0, x));
		return { ease: easeOf(bp).map(box) as [number, number, number, number], err: bestMiss, worst: bestWorst };
	};
	if (bestMiss <= enough) return done();
	for (let i = 1; i <= 3; i++)
		for (let c = 1; c <= 3; c++) {
			const p = along((max0 * i) / 3, (max1 * c) / 3);
			const e = misses(p, trial);
			if (e < best) take(p, e);
		}
	let lambda = 1e-3;
	const A = new Float64Array(P * P),
		g = new Float64Array(P);
	for (let it = 0; it < 8 && best > 1e-12 && bestMiss > enough; it++) {
		misses(bp, r, cols);
		for (let x = 0; x < P; x++) {
			let s = 0;
			for (let k = 0; k < m; k++) s += cols[x]![k]! * r[k]!;
			g[x] = s;
			for (let y = x; y < P; y++) {
				let t = 0;
				for (let k = 0; k < m; k++) t += cols[x]![k]! * cols[y]![k]!;
				A[x * P + y] = A[y * P + x] = t;
			}
		}
		let stepped = false;
		while (lambda < 1e9) {
			const step = solveDamped(A, g, P, lambda);
			const p = bp.map((x, c) => Math.min(hi[c]!, Math.max(lo[c]!, x - step[c]!)));
			const e = misses(p, trial);
			if (e < best) {
				const moved = p.reduce((s, x, c) => s + Math.abs(x - bp[c]!), 0);
				take(p, e);
				lambda = Math.max(1e-9, lambda / 3);
				stepped = moved > 1e-10;
				break;
			}
			lambda *= 4;
		}
		if (!stepped) break;
	}
	return done();
}

const LL = new Float64Array(16),
	LX = new Float64Array(4);

/**
 * x with (A + lambda · diag(A)) x = g, for a small symmetric positive semi-definite A (P × P ≤ 4,
 * row-major): Cholesky into a shared buffer (read it before the next call).
 */
function solveDamped(A: Float64Array, g: Float64Array, P: number, lambda: number): Float64Array {
	const L = LL,
		x = LX;
	for (let i = 0; i < P; i++)
		for (let j = 0; j <= i; j++) {
			let s = A[i * P + j]! * (i === j ? 1 + lambda : 1) + (i === j ? 1e-15 : 0);
			for (let k = 0; k < j; k++) s -= L[i * 4 + k]! * L[j * 4 + k]!;
			L[i * 4 + j] = i === j ? Math.sqrt(Math.max(s, 1e-30)) : s / L[j * 4 + j]!;
		}
	for (let i = 0; i < P; i++) {
		let s = g[i]!;
		for (let k = 0; k < i; k++) s -= L[i * 4 + k]! * x[k]!;
		x[i] = s / L[i * 4 + i]!;
	}
	for (let i = P - 1; i >= 0; i--) {
		let s = x[i]!;
		for (let k = i + 1; k < P; k++) s -= L[k * 4 + i]! * x[k]!;
		x[i] = s / L[i * 4 + i]!;
	}
	return x;
}

/** The curve parameter where a timing function with control x's x1, x2 reaches time s. */
function solveTime(x1: number, x2: number, s: number): number {
	// (the cubic polynomial: time is the parameter)
	if (Math.abs(x1 - 1 / 3) < 1e-12 && Math.abs(x2 - 2 / 3) < 1e-12) return s;
	let u = s;
	for (let it = 0; it < 8; it++) {
		const w = 1 - u;
		const x = 3 * w * w * u * x1 + 3 * w * u * u * x2 + u * u * u - s;
		if (Math.abs(x) < 1e-8) return u;
		const dx = 3 * w * w * x1 + 6 * w * u * (x2 - x1) + 3 * u * u * (1 - x2);
		if (dx < 1e-6) break;
		const next = u - x / dx;
		if (next < 0 || next > 1) break;
		u = next;
	}
	let lo = 0,
		hi = 1;
	for (let it = 0; it < 40; it++) {
		u = (lo + hi) / 2;
		const w = 1 - u;
		if (3 * w * w * u * x1 + 3 * w * u * u * x2 + u * u * u < s) lo = u;
		else hi = u;
	}
	return u;
}

/**
 * Keys for values that move together along straight lines (x and y on a path of straight pieces,
 * as a motion tween's position keyframes make it; a uniform scale; a tint): on each line one curve
 * for the progress along it (fitCurve), every value's keys at the same frames with the same timing
 * functions, so they stay one animation (SMIL's translate, CSS's translate, Lottie's position).
 * A line breaks at the frame furthest off it (by more than the `tols`); `curve` as for fitCurve.
 * Null when there is nothing to fit (one frame).
 */
export function fitTogether(series: readonly (readonly number[])[], t0: number, tols: readonly number[], curve = 1): Track[] | null {
	const dims = series.length,
		n = series[0]?.length ?? 0;
	if (n < 2) return null;
	// in units of each value's tolerance
	const z = (d: number, f: number) => series[d]![f]! / tols[d]!;
	const out: Track[] = series.map(() => []);
	const along: number[] = new Array(n);
	const piece = (i: number, j: number): void => {
		let cl2 = 0;
		for (let d = 0; d < dims; d++) cl2 += (z(d, j) - z(d, i)) ** 2;
		if (cl2 < 1) {
			// out and back (or still): break at the frame furthest away, if one is beyond the tolerance
			let far = 1,
				fi = -1;
			for (let f = i + 1; f < j; f++) {
				let s = 0;
				for (let d = 0; d < dims; d++) s += (z(d, f) - z(d, i)) ** 2;
				if (s > far) [far, fi] = [s, f];
			}
			if (fi < 0) {
				for (let d = 0; d < dims; d++) out[d]!.push({ t: t0 + i, v: series[d]![i]!, ease: "linear" });
				return;
			}
			piece(i, fi);
			piece(fi, j);
			return;
		}
		// the progress along the chord (0..1) and the distance off it
		let off = 0,
			worst = -1;
		for (let f = i; f <= j; f++) {
			let a = 0;
			for (let d = 0; d < dims; d++) a += (z(d, f) - z(d, i)) * (z(d, j) - z(d, i));
			a /= cl2;
			let p = 0;
			for (let d = 0; d < dims; d++) p += (z(d, f) - z(d, i) - a * (z(d, j) - z(d, i))) ** 2;
			if (p > off) [off, worst] = [p, f];
			along[f] = a;
		}
		if (off > 1) {
			piece(i, worst);
			piece(worst, j);
			return;
		}
		const keys = fitCurve(along.slice(i, j + 1), t0 + i, Math.max(0.5, Math.sqrt(1 - off)) / Math.sqrt(cl2), curve);
		keys.pop();
		for (const k of keys) for (let d = 0; d < dims; d++) out[d]!.push({ t: k.t, v: series[d]![i]! + k.v * (series[d]![j]! - series[d]![i]!), ease: k.ease });
	};
	piece(0, n - 1);
	for (let d = 0; d < dims; d++) out[d]!.push({ t: t0 + n - 1, v: series[d]![n - 1]!, ease: "linear" });
	return out;
}
