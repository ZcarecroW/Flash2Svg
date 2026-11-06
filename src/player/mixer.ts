/**
 * Sounds: the player's, and those of SMIL and CSS output (soundtrack.ts), which keep the same
 * clock in a few lines.
 */
import type { PFrameSound, PSound } from "./format.ts";

/** a script's volume and pan are in the runtime with scripts only */
declare const __SCRIPTS__: boolean;

/** What the mixer needs of whoever keeps the time. */
export interface MixerHost {
	P: { snd: Record<string, PSound> };
	clock: number;
	running: boolean;
	speed: number;
	quiet: boolean;
	muted: boolean;
}

/** One playing (or waiting) sound. Its position runs on the player's clock, so it can start late. */
export class Voice {
	/** a script's volume and pan, and the nodes doing that */
	vol?: number;
	pan?: number;
	fx?: [GainNode, StereoPannerNode];
	src: AudioBufferSourceNode | null = null;
	el: HTMLAudioElement | null = null;
	done = false;
	readonly m: Mixer;
	readonly e: PFrameSound;
	/** player clock at position 0 */
	readonly born: number;
	constructor(m: Mixer, e: PFrameSound, born: number) {
		this.m = m;
		this.e = e;
		this.born = born;
	}
	pos() {
		return this.m.player.clock - this.born;
	}
	/** Detaches the playing node; the voice starts again (at its position) on the next start(). */
	hold() {
		if (this.src) {
			this.src.onended = null;
			try {
				this.src.stop();
			} catch {}
			this.src = null;
		}
		this.el?.pause();
		this.el = null;
	}
	stop() {
		this.done = true;
		this.hold();
		this.m.voices.delete(this);
	}
}

/**
 * Web Audio playback of frame sounds: in and out points and loops sample exact, volume envelopes,
 * stream sounds on the timeline's clock. Sounds that can't play yet (still decoding, or blocked
 * until the visitor interacts with the page) keep their position and join when they can: a long
 * event sound starts in the middle, a short one that is over by then stays silent.
 * Without Web Audio, or for a file it can't decode, an <audio> element plays instead.
 */
export class Mixer {
	readonly player: MixerHost;
	private ac: AudioContext | null = null;
	private out: GainNode | null = null;
	private bufs = new Map<string, AudioBuffer | null>();
	voices = new Set<Voice>();
	held = false;

