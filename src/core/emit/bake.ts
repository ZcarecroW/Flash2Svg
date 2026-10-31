/**
 * "Bakes" the scene onto one global clock for the declarative emitters (SMIL, CSS).
 *
 * Every timeline instance gets an array: the frame of that timeline shown at each global tick
 * (or -1). Movie clips run their own playhead from the moment they appear, graphic symbols
 * follow their parent, buttons show their Up frame. Local animation tracks are then mapped onto
 * global time, run by run, with exact cut-down Bezier pieces at the edges.
 */
import { subBezier } from "../easing.ts";
import { COLOR_PROPS, TRANSFORM_PROPS, type ColorProp, type InstanceItem, type Item, type Program, type ProgramLayer, type TransformProp } from "../program.ts";
import { valueAt, type Ease, type Track } from "../tracks.ts";
import type { Context } from "../context.ts";
import type { MorphPart } from "../morph.ts";
import type { FilterData } from "../model.ts";
import { graphicFrame, playhead, playheadFrame } from "./timing.ts";

export interface GKey {
	/** Global time in ticks (frames of the root timeline), may be fractional. */
	t: number;
	v: number;
	ease: Ease;
}
export type GTrack = GKey[];
/** [startTick, endTick) */
export type Interval = [number, number];

export interface Horizon {
	ticks: number;
	loop: boolean;
	fps: number;
	/**
	 * Not looping, but movie clips keep running after the root timeline stopped (Flash semantics):
	 * after one pass the ticks [tail, ticks) repeat forever. 0 = no such tail.
	 */
	tail: number;
}

export interface BakeOptions {
	smooth: boolean;
	/** "auto" follows frame scripts (stop()); "always"/"never" override. */
	loop: "auto" | "always" | "never";
	startFrame?: number;
	endFrame?: number;
	maxTicks?: number;
	/** Shape tweens as path morphs where SMIL can animate them (see morph.ts); else frame by frame. */
	morph?: boolean;
	/** ... also those whose gradient or pattern matrix turns (the SMIL writer animates the rotation per frame). */
	turning?: boolean;
}

export interface BakedTimeline {
	key: string;
	program: Program;
	layers: BakedLayer[];
	/** True if anything inside changes over time. */
	animated: boolean;
	/** Camera transform (root scenes). */
	view?: Record<TransformProp, GTrack>;
}

export interface BakedLayer {
	layer: ProgramLayer;
	nodes: BakedNode[];
}

interface NodeBase {
	/** Ticks during which the node is displayed. */
	vis: Interval[];
	uid: string;
}
export interface BakedArt extends NodeBase {
	kind: "art";
	art: string;
}
export interface BakedStatic extends NodeBase {
	kind: "bitmap" | "text" | "video";
	item: Item;
}
export interface BakedInstance extends NodeBase {
	kind: "instance";
	item: InstanceItem;
	transform: Record<TransformProp, GTrack>;
	color: Record<ColorProp, GTrack> | null;
	filters: { t: number; filters: FilterData[] }[];
	child: BakedTimeline | null;
	/** Buttons: Over and Down states (Up is `child`). */
	states?: BakedTimeline[];
}
/** Frames of a shape tween drawn as one morphing drawing. */
export interface BakedMorph extends NodeBase {
	kind: "morph";
	part: MorphPart;
	/** The blend ratio. */
	ratio: GTrack;
	/** Position in the part's frames (0 = its first), for channels with values per frame. */
	frame: GTrack;
}
export type BakedNode = BakedArt | BakedStatic | BakedInstance | BakedMorph;

export interface BakeResult {
	horizon: Horizon;
	root: BakedTimeline;
	/** The root timeline's frame at each tick of the horizon. */
	frames: Int32Array;
	/** All distinct baked timelines (for shared <defs>). */
	timelines: BakedTimeline[];
}

const EMPTY = -1;

