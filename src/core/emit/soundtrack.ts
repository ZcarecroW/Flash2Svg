/**
 * Sounds as the output formats need them: what a timeline's frames play (the player's lists), the
 * sound files, and for SMIL and CSS output all of it on one clock. Every timeline instance knows the
 * frame it shows at each tick: a sound's frame entered is a sound due, a stream plays while the
 * playhead moves through its frames.
 */
import type { PFrameSound, PSound } from "../../player/format.ts";
import type { SoundSchedule } from "../../player/soundtrack.ts";
import type { Context } from "../context.ts";
import { audioMime } from "../mime.ts";
import type { BakedTimeline, Horizon } from "./bake.ts";
import { toBase64 } from "./document.ts";

const round = (v: number, d: number) => +v.toFixed(d);

/** The sounds a timeline's frames say. */
export function frameSounds(ctx: Context, id: string): PFrameSound[] {
	const tl = ctx.model.timelines[ctx.programs[id]?.source ?? id];
	const sd: PFrameSound[] = [];
	if (!tl) return sd;
	for (const layer of tl.layers)
		for (const kf of layer.keyframes) {
			const fs = kf.sound;
			if (!fs) continue;
			const sync = { event: 0, start: 1, stop: 2, stream: 3 }[fs.sync] ?? 0;
			const e: PFrameSound = [kf.index, fs.sound, sync, fs.loopMode === "loop" ? 9999 : fs.loops || 1, kf.duration];
			const snd = ctx.model.sounds[fs.sound];
			// in and out point in the file (encodeSounds cut off what no frame plays)
			const trim = snd?.trim ?? 0;
			const length = snd?.seconds;
			const lim = fs.limits;
			const inPt = lim ? Math.max(0, (lim.start - trim) / 44100) : 0;
			const outPt = lim && lim.end < 1073741823 ? (lim.end - trim) / 44100 : undefined;
			const hasOut = outPt !== undefined && (length === undefined || outPt < length - 1e-4);
			if (inPt > 1e-4 || hasOut) e.push(round(inPt, 4), hasOut ? round(outPt!, 4) : undefined);
			if (fs.envelope?.length) {
				while (e.length < 7) e.push(undefined);
				e.push(fs.envelope.flatMap(([t, l, r]) => [round(t / 44100, 4), round(l / 32768, 3), round(r / 32768, 3)]));
			}
			sd.push(e);
		}
	return sd;
}

/** The sound files: embedded, or as files next to the output. `lengths`: scripts ask how long a sound is. */
export function soundTable(ctx: Context, embed: boolean, assets: { path: string; source: string }[], lengths = false): Record<string, PSound> {
	const out: Record<string, PSound> = {};
	for (const sid in ctx.model.sounds) {
		const snd = ctx.model.sounds[sid]!;
		let url = snd.file;
		if (embed) url = `data:${audioMime(snd.file)};base64,${toBase64(ctx.files.readBinary(snd.file))}`;
		else assets.push({ path: snd.file, source: snd.file });
		const seconds = snd.seconds ?? (lengths && snd.samples ? snd.samples / 44100 : undefined);
		out[sid] = seconds !== undefined ? [url, round(seconds, 4), round(snd.lead ?? 0, 5)] : url;
	}
	return out;
}

/** Everything due, in tick order; null when nothing sounds. */
export function schedule(ctx: Context, root: BakedTimeline, h: Horizon, table: () => SoundSchedule["snd"]): SoundSchedule | null {
	const ev: PFrameSound[] = [];
	const lists = new Map<string, PFrameSound[]>();
	const walk = (bt: BakedTimeline) => {
		const id = bt.program.source ?? bt.program.id;
		let list = lists.get(id);
		if (!list) lists.set(id, (list = frameSounds(ctx, id)));
		const frames = bt.frames;
		if (frames)
			for (const e of list) {
				for (let t = 0; t < frames.length; t++) {
					if (frames[t] !== e[0] || (t > 0 && frames[t - 1] === e[0])) continue;
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
			}
		for (const l of bt.layers) for (const n of l.nodes) if (n.kind === "instance" && n.child && n.item.symbolType !== "graphic") walk(n.child);
	};
	walk(root);
	if (!ev.length) return null;
	ev.sort((a, b) => a[0] - b[0]);
	return { snd: table(), fps: h.fps, ticks: h.ticks, from: h.loop ? 0 : h.tail ? h.tail : -1, ev };
}