	constructor(player: MixerHost) {
		this.player = player;
		const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext; __f2sAudio?: AudioContext };
		const AC = w.AudioContext ?? w.webkitAudioContext;
		try {
			// one context for all players on the page
			this.ac = w.__f2sAudio ??= new AC!();
		} catch {
			this.ac = null;
		}
		const ac = this.ac;
		if (ac) {
			this.out = ac.createGain();
			this.out.connect(ac.destination);
			ac.addEventListener("statechange", () => this.startAll());
			if (ac.state !== "running") {
				const unlock = () => void ac.resume().catch(() => {});
				unlock();
				for (const t of ["pointerdown", "keydown", "touchend"]) document.addEventListener(t, unlock, { capture: true, passive: true });
			}
		}
		for (const id in player.P.snd) this.load(id);
		// hidden tabs don't animate: hold the sounds there too
		document.addEventListener("visibilitychange", () => this.hold(document.hidden));
	}

	private info(id: string): [string, number, number] {
		const s = this.player.P.snd[id]!;
		return typeof s === "string" ? [s, 0, 0] : s;
	}

	private load(id: string) {
		const ac = this.ac;
		if (!ac) return void this.bufs.set(id, null);
		fetch(this.info(id)[0])
			.then((r) => r.arrayBuffer())
			.then((b) => ac.decodeAudioData(b))
			.then(
				(b) => this.bufs.set(id, b),
				() => this.bufs.set(id, null),
			)
			.then(() => this.startAll());
	}

	/** Event, start and stop sounds of a frame just entered. */
	trigger(e: PFrameSound) {
		const p = this.player;
		if (p.quiet) return;
		const mine = [...this.voices].filter((v) => v.e[1] === e[1]);
		if (e[2] === 2) return mine.forEach((v) => v.stop());
		// "start": only when that sound isn't playing yet
		if (e[2] === 1 && mine.some((v) => !v.done)) return;
		if (!p.muted) this.voice(e, 0);
	}

	/** A new voice at `pos` seconds into its playback. */
	voice(e: PFrameSound, pos: number): Voice {
		const v = new Voice(this, e, this.player.clock - pos);
		this.voices.add(v);
		this.start(v);
		return v;
	}

	hold(on: boolean) {
		this.held = on;
		if (on) this.voices.forEach((v) => v.hold());
		else this.startAll();
	}

	startAll() {
		this.voices.forEach((v) => this.start(v));
	}

	stopAll() {
		this.voices.forEach((v) => v.stop());
		this.voices.clear();
	}

	private start(v: Voice) {
		if (v.done) return;
		if (v.src || v.el || this.held || !this.player.running) return;
		const e = v.e;
		const id = e[1];
		const buf = this.bufs.get(id);
		if (buf === undefined) return; // still decoding
		const [url, len, lead] = this.info(id);
		const ac = this.ac;
		const speed = this.player.speed;
		const loops = e[3];
		const endless = loops >= 9999;
		const L = len || buf?.duration || 0;
		const a = e[5] ?? 0;
		const b = Math.min(e[6] ?? L, L || Infinity);
		const seg = b - a;
		const off = Math.max(0, v.pos());
		if (!(seg > 0) || (!endless && off >= seg * loops)) return v.stop();
		const at = a + (off % seg);
		const left = endless ? 0 : (seg * loops - off) / speed;
		if (buf && ac && this.out) {
			if (ac.state !== "running") return;
			// decoders that read no gapless header keep the encoder delay at the start
			const skip = buf.duration >= L + lead * 0.9 ? lead : 0;
			const src = ac.createBufferSource();
			src.buffer = buf;
			src.playbackRate.value = speed;
			if (loops > 1) {
				src.loop = true;
				src.loopStart = skip + a;
				src.loopEnd = skip + b;
			}
			const env = e[7];
			const tail = env ? this.envelope(ac, src, env, off, speed) : src;
			if (__SCRIPTS__ && v.vol !== undefined) {
				// (a script's volume and pan, which it can change while the sound plays)
				const g = ac.createGain();
				const p = ac.createStereoPanner();
				g.gain.value = v.vol;
				p.pan.value = v.pan ?? 0;
				tail.connect(g).connect(p).connect(this.out);
				v.fx = [g, p];
			} else tail.connect(this.out);
			src.onended = () => v.stop();
			src.start(0, skip + at);
			if (left) src.stop(ac.currentTime + left);
			v.src = src;
		} else if (!ac || buf === null) {
			const el = new Audio(url);
			let n = Math.floor(off / seg);
			el.currentTime = at;
			el.playbackRate = speed;
			el.ontimeupdate = () => {
				if (el.currentTime < b && !el.ended) return;
				if (++n < loops) el.currentTime = a;
				else v.stop();
			};
			el.onended = el.ontimeupdate;
			el.play().catch(() => {});
			v.el = el;
		}
	}

	/** Left and right volume over time ([t, left, right, ...] from the start of playback). */
	private envelope(ac: AudioContext, src: AudioNode, env: number[], off: number, speed: number): AudioNode {
		// mono sounds go to both sides first
		const up = ac.createGain();
		up.channelCount = 2;
		up.channelCountMode = "explicit";
		up.channelInterpretation = "speakers";
		const split = ac.createChannelSplitter(2);
		const merge = ac.createChannelMerger(2);
		src.connect(up).connect(split);
		const now = ac.currentTime;
		for (const k of [1, 2]) {
			const g = ac.createGain();
			g.gain.setValueAtTime(envelopeAt(env, k, off), now);
			for (let i = 0; i < env.length; i += 3) if (env[i]! > off) g.gain.linearRampToValueAtTime(env[i + k]!, now + (env[i]! - off) / speed);
			split.connect(g, k - 1).connect(merge, 0, k - 1);
		}
		return merge;
	}

	set muted(v: boolean) {
		if (this.out) this.out.gain.value = v ? 0 : 1;
		if (v) this.stopAll();
	}
}

/** Envelope volume of channel k (1 left, 2 right) at t seconds: linear between points, held outside. */
function envelopeAt(env: number[], k: number, t: number): number {
	if (t <= env[0]!) return env[k]!;
	for (let i = 3; i < env.length; i += 3)
		if (t < env[i]!) {
			const t0 = env[i - 3]!;
			return env[i - 3 + k]! + ((env[i + k]! - env[i - 3 + k]!) * (t - t0)) / (env[i]! - t0);
		}
	return env[env.length - 3 + k]!;
}
