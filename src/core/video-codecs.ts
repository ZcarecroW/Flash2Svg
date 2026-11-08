/**
 * The encoders of a video export (video.ts): WebCodecs and Web Audio of the page this runs in — the
 * panel's browser, or a browser the command line drives (src/cli/browser-codecs.ts). Nothing here
 * needs more than a browser, so the command line loads it into one as it is.
 */
import type { SoundSchedule } from "../player/soundtrack.ts";
import type { AudioTrack, Sample } from "./mux.ts";

/** What encodes a video's pictures and sounds. */
export interface VideoEncoders {
	/** The first configuration of `candidates` the host's encoder takes; an error when none. */
	pick(format: "mp4" | "webm", candidates: VideoEncoderConfig[]): Promise<VideoEncoderConfig>;
	/** Starts encoding pictures with that configuration. */
	open(config: VideoEncoderConfig): Promise<FrameSink>;
	/** The sounds mixed to one stereo track and encoded (AAC in MP4 where there is an encoder, else Opus); null when the host can't. */
	sound(schedule: SoundSchedule, seconds: number, format: "mp4" | "webm"): Promise<AudioTrack | null>;
}

/** Pictures in: I420 at the configured size, BT.709 in video range; timestamps and durations in microseconds. */
export interface FrameSink {
	encode(i420: Uint8Array, width: number, height: number, timestamp: number, duration: number, key: boolean): Promise<void>;
	close(): Promise<{ samples: Sample[]; description?: Uint8Array }>;
}

/** A copy of what an encoder hands over. */
const bytesOf = (d: AllowSharedBufferSource): Uint8Array =>
	(ArrayBuffer.isView(d) ? new Uint8Array(d.buffer as ArrayBuffer, d.byteOffset, d.byteLength) : new Uint8Array(d as ArrayBuffer)).slice();

/** The host's own encoders (WebCodecs, Web Audio). */
export function webCodecs(): VideoEncoders {
	return {
		async pick(format, candidates) {
			if (typeof VideoEncoder === "undefined") throw new Error("This host has no video encoder: MP4 and WebM export from the panel (WebCodecs)");
			for (const config of candidates) {
				const r = await VideoEncoder.isConfigSupported(config).catch(() => null);
				if (r?.supported) return config;
			}
			throw new Error(`This host's video encoders can't write ${format.toUpperCase()}`);
		},
		async open(config) {
			const samples: Sample[] = [];
			let description: Uint8Array | undefined;
			let failure: Error | null = null;
			const enc = new VideoEncoder({
				output: (c, meta) => {
					const data = new Uint8Array(c.byteLength);
					c.copyTo(data);
					samples.push({ data, time: c.timestamp, duration: c.duration ?? 0, key: c.type === "key" });
					const d = meta?.decoderConfig?.description;
					if (d && !description) description = bytesOf(d);
				},
				error: (e) => void (failure = e),
			});
			enc.configure(config);
			return {
				async encode(i420, width, height, timestamp, duration, key) {
					if (failure) throw failure;
					const frame = new VideoFrame(i420, {
						format: "I420",
						codedWidth: width,
						codedHeight: height,
						timestamp,
						duration,
						colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false },
					});
					enc.encode(frame, { keyFrame: key });
					frame.close();
					// (the encoder takes its time: no more than a few frames in memory)
					while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
				},
				async close() {
					await enc.flush();
					enc.close();
					if (failure) throw failure;
					for (const s of samples) if (!s.duration) s.duration = Math.round(1e6 / (config.framerate ?? 24));
					return { samples, description };
				},
			};
		},
		async sound(schedule, seconds, format) {
			const mixed = await mixSounds(schedule, seconds);
			// (Opus in both when the encoder has no AAC: browsers and players read it, some sites don't)
			return mixed ? ((format === "mp4" ? await encodeAudio(mixed, "aac") : null) ?? (await encodeAudio(mixed, "opus"))) : null;
		},
	};
}

export interface Mix {
	channels: Float32Array[];
	sampleRate: number;
}

