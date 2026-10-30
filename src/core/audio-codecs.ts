/**
 * The audio codecs for audio.ts: LAME (wasm-media-encoders, its WebAssembly file passed in like the
 * image codecs'), libopus (libopus-wasm, WebAssembly inlined) and mpg123 (mpg123-decoder, inlined).
 * Each is initialised on first use, once per process.
 */
import { createEncoder } from "wasm-media-encoders/esnext";
import { createEncoder as createOpusEncoder, Application, Signal } from "libopus-wasm";
import { MPEGDecoder } from "mpg123-decoder";
import type { AudioCodecs, Pcm } from "./audio.ts";
import type { WasmLoader } from "./images.ts";

/** The LAME build's WebAssembly file (published next to the panel and the CLI). */
export const MP3_WASM = "mp3.wasm";
// (its package maps "wasm/mp3.wasm" to a file that does not exist)
export const MP3_WASM_SOURCE = "wasm-media-encoders/wasm/mp3";

export function createAudioCodecs(load: WasmLoader): AudioCodecs {
	let lame: Promise<WebAssembly.Module> | null = null;
	let mpg: Promise<MPEGDecoder> | null = null;
	const lameModule = () =>
		(lame ??= (async () => {
			const bytes = await load(MP3_WASM);
			const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
			return WebAssembly.compile(view.slice().buffer as ArrayBuffer);
		})());
	return {
		async mp3(pcm, kbps) {
			const enc = await createEncoder("audio/mpeg", await lameModule());
			enc.configure({ sampleRate: pcm.rate, channels: pcm.data.length > 1 ? 2 : 1, bitrate: kbps as 128 });
			const parts: Uint8Array[] = [];
			// in blocks: LAME's input buffer grows with the block
			const BLOCK = 1 << 16;
			const n = pcm.data[0]!.length;
			for (let i = 0; i < n; i += BLOCK) parts.push(enc.encode(pcm.data.slice(0, 2).map((c) => c.subarray(i, i + BLOCK))).slice());
			parts.push(enc.finalize().slice());
			return concat(parts);
		},
		async opus(pcm, kbps) {
			const channels = pcm.data.length > 1 ? 2 : 1;
			const enc = await createOpusEncoder({ sampleRate: 48000, channels, application: Application.Audio, signal: Signal.Music, bitrate: kbps * 1000, complexity: 10, vbr: true });
			try {
				const preSkip = enc.getLookahead();
				const frame = enc.frameSize;
				const n = pcm.data[0]!.length;
				// the lookahead delays the output: feed that much silence after the end
				const frames = Math.ceil((n + preSkip) / frame);
				const packets: Uint8Array[] = [];
				const buf = new Float32Array(frame * channels);
				for (let f = 0; f < frames; f++) {
					buf.fill(0);
					const o = f * frame;
					for (let c = 0; c < channels; c++) {
						const src = pcm.data[c]!;
						for (let i = 0, j = o; i < frame && j < n; i++, j++) buf[i * channels + c] = src[j]!;
					}
					packets.push(enc.encodeFloat(buf).slice());
				}
				return { packets, preSkip };
			} finally {
				enc.free();
			}
		},
		async decodeMp3(bytes): Promise<Pcm> {
			const d = await (mpg ??= (async () => {
				const m = new MPEGDecoder();
				await m.ready;
				return m;
			})());
			await d.reset();
			const r = d.decode(bytes);
			if (!r.samplesDecoded) throw new Error("no MP3 audio");
			return { rate: r.sampleRate, data: r.channelData.map((c) => c.slice(0, r.samplesDecoded)) };
		},
	};
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