export function bake(ctx: Context, rootId: string, opts: BakeOptions): BakeResult {
	const prog = ctx.programs[rootId];
	if (!prog) throw new Error(`Unknown timeline ${rootId}`);
	const fps = ctx.model.doc.frameRate || 24;
	const maxTicks = opts.maxTicks ?? Math.max(1, Math.round(fps * 600));

	// ---- root playhead over the horizon
	let frames: number[];
	let loop: boolean;
	if (opts.startFrame !== undefined || opts.endFrame !== undefined || opts.loop === "always") {
		const s = Math.max(0, Math.min(prog.frameCount - 1, opts.startFrame ?? 0));
		const e = Math.max(s + 1, Math.min(prog.frameCount, opts.endFrame ?? prog.frameCount));
		frames = [];
		for (let f = s; f < e; f++) frames.push(f);
		loop = opts.loop !== "never";
	} else {
		const p = playhead(prog);
		frames = [...p.prefix, ...p.cycle];
		loop = p.cycle.length > 0 && opts.loop !== "never";
	}
	if (!frames.length) frames = [0];

	// Movie clips that live for the whole root timeline keep running across the loop: extend the
	// horizon to a common multiple so they come round exactly.
	let H = frames.length;
	// set when running movie clips have no common period within maxTicks
	let tooLong = false;
	if (loop) {
		for (const layer of prog.layers) {
			for (const it of layer.items) {
				if (it.kind !== "instance" || it.symbolType !== "movie clip" || it.start > 0 || it.end < prog.frameCount) continue;
				const child = ctx.programs[it.symbol];
				if (!child) continue;
				const ph = playhead(child);
				if (ph.prefix.length || !ph.cycle.length) continue;
				const l = lcm(H, ph.cycle.length);
				if (l <= maxTicks) H = l;
				else tooLong = true;
			}
		}
	}
	// A root that stops (stop() script) leaves its movie clips running: extend the horizon until
	// they have played their intros, then loop their common period as a tail.
	let tail = 0;
	if (!loop && opts.loop !== "never" && opts.startFrame === undefined && opts.endFrame === undefined) {
		const P = frames.length;
		const last = frames[P - 1]!;
		let start = P,
			period = 1;
		for (const layer of prog.layers) {
			for (const it of layer.items) {
				if (it.kind !== "instance" || it.symbolType !== "movie clip" || last < it.start || last >= it.end) continue;
				const child = ctx.programs[it.symbol];
				if (!child || child.frameCount <= 1) continue;
				// age (ticks shown) of the clip when the root stops
				let age = 0;
				for (let t = P - 1; t >= 0 && frames[t]! >= it.start && frames[t]! < it.end; t--) age++;
				start = Math.max(start, P + playhead(child).prefix.length - age);
				const l = lcm(period, clipPeriod(ctx, child, maxTicks, 0));
				if (l <= maxTicks) period = l;
				else tooLong = true;
			}
		}
		if (start + (period > 1 ? period : 0) > maxTicks) tooLong = true;
		else {
			if (period > 1) tail = start;
			H = start + (period > 1 ? period : 0);
		}
	}
	if (tooLong) {
		const m = `Movie clips with loops of very different lengths keep running: SMIL/CSS repeat after ${Math.round(maxTicks / fps)} s at most, so some clips jump when the animation repeats (the JS player is exact)`;
		if (!ctx.warnings.includes(m)) ctx.warnings.push(m);
	}
	const rootFrames = new Int32Array(H);
	for (let t = 0; t < H; t++) rootFrames[t] = t < frames.length ? frames[t]! : loop ? frames[t % frames.length]! : frames[frames.length - 1]!;

	const baker = new Baker(ctx, opts.smooth, H, opts.morph, opts.turning);
	const root = baker.timeline(prog, rootFrames, 0);
	return { horizon: { ticks: H, loop, fps, tail }, root, frames: rootFrames, timelines: baker.all };
}

/** Ticks after which a running movie clip (and the clips running inside it) repeats; 1 = it stops. */
function clipPeriod(ctx: Context, prog: Program, max: number, depth: number): number {
	const ph = playhead(prog);
	let p = ph.cycle.length || 1;
	if (depth > 8) return p;
	const final = ph.cycle.length ? -1 : (ph.prefix[ph.prefix.length - 1] ?? 0);
	for (const layer of prog.layers) {
		for (const it of layer.items) {
			if (it.kind !== "instance" || it.symbolType !== "movie clip") continue;
			// looping: only clips that live through the whole timeline keep running across the loop;
			// stopped: the clips on the frame it stopped at
			if (final < 0 ? it.start > 0 || it.end < prog.frameCount : final < it.start || final >= it.end) continue;
			const child = ctx.programs[it.symbol];
			if (!child || child.frameCount <= 1) continue;
			const l = lcm(p, clipPeriod(ctx, child, max, depth + 1));
			if (l <= max) p = l;
		}
	}
	return p;
}

/** The track up to `t`, then holding the value it has at `t`. */
export function holdFrom(track: GTrack, t: number): GTrack {
	const out = sliceTrack(track, 0, t);
	push(out, { t, v: valueAt(track as Track, t), ease: "hold" });
	return out;
}