/** Left and right over time ([t, left, right, ...] in seconds from the start), as Animate's envelopes. */
function envelope(ac: BaseAudioContext, src: AudioNode, env: number[], at: number, speed = 1): AudioNode {
	const up = ac.createGain();
	up.channelCount = 2;
	up.channelCountMode = "explicit";
	const split = ac.createChannelSplitter(2);
	const merge = ac.createChannelMerger(2);
	src.connect(up).connect(split);
	for (const k of [1, 2]) {
		const g = ac.createGain();
		g.gain.setValueAtTime(env[k]!, at);
		for (let i = 0; i < env.length; i += 3) g.gain.linearRampToValueAtTime(env[i + k]!, at + env[i]! / speed);
		split.connect(g, k - 1).connect(merge, 0, k - 1);
	}
	return merge;
}

/** The sounds a timeline's frames play, rendered to one stereo track: what the player would play in that time. */
export async function mixSounds(S: SoundSchedule, seconds: number): Promise<Mix | null> {
	if (typeof OfflineAudioContext === "undefined") return null;
	const sampleRate = 48000;
	const ac = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
	const bufs = new Map<string, AudioBuffer>();
	for (const id in S.snd) {
		const f = S.snd[id]!;
		try {
			bufs.set(id, await ac.decodeAudioData(await (await fetch(typeof f === "string" ? f : f[0])).arrayBuffer()));
		} catch {
			// (a file the host can't decode stays silent)
		}
	}
	const playing: { id: string; src: AudioBufferSourceNode; end: number }[] = [];
	for (const e of S.ev) {
		const [tick, id, sync, loops, length, inPoint, outPoint, env] = e;
		const t = tick / S.fps;
		if (t >= seconds) break;
		if (sync === 2) {
			for (const v of playing)
				if (v.id === id && v.end > t) {
					v.src.stop(t);
					v.end = t;
				}
			continue;
		}
		if (sync === 1 && playing.some((v) => v.id === id && v.end > t)) continue;
		const buf = bufs.get(id);
		if (!buf) continue;
		const info = S.snd[id]!;
		const L = typeof info === "string" ? buf.duration : (info[1] ?? buf.duration);
		const lead = typeof info === "string" ? 0 : (info[2] ?? 0);
		const a = inPoint ?? 0;
		const b = Math.min(outPoint ?? L, L);
		if (!(b > a)) continue;
		// (decoders that read no gapless header keep the encoder delay at the start)
		const skip = buf.duration >= L + lead * 0.9 ? lead : 0;
		const src = ac.createBufferSource();
		src.buffer = buf;
		if (loops > 1) {
			src.loop = true;
			src.loopStart = skip + a;
			src.loopEnd = skip + b;
		}
		(env ? envelope(ac, src, env, t) : src).connect(ac.destination);
		const end = Math.min(seconds, sync === 3 ? length / S.fps : t + (b - a) * loops);
		src.start(t, skip + a);
		src.stop(end);
		playing.push({ id, src, end });
	}
	const out = await ac.startRendering();
	return { channels: [out.getChannelData(0), out.getChannelData(1)], sampleRate };
}

async function encodeAudio(mix: Mix, kind: "opus" | "aac"): Promise<AudioTrack | null> {
	if (typeof AudioEncoder === "undefined") return null;
	const { channels, sampleRate } = mix;
	const config: AudioEncoderConfig = { codec: kind === "opus" ? "opus" : "mp4a.40.2", sampleRate, numberOfChannels: channels.length, bitrate: 160000 };
	if (!(await AudioEncoder.isConfigSupported(config).catch(() => null))?.supported) return null;
	const track: AudioTrack = { codec: kind, sampleRate, channels: channels.length, samples: [] };
	let failure: Error | null = null;
	const enc = new AudioEncoder({
		output: (c, meta) => {
			const data = new Uint8Array(c.byteLength);
			c.copyTo(data);
			track.samples.push({ data, time: c.timestamp, duration: c.duration ?? 20000, key: true });
			const d = meta?.decoderConfig?.description;
			if (d && !track.description) track.description = bytesOf(d);
		},
		error: (e) => void (failure = e),
	});
	enc.configure(config);
	const block = 4800;
	const length = channels[0]!.length;
	for (let o = 0; o < length; o += block) {
		const n = Math.min(block, length - o);
		const planar = new Float32Array(n * channels.length);
		channels.forEach((c, k) => planar.set(c.subarray(o, o + n), k * n));
		const data = new AudioData({
			format: "f32-planar",
			sampleRate,
			numberOfFrames: n,
			numberOfChannels: channels.length,
			timestamp: Math.round((o / sampleRate) * 1e6),
			data: planar,
		});
		enc.encode(data);
		data.close();
	}
	await enc.flush();
	enc.close();
	if (failure) throw failure;
	return track;
}
