/**
 * Sounds in the format the export settings ask for: compressed (MP3 or Opus) or uncompressed
 * (WAV). Animate's compression setting for each sound (Library › Properties) decides by default;
 * the settings can override it per sound. Imported MP3s that keep their quality stay byte for byte.
 * The codecs (audio-codecs.ts) are WebAssembly builds of LAME, libopus and mpg123.
 *
 * Every sound is cut to its real length (Animate pads the WAV it exports with silence) and to the
 * part the frames play (their in and out points); envelopes, loops and in/out points are applied
 * by the player.
 */
import type { FileSource } from "./context.ts";
import type { SceneModel, SoundData } from "./model.ts";

export type SoundFormat = "mp3" | "opus";

export interface SoundSettings {
	/** Compressed sounds ("lossy" in soundModes, or any compression but Raw in Animate). */
	soundFormat: SoundFormat;
	/** kbit/s on MP3's scale (Opus uses half of it for the same quality); 0 = Animate's setting. */
	soundBitrate: number;
	/** Per sound (library name): overrides Animate's compression setting. "lossless" = WAV. */
	soundModes: Record<string, "lossy" | "lossless">;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { soundFormat: "mp3", soundBitrate: 0, soundModes: {} };

/** PCM audio, one Float32Array per channel (-1..1). */
export interface Pcm {
	rate: number;
	data: Float32Array[];
}

/** The audio codecs (audio-codecs.ts; the panel loads them only when a document has sounds). */
export interface AudioCodecs {
	/** MP3 (CBR), LAME picks the output sample rate for low bit rates. */
	mp3(pcm: Pcm, kbps: number): Promise<Uint8Array>;
	/** Raw Opus packets of 20 ms from 48 kHz PCM, and the encoder's lookahead (pre-skip). */
	opus(pcm: Pcm, kbps: number): Promise<{ packets: Uint8Array[]; preSkip: number }>;
	decodeMp3(bytes: Uint8Array): Promise<Pcm>;
}

export interface SoundReport {
	name: string;
	mode: "lossy" | "lossless";
	/** "original" = the imported MP3 as it is. */
	format: SoundFormat | "wav" | "original";
	bytes: number;
	/** Size of the file Animate exported. */
	sourceBytes: number;
	seconds: number;
	channels: number;
	/** compressed: kbit/s */
	kbps?: number;
}

/** LAME's delay (encoder + decoder) at the output rate when no gapless header tells decoders to skip it. */
const MP3_DELAY = 1105;
const MP3_RATES = [8, 16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
/** The whole sound (getSoundEnvelopeLimits' end without an out point). */
const NO_END = 1073741823;

export function modeOf(snd: SoundData, s: SoundSettings): "lossy" | "lossless" {
	return s.soundModes[snd.name] ?? (snd.compression === "raw" ? "lossless" : "lossy");
}

/**
 * MP3-scale bit rate for a sound: the setting, Animate's MP3 setting, or a default: 128 kbps
 * stereo / 64 mono, less for lower sample rates (about 1.5 bits per sample and channel, as 128 kbps
 * at 44.1 kHz stereo; more would only add bytes).
 */
function bitRateOf(snd: SoundData, s: SoundSettings, channels: number, rate: number): number {
	const own =
		Number.isFinite(s.soundBitrate) && s.soundBitrate > 0
			? s.soundBitrate
			: snd.compression === "mp3" && snd.bitRate
				? snd.bitRate
				: Math.max(16, Math.min(channels > 1 ? 128 : 64, (rate * channels * 1.5) / 1000));
	return MP3_RATES.reduce((a, b) => (Math.abs(b - own) < Math.abs(a - own) ? b : a));
}

/**
 * Re-encodes the model's sounds. Returns a copy of the model whose sounds point at the new files
 * (with what the player needs to play them exactly: their length, the part cut off the start and
 * the encoder delay), and a file source that serves them.
 */
export async function encodeSounds(
	model: SceneModel,
	files: FileSource,
	partial: Partial<SoundSettings>,
	codecs: AudioCodecs,
): Promise<{ model: SceneModel; files: FileSource; report: SoundReport[]; warnings: string[] }> {
	const s: SoundSettings = { ...DEFAULT_SOUND_SETTINGS, ...partial, soundModes: { ...partial.soundModes } };
	const made = new Map<string, Uint8Array>();
	const sounds: Record<string, SoundData> = {};
	const report: SoundReport[] = [];
	const warnings: string[] = [];
	const used = usedRanges(model);

	for (const [id, snd] of Object.entries(model.sounds)) {
		const mode = modeOf(snd, s);
		let source: Uint8Array;
		try {
			source = new Uint8Array(files.readBinary(snd.file));
		} catch {
			sounds[id] = snd;
			continue;
		}
		const keep = (
			rel: string,
			bytes: Uint8Array,
			format: SoundReport["format"],
			extra: Partial<SoundData>,
			seconds: number,
			channels: number,
			kbps?: number,
		) => {
			made.set(rel, bytes);
			sounds[id] = { ...snd, file: rel, ...extra };
			report.push({ name: snd.name, mode, format, bytes: bytes.byteLength, sourceBytes: source.byteLength, seconds, channels, kbps });
		};
		const mp3In = snd.file.toLowerCase().endsWith(".mp3");
		// older models: no length or import information, keep the file
		if (snd.original === undefined) {
			sounds[id] = snd;
			report.push({ name: snd.name, mode, format: "original", bytes: source.byteLength, sourceBytes: source.byteLength, seconds: 0, channels: 0 });
			continue;
		}
		// an imported MP3 at its own quality: as it is (cutting it would mean encoding it again)
		if (mp3In && mode === "lossy" && s.soundFormat === "mp3" && !(s.soundBitrate > 0) && (snd.compression === "default" || snd.importedQuality)) {
			const seconds = (snd.samples ?? 0) / 44100;
			keep(
				snd.file,
				source,
				"original",
				{ trim: 0, lead: 0, seconds },
				seconds,
				mp3Channels(source),
				seconds ? Math.round((source.byteLength * 8) / seconds / 1000) : undefined,
			);
			continue;
		}

		let pcm: Pcm;
		try {
			pcm = mp3In ? await codecs.decodeMp3(source) : readWav(source);
		} catch (e) {
			warnings.push(`Sound ${snd.name} could not be read (${(e as Error).message}); it is kept as Animate exported it`);
			sounds[id] = snd;
			continue;
		}
		// the real length, then only the part the frames play
		const total44 = snd.samples ?? Math.round((pcm.data[0]!.length * 44100) / pcm.rate);
		const range = used.get(id) ?? [0, total44];
		const from44 = Math.max(0, Math.min(range[0], total44));
		const to44 = Math.max(from44, Math.min(range[1], total44));
		const a = Math.round((from44 * pcm.rate) / 44100);
		const b = Math.max(a, Math.round((to44 * pcm.rate) / 44100));
		pcm = { rate: pcm.rate, data: pcm.data.map((c) => c.slice(a, b)) };
		if (snd.mono && pcm.data.length > 1) pcm = { rate: pcm.rate, data: [mixDown(pcm.data)] };
		const seconds = (to44 - from44) / 44100;
		const channels = pcm.data.length;
		// named by the sound: several sounds may share a source file
		const base = snd.file.slice(0, snd.file.lastIndexOf("/") + 1) + id;
		const extra = { trim: from44, seconds };

		if (mode === "lossless") {
			// Raw in Animate with a lower sample rate: as Animate publishes it
			if (snd.compression === "raw" && !s.soundModes[snd.name] && snd.sampleRate && snd.sampleRate < pcm.rate) pcm = resample(pcm, snd.sampleRate);
			keep(`${base}.wav`, writeWav(pcm), "wav", { ...extra, lead: 0 }, seconds, channels);
			continue;
		}
		const kbps = bitRateOf(snd, s, channels, pcm.rate);
		if (s.soundFormat === "opus") {
			const k = Math.max(8 * channels, Math.round(kbps / 2));
			const { packets, preSkip } = await codecs.opus(resample(pcm, 48000), k);
			keep(`${base}.opus`, oggOpus(packets, channels, preSkip, pcm.rate, Math.round(seconds * 48000)), "opus", { ...extra, lead: 0 }, seconds, channels, k);
		} else {
			const bytes = await codecs.mp3(pcm, kbps);
			const rate = mp3Rate(bytes) || pcm.rate;
			keep(`${base}.mp3`, bytes, "mp3", { ...extra, lead: MP3_DELAY / rate }, seconds, channels, kbps);
		}
	}

	return {
		model: { ...model, sounds },
		files: {
			readText: (rel) => files.readText(rel),
			readBinary: (rel) => made.get(rel) ?? files.readBinary(rel),
		},
		report,
		warnings,
	};
}

/** Per sound: the range (44.1 kHz samples) any frame plays, from the earliest in point to the latest out point. */
function usedRanges(model: SceneModel): Map<string, [number, number]> {
	const out = new Map<string, [number, number]>();
	for (const tl of Object.values(model.timelines))
		for (const layer of tl.layers)
			for (const kf of layer.keyframes) {
				const fs = kf.sound;
				if (!fs?.sound || fs.sync === "stop") continue;
				const start = fs.limits?.start ?? 0;
				const end = fs.limits && fs.limits.end < NO_END ? fs.limits.end : Infinity;
				const r = out.get(fs.sound);
				out.set(fs.sound, r ? [Math.min(r[0], start), Math.max(r[1], end)] : [start, end]);
			}
	return out;
}

function mixDown(data: Float32Array[]): Float32Array {
	const n = data[0]!.length;
	const out = new Float32Array(n);
	const k = 1 / data.length;
	for (const c of data) for (let i = 0; i < n; i++) out[i]! += c[i]! * k;
	return out;
}

// ------------------------------------------------------------------ WAV

/** PCM (8/16/24/32 bit) and float WAV files. */
export function readWav(bytes: Uint8Array): Pcm {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
	if (bytes.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
	let format = 0,
		channels = 0,
		rate = 0,
		bits = 0;
	for (let o = 12; o + 8 <= bytes.byteLength;) {
		const id = tag(o),
			size = v.getUint32(o + 4, true),
			p = o + 8;
		if (id === "fmt ") {
			format = v.getUint16(p, true);
			channels = v.getUint16(p + 2, true);
			rate = v.getUint32(p + 4, true);
			bits = v.getUint16(p + 14, true);
			// WAVE_FORMAT_EXTENSIBLE: the real format is in the sub format GUID
			if (format === 0xfffe && size >= 26) format = v.getUint16(p + 24, true);
		} else if (id === "data") {
			if (!channels || !rate) throw new Error("WAV without format");
			if (format !== 1 && !(format === 3 && bits === 32)) throw new Error(`unsupported WAV format ${format}`);
			const bps = bits >> 3;
			const n = Math.floor(Math.min(size, bytes.byteLength - p) / (bps * channels));
			const data = Array.from({ length: channels }, () => new Float32Array(n));
			for (let i = 0, q = p; i < n; i++)
				for (let c = 0; c < channels; c++, q += bps)
					data[c]![i] =
						format === 3
							? v.getFloat32(q, true)
							: bits === 8
								? (bytes[q]! - 128) / 128
								: bits === 16
									? v.getInt16(q, true) / 32768
									: bits === 24
										? (bytes[q]! | (bytes[q + 1]! << 8) | (v.getInt8(q + 2) << 16)) / 8388608
										: v.getInt32(q, true) / 2147483648;
			return { rate, data };
		}
		o = p + size + (size & 1);
	}
	throw new Error("WAV without data");
}

/** 16-bit PCM WAV. */
export function writeWav(pcm: Pcm): Uint8Array {
	const ch = pcm.data.length,
		n = pcm.data[0]?.length ?? 0;
	const out = new Uint8Array(44 + n * ch * 2);
	const v = new DataView(out.buffer);
	const str = (o: number, s: string) => {
		for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
	};
	str(0, "RIFF");
	v.setUint32(4, 36 + n * ch * 2, true);
	str(8, "WAVEfmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, ch, true);
	v.setUint32(24, pcm.rate, true);
	v.setUint32(28, pcm.rate * ch * 2, true);
	v.setUint16(32, ch * 2, true);
	v.setUint16(34, 16, true);
	str(36, "data");
	v.setUint32(40, n * ch * 2, true);
	for (let i = 0, o = 44; i < n; i++)
		for (let c = 0; c < ch; c++, o += 2) {
			const x = Math.max(-1, Math.min(1, pcm.data[c]![i]!));
			v.setInt16(o, Math.round(x * 32767), true);
		}
	return out;
}

// ------------------------------------------------------------------ resampling

const TAPS = 16; // zero crossings on each side
const PHASES = 1024;

/**
 * Band-limited resampling (windowed sinc, Blackman window) with a precomputed polyphase table:
 * no trigonometry per sample, about 32 multiply-adds per output sample.
 */
export function resample(pcm: Pcm, to: number): Pcm {
	const from = pcm.rate;
	if (from === to) return pcm;
	const ratio = from / to;
	// downsampling: the cut-off moves below the new Nyquist frequency
	const fc = Math.min(1, to / from) * 0.97;
	const width = Math.ceil(TAPS / Math.min(1, to / from));
	const len = 2 * width;
	const table = new Float32Array((PHASES + 1) * len);
	for (let p = 0; p <= PHASES; p++) {
		const frac = p / PHASES;
		let sum = 0;
		for (let k = 0; k < len; k++) {
			const x = k - width + 1 - frac; // distance from the output position
			const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / width) + 0.08 * Math.cos((2 * Math.PI * x) / width);
			const s = x === 0 ? 1 : Math.sin(Math.PI * fc * x) / (Math.PI * fc * x);
			const val = Math.abs(x) >= width ? 0 : fc * s * w;
			table[p * len + k] = val;
			sum += val;
		}
		// unity gain for every phase (no ripple from the table's finite length)
		if (sum) for (let k = 0; k < len; k++) table[p * len + k]! /= sum;
	}
	const n = pcm.data[0]!.length;
	const m = Math.round((n * to) / from);
	const data = pcm.data.map((src) => {
		// the input with `width` zeros on both sides: no bounds checks in the inner loop
		const x = new Float32Array(n + 2 * width);
		x.set(src, width);
		const out = new Float32Array(m);
		for (let i = 0; i < m; i++) {
			const t = i * ratio;
			const i0 = Math.floor(t);
			let row = Math.round((t - i0) * PHASES) * len;
			let j = i0 + 1; // = (i0 - width + 1) + width
			let acc = 0;
			for (const end = row + len; row < end; row++, j++) acc += x[j]! * table[row]!;
			out[i] = acc;
		}
		return out;
	});
	return { rate: to, data };
}

// ------------------------------------------------------------------ Ogg Opus (RFC 7845)

let crcTable: Uint32Array | null = null;
function oggCrc(page: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let i = 0; i < 256; i++) {
			let r = i << 24;
			for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
			crcTable[i] = r >>> 0;
		}
	}
	let crc = 0;
	for (let i = 0; i < page.length; i++) crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ page[i]!) & 0xff]!) >>> 0;
	return crc;
}

