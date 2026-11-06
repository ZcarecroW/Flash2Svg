/**
 * The sounds of a baked animation on its one clock, for SMIL and CSS output. Every timeline instance
 * knows the frame it shows at each tick: a sound's frame entered is a sound due, a stream plays
 * while the playhead moves through its frames.
 */
import type { PFrameSound } from "../../player/format.ts";
import type { SoundSchedule } from "../../player/soundtrack.ts";
import type { Context } from "../context.ts";
import type { BakedTimeline, BakeResult, Horizon } from "./bake.ts";

/** A frame's sound as the player's list has it (`frameSounds` in player.ts): by timeline id. */
export type FrameSounds = (id: string) => PFrameSound[] | undefined;

/** Everything due, in tick order; null when nothing sounds. */
export function schedule(ctx: Context, bake: BakeResult, soundsOf: FrameSounds, snd: SoundSchedule["snd"]): SoundSchedule | null {
	const h: Horizon = bake.horizon;
	const ev: PFrameSound[] = [];
	const seen = new Set<string>();
	const walk = (bt: BakedTimeline, path: string) => {
		const id = bt.program.source ?? bt.program.id;
		const list = soundsOf(id);
		const frames = bt.frames;
		if (list && frames) {
			for (const e of list) {
				let t = 0;
				while (t < frames.length) {
					const entered = frames[t] === e[0] && (t === 0 || frames[t - 1] !== e[0]);
					if (!entered) {
						t++;
						continue;
					}
					const key = `${path}|${e[1]}|${t}`;
					if (!seen.has(key)) {
						seen.add(key);
						const copy = [...e] as PFrameSound;
						copy[0] = t;
						if (e[2] === 3) {
							// until the playhead leaves its frames
							let end = t + 1;
							while (end < frames.length && frames[end]! > frames[end - 1]! && frames[end]! < e[0] + e[4]) end++;
							copy[4] = end;
						}
						ev.push(copy);
					}
					t++;
				}
			}
		}
		let n = 0;
		for (const l of bt.layers) for (const node of l.nodes) if (node.kind === "instance" && node.child && node.item.symbolType !== "graphic") walk(node.child, `${path}/${n++}`);
	};
	walk(bake.root, "");
	void ctx;
	if (!ev.length) return null;
	ev.sort((a, b) => a[0] - b[0]);
	// (it repeats whole, from a tail, or not at all)
	return { snd, fps: h.fps, ticks: h.ticks, from: h.loop ? 0 : h.tail ? h.tail : -1, ev };
}
