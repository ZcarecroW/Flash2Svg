/**
 * CSS @keyframes from baked tracks, written lean:
 * - tracks with different key times are merged exactly (eased pieces cut, never sampled) when
 *   they ease alike wherever both change;
 * - the timing most keyframes use becomes the animation's own, so they leave it out;
 * - keyframes with the same declarations share one rule ("50%,to{...}");
 * - keys that all lie on one line in value space (frame-by-frame samples, steps, multi-piece
 *   eases) become one keyframe pair with a linear() timing function, where that is shorter.
 */
import { evalBezier, isLinearBezier, subBezier } from "../easing.ts";
import { fmt } from "../geom.ts";
import { valueAt, type Ease, type Track } from "../tracks.ts";
import type { GTrack } from "./bake.ts";

/** Values of several tracks at one key; `ease` leads to the next key. */
export interface MKey {
	t: number;
	v: number[];
	ease: Ease;
}

const EPS = 1e-9;
/** Width of an instantaneous jump, in ticks. */
const EPS_TICK = 0.01;
/** Longest run of keys tried as one linear() (keeps the search linear in the number of keys). */
const MAX_RUN = 256;

function isFlat(t: GTrack): boolean {
	return t.length <= 1 || t.every((k) => Math.abs(k.v - t[0]!.v) < EPS);
}

function sameEase(a: Ease, b: Ease): boolean {
	if (a === b) return true;
	if (typeof a === "string" || typeof b === "string") return false;
	return a.every((x, i) => Math.abs(x - b[i]!) < 1e-6);
}

/**
 * Merges tracks on the union of their key times. Each track is cut exactly where it has no key
 * (eased pieces with subBezier); jumps (keys at the same time) stay jumps. Null when two tracks
 * change in one stretch with different eases (one timing function can't serve both).
 */
export function alignTracks(tracks: GTrack[]): MKey[] | null {
	const animated = tracks.map((t) => !isFlat(t));
	if (!animated.some(Boolean)) return null;
	const times: number[] = [];
	{
		const all: number[] = [];
		tracks.forEach((tr, i) => animated[i] && tr.forEach((k) => all.push(k.t)));
		all.sort((a, b) => a - b);
		for (const t of all) if (!times.length || t - times[times.length - 1]! > EPS) times.push(t);
	}
	const n = tracks.length;
	// per track: index of its last key at or before the current time
	const idx = new Array<number>(n).fill(0);
	const out: MKey[] = [];
	for (let ti = 0; ti < times.length; ti++) {
		const t = times[ti]!;
		// values at t: several for a track with several keys at t (a jump)
		const vals: number[][] = [];
		let mult = 1;
		for (let i = 0; i < n; i++) {
			const tr = tracks[i]!;
			if (!animated[i]) {
				vals.push([tr[0]?.v ?? 0]);
				continue;
			}
			while (idx[i]! < tr.length - 1 && tr[idx[i]! + 1]!.t <= t + EPS) idx[i]!++;
			const here: number[] = [];
			// keys at t, in order (idx points at the last of them)
			let j = idx[i]!;
			while (j > 0 && Math.abs(tr[j - 1]!.t - t) < EPS) j--;
			for (let k = j; k <= idx[i]!; k++) if (Math.abs(tr[k]!.t - t) < EPS) here.push(tr[k]!.v);
			if (!here.length) here.push(valueAt(tr as Track, t));
			vals.push(here);
			mult = Math.max(mult, here.length);
		}
		for (let m = 0; m < mult; m++) {
			const last = m === mult - 1;
			out.push({ t, v: vals.map((vs) => vs[Math.min(m, vs.length - 1)]!), ease: last ? "linear" : "hold" });
		}
		if (ti === times.length - 1) {
			out[out.length - 1]!.ease = "hold";
			break;
		}
		// the stretch to the next time: every track that changes in it must ease the same way
		const t1 = times[ti + 1]!;
		let ease: Ease | null = null;
		for (let i = 0; i < n; i++) {
			if (!animated[i]) continue;
			const tr = tracks[i]!;
			const a = tr[idx[i]!]!;
			const b = tr[idx[i]! + 1];
			if (!b || a.t > t + EPS) continue; // before the first or after the last key: constant
			let e: Ease | null;
			if (a.ease === "hold") e = Math.abs(b.t - t1) < EPS && Math.abs(b.v - a.v) > EPS ? "hold" : null;
			else if (Math.abs(b.v - a.v) < EPS) e = null;
			else if (a.ease === "linear") e = "linear";
			else {
				const span = b.t - a.t;
				const u0 = (t - a.t) / span,
					u1 = (t1 - a.t) / span;
				e = u0 < EPS && u1 > 1 - EPS ? a.ease : subBezier(a.ease, Math.max(0, u0), Math.min(1, u1)).bezier;
			}
			if (!e) continue;
			if (ease === null) ease = e;
			else if (!sameEase(ease, e)) return null;
		}
		out[out.length - 1]!.ease = ease ?? "linear";
	}
	return out;
}