/**
 * Wraps 20 ms Opus packets into an Ogg Opus file. `samples` (at 48 kHz) is the length of the
 * sound: the last page's granule position tells decoders to drop the padding of the last packet.
 */
export function oggOpus(packets: Uint8Array[], channels: number, preSkip: number, inputRate: number, samples: number): Uint8Array {
	const serial = 0x46325356; // "F2SV"
	const pages: Uint8Array[] = [];
	let seq = 0;
	const page = (data: Uint8Array[], granule: number, flags: number) => {
		const lacing: number[] = [];
		for (const d of data) {
			let l = d.length;
			while (l >= 255) {
				lacing.push(255);
				l -= 255;
			}
			lacing.push(l);
		}
		const bodyLen = data.reduce((a, d) => a + d.length, 0);
		const out = new Uint8Array(27 + lacing.length + bodyLen);
		const v = new DataView(out.buffer);
		out.set([0x4f, 0x67, 0x67, 0x53]); // OggS
		out[5] = flags;
		v.setUint32(6, granule >>> 0, true);
		v.setUint32(10, Math.floor(granule / 0x100000000), true);
		v.setUint32(14, serial, true);
		v.setUint32(18, seq++, true);
		out[26] = lacing.length;
		out.set(lacing, 27);
		let o = 27 + lacing.length;
		for (const d of data) {
			out.set(d, o);
			o += d.length;
		}
		v.setUint32(22, oggCrc(out), true);
		pages.push(out);
	};
	const head = new Uint8Array(19);
	const hv = new DataView(head.buffer);
	head.set([...ascii("OpusHead"), 1, channels]);
	hv.setUint16(10, preSkip, true);
	hv.setUint32(12, inputRate, true);
	page([head], 0, 2);
	const vendor = ascii("flash2svg");
	const tags = new Uint8Array(8 + 4 + vendor.length + 4);
	tags.set(ascii("OpusTags"));
	new DataView(tags.buffer).setUint32(8, vendor.length, true);
	tags.set(vendor, 12);
	page([tags], 0, 0);
	// granule positions count the decoded samples, the pre-skip included
	const end = preSkip + samples;
	// about a second per page; a page holds at most 255 lacing values
	let batch: Uint8Array[] = [];
	let lacing = 0;
	let granule = 0;
	for (let i = 0; i < packets.length; i++) {
		const p = packets[i]!;
		const need = Math.floor(p.length / 255) + 1;
		if (batch.length && (batch.length >= 50 || lacing + need > 255)) {
			page(batch, Math.min(granule, end), 0);
			batch = [];
			lacing = 0;
		}
		batch.push(p);
		lacing += need;
		granule += 960;
	}
	page(batch, end, 4);
	const total = pages.reduce((a, p) => a + p.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of pages) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

function ascii(s: string): number[] {
	return Array.from(s, (c) => c.charCodeAt(0));
}

// ------------------------------------------------------------------ MP3 headers

const MPEG_RATES = [
	[11025, 12000, 8000], // MPEG 2.5
	null,
	[22050, 24000, 16000], // MPEG 2
	[44100, 48000, 32000], // MPEG 1
] as const;

/** Offset of the first MPEG audio frame (after an ID3v2 tag). */
function firstFrame(b: Uint8Array): number {
	let o = 0;
	if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 && b.length > 10) o = 10 + ((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!);
	for (; o + 4 <= b.length; o++) if (b[o] === 0xff && (b[o + 1]! & 0xe0) === 0xe0) return o;
	return -1;
}

/** Sample rate of an MP3 file (its first frame). */
export function mp3Rate(b: Uint8Array): number {
	const o = firstFrame(b);
	if (o < 0) return 0;
	const rates = MPEG_RATES[(b[o + 1]! >> 3) & 3];
	const i = (b[o + 2]! >> 2) & 3;
	return rates && i < 3 ? rates[i]! : 0;
}

function mp3Channels(b: Uint8Array): number {
	const o = firstFrame(b);
	return o < 0 ? 0 : b[o + 3]! >> 6 === 3 ? 1 : 2;
}
