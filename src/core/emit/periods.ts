/**
 * Repetition in a baked scene (bake.ts): the smallest period after which a node - its tracks, its
 * visibility and everything drawn inside it - repeats on the global clock. Looping movie clips
 * make the baked horizon long (up to the common multiple of all loops) and repeat their keys on
 * every loop; the Lottie writer draws repeating content once and plays it again with a time
 * remap instead.
 */
import type { Context } from "../context.ts";
import { valueAt, type Track } from "../tracks.ts";
import type { BakedNode, BakedTimeline, GTrack, Interval } from "./bake.ts";
import { playhead } from "./timing.ts";

function gcd(a: number, b: number): number {
	while (b) [a, b] = [b, a % b];
	return a;
}

export class Periods {
	readonly H: number;
	/** Periods worth trying, ascending: the loop lengths of the timelines and their common multiples. */
	private readonly candidates: number[];
	private nodes = new Map<BakedNode, number>();
	private timelines = new Map<string, Map<number, boolean>>();

	constructor(ctx: Context, H: number) {
		this.H = H;
		const base = new Set<number>();
		for (const id in ctx.programs) {
			const prog = ctx.programs[id]!;
			base.add(prog.frameCount);
			const cycle = playhead(prog).cycle.length;
			if (cycle) base.add(cycle);
			for (const l of prog.layers)
				for (const it of l.items)
					if (it.kind === "instance" && it.graphic) {
						const n = ctx.programs[it.symbol]?.frameCount ?? 0;
						for (const g of it.graphic) base.add(g.lastFrame >= g.firstFrame ? g.lastFrame - g.firstFrame + 1 : n);
					}
		}
		const set = new Set<number>();
		const max = Math.floor(H / 2);
		for (const p of base) if (p >= 1 && p <= max) set.add(p);
		// common multiples (a clip inside a clip repeats after both loops came round)
		for (let grew = true; grew;) {
			grew = false;
			for (const a of [...set])
				for (const b of [...set]) {
					const l = (a / gcd(a, b)) * b;
					if (l <= max && !set.has(l)) {
						set.add(l);
						grew = true;
					}
				}
			if (set.size > 64) break;
		}
		this.candidates = [...set].sort((a, b) => a - b);
	}

	/** The smallest period of a node, or H if it doesn't repeat. */
	node(n: BakedNode): number {
		let p = this.nodes.get(n);
		if (p === undefined) {
			p = this.H;
			for (const c of this.candidates)
				if (this.nodeRepeats(n, c)) {
					p = c;
					break;
				}
			this.nodes.set(n, p);
		}
		return p;
	}

	/** The smallest period of everything in a timeline, or H. */
	timeline(bt: BakedTimeline): number {
		for (const c of this.candidates) if (this.timelineRepeats(bt, c)) return c;
		return this.H;
	}

	private nodeRepeats(n: BakedNode, P: number): boolean {
		if (!visRepeats(n.vis, P, this.H)) return false;
		// values only matter while the node shows (between its shows a tween holds its end)
		const same = (t: GTrack) => trackRepeatsIn(t, n.vis, P, this.H);
		switch (n.kind) {
			case "instance": {
				for (const t of Object.values(n.transform)) if (!same(t)) return false;
				if (n.color) for (const t of Object.values(n.color)) if (!same(t)) return false;
				if (n.filters.length > 1) return false;
				return !n.child || this.timelineRepeats(n.child, P);
			}
			case "morph":
				return same(n.ratio) && same(n.frame);
			default:
				return true;
		}
	}

	private timelineRepeats(bt: BakedTimeline, P: number): boolean {
		let m = this.timelines.get(bt.key);
		if (!m) this.timelines.set(bt.key, (m = new Map()));
		const hit = m.get(P);
		if (hit !== undefined) return hit;
		m.set(P, true); // (cycle guard)
		let ok = !bt.view || Object.values(bt.view).every((t) => trackRepeats(t, P, this.H));
		for (const bl of bt.layers) {
			if (!ok) break;
			for (const n of bl.nodes)
				if (!this.nodeRepeats(n, P)) {
					ok = false;
					break;
				}
		}
		m.set(P, ok);
		return ok;
	}
}

/** True if the track over [P, H) is the track over [0, H - P) again. */
export function trackRepeats(track: GTrack, P: number, H: number): boolean {
	if (track.length <= 1 || P >= H) return true;
	return sameCurve(track, 0, track, P, H - P);
}

/** True if, on every visible stretch in [P, H), the track is what it was P ticks earlier. */
export function trackRepeatsIn(track: GTrack, vis: Interval[], P: number, H: number): boolean {
	if (track.length <= 1 || P >= H) return true;
	for (const [a, b] of vis) {
		const s = Math.max(a, P),
			e = Math.min(b, H);
		if (e > s && !sameCurve(track, s - P, track, s, e - s)) return false;
	}
	return true;
}

/**
 * True if track `a` from `ta` and track `b` from `tb` run the same over `len` ticks. Compared as
 * curves, not keys (the same motion can be keyed differently in each loop): at every key of
 * either, just before it (a jump) and inside each stretch, where a cubic ease can't hide.
 */
function sameCurve(a: GTrack, ta: number, b: GTrack, tb: number, len: number): boolean {
	const at = new Set<number>([0, len]);
	for (const k of a) if (k.t > ta && k.t < ta + len) at.add(k.t - ta);
	for (const k of b) if (k.t > tb && k.t < tb + len) at.add(k.t - tb);
	const times = [...at].sort((x, y) => x - y);
	const same = (u: number) => {
		const x = valueAt(a as Track, ta + u),
			y = valueAt(b as Track, tb + u);
		return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x));
	};
	for (let i = 0; i < times.length; i++) {
		const t0 = times[i]!;
		// (the end itself belongs to what follows: a new loop may start there)
		if (t0 < len && !same(t0)) return false;
		const t1 = times[i + 1];
		if (t1 === undefined) break;
		for (const f of [0.25, 0.5, 0.75]) if (!same(t0 + (t1 - t0) * f)) return false;
		if (!same(t1 - 1e-6 * (t1 - t0))) return false;
	}
	return true;
}

/** Intervals within [from, to), shifted by -from. */
function clipShift(vis: Interval[], from: number, to: number): Interval[] {
	const out: Interval[] = [];
	for (const [a, b] of vis) {
		const s = Math.max(a, from),
			e = Math.min(b, to);
		if (e > s) out.push([s - from, e - from]);
	}
	return out;
}

function visRepeats(vis: Interval[], P: number, H: number): boolean {
	if (P >= H) return true;
	const a = clipShift(vis, 0, H - P),
		b = clipShift(vis, P, H);
	return a.length === b.length && a.every(([s, e], i) => s === b[i]![0] && e === b[i]![1]);
}