export interface KeyframeSpec {
	/** Decimal places of each value: keyframes print them rounded so (also the linear() tolerance). */
	digits: number[];
	/** Declarations of one keyframe ("translate:1px 2px;rotate:3deg"). */
	body(v: number[]): string;
	/** Constant declarations for the first and the last keyframe (CSS fills them in between). */
	extra?: string;
}

export interface Keyframes {
	/** "0%{...}50%,to{...}" */
	frames: string;
	/** The animation's timing function: what most keyframes use (they leave it out). */
	timing: string;
	/** Every keyframe shows the same values. */
	constant: boolean;
}

interface Pt {
	t: number;
	v: number[];
	ease: Ease;
}

const TF = "animation-timing-function:";

function timingOf(e: Ease): string {
	if (e === "hold") return "step-end";
	if (e === "linear" || isLinearBezier(e, 1e-5)) return "linear";
	return `cubic-bezier(${e.map((x) => fmt(x, 4) || "0").join(",")})`;
}

const round = (x: number, d: number) => {
	const p = 10 ** d;
	return Math.round(x * p) / p;
};

/** Keyframes for keys over a window of `H` ticks (null: no keys). */
export function encodeKeyframes(keys: MKey[], H: number, spec: KeyframeSpec): Keyframes | null {
	if (!keys.length) return null;
	const pts: Pt[] = [];
	if (keys[0]!.t > 0) pts.push({ t: 0, v: keys[0]!.v, ease: "hold" });
	for (let i = 0; i < keys.length; i++) {
		const k = keys[i]!;
		const next = keys[i + 1];
		// two keys at the same time = a jump: CSS merges equal offsets, so pull this one back a hair
		const t = next && next.t - k.t < EPS_TICK / 2 ? Math.max(0, next.t - EPS_TICK) : k.t;
		pts.push({ t: Math.min(H, t), v: k.v, ease: k.ease });
	}
	if (pts[pts.length - 1]!.t < H) pts.push({ t: H, v: pts[pts.length - 1]!.v, ease: "hold" });
	const n = pts.length;
	const bodies = pts.map((p) => spec.body(p.v));
	const flat = (i: number) => bodies[i] === bodies[i + 1];
	const tim = pts.map((p, i) => (i < n - 1 && !flat(i) ? timingOf(p.ease) : ""));
	const pd = Math.max(4, Math.ceil(Math.log10(Math.max(1, H) * 1000)) - 2);
	// rounded down: a jump comes at (or a hair before) its frame, never after
	const pct = (t: number) => (t <= 0 ? "0%" : t >= H ? "to" : fmt(Math.floor((t / H) * 100 * 10 ** pd + 1e-6) / 10 ** pd, pd) + "%");
	if (bodies.every((b) => b === bodies[0])) return { frames: `0%,to{${join(bodies[0]!, spec.extra)}}`, timing: "linear", constant: true };
	// the timing most segments use, for estimating what keyframes cost
	const preDefault = mostCommon(tim.filter(Boolean));
	const cost = (i: number) => (!tim[i] || tim[i] === preDefault ? 0 : TF.length + tim[i]!.length);

	// macro segments: from key `at` to key `to` with one timing function
	const macro: { at: number; timing: string }[] = [];
	let i = 0;
	while (i < n - 1) {
		const run = longestRun(pts, i, spec.digits);
		if (run > i + 1) {
			const lin = linearFn(pts, bodies, i, run, spec.digits);
			if (lin) {
				let kf = cost(i);
				for (let m = i + 1; m < run; m++) kf += pct(pts[m]!.t).length + bodies[m]!.length + 2 + cost(m);
				if (TF.length + lin.length < kf) {
					macro.push({ at: i, timing: lin });
					i = run;
					continue;
				}
			}
			// not worth it: keep the run's keys (and don't search inside it again)
			for (let m = i; m < run; m++) macro.push({ at: m, timing: tim[m]! });
			i = run;
			continue;
		}
		macro.push({ at: i, timing: tim[i]! });
		i++;
	}
	macro.push({ at: n - 1, timing: "" });
	const timing = mostCommon(macro.map((m) => m.timing).filter(Boolean)) || "linear";
	const groups = new Map<string, string[]>();
	const full = macro.map((m) => (m.timing && m.timing !== timing ? join(bodies[m.at]!, TF + m.timing) : bodies[m.at]!));
	// the constants go to the first and last keyframes, and to those that look the same (so they stay grouped)
	const ends = new Set([full[0], full[full.length - 1]]);
	macro.forEach((m, k) => {
		const body = ends.has(full[k]) ? join(full[k]!, spec.extra) : full[k]!;
		const sel = pct(pts[m.at]!.t);
		const g = groups.get(body);
		if (g) {
			if (g[g.length - 1] !== sel) g.push(sel);
		} else groups.set(body, [sel]);
	});
	let frames = "";
	for (const [body, sels] of groups) frames += `${sels.join(",")}{${body}}`;
	return { frames, timing, constant: false };
}

