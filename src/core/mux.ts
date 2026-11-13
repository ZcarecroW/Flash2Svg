/**
 * Video files around what an encoder made: MP4 (ISO BMFF, the index first, so it plays while it
 * loads) and WebM (Matroska, with cues to seek by). Everything is in memory: the tracks are short.
 */

export interface Sample {
	data: Uint8Array;
	/** Microseconds. */
	time: number;
	duration: number;
	key: boolean;
}

export interface VideoTrack {
	/** As WebCodecs names it: avc1.640028, vp09.00.40.08, av01.0.08M.08, vp8. */
	codec: string;
	width: number;
	height: number;
	/** The decoder's configuration, if the codec has one (avcC). */
	description?: Uint8Array;
	samples: Sample[];
}

export interface AudioTrack {
	codec: "opus" | "aac";
	sampleRate: number;
	channels: number;
	/** AudioSpecificConfig of AAC. */
	description?: Uint8Array;
	samples: Sample[];
}

const concat = (parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const be = (v: number, n: number): Uint8Array => {
	const out = new Uint8Array(n);
	for (let i = n - 1; i >= 0; i--) {
		out[i] = v % 256;
		v = Math.floor(v / 256);
	}
	return out;
};
const u8 = (v: number) => Uint8Array.of(v & 255);
const u16 = (v: number) => be(v, 2);
const u32 = (v: number) => be(v, 4);

// ---------------------------------------------------------------- MP4

const box = (type: string, ...parts: Uint8Array[]): Uint8Array => {
	const body = concat(parts);
	return concat([u32(body.length + 8), ascii(type), body]);
};
const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]) => box(type, u8(version), be(flags, 3), ...parts);

/** The VP codec configuration from a codec string (vp09.PP.LL.DD). */
function vpcC(codec: string): Uint8Array {
	const [, p, l, d] = codec.split(".");
	const profile = codec === "vp8" ? 0 : Number(p ?? 0);
	const level = codec === "vp8" ? 10 : Number(l ?? 40);
	const depth = codec === "vp8" ? 8 : Number(d ?? 8);
	// (4:2:0 colocated, limited range, BT.709)
	return full("vpcC", 1, 0, u8(profile), u8(level), u8((depth << 4) | (1 << 1) | 0), u8(1), u8(1), u8(1), u16(0));
}

/** The AV1 configuration from a codec string (av01.P.LLT.DD), without its OBUs: they are in the stream. */
function av1C(codec: string): Uint8Array {
	const [, p, lt, d] = codec.split(".");
	const level = parseInt(lt ?? "08", 10);
	const tier = lt?.endsWith("H") ? 1 : 0;
	const high = Number(d ?? 8) > 8 ? 1 : 0;
	return box("av1C", Uint8Array.of(0x81, (Number(p ?? 0) << 5) | level, (tier << 7) | (high << 6) | (1 << 3) | (1 << 2), 0));
}

function visualEntry(v: VideoTrack): Uint8Array {
	const c = v.codec;
	const [type, config] = c.startsWith("avc1") ? ["avc1", box("avcC", v.description ?? new Uint8Array())] : c.startsWith("av01") ? ["av01", av1C(c)] : ["vp09", vpcC(c)];
	return box(
		type,
		new Uint8Array(6),
		u16(1),
		new Uint8Array(16),
		u16(v.width),
		u16(v.height),
		u32(0x480000),
		u32(0x480000),
		u32(0),
		u16(1),
		new Uint8Array(32),
		u16(0x18),
		u16(0xffff),
		config,
		// BT.709, limited range
		box("colr", ascii("nclx"), u16(1), u16(1), u16(1), u8(0)),
	);
}

