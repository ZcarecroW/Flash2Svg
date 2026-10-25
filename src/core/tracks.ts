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
