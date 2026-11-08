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
 * (keys at the turning points), so its control points stay inside 0..1 as SMIL's keySplines need;
 * a piece's slopes at its ends come from the neighbouring values, so pieces join smoothly where a
 * key had to go in (at the frame the curve fits worst; afterwards each such key is tried away
 * again). `curve`: what a curved key costs in straight keys (SMIL and CSS write its timing function
 * out, Lottie keys carry their handles anyway): where the frames of a curved piece take no more
 * straight keys than that, they are written straight. The last key is linear, towards whatever
 * follows.
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
	// one piece from frame i to j with slopes si, sj: its ease, or the frame to split at
	const one = (i: number, j: number, si: number, sj: number): { ease: Ease } | { at: number; turn: boolean } => {
		const vi = v[i]!,
			vj = v[j]!,
			len = j - i,
			d = vj - vi;
		let dev = 0;
		for (let k = i + 1; k < j; k++) dev = Math.max(dev, Math.abs(vi + (d * (k - i)) / len - v[k]!));
		if (dev <= tol) return { ease: "linear" };
		// a turning point: the value furthest beyond the ends' range
		const lo = Math.min(vi, vj) - tol,
			hi = Math.max(vi, vj) + tol;
		let turn = -1,
			far = 0;
		for (let k = i + 1; k < j; k++) {
			const o = v[k]! > hi ? v[k]! - hi : v[k]! < lo ? lo - v[k]! : 0;
			if (o > far) {
				far = o;
				turn = k;
			}
		}
		if (turn > 0) return { at: turn, turn: true };
		const fit = cubicFit(v, i, j, Math.max(0, (si * len) / d), Math.max(0, (sj * len) / d), tol / 2);
		return fit.err <= tol ? { ease: fit.ease } : { at: fit.worst, turn: false };
	};
	// keys: frame, slope there, ease to the next
	let out: { i: number; s: number; ease: Ease }[] = [];
	const piece = (i: number, j: number, si: number, sj: number): void => {
		const r = one(i, j, si, sj);
		if ("ease" in r) {
			out.push({ i, s: si, ease: r.ease });
			return;
		}
		const sk = r.turn ? 0 : slope(r.at);
		piece(i, r.at, si, sk);
		piece(r.at, j, sk, sj);
	};
	if (n > 1) {
		const s1 = slope(n - 1);
		piece(0, n - 1, slope(0), s1);
		out.push({ i: n - 1, s: s1, ease: "linear" });
		for (let k = 1; k < out.length - 1;) {
			const r = one(out[k - 1]!.i, out[k + 1]!.i, out[k - 1]!.s, out[k + 1]!.s);
			if ("ease" in r) {
				out[k - 1]!.ease = r.ease;
				out.splice(k, 1);
			} else k++;
		}
	} else out.push({ i: 0, s: 0, ease: "linear" });
	if (curve > 1) {
		const res: typeof out = [];
		for (let k = 0; k < out.length; k++) {
			const o = out[k]!;
			res.push(o);
			if (!Array.isArray(o.ease)) continue;
			const kept: number[] = [];
			straight(v, o.i, out[k + 1]!.i, tol, kept);
			if (kept.length + 1 > curve) continue;
			o.ease = "linear";
			for (const i of kept.sort((a, b) => a - b)) res.push({ i, s: 0, ease: "linear" });
		}
		out = res;
	}
	return out.map((o) => ({ t: t0 + o.i, v: v[o.i]!, ease: o.ease }));
}

/** The frames between i and j that straight keys need to pass all within `tol` (Ramer-Douglas-Peucker), into `kept`. */
function straight(v: readonly number[], i: number, j: number, tol: number, kept: number[]) {
	let far = tol,
		at = -1;
	for (let k = i + 1; k < j; k++) {
		const e = Math.abs(v[i]! + ((v[j]! - v[i]!) * (k - i)) / (j - i) - v[k]!);
		if (e > far) [far, at] = [e, k];
	}
	if (at < 0) return;
	kept.push(at);
	straight(v, i, at, tol, kept);
	straight(v, at, j, tol, kept);
}

/**
 * The timing function from v[i] to v[j] with normalised end slopes m0, m1 (its control points on
 * those tangents, inside the unit box) that passes the frames between closest (least squares:
 * the cubic polynomial, a coarse grid, then Levenberg-Marquardt down the valley; it stops once no
 * frame is missed by more than `enough`); err: its largest miss.
 */