/** Two lists of declarations as one. */
const join = (a: string, b: string | undefined) => (a && b ? a + ";" + b : a || b || "");

/** The most frequent string, weighted by how much leaving it out saves (ties: the first). */
function mostCommon(list: string[]): string {
	const count = new Map<string, number>();
	for (const s of list) count.set(s, (count.get(s) ?? 0) + TF.length + s.length);
	let best = "",
		most = 0;
	for (const [s, c] of count)
		if (c > most) {
			best = s;
			most = c;
		}
	return best;
}

/**
 * Last key `b` > `a` such that keys a..b lie on the line from a to b (each value within half a
 * printed step, see projection), or `a` + 1.
 */
function longestRun(pts: Pt[], a: number, digits: number[]): number {
	let best = a + 1;
	const ra = pts[a]!.v.map((x, c) => round(x, digits[c]!));
	for (let b = a + 2; b < pts.length && b - a <= MAX_RUN; b++) {
		const p = projection(pts, ra, a, b, digits);
		if (!p) break;
		best = b;
	}
	return best;
}

/** Progress of keys a..b along the line between the printed values of a and b (null: off the line). */
function projection(pts: Pt[], ra: number[], a: number, b: number, digits: number[]): number[] | null {
	const rb = pts[b]!.v.map((x, c) => round(x, digits[c]!));
	const C = ra.length;
	const w = new Array<number>(C);
	let S = 0;
	for (let c = 0; c < C; c++) {
		w[c] = (rb[c]! - ra[c]!) * 10 ** digits[c]!;
		S += w[c]! * w[c]!;
	}
	// at least a few printed steps of change: below that the line's direction is noise
	if (S < 4) return null;
	const ps = [0];
	for (let m = a + 1; m < b; m++) {
		const v = pts[m]!.v;
		let dot = 0;
		const d = new Array<number>(C);
		for (let c = 0; c < C; c++) {
			d[c] = (v[c]! - ra[c]!) * 10 ** digits[c]!;
			dot += w[c]! * d[c]!;
		}
		const p = dot / S;
		for (let c = 0; c < C; c++) if (Math.abs(p * w[c]! - d[c]!) > 0.5) return null;
		ps.push(p);
	}
	ps.push(1);
	return ps;
}

interface LPoint {
	p: number;
	x: number;
}

/**
 * linear() for keys a..b (on one line): their progress at their times; holds as flat stretches
 * ending in a jump; eased pieces sampled within a quarter printed step. Null if too detailed.
 */
function linearFn(pts: Pt[], bodies: string[], a: number, b: number, digits: number[]): string | null {
	const ra = pts[a]!.v.map((x, c) => round(x, digits[c]!));
	const prog = projection(pts, ra, a, b, digits);
	if (!prog) return null;
	const rb = pts[b]!.v.map((x, c) => round(x, digits[c]!));
	let wmax = 0;
	for (let c = 0; c < ra.length; c++) wmax = Math.max(wmax, Math.abs(rb[c]! - ra[c]!) * 10 ** digits[c]!);
	// printed progress within a quarter step; eased pieces within another quarter
	const dp = Math.max(1, Math.ceil(Math.log10(2 * wmax)));
	const eps = 0.25 / wmax;
	const t0 = pts[a]!.t,
		span = pts[b]!.t - t0;
	const x = (m: number) => (pts[m]!.t - t0) / span;
	const list: LPoint[] = [];
	let budget = 4 * (b - a) + 64;
	for (let m = a; m < b; m++) {
		const p0 = prog[m - a]!,
			p1 = prog[m + 1 - a]!;
		const x0 = x(m),
			x1 = x(m + 1);
		list.push({ p: p0, x: x0 });
		const e = pts[m]!.ease;
		if (bodies[m] === bodies[m + 1]) continue;
		if (e === "hold") list.push({ p: p0, x: x1 });
		else if (Array.isArray(e) && !isLinearBezier(e, 1e-5)) {
			const before = list.length;
			sampleEase(e, 0, 1, 0, 1, eps / Math.max(EPS, Math.abs(p1 - p0)), 0, (u, y) => list.push({ p: p0 + (p1 - p0) * y, x: x0 + (x1 - x0) * u }));
			budget -= list.length - before;
			if (budget < 0) return null;
		}
	}
	list.push({ p: 1, x: 1 });
	// positions to a thousandth of a tick
	return serializeLinear(list, dp, Math.max(0, Math.ceil(Math.log10(Math.max(1, span)) + 1)));
}

