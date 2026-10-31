import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nodeWasmLoader } from "../../src/cli/wasm.ts";
import { encodeSounds, mp3Rate, oggOpus, readWav, resample, writeWav, type Pcm } from "../../src/core/audio.ts";
import { createAudioCodecs } from "../../src/core/audio-codecs.ts";
import { compileScene } from "../../src/core/compile.ts";
import type { FrameSound, SceneModel, SoundData } from "../../src/core/model.ts";
import type { PProgram } from "../../src/player/format.ts";

const codecs = createAudioCodecs(nodeWasmLoader());
const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/assets/${name}`, import.meta.url)));
const sine = (rate: number, hz: number, seconds: number, amp = 0.5) =>
	Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate) * amp);

/** What Animate exports: the WAV padded with silence to several times its length. */
function padded(pcm: Pcm, total: number): Uint8Array {
	return writeWav({ rate: pcm.rate, data: pcm.data.map((c) => Float32Array.from({ length: total }, (_, i) => c[i] ?? 0)) });
}
const chord = readWav(asset("chord.wav")); // 1.5 s stereo, 44.1 kHz
const FILES: Record<string, Uint8Array> = {
	"sounds/chord.wav": padded(chord, 87376),
	"sounds/melody.mp3": asset("melody.mp3"),
};
const files = { readText: () => "", readBinary: (rel: string) => FILES[rel]! };
const snd = (name: string, file: string, extra: Partial<SoundData> = {}): SoundData => ({
	name,
	file,
	original: file.endsWith(".mp3") ? "mp3" : "raw",
	compression: "default",
	samples: 66150,
	...extra,
});
const frame = (sound: string, extra: Partial<FrameSound> = {}): FrameSound => ({
	sound,
	sync: "event",
	loopMode: "repeat",
	loops: 1,
	effect: "none",
	...extra,
});
function model(sounds: Record<string, SoundData>, uses: FrameSound[]): SceneModel {
	return {
		version: 1,
		doc: { name: "t.fla", width: 100, height: 100, frameRate: 24, backgroundColor: "#ffffff" },
		roots: ["scene:0"],
		timelines: {
			"scene:0": {
				id: "scene:0",
				name: "Scene 1",
				kind: "scene",
				frameCount: 24,
				layers: [
					{
						name: "a",
						type: "normal",
						visible: true,
						parent: -1,
						frameCount: 24,
						keyframes: uses.map((s, i) => ({ index: i, duration: 1, elements: [], sound: s })),
					},
				],
			},
		},
		atlas: {},
		bitmaps: {},
		sounds,
		warnings: [],
	} as unknown as SceneModel;
}

describe("WAV", () => {
	it("reads what it writes (16 bit), and 8 bit / float files", () => {
		const pcm = { rate: 22050, data: [sine(22050, 440, 0.1), sine(22050, 660, 0.1, -0.25)] };
		const back = readWav(writeWav(pcm));
		expect(back.rate).toBe(22050);
		expect(back.data).toHaveLength(2);
		for (let c = 0; c < 2; c++) for (let i = 0; i < pcm.data[c]!.length; i += 37) expect(back.data[c]![i]).toBeCloseTo(pcm.data[c]![i]!, 4);
		// 8 bit unsigned, then float
		const w8 = writeWav({ rate: 8000, data: [new Float32Array([0, 0.5, -0.5])] });
		const raw8 = new Uint8Array(44 + 3);
		raw8.set(w8.subarray(0, 44));
		const v = new DataView(raw8.buffer);
		v.setUint32(4, 36 + 3, true);
		v.setUint16(32, 1, true);
		v.setUint16(34, 8, true);
		v.setUint32(40, 3, true);
		raw8.set([128, 192, 64], 44);
		expect(Array.from(readWav(raw8).data[0]!)).toEqual([0, 0.5, -0.5]);
		const f = new Uint8Array(44 + 8);
		f.set(raw8.subarray(0, 44));
		const fv = new DataView(f.buffer);
		fv.setUint16(20, 3, true);
		fv.setUint16(34, 32, true);
		fv.setUint32(40, 8, true);
		fv.setFloat32(44, 0.25, true);
		fv.setFloat32(48, -1, true);
		expect(Array.from(readWav(f).data[0]!)).toEqual([0.25, -1]);
		expect(() => readWav(new Uint8Array(20))).toThrow();
	});
});

describe("resampling", () => {
	it("keeps the signal (a 1 kHz sine 44.1 -> 48 kHz within -80 dB) and the length", () => {
		const r = resample({ rate: 44100, data: [sine(44100, 1000, 1)] }, 48000);
		expect(r.rate).toBe(48000);
		expect(r.data[0]).toHaveLength(48000);
		let err = 0;
		for (let i = 200; i < 47800; i++) err = Math.max(err, Math.abs(r.data[0]![i]! - Math.sin((2 * Math.PI * 1000 * i) / 48000) * 0.5));
		expect(20 * Math.log10(err / 0.5)).toBeLessThan(-80);
	});
	it("filters what the lower rate can't hold", () => {
		// 8 kHz tone into 11025 Hz (Nyquist 5.5 kHz): gone, instead of folding back as 3 kHz
		const r = resample({ rate: 44100, data: [sine(44100, 8000, 0.5)] }, 11025);
		const peak = r.data[0]!.slice(100, -100).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
		expect(peak).toBeLessThan(0.01);
	});
});

describe("Ogg Opus", () => {
	it("writes valid pages: head, tags, granule positions with the pre-skip, end of stream", () => {
		const packets = Array.from({ length: 120 }, (_, i) => new Uint8Array(100 + (i % 7) * 60).fill(i));
		const ogg = oggOpus(packets, 2, 312, 44100, 114000);
		const pages: { flags: number; granule: number; body: Uint8Array }[] = [];
		for (let o = 0; o < ogg.length;) {
			expect(String.fromCharCode(...ogg.subarray(o, o + 4))).toBe("OggS");
			const v = new DataView(ogg.buffer, ogg.byteOffset + o);
			const n = ogg[o + 26]!;
			const len = ogg.subarray(o + 27, o + 27 + n).reduce((a, b) => a + b, 0);
			// CRC over the page with its CRC field zeroed
			const page = ogg.slice(o, o + 27 + n + len);
			const crc = v.getUint32(22, true);
			page.fill(0, 22, 26);
			let c = 0;
			for (const byte of page) {
				c ^= byte << 24;
				for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
			}
			expect(c >>> 0).toBe(crc);
			pages.push({ flags: ogg[o + 5]!, granule: v.getUint32(6, true), body: ogg.subarray(o + 27 + n, o + 27 + n + len) });
			o += 27 + n + len;
		}
		expect(String.fromCharCode(...pages[0]!.body.subarray(0, 8))).toBe("OpusHead");
		expect(pages[0]!.body[9]).toBe(2);
		expect(new DataView(pages[0]!.body.buffer, pages[0]!.body.byteOffset).getUint16(10, true)).toBe(312);
		expect(pages[0]!.flags).toBe(2);
		expect(String.fromCharCode(...pages[1]!.body.subarray(0, 8))).toBe("OpusTags");
		const last = pages[pages.length - 1]!;
		expect(last.flags).toBe(4);
		expect(last.granule).toBe(312 + 114000);
		// granules count decoded samples: 960 per packet from the first one on
		expect(pages[2]!.granule % 960).toBe(0);
		for (let i = 3; i < pages.length; i++) expect(pages[i]!.granule).toBeGreaterThan(pages[i - 1]!.granule);
	});
});

describe("sound encoding", () => {
	it("cuts Animate's padding, follows its compression settings and keeps imported MP3s", async () => {
		const m = model(
			{
				chord: snd("chord.wav", "sounds/chord.wav"),
				mono: snd("chord mono.wav", "sounds/chord.wav", { compression: "mp3", bitRate: 32, mono: true }),
				raw: snd("raw.wav", "sounds/chord.wav", { compression: "raw", sampleRate: 11025, mono: true }),
				melody: snd("melody.mp3", "sounds/melody.mp3", { compression: "mp3", importedQuality: true, samples: 89856 }),
			},
			[frame("chord"), frame("mono"), frame("raw"), frame("melody", { sync: "stream" })],
		);
		const r = await encodeSounds(m, files, {}, codecs);
		const rep = (name: string) => r.report.find((x) => x.name === name)!;
		expect(rep("chord.wav")).toMatchObject({ format: "mp3", kbps: 128, channels: 2, seconds: 1.5 });
		expect(rep("chord mono.wav")).toMatchObject({ format: "mp3", kbps: 32, channels: 1 });
		expect(rep("raw.wav")).toMatchObject({ format: "wav", mode: "lossless", channels: 1 });
		expect(rep("melody.mp3")).toMatchObject({ format: "original" });
		expect(r.files.readBinary(r.model.sounds.melody!.file)).toEqual(FILES["sounds/melody.mp3"]);
		// Raw at 11 kHz: 1.5 s mono 16 bit
		const raw = readWav(new Uint8Array(r.files.readBinary(r.model.sounds.raw!.file)));
		expect(raw.rate).toBe(11025);
		expect(raw.data[0]!.length).toBe(Math.round(1.5 * 11025));
		// the MP3 encoder delay is recorded for the player
		expect(r.model.sounds.chord!.lead).toBeCloseTo(1105 / 44100, 5);
		expect(mp3Rate(new Uint8Array(r.files.readBinary(r.model.sounds.chord!.file)))).toBe(44100);
		expect(rep("chord.wav").bytes).toBeLessThan(rep("chord.wav").sourceBytes / 10);
	});

	it("writes Opus at half the bit rate, WAV per sound, and only the part the frames play", async () => {
		const m = model({ chord: snd("chord.wav", "sounds/chord.wav") }, [
			frame("chord", { limits: { start: 22050, end: 44100 } }),
			frame("chord", { limits: { start: 11025, end: 33075 } }),
		]);
		const r = await encodeSounds(m, files, { soundFormat: "opus", soundBitrate: 96 }, codecs);
		expect(r.report[0]).toMatchObject({ format: "opus", kbps: 48, seconds: 0.75 });
		expect(r.model.sounds.chord).toMatchObject({ trim: 11025, seconds: 0.75, lead: 0 });
		const ogg = r.files.readBinary(r.model.sounds.chord!.file);
		expect(String.fromCharCode(...ogg.subarray(28, 36))).toBe("OpusHead");
		// the player gets in and out points in the cut file
		const out = compileScene(r.model, r.files, { format: "player" });
		const P = JSON.parse(/<script type="application\/json"><!\[CDATA\[(.*?)\]\]>/s.exec(out.files[0]!.svg)![1]!) as PProgram;
		const sd = P.tl["scene:0"]!.sd!;
		// (an out point at the end of the file is left out)
		expect(sd[0]!.slice(5, 7)).toEqual([0.25, null]);
		expect(sd[1]!.slice(5, 7)).toEqual([0, 0.5]);
		expect(P.snd.chord).toEqual([expect.stringMatching(/^data:audio\/ogg;base64,/), 0.75, 0]);
		const wav = await encodeSounds(m, files, { soundModes: { "chord.wav": "lossless" } }, codecs);
		expect(wav.report[0]).toMatchObject({ format: "wav", channels: 2 });
		expect(readWav(new Uint8Array(wav.files.readBinary(wav.model.sounds.chord!.file))).data[0]!.length).toBe(33075);
	});

	it("scales the default bit rate down for low sample rates, not set ones", async () => {
		const low = { rate: 22050, data: [sine(22050, 440, 1)] };
		const lf = { readText: () => "", readBinary: () => writeWav(low) };
		const m = model(
			{ a: snd("a.wav", "sounds/a.wav", { samples: 44100 }), b: snd("b.wav", "sounds/b.wav", { samples: 44100, compression: "mp3", bitRate: 96 }) },
			[frame("a"), frame("b")],
		);
		const r = await encodeSounds(m, lf, {}, codecs);
		expect(r.report.map((x) => x.kbps)).toEqual([32, 96]);
		const o = await encodeSounds(m, lf, { soundFormat: "opus", soundBitrate: 64 }, codecs);
		expect(o.report.map((x) => x.kbps)).toEqual([32, 32]);
	});

	it("passes envelopes to the player and leaves older models alone", async () => {
		const env: [number, number, number][] = [
			[0, 0, 0],
			[16537, 32768, 32768],
		];
		const m = model({ chord: snd("chord.wav", "sounds/chord.wav") }, [frame("chord", { envelope: env, loops: 2 })]);
		const r = await encodeSounds(m, files, {}, codecs);
		const P = JSON.parse(/<!\[CDATA\[(.*?)\]\]>/s.exec(compileScene(r.model, r.files, { format: "player" }).files[0]!.svg)![1]!) as PProgram;
		expect(P.tl["scene:0"]!.sd![0]).toEqual([0, "chord", 0, 2, 1, null, null, [0, 0, 0, 0.375, 1, 1]]);
		const old = model({ chord: { name: "chord.wav", file: "sounds/chord.wav" } }, [frame("chord")]);
		const o = await encodeSounds(old, files, {}, codecs);
		expect(o.model.sounds.chord!.file).toBe("sounds/chord.wav");
		expect(o.report[0]!.format).toBe("original");
	});
});
