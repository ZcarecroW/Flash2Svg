/**
 * What the command line loads into a browser to encode video (browser-codecs.ts): the browser's
 * encoders (src/core/video-codecs.ts) behind a few functions it calls, bytes as Base64.
 * Built into video-page.generated.ts by scripts/build-video-page.mjs.
 */
import { webCodecs, type FrameSink } from "../core/video-codecs.ts";
import type { SoundSchedule } from "../player/soundtrack.ts";
import type { AudioTrack, Sample } from "../core/mux.ts";

const enc = webCodecs();
let sink: FrameSink | null = null;

function toBase64(u: Uint8Array): string {
	let s = "";
	for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
	return btoa(s);
}
function fromBase64(b: string): Uint8Array {
	const s = atob(b);
	const u = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
	return u;
}
const samples = (list: Sample[]) => list.map((s) => ({ ...s, data: toBase64(s.data) }));

Object.assign(globalThis, {
	f2sPick: async (format: "mp4" | "webm", candidates: VideoEncoderConfig[]) => JSON.stringify(await enc.pick(format, candidates)),
	f2sOpen: async (config: VideoEncoderConfig) => {
		sink = await enc.open(config);
		return true;
	},
	f2sEncode: async (data: string, width: number, height: number, timestamp: number, duration: number, key: boolean) => {
		await sink!.encode(fromBase64(data), width, height, timestamp, duration, key);
		return true;
	},
	f2sClose: async () => {
		const r = await sink!.close();
		sink = null;
		return JSON.stringify({ samples: samples(r.samples), description: r.description ? toBase64(r.description) : null });
	},
	f2sSound: async (schedule: SoundSchedule, seconds: number, format: "mp4" | "webm") => {
		const t: AudioTrack | null = await enc.sound(schedule, seconds, format);
		return t ? JSON.stringify({ ...t, samples: samples(t.samples), description: t.description ? toBase64(t.description) : null }) : null;
	},
});
