/**
 * Part of the Flash API for the video component (fl.video): FLVPlayback on a <video>. Its states and
 * cue points as Flash Player has them (tests/fixtures/as3/f90-video.as).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function flv(L: any): Record<string, unknown> {
	const { Sprite, FEvent, scripts } = L;
	const safely = (f: () => void) => scripts.safely(f);

	class VideoEvent extends FEvent {
		static AUTO_REWOUND = "autoRewound";
		static BUFFERING_STATE_ENTERED = "bufferingStateEntered";
		static CLOSE = "close";
		static COMPLETE = "complete";
		static FAST_FORWARD = "fastForward";
		static PAUSED_STATE_ENTERED = "pausedStateEntered";
		static PLAYHEAD_UPDATE = "playheadUpdate";
		static PLAYING_STATE_ENTERED = "playingStateEntered";
		static READY = "ready";
		static REWIND = "rewind";
		static SCRUB_FINISH = "scrubFinish";
		static SCRUB_START = "scrubStart";
		static SEEKED = "seeked";
		static SKIN_LOADED = "skinLoaded";
		static STATE_CHANGE = "stateChange";
		static STOPPED_STATE_ENTERED = "stoppedStateEntered";
		state: string | null;
		playheadTime: number;
		vp = 0;
		constructor(type: string, bubbles = false, cancelable = false, state: string | null = null, playheadTime = NaN) {
			super(type, bubbles, cancelable);
			this.state = state;
			this.playheadTime = playheadTime;
		}
	}
	class MetadataEvent extends FEvent {
		static CUE_POINT = "cuePoint";
		static METADATA_RECEIVED = "metadataReceived";
		info: unknown;
		vp = 0;
		constructor(type: string, bubbles = false, cancelable = false, info: unknown = null) {
			super(type, bubbles, cancelable);
			this.info = info;
		}
	}
	const VideoState = { BUFFERING: "buffering", CONNECTION_ERROR: "connectionError", DISCONNECTED: "disconnected", EXEC_QUEUED_CMD: "execQueuedCmd", LOADING: "loading", PAUSED: "paused", PLAYING: "playing", REWINDING: "rewinding", SEEKING: "seeking", STOPPED: "stopped", RESIZING: "resizing" };

	type Cue = { name: string; "time": number; type: string; parameters?: unknown; index: number; array: Cue[] };

	class FLVPlayback extends Sprite {
		_cls = "FLVPlayback";
		_v: HTMLVideoElement;
		_p: Record<string, any>;
		_w: number;
		_h: number;
		_state = VideoState.DISCONNECTED;
		_cues: Cue[] = [];
		_past = -1;
		_fo: SVGElement;
		autoRewind: boolean;
		bufferTime = 0.1;
		isLive = false;
		scaleMode = "maintainAspectRatio";
		constructor(node: SVGElement, ct: any) {
			super(node);
			this._p = ct[1];
			this._w = ct[2];
			this._h = ct[3];
			const fo = node.querySelector("foreignObject") as SVGElement;
			this._fo = fo;
			this._v = fo.firstElementChild as HTMLVideoElement;
			// (the place belongs to the object)
			node.setAttribute("transform", `translate(${fo.getAttribute("x")} ${fo.getAttribute("y")})`);
			fo.removeAttribute("x");
			fo.removeAttribute("y");
			this.autoRewind = !!this._p.autoRewind;
			const v = this._v;
			const on = (type: string, f: () => void) => v.addEventListener(type, () => safely(f));
			const now = () => new VideoEvent(VideoEvent.STATE_CHANGE, false, false, this._state, this.playheadTime);
			const go = (state: string, type: string) => {
				this._state = state;
				this.dispatchEvent(now());
				this.dispatchEvent(new VideoEvent(type, false, false, state, this.playheadTime));
			};
			const cues = () => {
				const t = v.currentTime;
				for (const c of this._cues)
					if (c["time"] > this._past && c["time"] <= t) this.dispatchEvent(new MetadataEvent(MetadataEvent.CUE_POINT, false, false, { name: c.name, "time": c["time"], type: c.type, parameters: c.parameters }));
				this._past = t;
			};
			const beat = () => {
				if (this._state !== VideoState.PLAYING) return;
				safely(cues);
				requestAnimationFrame(beat);
			};
			on("loadedmetadata", () => {
				this.dispatchEvent(new MetadataEvent(MetadataEvent.METADATA_RECEIVED, false, false, { duration: v.duration, width: v.videoWidth, height: v.videoHeight }));
				go(VideoState.STOPPED, VideoEvent.STOPPED_STATE_ENTERED);
				this.dispatchEvent(new VideoEvent(VideoEvent.READY, false, false, this._state, this.playheadTime));
			});
			on("playing", () => {
				go(VideoState.PLAYING, VideoEvent.PLAYING_STATE_ENTERED);
				beat();
			});
			// (a video that ends is paused first: that isn't a pause)
			on("pause", () => void (!v.ended && v.currentTime < v.duration - 0.05 && this._state === VideoState.PLAYING && go(VideoState.PAUSED, VideoEvent.PAUSED_STATE_ENTERED)));
			on("ended", () => {
				cues();
				go(VideoState.STOPPED, VideoEvent.STOPPED_STATE_ENTERED);
				this.dispatchEvent(new VideoEvent(VideoEvent.COMPLETE, false, false, this._state, this.playheadTime));
				if (this.autoRewind) {
					v.currentTime = 0;
					this._past = -1;
					this.dispatchEvent(new VideoEvent(VideoEvent.AUTO_REWOUND, false, false, this._state, 0));
				}
			});
			on("seeked", () => {
				this._past = v.currentTime;
				// (one that was over waits at where it was sent to)
				if (this._state === VideoState.STOPPED && v.currentTime) go(VideoState.PAUSED, VideoEvent.PAUSED_STATE_ENTERED);
				this.dispatchEvent(new VideoEvent(VideoEvent.SEEKED, false, false, this._state, this.playheadTime));
			});
			on("timeupdate", () => this.dispatchEvent(new VideoEvent(VideoEvent.PLAYHEAD_UPDATE, false, false, this._state, this.playheadTime)));
		}
		_self() {
			return { l: 0, t: 0, r: this._w, b: this._h };
		}
		get width() {
			return this._w;
		}
		set width(v: number) {
			this.setSize(v, this._h);
		}
		get height() {
			return this._h;
		}
		set height(v: number) {
			this.setSize(this._w, v);
		}
		setSize(w: number, h: number) {
			this._w = w;
			this._h = h;
			this._fo.setAttribute("width", String(w));
			this._fo.setAttribute("height", String(h));
		}
		get source() {
			return this._p.source ?? this._v.getAttribute("src");
		}
		set source(s: string) {
			this._p.source = s;
			this._v.src = s;
			this._cues.length = 0;
		}
		load(s: string) {
			this.source = s;
		}
		get autoPlay() {
			return this._v.autoplay;
		}
		set autoPlay(v: boolean) {
			this._v.autoplay = !!v;
		}
		get state() {
			return this._state;
		}
		get "playing"() {
			return this._state === VideoState.PLAYING;
		}
		get paused() {
			return this._state === VideoState.PAUSED;
		}
		get stopped() {
			return this._state === VideoState.STOPPED;
		}
		get buffering() {
			return this._state === VideoState.BUFFERING;
		}
		get playheadTime() {
			return this._v.currentTime;
		}
		set playheadTime(t: number) {
			this.seek(t);
		}
		get totalTime() {
			return Number.isFinite(this._v.duration) ? this._v.duration : 0;
		}
		get playheadPercentage() {
			return this.totalTime ? (this.playheadTime / this.totalTime) * 100 : NaN;
		}
		set playheadPercentage(p: number) {
			this.seekPercent(p);
		}
		get volume() {
			return this._v.volume;
		}
		set volume(v: number) {
			this._v.volume = Math.max(0, Math.min(1, v));
		}
		get metadata() {
			return this._v.readyState ? { duration: this._v.duration, width: this._v.videoWidth, height: this._v.videoHeight } : null;
		}
		get bytesLoaded() {
			return 0;
		}
		get bytesTotal() {
			return 0;
		}
		play(source?: string) {
			if (typeof source === "string") this.source = source;
			void this._v.play().catch(() => {});
		}
		pause() {
			this._v.pause();
		}
		stop() {
			this._v.pause();
			this._v.currentTime = 0;
			this._past = -1;
		}
		seek(t: number) {
			this._v.currentTime = t;
		}
		seekSeconds(t: number) {
			this.seek(t);
		}
		seekPercent(p: number) {
			this.seek((this.totalTime * p) / 100);
		}
		seekToNavCuePoint(x: unknown) {
			const c = this.findCuePoint(x);
			if (c) this.seek(c["time"]);
		}
		closeVideoPlayer() {}
		addASCuePoint(time: any, name: string | null = null, parameters: unknown = null) {
			const o = typeof time === "object" ? time : { "time": time, name, parameters };
			const c: Cue = { name: o.name, "time": o["time"], type: "actionscript", index: 0, array: this._cues };
			if (o.parameters) c.parameters = o.parameters;
			this._cues.push(c);
			this._cues.sort((a, b) => a["time"] - b["time"]);
			this._cues.forEach((x, i) => (x.index = i));
			return c;
		}
		removeASCuePoint(x: unknown) {
			const c = this.findCuePoint(x);
			if (!c) return null;
			this._cues.splice(c.index, 1);
			this._cues.forEach((y, i) => (y.index = i));
			return c;
		}
		findCuePoint(x: any, _type = "all"): Cue | null {
			const by = typeof x === "object" && x ? (x.name ?? x["time"]) : x;
			return this._cues.find((c) => (typeof by === "number" ? c["time"] === by : c.name === by)) ?? null;
		}
		findNearestCuePoint(x: any, type = "all"): Cue | null {
			if (typeof x !== "number") return this.findCuePoint(x, type);
			let best: Cue | null = null;
			for (const c of this._cues) if (c["time"] <= x) best = c;
			return best;
		}
		findNextCuePointWithName(c: Cue) {
			return this._cues.slice(c.index + 1).find((y) => y.name === c.name) ?? null;
		}
	}

	return {
		FLVPlayback,
		VideoEvent,
		MetadataEvent,
		VideoState,
		VideoScaleMode: { MAINTAIN_ASPECT_RATIO: "maintainAspectRatio", NO_SCALE: "noScale", EXACT_FIT: "exactFit" },
		CuePointType: { ALL: "all", EVENT: "event", NAVIGATION: "navigation", FLV: "flv", ACTIONSCRIPT: "actionscript" },
	};
}