/** The part of a track in [from, to), shifted to start at 0 (eased segments cut exactly). */
export function sliceTrack(track: GTrack, from: number, to: number): GTrack {
	const out: GTrack = [];
	windowKeys(track as Track, from, to, -from, out);
	return out;
}

function gcd(a: number, b: number): number {
	while (b) [a, b] = [b, a % b];
	return a;
}
function lcm(a: number, b: number): number {
	return (a / gcd(a, b)) * b;
}

/** A stretch of global ticks during which local time either advances 1:1 or holds. */
interface Run {
	t0: number;
	t1: number;
	l0: number;
	advance: boolean;
}

class Baker {
	readonly all: BakedTimeline[] = [];
	private cache = new Map<string, BakedTimeline>();
	readonly ctx: Context;
	readonly smooth: boolean;
	readonly H: number;
	readonly morph: boolean;
	readonly turning: boolean;
	constructor(ctx: Context, smooth: boolean, H: number, morph = false, turning = false) {
		this.ctx = ctx;
		this.smooth = smooth;
		this.H = H;
		this.morph = morph;
		this.turning = turning;
	}

	timeline(prog: Program, frames: Int32Array, depth: number): BakedTimeline {
		const key = prog.id + "#" + hashFrames(frames);
		const hit = this.cache.get(key);
		if (hit) return hit;
		const bt: BakedTimeline = { key, program: prog, layers: [], animated: false };
		this.cache.set(key, bt);
		if (depth > 48) return bt;
		if (prog.view) {
			const runs = this.runs(frames, 0, prog.frameCount);
			bt.view = {} as Record<TransformProp, GTrack>;
			for (const p of TRANSFORM_PROPS) {
				bt.view[p] = this.mapTrack(prog.view[p], runs);
				if (bt.view[p].length > 1) bt.animated = true;
			}
		}
		for (const layer of prog.layers) {
			const bl: BakedLayer = { layer, nodes: [] };
			for (const item of layer.items) this.item(bt, bl, item, frames, depth);
			bt.layers.push(bl);
		}
		this.all.push(bt);
		return bt;
	}

	private item(bt: BakedTimeline, bl: BakedLayer, item: Item, frames: Int32Array, depth: number) {
		const runs = this.runs(frames, item.start, item.end);
		if (!runs.length) return;
		const vis = intervals(runs);
		if (!isAlways(vis, this.H)) bt.animated = true;
		switch (item.kind) {
			case "art":
				bl.nodes.push({ kind: "art", art: item.art, vis, uid: item.uid });
				return;
			case "bitmap":
			case "text":
			case "video":
				bl.nodes.push({ kind: item.kind, item, vis, uid: item.uid });
				return;
			case "artSeq": {
				// shape tweens: frames blended by a morph drawing, see morph.ts
				const morph = this.morph ? this.ctx.morph(item) : null;
				const parts = morph ? morph.parts.filter((p) => p.smil || (this.turning && p.turns)) : [];
				// one node per distinct drawing (or morph), shown on the ticks where it is the current frame
				const byArt = new Map<string, number[]>();
				const byPart = new Map<MorphPart, number[]>();
				for (let t = 0; t < this.H; t++) {
					const f = frames[t]!;
					if (f < item.start || f >= item.end) continue;
					const k = Math.min(item.arts.length - 1, f - item.start);
					const part = parts.find((p) => k >= p.from && k < p.to);
					if (part) {
						(byPart.get(part) ?? byPart.set(part, []).get(part)!).push(t);
						continue;
					}
					const art = item.arts[k];
					if (!art) continue;
					(byArt.get(art) ?? byArt.set(art, []).get(art)!).push(t);
				}
				let i = 0;
				for (const [art, ticks] of byArt) bl.nodes.push({ kind: "art", art, vis: tickIntervals(ticks), uid: `${item.uid}#${i++}` });
				for (const [part, ticks] of byPart) {
					const at = item.start + part.from;
					const frame: Track = [];
					if (part.channels.some((c) => c.f)) {
						for (let k = 0; k < part.to - part.from; k++) frame.push({ t: at + k, v: k, ease: "linear" });
						frame[frame.length - 1]!.ease = "hold";
					}
					bl.nodes.push({
						kind: "morph",
						part,
						ratio: this.mapTrack(part.ratio ?? morph!.ratio, runs),
						frame: frame.length ? this.mapTrack(frame, runs) : [],
						vis: tickIntervals(ticks),
						uid: `${item.uid}#m${part.from}`,
					});
				}
				bt.animated = true;
				return;
			}
			case "instance": {
				const transform = {} as Record<TransformProp, GTrack>;
				for (const p of TRANSFORM_PROPS) {
					transform[p] = this.mapTrack(item.transform[p], runs);
					if (transform[p].length > 1) bt.animated = true;
				}
				let color: Record<ColorProp, GTrack> | null = null;
				if (item.color) {
					color = {} as Record<ColorProp, GTrack>;
					for (const p of COLOR_PROPS) {
						color[p] = this.mapTrack(item.color[p], runs);
						if (color[p].length > 1) bt.animated = true;
					}
				}
				const filters = this.mapFilters(item, runs);
				if (filters.length > 1) bt.animated = true;
				const childProg = this.ctx.programs[item.symbol];
				let child: BakedTimeline | null = null;
				if (childProg) {
					const cf = this.childFrames(item, childProg, frames);
					child = this.timeline(childProg, cf, depth + 1);
					if (child.animated) bt.animated = true;
				}
				const node: BakedInstance = { kind: "instance", item, vis, uid: item.uid, transform, color, filters, child };
				if (item.symbolType === "button" && childProg && childProg.frameCount > 1) {
					node.states = [1, 2]
						.filter((f) => f < childProg.frameCount)
						.map((f) => this.timeline(childProg, new Int32Array(this.H).fill(f), depth + 1));
				}
				bl.nodes.push(node);
				return;
			}
		}
	}

