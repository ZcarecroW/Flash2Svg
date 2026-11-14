/**
 * MP4 and WebM of a timeline: the frames as the raster formats draw them, encoded by a browser's
 * own video encoders (video-codecs.ts: the panel's, or one the command line drives), the sound
 * mixed to one track.
 */
import { DEFAULT_SETTINGS, type CompileOutput, type ExportSettings } from "./compile.ts";
import { createContext, type FileSource } from "./context.ts";
import { bake } from "./emit/bake.ts";
import { schedule, soundTable } from "./emit/soundtrack.ts";
import { joinScenes } from "./scenes.ts";
import type { SceneModel } from "./model.ts";
import { muxMp4, muxWebm, type AudioTrack, type VideoTrack } from "./mux.ts";
import { webCodecs, type VideoEncoders } from "./video-codecs.ts";
import { tickSource, type Rasterize } from "./raster.ts";

/** 12.5 minutes at 24 fps (5 at 60): a video may be longer than a GIF. */
export const MAX_VIDEO_FRAMES = 18000;

const CODECS: Record<"mp4" | "webm", string[]> = {
	// H.264 where the encoder has it (what social media want), else what MP4 can hold
	mp4: ["avc1.640033", "avc1.4D0033", "avc1.42E033", "av01.0.08M.08", "vp09.00.41.08"],
	webm: ["vp09.00.41.08", "av01.0.08M.08", "vp8"],
};

/** The configurations to try, in order, for a format at a size. */
function candidates(format: "mp4" | "webm", width: number, height: number, framerate: number, bitrate: number): VideoEncoderConfig[] {
	return CODECS[format].map((codec) => ({
		codec,
		width,
		height,
		framerate,
		bitrate,
		hardwareAcceleration: "prefer-software",
		...(codec.startsWith("avc1") ? { avc: { format: "avc" } } : {}),
	}));
}

/** Bits a second for a picture: what keeps flat drawings and their edges clean. */
export function autoBitrate(w: number, h: number, fps: number): number {
	return Math.round(Math.min(40e6, Math.max(800e3, w * h * fps * 0.14)));
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

/**
 * Format "mp4" or "webm": the first pass of the timeline, frame by frame at the document's frame
 * rate, so players and social media get what they expect. `encoders`: this host's (the panel), or
 * a browser's the command line drives.
 */
export async function exportVideo(
	model: SceneModel,
	files: FileSource,
	partial: Partial<ExportSettings>,
	rasterize: Rasterize,
	rootIndex = 0,
	encoders: VideoEncoders = webCodecs(),
): Promise<CompileOutput> {
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
	const config = await encoders.pick(format, candidates(format, W, H, fps, bitrate));
	const sink = await encoders.open(config);
	const every = Math.max(1, Math.round(fps * 2));
	for (let t = 0; t < src.count; t++) {
		const px = t ? await src.draw(t) : first;
		await sink.encode(i420(px.data, width, height, W, H), W, H, Math.round(t * src.tickMs * 1000), Math.round(src.tickMs * 1000), t % every === 0);
	}
	const encoded = await sink.close();
	const track: VideoTrack = {
		codec: config.codec,
		width: W,
		height: H,
		samples: encoded.samples,
		...(encoded.description ? { description: encoded.description } : {}),
	};
	const seconds = (src.count * src.tickMs) / 1000;
	let audio: AudioTrack | null = null;
	if (Object.keys(model.sounds).length) {
		const joined = joinScenes(model);
		const ctx = createContext(joined, files, { smooth: true, includeHiddenLayers: s.includeHiddenLayers, includeGuides: s.includeGuides, digits: s.digits });
		const { root, horizon } = bake(ctx, joined.roots[rootIndex]!, { smooth: true, morph: false, loop: s.loop, startFrame: s.startFrame, endFrame: s.endFrame });
		const sounds = schedule(ctx, root, horizon, () => soundTable(ctx, true, []));
		audio = sounds ? await encoders.sound(sounds, seconds, format) : null;
		if (sounds && !audio) warnings.push("The sounds aren't in the video: this host can't mix or encode them");
	}
	if (
		Object.values(model.timelines).some((t) =>
			t.layers.some((l) => l.keyframes.some((k) => k.elements.some((e) => e.kind === "video" || e.kind === "control"))),
		)
	)
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
