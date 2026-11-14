/**
 * Sounds of SMIL and CSS output: where a script can run (inline, a file of its own, an <object>),
 * these few lines follow the animation's own clock and play what its frames say. The schedule comes
 * from the baked timelines: every sound on the document's clock (src/core/emit/soundtrack.ts).
 * The clock is the animation's, so pausing, a start trigger and a page scrolled away all count.
 */
import { Mixer, type MixerHost, type Voice } from "./mixer.ts";
import type { PFrameSound, PSound } from "./format.ts";

export interface SoundSchedule {
	snd: Record<string, PSound>;
	fps: number;
	/** Ticks of the whole, and from which one it repeats (-1: it doesn't). */
	ticks: number;
	from: number;
	/** At a tick: a frame sound ([tick, ...PFrameSound without its frame]), from tick order; a stream ends with the tick in [4]. */
	ev: PFrameSound[];
}

export default function soundtrack(S: SoundSchedule, id: string) {
	const svg = document.getElementById(id) as unknown as SVGSVGElement & { getAnimations(o: object): Animation[] };
	if (!svg) return;
	const host: MixerHost = { P: { snd: S.snd }, clock: 0, running: true, speed: 1, quiet: false, muted: false };
	const mixer = new Mixer(host);
	const smil = svg.querySelector("animate,animateTransform,animateMotion,set") as SVGAnimationElement | null;

	/** Seconds the animation has played, or null while it hasn't begun. */
	const now = (): number | null => {
		if (smil) {
			try {
				return svg.getCurrentTime() - smil.getStartTime();
			} catch {
				return null;
			}
		}
		// (kept: listing every animation of the document each frame, to read one clock, costs;
		// an animation its element let go of — a start trigger set another — is idle: asked anew)
		// (the document's animations where the subtree's aren't found: WebKit, see triggers.ts)
		if (!css || css.playState === "idle") css = svg.getAnimations?.({ subtree: true })[0] ?? document.getAnimations?.().find((a) => svg.contains((a.effect as KeyframeEffect | null)?.target ?? null));
		const a = css;
		if (a) return a.playState === "paused" || typeof a.currentTime !== "number" ? null : a.currentTime / 1000;
		return null;
	};
	let css: Animation | undefined;
	const streams = new Map<PFrameSound, Voice>();
	const span = S.ticks - S.from;
	/** The tick a time is on, looped; each pass of the loop has its own number. */
	const place = (t: number): [number, number] => {
		const k = t * S.fps;
		if (S.from < 0 || k < S.ticks) return [k, 0];
		const over = k - S.from;
		return [S.from + (over % span), Math.floor(over / span)];
	};
	let last = -1,
		pass = 0;
	const frame = () => {
		requestAnimationFrame(frame);
		const t = now();
		// (a paused animation — a hover start the pointer left — holds its sounds where they are)
		const still = t === null || document.hidden;
		if (still !== mixer.held) mixer.hold(still);
		if (t === null || still) return;
		host.clock = t;
		const [k, p] = place(t);
		const wrapped = p !== pass;
		// (back in time, or round the loop: streams start again where the animation is)
		if (last > k || wrapped) streams.forEach((v) => v.stop());
		for (const e of S.ev) {
			const at = e[0];
			// round the loop: the rest of this pass, then the loop's own ticks (not the intro's before it)
			const due = wrapped ? at > last || (at >= S.from && at <= k) : at > last && at <= k;
			if (e[2] === 3) {
				// a stream plays between its ticks, from where the animation is
				const on = k >= at && k < e[4];
				const v = streams.get(e);
				if (on && (!v || v.done)) streams.set(e, mixer.voice(e, (k - at) / S.fps));
				else if (!on && v) {
					v.stop();
					streams.delete(e);
				}
			} else if (due) mixer.trigger(e);
		}
		last = k;
		pass = p;
	};
	// (ticks start at 0: a sound on the first frame is due at once)
	last = -1;
	requestAnimationFrame(frame);
}