function audioEntry(a: AudioTrack): Uint8Array {
	const head = [new Uint8Array(6), u16(1), new Uint8Array(8), u16(a.channels), u16(16), u32(0), u32((a.sampleRate * 65536) >>> 0)];
	if (a.codec === "opus") return box("Opus", ...head, box("dOps", u8(0), u8(a.channels), u16(opusPreSkip(a)), u32(a.sampleRate), u16(0), u8(0)));
	const asc = a.description ?? new Uint8Array();
	const dec = concat([u8(0x40), u8(0x15), be(0, 3), u32(0), u32(0), u8(5), u8(asc.length), asc]);
	const es = concat([u16(1), u8(0), u8(4), u8(dec.length), dec, u8(6), u8(1), u8(2)]);
	return box("mp4a", ...head, full("esds", 0, 0, u8(3), u8(es.length), es));
}

/** Runs of equal values as count, value. */
function runs(values: number[]): [number, number][] {
	const out: [number, number][] = [];
	for (const v of values) {
		const l = out[out.length - 1];
		if (l && l[1] === v) l[0]++;
		else out.push([1, v]);
	}
	return out;
}

interface Track {
	id: number;
	handler: "vide" | "soun";
	timescale: number;
	entry: Uint8Array;
	width: number;
	height: number;
	samples: Sample[];
}

function trak(t: Track, offset: number, movieScale: number): Uint8Array {
	const ticks = (us: number) => Math.round((us * t.timescale) / 1e6);
	// (durations from the sum of what came, so the rounding doesn't add up)
	const shown = t.samples.map((s) => ticks(s.time));
	const at = [...shown].sort((a, b) => a - b);
	// an encoder with B frames hands them over in the order they decode: times are shown ones
	let early = 0;
	shown.forEach((v, i) => (early = Math.max(early, at[i]! - v)));
	const offsets = shown.map((v, i) => v - at[i]! + early);
	const last = t.samples.reduce((a, b) => (b.time > a.time ? b : a));
	at.push(ticks(last.time + last.duration));
	const deltas = at.slice(1).map((v, i) => v - at[i]!);
	const total = deltas.reduce((a, b) => a + b, 0);
	const start = at[0]! + early;
	const stts = runs(deltas);
	const ctts = runs(offsets);
	const keys = t.samples.flatMap((s, i) => (s.key ? [i + 1] : []));
	const sound = t.handler === "soun";
	const movie = Math.round((total * movieScale) / t.timescale);
	const unit = [1, 0, 0, 0, 1, 0, 0, 0, 0x40000000].map((v, i) => u32(i === 0 || i === 4 ? 0x10000 : v));
	const stbl = box(
		"stbl",
		full("stsd", 0, 0, u32(1), t.entry),
		full("stts", 0, 0, u32(stts.length), ...stts.flatMap(([n, d]) => [u32(n), u32(d)])),
		...(offsets.some((v) => v) ? [full("ctts", 0, 0, u32(ctts.length), ...ctts.flatMap(([n, d]) => [u32(n), u32(d)]))] : []),
		...(sound || keys.length === t.samples.length ? [] : [full("stss", 0, 0, u32(keys.length), ...keys.map(u32))]),
		full("stsc", 0, 0, u32(1), u32(1), u32(t.samples.length), u32(1)),
		full("stsz", 0, 0, u32(0), u32(t.samples.length), ...t.samples.map((s) => u32(s.data.length))),
		full("stco", 0, 0, u32(1), u32(offset)),
	);
	return box(
		"trak",
		full("tkhd", 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(movie), new Uint8Array(8), u16(0), u16(sound ? 1 : 0), u16(sound ? 0x100 : 0), u16(0), ...unit, u32(t.width * 65536), u32(t.height * 65536)),
		...(start ? [box("edts", full("elst", 0, 0, u32(1), u32(movie), u32(start), u32(0x10000)))] : []),
		box(
			"mdia",
			full("mdhd", 0, 0, u32(0), u32(0), u32(t.timescale), u32(total), u16(0x55c4), u16(0)),
			full("hdlr", 0, 0, u32(0), ascii(t.handler), new Uint8Array(12), ascii(sound ? "SoundHandler\0" : "VideoHandler\0")),
			box("minf", sound ? full("smhd", 0, 0, u32(0)) : full("vmhd", 0, 1, new Uint8Array(8)), box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))), stbl),
		),
	);
}