	private childFrames(item: InstanceItem, child: Program, frames: Int32Array): Int32Array {
		const H = this.H;
		const out = new Int32Array(H).fill(EMPTY);
		const active = (t: number) => {
			const f = frames[(t + H) % H]!;
			return f >= item.start && f < item.end;
		};
		if (item.symbolType === "graphic") {
			for (let t = 0; t < H; t++) if (active(t)) out[t] = graphicFrame(item, frames[t]!, child.frameCount);
			return out;
		}
		if (item.symbolType === "button") {
			for (let t = 0; t < H; t++) if (active(t)) out[t] = 0;
			return out;
		}
		// movie clip: own playhead from appearance
		let age = 0;
		for (let t = 0; t < H; t++) {
			if (!active(t)) {
				age = 0;
				continue;
			}
			out[t] = playheadFrame(child, age);
			age++;
		}
		return out;
	}

	/** Splits the ticks where frames[t] is in [start, end) into advancing / holding runs. */
	private runs(frames: Int32Array, start: number, end: number): Run[] {
		const out: Run[] = [];
		let cur: Run | null = null;
		for (let t = 0; t < this.H; t++) {
			const f = frames[t]!;
			if (f < start || f >= end) {
				cur = null;
				continue;
			}
			if (cur) {
				const expectedAdvance: number = cur.l0 + (t - cur.t0);
				const prevF = frames[t - 1]!;
				if (cur.t1 - cur.t0 === 1 && f === prevF + 1) {
					cur.advance = true;
					cur.t1 = t + 1;
					continue;
				}
				if (cur.advance && f === expectedAdvance) {
					cur.t1 = t + 1;
					continue;
				}
				if (!cur.advance && f === cur.l0) {
					cur.t1 = t + 1;
					continue;
				}
			}
			cur = { t0: t, t1: t + 1, l0: f, advance: false };
			out.push(cur);
		}
		return out;
	}

	private mapTrack(track: Track, runs: Run[]): GTrack {
		const out: GTrack = [];
		for (const r of runs) {
			if (!r.advance) {
				push(out, { t: r.t0, v: valueAt(track, r.l0), ease: "hold" });
				continue;
			}
			const len = r.t1 - r.t0;
			if (!this.smooth) {
				for (let i = 0; i < len; i++) push(out, { t: r.t0 + i, v: valueAt(track, r.l0 + i), ease: "hold" });
				continue;
			}
			windowKeys(track, r.l0, r.l0 + len, r.t0 - r.l0, out);
			const last = out[out.length - 1];
			if (last) last.ease = "hold";
		}
		return compact(out);
	}

