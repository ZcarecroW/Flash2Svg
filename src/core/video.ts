/**
 * MP4 and WebM of a timeline: the frames as the raster formats draw them, encoded by the browser's
 * own video encoders (WebCodecs: the panel, not the command line), the sound mixed to one track.
 */
import { DEFAULT_SETTINGS, type CompileOutput, type ExportSettings } from "./compile.ts";
import { createContext, type FileSource } from "./context.ts";
import { bake } from "./emit/bake.ts";
import { schedule, soundTable } from "./emit/soundtrack.ts";
import { joinScenes } from "./scenes.ts";
import type { SoundSchedule } from "../player/soundtrack.ts";
import type { SceneModel } from "./model.ts";
import { muxMp4, muxWebm, type AudioTrack, type Sample, type VideoTrack } from "./mux.ts";
import { tickSource, type Rasterize } from "./raster.ts";

/** About 3 minutes at 24 fps... a video may be longer than a GIF. */
export const MAX_VIDEO_FRAMES = 18000;

const CODECS: Record<"mp4" | "webm", string[]> = {
	// H.264 where the encoder has it (what social media want), else what MP4 can hold
	mp4: ["avc1.640033", "avc1.4D0033", "avc1.42E033", "av01.0.08M.08", "vp09.00.41.08"],
	webm: ["vp09.00.41.08", "av01.0.08M.08", "vp8"],
};

/** Bits a second for a picture: what keeps flat drawings and their edges clean. */
export function autoBitrate(w: number, h: number, fps: number): number {
	return Math.round(Math.min(40e6, Math.max(800e3, w * h * fps * 0.14)));
}

async function pick(format: "mp4" | "webm", width: number, height: number, framerate: number, bitrate: number): Promise<VideoEncoderConfig> {
	if (typeof VideoEncoder === "undefined") throw new Error("This host has no video encoder: MP4 and WebM export from the panel (WebCodecs)");
	for (const codec of CODECS[format]) {
		const config: VideoEncoderConfig = { codec, width, height, framerate, bitrate, hardwareAcceleration: "prefer-software", ...(codec.startsWith("avc1") ? { avc: { format: "avc" } } : {}) };
		const r = await VideoEncoder.isConfigSupported(config).catch(() => null);
		if (r?.supported) return config;
	}
	throw new Error(`This host's video encoders can't write ${format.toUpperCase()}`);
}

/**
 * The picture as video has it: 4:2:0 at an even size, BT.709 in video range, what every player and
 * site takes the same way (left to the encoders, each picks its own colours and tags them, and
 * Edge can't even play back what its own VP9 encoder makes of RGB). See-through pixels are over white.
 */
function i420(d: Uint8ClampedArray, w: number, h: number, W: number, H: number): Uint8Array {
	const cw = W >> 1;
	const out = new Uint8Array(W * H + 2 * cw * (H >> 1));
	const U = W * H,
		V = U + cw * (H >> 1);
	// luma per pixel; colours as sums of four
	const us = new Float32Array(cw),
		vs = new Float32Array(cw);
	for (let y = 0; y < H; y++) {
		const row = Math.min(y, h - 1) * w * 4;
		for (let x = 0; x < W; x++) {
			const i = row + Math.min(x, w - 1) * 4;
			const a = d[i + 3]!;
			let r = d[i]!,
				g = d[i + 1]!,
				b = d[i + 2]!;
			if (a !== 255) {
				const k = a / 255,
					white = 255 * (1 - k);
				r = r * k + white;
				g = g * k + white;
				b = b * k + white;
			}
			out[y * W + x] = 16.5 + 0.182586 * r + 0.614231 * g + 0.062007 * b;
			const c = x >> 1;
			us[c]! += -0.100644 * r - 0.338572 * g + 0.439216 * b;
			vs[c]! += 0.439216 * r - 0.398942 * g - 0.040274 * b;
		}
		if (y & 1) {
			const line = (y >> 1) * cw;
			for (let c = 0; c < cw; c++) {
				out[U + line + c] = 128.5 + us[c]! / 4;
				out[V + line + c] = 128.5 + vs[c]! / 4;
			}
			us.fill(0);
			vs.fill(0);
		}
	}
	return out;
}