/** An MP4 file. The index comes first: the file plays while it loads. */
export function muxMp4(video: VideoTrack, audio?: AudioTrack): Uint8Array {
	const tracks: Track[] = [{ id: 1, handler: "vide", timescale: 90000, entry: visualEntry(video), width: video.width, height: video.height, samples: video.samples }];
	if (audio?.samples.length) tracks.push({ id: 2, handler: "soun", timescale: audio.sampleRate, entry: audioEntry(audio), width: 0, height: 0, samples: audio.samples });
	const AV = video.codec.startsWith("av01") ? "av01" : video.codec.startsWith("avc1") ? "avc1" : "vp09";
	const ftyp = box("ftyp", ascii("isom"), u32(0x200), ascii("isom"), ascii("iso6"), ascii("mp41"), ascii(AV));
	const movieScale = 1000;
	const moov = (at: number[]) => {
		const traks = tracks.map((t, i) => trak(t, at[i]!, movieScale));
		const end = Math.max(...tracks.flatMap((t) => t.samples.map((s) => s.time + s.duration)));
		const unit = [1, 0, 0, 0, 1, 0, 0, 0, 0x40000000].map((v, i) => u32(i === 0 || i === 4 ? 0x10000 : v));
		return box(
			"moov",
			full(
				"mvhd",
				0,
				0,
				u32(0),
				u32(0),
				u32(movieScale),
				u32(Math.round(end / 1000)),
				u32(0x10000),
				u16(0x100),
				new Uint8Array(10),
				...unit,
				new Uint8Array(24),
				u32(tracks.length + 1),
			),
			...traks,
		);
	};
	// (its size doesn't depend on the offsets: asked once with zeros)
	const head = ftyp.length + moov(tracks.map(() => 0)).length + 8;
	const offsets: number[] = [];
	let o = head;
	for (const t of tracks) {
		offsets.push(o);
		o += t.samples.reduce((n, s) => n + s.data.length, 0);
	}
	return concat([ftyp, moov(offsets), u32(o - head + 8), ascii("mdat"), ...tracks.flatMap((t) => t.samples.map((s) => s.data))]);
}

// ---------------------------------------------------------------- WebM

/** A number as EBML writes a size: the shortest form. */
function vint(v: number): Uint8Array {
	for (let n = 1; n <= 8; n++) if (v < 2 ** (7 * n) - 1) {
		const out = be(v, n);
		out[0]! |= 1 << (8 - n);
		return out;
	}
	throw new Error("too large");
}

const idBytes = (id: number): Uint8Array => {
	const n = id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1;
	return be(id, n);
};
const el = (id: number, ...parts: Uint8Array[]): Uint8Array => {
	const body = concat(parts);
	return concat([idBytes(id), vint(body.length), body]);
};
const uint = (id: number, v: number): Uint8Array => {
	let n = 1;
	while (v >= 2 ** (8 * n)) n++;
	return el(id, be(v, n));
};
const float = (id: number, v: number): Uint8Array => {
	const b = new DataView(new ArrayBuffer(8));
	b.setFloat64(0, v);
	return el(id, new Uint8Array(b.buffer));
};
const text = (id: number, s: string) => el(id, ascii(s));

/**
 * The samples (at 48 kHz) a decoder drops at the start of Opus: what the encoder's own head says,
 * else libopus's usual 312 (6.5 ms). One number for the head, MP4's dOps and WebM's CodecDelay:
 * 80 ms in one and 6.5 in the other let a player that goes by the head cut 80 ms of sound.
 */
function opusPreSkip(a: AudioTrack): number {
	const d = a.description;
	return d && d.length >= 12 && d[0] === 0x4f && d[1] === 0x70 ? d[10]! | (d[11]! << 8) : 312;
}

function opusHead(a: AudioTrack): Uint8Array {
	const h = new DataView(new ArrayBuffer(19));
	"OpusHead".split("").forEach((c, i) => h.setUint8(i, c.charCodeAt(0)));
	h.setUint8(8, 1);
	h.setUint8(9, a.channels);
	h.setUint16(10, opusPreSkip(a), true);
	h.setUint32(12, a.sampleRate, true);
	return new Uint8Array(h.buffer);
}