function cubicFit(
	v: readonly number[],
	i: number,
	j: number,
	m0: number,
	m1: number,
	enough: number,
): { ease: [number, number, number, number]; err: number; worst: number } {
	const len = j - i,
		vi = v[i]!,
		d = v[j]! - vi,
		m = j - i - 1;
	const max0 = m0 > 1 ? 1 / m0 : 1,
		max1 = m1 > 1 ? 1 / m1 : 1;
	const clamp0 = (h: number) => Math.min(max0, Math.max(1e-4, h)),
		clamp1 = (h: number) => Math.min(max1, Math.max(1e-4, h));
	let worst = i + 1,
		miss = 0;
	const r = new Float64Array(m),
		ra = new Float64Array(m),
		rb = new Float64Array(m);
	// the misses at the frames between into `out`; returns their sum of squares
	const misses = (h0: number, h1: number, out: Float64Array): number => {
		const x1 = h0,
			y1 = h0 * m0,
			x2 = 1 - h1,
			y2 = 1 - h1 * m1;
		let sum = 0;
		miss = 0;
		for (let k = 0; k < m; k++) {
			const u = solveTime(x1, x2, (k + 1) / len);
			const w = 1 - u;
			const e = vi + d * (3 * w * w * u * y1 + 3 * w * u * u * y2 + u * u * u) - v[i + 1 + k]!;
			out[k] = e;
			sum += e * e;
			if (Math.abs(e) > miss) {
				miss = Math.abs(e);
				worst = i + 1 + k;
			}
		}
		return sum;
	};
	let b0 = 0,
		b1 = 0,
		best = Infinity,
		bestMiss = Infinity,
		bestWorst = worst;
	const take = (h0: number, h1: number, e: number) => {
		[best, b0, b1, bestMiss, bestWorst] = [e, h0, h1, miss, worst];
	};
	const done = () => {
		const box = (x: number) => Math.min(1, Math.max(0, x));
		return { ease: [box(b0), box(b0 * m0), box(1 - b1), box(1 - b1 * m1)] as [number, number, number, number], err: bestMiss, worst: bestWorst };
	};
	// (the cubic polynomial in time first: exact for many eases)
	const p0 = Math.min(max0, 1 / 3),
		p1 = Math.min(max1, 1 / 3);
	take(p0, p1, misses(p0, p1, r));
	if (bestMiss <= enough) return done();
	for (let a = 1; a <= 3; a++)
		for (let c = 1; c <= 3; c++) {
			const h0 = (max0 * a) / 3,
				h1 = (max1 * c) / 3;
			const e = misses(h0, h1, r);
			if (e < best) take(h0, h1, e);
		}
	let lambda = 1e-3;
	for (let it = 0; it < 8 && best > 1e-12 && bestMiss > enough; it++) {
		misses(b0, b1, r);
		const ea = 1e-6 * max0,
			eb = 1e-6 * max1;
		// (one-sided differences that stay inside the box)
		const sa = b0 + ea > max0 ? -ea : ea,
			sb = b1 + eb > max1 ? -eb : eb;
		misses(b0 + sa, b1, ra);
		misses(b0, b1 + sb, rb);
		let aa = 0,
			ab = 0,
			bb = 0,
			ga = 0,
			gb = 0;
		for (let k = 0; k < m; k++) {
			const ja = (ra[k]! - r[k]!) / sa,
				jb = (rb[k]! - r[k]!) / sb;
			aa += ja * ja;
			ab += ja * jb;
			bb += jb * jb;
			ga += ja * r[k]!;
			gb += jb * r[k]!;
		}
		let stepped = false;
		while (lambda < 1e9) {
			const A = aa * (1 + lambda) + 1e-15,
				B = bb * (1 + lambda) + 1e-15,
				det = A * B - ab * ab;
			const n0 = clamp0(b0 - (B * ga - ab * gb) / det),
				n1 = clamp1(b1 - (A * gb - ab * ga) / det);
			const e = misses(n0, n1, ra);
			if (e < best) {
				const moved = Math.abs(n0 - b0) + Math.abs(n1 - b1);
				take(n0, n1, e);
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
