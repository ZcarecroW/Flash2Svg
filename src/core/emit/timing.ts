/**
 * Which frame of a child timeline is showing.
 *  - Graphic symbols follow the parent timeline (loop / play once / single frame / reverse modes).
 *  - Movie clips run their own playhead from the moment they appear, honouring frame scripts
 *    (stop, play, gotoAndPlay, gotoAndStop).
 */
import type { FrameAction, InstanceItem, Program } from "../program.ts";

export function graphicFrame(item: InstanceItem, frame: number, childFrames: number): number {
	const ranges = item.graphic;
	if (!ranges?.length || childFrames <= 0) return 0;
	let r = ranges[0]!;
	for (const g of ranges) if (frame >= g.start) r = g;
	const off = Math.max(0, frame - r.start);
	const first = clampFrame(r.firstFrame, childFrames);
	const last = r.lastFrame >= 0 ? clampFrame(r.lastFrame, childFrames) : -1;
	switch (r.loop) {
		case "single frame":
			return first;
		case "play once":
			return Math.min(first + off, last >= first ? last : childFrames - 1);
		case "play once reverse":
			return Math.max(first - off, last >= 0 && last <= first ? last : 0);
		case "loop reverse": {
			if (last >= 0 && last <= first) {
				const len = first - last + 1;
				return first - (off % len);
			}
			return (((first - off) % childFrames) + childFrames) % childFrames;
		}
		default: {
			// "loop"
			if (last >= first && last >= 0 && last < childFrames - 1) {
				const len = last - first + 1;
				return first + (off % len);
			}
			return (first + off) % childFrames;
		}
	}
}

function clampFrame(f: number, count: number): number {
	return Math.max(0, Math.min(count - 1, Math.floor(f || 0)));
}

export interface Playhead {
	/** Frame shown at each tick for the first `prefix.length` ticks. */
	prefix: number[];
	/** Then this sequence repeats forever (empty => stays on the last prefix frame). */
	cycle: number[];
}

const playheadCache = new WeakMap<Program, Playhead>();

/**
 * Simulates a timeline's playhead from tick 0 (frame 0) with frame scripts.
 * The result is a prefix followed by an endlessly repeating cycle.
 */
export function playhead(prog: Program): Playhead {
	const cached = playheadCache.get(prog);
	if (cached) return cached;
	const n = Math.max(1, prog.frameCount);
	const labels = new Map(prog.labels.map((l) => [l.name, l.frame]));
	const resolve = (t: number | string): number => (typeof t === "number" ? Math.max(0, Math.min(n - 1, t - 1)) : (labels.get(t) ?? 0));
	// passes over frames whose actions depend on them, counted up to where nothing changes any more
	const caps = new Map<number, number>();
	for (const f in prog.actions) {
		let c = 0;
		for (const a of prog.actions[f]!) if (a.passes) c = Math.max(c, a.passes.from, a.passes.before);
		if (c) caps.set(+f, c);
	}
	const passes = new Map<number, number>();
	const applies = (a: FrameAction, f: number) => {
		if (!a.passes) return true;
		const p = passes.get(f) ?? 0;
		return (!a.passes.from || p >= a.passes.from) && (!a.passes.before || p < a.passes.before);
	};
	const frames: number[] = [];
	const seen = new Map<string, number>();
	let frame = 0;
	let playing = true;
	let result: Playhead | null = null;
	for (let tick = 0; tick < 100000; tick++) {
		// arriving at `frame` runs its scripts; a goto moves on at once (that frame isn't shown)
		for (let hop = 0; hop < 16; hop++) {
			const cap = caps.get(frame);
			if (cap) passes.set(frame, Math.min(cap, (passes.get(frame) ?? 0) + 1));
			let target = -1;
			for (const a of prog.actions[frame] ?? []) {
				if (!applies(a, frame)) continue;
				if (a.type === "stop") playing = false;
				else if (a.type === "play") playing = true;
				else {
					target = resolve(a.target);
					playing = a.play;
					break;
				}
			}
			if (target < 0) break;
			frame = target;
		}
		const state = `${frame}:${playing}:${[...passes.values()].join(",")}`;
		if (seen.has(state)) {
			const at = seen.get(state)!;
			result = { prefix: frames.slice(0, at), cycle: frames.slice(at) };
			break;
		}
		seen.set(state, tick);
		frames.push(frame);
		if (!playing) {
			result = { prefix: frames, cycle: [] };
			break;
		}
		frame = frame + 1 >= n ? 0 : frame + 1;
	}
	if (!result) result = { prefix: frames, cycle: [] };
	playheadCache.set(prog, result);
	return result;
}

export function playheadFrame(prog: Program, ticks: number): number {
	const p = playhead(prog);
	if (ticks < p.prefix.length) return p.prefix[ticks]!;
	if (!p.cycle.length) return p.prefix[p.prefix.length - 1] ?? 0;
	return p.cycle[(ticks - p.prefix.length) % p.cycle.length]!;
}