/** A WebM file: one cluster from each key frame, cues to find them. */
export function muxWebm(video: VideoTrack, audio?: AudioTrack): Uint8Array {
	const fps = video.samples.length > 1 ? (video.samples.length * 1e6) / video.samples.reduce((n, s) => n + s.duration, 0) : 24;
	const id = video.codec.startsWith("vp09") ? "V_VP9" : video.codec.startsWith("av01") ? "V_AV1" : "V_VP8";
	const hasAudio = !!audio?.samples.length;
	const tracks = el(
		0x1654ae6b,
		el(
			0xae,
			uint(0xd7, 1),
			uint(0x73c5, 1),
			uint(0x83, 1),
			uint(0x9c, 0),
			text(0x86, id),
			uint(0x23e383, Math.round(1e9 / fps)),
			el(0xe0, uint(0xb0, video.width), uint(0xba, video.height)),
		),
		...(hasAudio
			? [
					el(
						0xae,
						uint(0xd7, 2),
						uint(0x73c5, 2),
						uint(0x83, 2),
						uint(0x9c, 0),
						text(0x86, "A_OPUS"),
						el(0x63a2, opusHead(audio!)),
						uint(0x56aa, Math.round((opusPreSkip(audio!) / 48000) * 1e9)),
						uint(0x56bb, 80000000),
						el(0xe1, float(0xb5, audio!.sampleRate), uint(0x9f, audio!.channels)),
					),
				]
			: []),
	);
	const end = Math.max(...[video, ...(hasAudio ? [audio!] : [])].flatMap((t) => t.samples.map((s) => s.time + s.duration)));
	const info = el(0x1549a966, uint(0x2ad7b1, 1000000), float(0x4489, end / 1000), text(0x4d80, "Flash2SVG"), text(0x5741, "Flash2SVG"));
	// clusters in time order, each block in place
	// (frames in the order they decode, each at the place of the time in that order)
	const order = video.samples.map((s) => s.time).sort((a, b) => a - b);
	type Tagged = { s: Sample; track: number; at: number };
	const all: Tagged[] = [...video.samples.map((s, i) => ({ s, track: 1, at: order[i]! })), ...(hasAudio ? audio!.samples.map((s) => ({ s, track: 2, at: s.time })) : [])].sort((a, b) => a.at - b.at || a.track - b.track);
	const clusters: { time: number; body: Uint8Array[] }[] = [];
	for (const { s, track } of all) {
		const ms = Math.round(s.time / 1000);
		let c = clusters[clusters.length - 1];
		if (!c || (track === 1 && s.key) || ms - c.time > 30000) clusters.push((c = { time: ms, body: [uint(0xe7, ms)] }));
		c.body.push(el(0xa3, vint(track), u16((ms - c.time) & 0xffff), u8(s.key || track === 2 ? 0x80 : 0), s.data));
	}
	const made = clusters.map((c) => el(0x1f43b675, ...c.body));
	// cues: where each cluster starts in the segment (of a fixed length: they come before the clusters)
	const cue = (ms: number, at: number) => el(0xbb, uint(0xb3, ms), el(0xb7, uint(0xf7, 1), el(0xf1, be(at, 8))));
	const cues = (start: number) => {
		let at = start;
		return el(
			0x1c53bb6b,
			...clusters.map((c, i) => {
				const one = cue(c.time, at);
				at += made[i]!.length;
				return one;
			}),
		);
	};
	const before = info.length + tracks.length;
	const size = cues(0).length;
	const segment = concat([info, tracks, cues(before + size), ...made]);
	const ebml = el(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), text(0x4282, "webm"), uint(0x4287, 4), uint(0x4285, 2));
	return concat([ebml, idBytes(0x18538067), vintFixed(segment.length), segment]);
}

/** A size in 8 bytes. */
function vintFixed(v: number): Uint8Array {
	const out = be(v, 8);
	out[0] = 1;
	return out;
}