/** A copy of what an encoder hands over. */
const bytesOf = (d: AllowSharedBufferSource): Uint8Array => (ArrayBuffer.isView(d) ? new Uint8Array(d.buffer as ArrayBuffer, d.byteOffset, d.byteLength) : new Uint8Array(d as ArrayBuffer)).slice();

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
		const data = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: n, numberOfChannels: channels.length, timestamp: Math.round((o / sampleRate) * 1e6), data: planar });
		enc.encode(data);
		data.close();
	}
	await enc.flush();
	enc.close();
	if (failure) throw failure;
	return track;
}

/**
 * Format "mp4" or "webm": the first pass of the timeline, frame by frame at the document's frame
 * rate, so players and social media get what they expect.
 */
export async function exportVideo(model: SceneModel, files: FileSource, partial: Partial<ExportSettings>, rasterize: Rasterize, rootIndex = 0): Promise<CompileOutput> {
	const s: ExportSettings = { ...DEFAULT_SETTINGS, ...partial, includeBackground: true };
	const format = s.format === "webm" ? "webm" : "mp4";
	const warnings: string[] = [];
	const src = tickSource(model, files, s, rasterize, (m) => warnings.push(m), rootIndex, MAX_VIDEO_FRAMES, true);
	const first = await src.draw(0);
	const { width, height } = first;
	const W = width + (width & 1),
		H = height + (height & 1);
	const fps = 1000 / src.tickMs;
	const bitrate = s.videoBitrate ? s.videoBitrate * 1000 : autoBitrate(W, H, fps);
	const config = await pick(format, W, H, fps, bitrate);
	const samples: Sample[] = [];
	const track: VideoTrack = { codec: config.codec, width: W, height: H, samples };
	let failure: Error | null = null;
	const enc = new VideoEncoder({
		output: (c, meta) => {
			const data = new Uint8Array(c.byteLength);
			c.copyTo(data);
			samples.push({ data, time: c.timestamp, duration: c.duration ?? src.tickMs * 1000, key: c.type === "key" });
			const d = meta?.decoderConfig?.description;
			if (d && !track.description) track.description = bytesOf(d);
		},
		error: (e) => void (failure = e),
	});
	enc.configure(config);
	const every = Math.max(1, Math.round(fps * 2));
	for (let t = 0; t < src.count; t++) {
		if (failure) throw failure;
		const px = t ? await src.draw(t) : first;
		const frame = new VideoFrame(i420(px.data, width, height, W, H), { format: "I420", codedWidth: W, codedHeight: H, timestamp: Math.round(t * src.tickMs * 1000), duration: Math.round(src.tickMs * 1000), colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false } });
		enc.encode(frame, { keyFrame: t % every === 0 });
		frame.close();
		// (the encoder takes its time: no more than a few frames in memory)
		while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
	}
	await enc.flush();
	enc.close();
	if (failure) throw failure;
	const seconds = (src.count * src.tickMs) / 1000;
	let audio: AudioTrack | null = null;
	if (Object.keys(model.sounds).length) {
		const joined = joinScenes(model);
		const ctx = createContext(joined, files, { smooth: true, includeHiddenLayers: s.includeHiddenLayers, includeGuides: s.includeGuides, digits: s.digits });
		const { root, horizon } = bake(ctx, joined.roots[rootIndex]!, { smooth: true, morph: false, loop: s.loop, startFrame: s.startFrame, endFrame: s.endFrame });
		const track = schedule(ctx, root, horizon, () => soundTable(ctx, true, []));
		const mixed = track ? await mixSounds(track, seconds) : null;
		// (Opus in both when the encoder has no AAC: browsers and players read it, some sites don't)
		audio = mixed ? ((format === "mp4" ? await encodeAudio(mixed, "aac") : null) ?? (await encodeAudio(mixed, "opus"))) : null;
		if (track && !audio) warnings.push("The sounds aren't in the video: this host can't mix or encode them");
	}
	if (Object.values(model.timelines).some((t) => t.layers.some((l) => l.keyframes.some((k) => k.elements.some((e) => e.kind === "video" || e.kind === "control")))))
		warnings.push("Videos and UI components aren't part of a video file (their place stays empty)");
	const bytes = format === "webm" ? muxWebm(track, audio ?? undefined) : muxMp4(track, audio ?? undefined);
	return {
		files: [{ suffix: "", svg: "", ext: `.${format}`, bytes }],
		assets: [],
		warnings,
		stats: {
			durationSeconds: seconds,
			frames: src.count,
			bytes: bytes.length,
			parts: { drawing: 0, animation: 0, images: bytes.length, sounds: 0, runtime: 0, fonts: 0 },
			drawings: [],
		},
	};
}