	private mapFilters(item: InstanceItem, runs: Run[]): { t: number; filters: FilterData[] }[] {
		if (!item.filters.length) return [];
		const at = (l: number) => {
			let fs = item.filters[0]!.filters;
			for (const f of item.filters) if (f.t <= l) fs = f.filters;
			return fs;
		};
		const out: { t: number; filters: FilterData[]; sig: string }[] = [];
		const add = (t: number, fs: FilterData[]) => {
			const sig = JSON.stringify(fs);
			const last = out[out.length - 1];
			if (last && last.sig === sig) return;
			out.push({ t, filters: fs, sig });
		};
		for (const r of runs) {
			add(r.t0, at(r.l0));
			if (r.advance) {
				for (const f of item.filters) if (f.t > r.l0 && f.t < r.l0 + (r.t1 - r.t0)) add(r.t0 + (f.t - r.l0), f.filters);
			}
		}
		return out.map(({ t, filters }) => ({ t, filters }));
	}
}

/** Appends the keys of `track` between local times [l0, l1) shifted by `shift`, cutting eased segments exactly. */
function windowKeys(track: Track, l0: number, l1: number, shift: number, out: GTrack) {
	if (!track.length) return;
	// index of the segment containing l0
	let i = 0;
	while (i < track.length - 1 && track[i + 1]!.t <= l0) i++;
	let t = l0;
	while (t < l1) {
		const a = track[i]!;
		const b = track[i + 1];
		if (!b || t < a.t) {
			// before the first key or after the last: constant
			push(out, { t: t + shift, v: valueAt(track, t), ease: "hold" });
			if (!b && t >= a.t) break;
			t = Math.min(l1, a.t);
			continue;
		}
		const segEnd = Math.min(b.t, l1);
		const v0 = valueAt(track, t);
		let ease: Ease = a.ease;
		if (Array.isArray(a.ease) && (t > a.t || segEnd < b.t)) {
			const span = b.t - a.t;
			const sub = subBezier(a.ease, (t - a.t) / span, (segEnd - a.t) / span);
			ease = sub.bezier;
		}
		push(out, { t: t + shift, v: v0, ease });
		if (segEnd >= l1) {
			// close at the window end with the exact value reached there
			if (a.ease !== "hold") push(out, { t: l1 + shift, v: valueAt(track, l1 - 1e-9), ease: "hold" });
			break;
		}
		t = segEnd;
		i++;
	}
}

function push(out: GTrack, k: GKey) {
	const last = out[out.length - 1];
	if (last && Math.abs(last.t - k.t) < 1e-9 && last.ease === "hold" && Math.abs(last.v - k.v) < 1e-12) {
		last.ease = k.ease;
		return;
	}
	out.push(k);
}

/** Drops redundant keys (repeated holds of the same value). */
/** Sorted ticks as intervals [start, end). */
function tickIntervals(ticks: number[]): Interval[] {
	const v: Interval[] = [];
	for (const t of ticks) {
		const last = v[v.length - 1];
		if (last && last[1] === t) last[1] = t + 1;
		else v.push([t, t + 1]);
	}
	return v;
}

function compact(keys: GTrack): GTrack {
	const out: GTrack = [];
	for (const k of keys) {
		const last = out[out.length - 1];
		if (last && last.ease === "hold" && Math.abs(last.v - k.v) < 1e-9) {
			// same value continues: merge (keep the earliest key, adopt the new ease)
			if (k.ease !== "hold") last.ease = k.ease;
			continue;
		}
		if (last && Math.abs(last.t - k.t) < 1e-9 && Math.abs(last.v - k.v) < 1e-9) {
			last.ease = k.ease;
			continue;
		}
		out.push(k);
	}
	// a single remaining key = constant
	return out.length ? out : keys.slice(0, 1);
}

function intervals(runs: Run[]): Interval[] {
	const out: Interval[] = [];
	for (const r of runs) {
		const last = out[out.length - 1];
		if (last && last[1] === r.t0) last[1] = r.t1;
		else out.push([r.t0, r.t1]);
	}
	return out;
}

export function isAlways(vis: Interval[], H: number): boolean {
	return vis.length === 1 && vis[0]![0] === 0 && vis[0]![1] >= H;
}

function hashFrames(frames: Int32Array): string {
	// FNV-1a over the frame numbers + length
	let h = 0x811c9dc5;
	for (let i = 0; i < frames.length; i++) {
		h ^= frames[i]! + 2;
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36) + "." + frames.length;
}

export function isConstantTrack(t: GTrack): boolean {
	return t.length <= 1 || t.every((k) => Math.abs(k.v - t[0]!.v) < 1e-9);
}

export function trackValueAt(t: GTrack, tick: number): number {
	return valueAt(t as Track, tick);
}