/** Points inside an ease (u in time, y in progress) so straight lines between them stay within `tol`. */
function sampleEase(
	e: [number, number, number, number],
	u0: number,
	u1: number,
	y0: number,
	y1: number,
	tol: number,
	depth: number,
	emit: (u: number, y: number) => void,
) {
	const um = (u0 + u1) / 2;
	const ym = evalBezier(e, um);
	const q1 = evalBezier(e, (u0 + um) / 2),
		q3 = evalBezier(e, (um + u1) / 2);
	const off = Math.max(Math.abs(ym - (y0 + y1) / 2), Math.abs(q1 - (y0 * 3 + y1) / 4), Math.abs(q3 - (y0 + y1 * 3) / 4));
	if (off <= tol || depth >= 8) return;
	sampleEase(e, u0, um, y0, ym, tol, depth + 1, emit);
	emit(um, ym);
	sampleEase(e, um, u1, ym, y1, tol, depth + 1, emit);
}

/**
 * Writes linear() stops: equal neighbours become one stop with two positions (a flat stretch), a
 * position equal to the one before is written "0%" (clamped to it), evenly spaced positions
 * are left out (spread evenly between their neighbours), as are 0% first and 100% last.
 */
export function serializeLinear(list: LPoint[], dp: number, xd: number): string {
	interface Stop {
		p: string;
		x1: number;
		x2: number;
	}
	const stops: Stop[] = [];
	for (const pt of list) {
		const p = fmt(pt.p, dp);
		const last = stops[stops.length - 1];
		if (last && last.p === p) last.x2 = pt.x;
		else stops.push({ p, x1: pt.x, x2: pt.x });
	}
	const floorX = (x: number) => Math.floor(x * 100 * 10 ** xd + 1e-6) / 10 ** xd;
	const pos = (x: number) => fmt(floorX(x), xd) + "%";
	const out: string[] = new Array(stops.length);
	// position of the last written point (stops left out are spread evenly, so not known yet)
	let anchor = 0;
	let k = 0;
	while (k < stops.length) {
		const s = stops[k]!;
		const isLast = k === stops.length - 1;
		const jump = k > 0 && Math.abs(s.x1 - stops[k - 1]!.x2) < 1e-9;
		if (s.x2 - s.x1 > 1e-9 || jump || k === 0) {
			// written positions: the first stop at 0%, a jump clamped to the one before
			const p1 = k === 0 && s.x1 < 1e-9 ? "" : jump ? "0%" : pos(s.x1);
			const p2 = s.x2 - s.x1 > 1e-9 ? (isLast && s.x2 > 1 - 1e-9 ? "100%" : pos(s.x2)) : "";
			out[k] = [s.p, p1 || (p2 ? "0%" : ""), p2].filter(Boolean).join(" ");
			anchor = s.x2;
			k++;
			continue;
		}
		// plain points from here: leave out the positions of an evenly spaced stretch
		let e = k;
		const step = s.x1 - anchor;
		while (e + 1 < stops.length) {
			const nx = stops[e + 1]!;
			if (nx.x2 - nx.x1 > 1e-9 || Math.abs(nx.x1 - stops[e]!.x2) < 1e-9) break;
			if (Math.abs(nx.x1 - stops[e]!.x1 - step) > 1e-7) break;
			e++;
		}
		// stops k..e-1 spread evenly up to stop e, which is written (unless it is the last, at 100%)
		const endsAtLast = e === stops.length - 1 && stops[e]!.x1 > 1 - 1e-9;
		if (e === k) {
			out[k] = isLast && s.x1 > 1 - 1e-9 ? s.p : `${s.p} ${pos(s.x1)}`;
			anchor = s.x1;
			k++;
			continue;
		}
		for (let m = k; m < e; m++) out[m] = stops[m]!.p;
		out[e] = endsAtLast ? stops[e]!.p : `${stops[e]!.p} ${pos(stops[e]!.x1)}`;
		anchor = stops[e]!.x1;
		k = e + 1;
	}
	return `linear(${out.join(",")})`;
}

/** Groups keyframes with the same declarations ("0%,50%{...}"), in order of first use. */
export function groupFrames(frames: [string, string][]): string {
	const groups = new Map<string, string[]>();
	for (const [sel, body] of frames) {
		const g = groups.get(body);
		if (g) g.push(sel);
		else groups.set(body, [sel]);
	}
	let s = "";
	for (const [body, sels] of groups) s += `${sels.join(",")}{${body}}`;
	return s;
}
