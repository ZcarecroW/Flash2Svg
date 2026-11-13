import { describe, expect, it } from "vitest";
import { muxMp4, muxWebm } from "../../src/core/mux.ts";
import { encodeGif, paced, type RasterFrame } from "../../src/core/raster.ts";

const frames = (n: number, fps: number): RasterFrame[] =>
	Array.from({ length: n }, (_, i) => ({ pixels: { data: new Uint8ClampedArray([i, 0, 0, 255]), width: 1, height: 1 }, ms: 1000 / fps }));

describe("GIF and WebP frame timing", () => {
	it("keeps every delay a browser honours and the exact length", () => {
		// browsers show 10 ms and less as 100 ms: GIF counts hundredths, WebP milliseconds
		for (const fps of [8, 12, 24, 25, 30, 50, 60, 100, 120]) {
			const gif = paced(frames(fps * 2, fps), 10, 2);
			expect(Math.min(...gif.delays), `GIF at ${fps} fps`).toBeGreaterThanOrEqual(2);
			expect(
				gif.delays.reduce((a, b) => a + b, 0),
				`GIF at ${fps} fps`,
			).toBe(200);
			const webp = paced(frames(fps * 2, fps), 1, 11);
			expect(Math.min(...webp.delays), `WebP at ${fps} fps`).toBeGreaterThanOrEqual(11);
			expect(
				webp.delays.reduce((a, b) => a + b, 0),
				`WebP at ${fps} fps`,
			).toBe(2000);
			// up to 50 fps every frame stays
			if (fps <= 50) expect(gif.frames.length).toBe(fps * 2);
		}
		// 24 fps alternates 4 and 5 hundredths
		expect([...new Set(paced(frames(48, 24), 10, 2).delays)].sort()).toEqual([4, 5]);
		// a 60 fps GIF leaves out every third picture
		expect(paced(frames(120, 60), 10, 2).frames.length).toBe(80);
	});

	it("writes those delays into the GIF", () => {
		const bytes = encodeGif(frames(120, 60), true);
		const s = Buffer.from(bytes);
		const d: number[] = [];
		for (let i = 0; i + 5 < s.length; i++) if (s[i] === 0x21 && s[i + 1] === 0xf9 && s[i + 2] === 4) d.push(s.readUInt16LE(i + 4));
		expect(d.length).toBe(80);
		expect(Math.min(...d)).toBeGreaterThanOrEqual(2);
		expect(d.reduce((a, b) => a + b, 0)).toBe(200);
		// loops: the NETSCAPE2.0 extension with 0 repetitions = forever
		expect(s.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
	});

	it("clears every frame when its time is over (an opaque one showed through the next one's transparent parts)", () => {
		const opaque = new Uint8ClampedArray(16 * 4).fill(255);
		const half = Uint8ClampedArray.from({ length: 16 * 4 }, (_, i) => (i < 32 ? 255 : 0));
		const s = Buffer.from(
			encodeGif(
				[opaque, half].map((data) => ({ pixels: { data, width: 4, height: 4 }, ms: 100 })),
				true,
			),
		);
		const disposal: number[] = [];
		for (let i = 0; i + 5 < s.length; i++) if (s[i] === 0x21 && s[i + 1] === 0xf9 && s[i + 2] === 4) disposal.push((s[i + 3]! >> 2) & 7);
		expect(disposal).toEqual([2, 2]);
	});
});

describe("MP4 and WebM", () => {
	const video = { codec: "avc1.640028", width: 4, height: 4, samples: [{ data: new Uint8Array(8), time: 0, duration: 41667, key: true }] };
	const sound = (description?: Uint8Array) => ({
		codec: "opus" as const,
		sampleRate: 48000,
		channels: 2,
		samples: [{ data: new Uint8Array(4), time: 0, duration: 20000, key: true }],
		description,
	});
	const find = (bytes: Uint8Array, name: string) => Buffer.from(bytes).indexOf(Buffer.from(name, "latin1"));

	it("writes the unity matrix of MP4 with 1.0 in its last place", () => {
		const mp4 = Buffer.from(muxMp4(video));
		for (const name of ["mvhd", "tkhd"]) {
			// version 0: the matrix is 36 bytes, 9 numbers; the last one is 2.30 fixed point
			const at = mp4.indexOf(Buffer.from([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x01, 0x00, 0x00]), find(mp4, name));
			expect(at, name).toBeGreaterThan(0);
			expect(mp4.readUInt32BE(at + 32), name).toBe(0x40000000);
		}
	});

	it("says one start delay for Opus everywhere: the encoder's own, else 312 samples", () => {
		const head = (d: number) => {
			const h = new Uint8Array(19);
			h.set(Buffer.from("OpusHead"));
			new DataView(h.buffer).setUint16(10, d, true);
			return h;
		};
		for (const [description, samples] of [
			[undefined, 312],
			[head(840), 840],
		] as const) {
			const webm = Buffer.from(muxWebm({ ...video, codec: "vp09.00.40.08" }, sound(description)));
			const at = find(webm, "OpusHead");
			expect(webm.readUInt16LE(at + 10)).toBe(samples);
			// CodecDelay (0x56AA), in nanoseconds
			const delay = webm.indexOf(Buffer.from([0x56, 0xaa]));
			const size = webm[delay + 2]! & 0x7f;
			expect(Number(webm.readUIntBE(delay + 3, size))).toBe(Math.round((samples / 48000) * 1e9));
			const mp4 = Buffer.from(muxMp4(video, sound(description)));
			expect(mp4.readUInt16BE(find(mp4, "dOps") + 4 + 2)).toBe(samples);
		}
	});
});

describe("GIF and WebP export", () => {
	it("encodes frames while it draws them (memory for a few pictures, not all)", async () => {
		const { exportRaster } = await import("../../src/core/raster.ts");
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const dir = new URL("../fixtures/models/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
		const model = JSON.parse(readFileSync(join(dir, "f28-onestop.json"), "utf8"));
		model.roots = ["sym:spin8"];
		const files = {
			readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#c30" d="M0 0L9 0 9 9 0 9Z"/></svg>`,
			readBinary: () => new Uint8Array(),
		};
		const log: string[] = [];
		let tick = 0;
		// every tick a different picture; a minimal lossless WebP for each frame
		const webp = new Uint8Array([...Buffer.from("RIFF"), 18, 0, 0, 0, ...Buffer.from("WEBPVP8L"), 6, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0]);
		const codecs = { webp: async () => (log.push("encode"), webp) } as never;
		await exportRaster(
			model,
			files,
			{ format: "webp" },
			async (_svg, w, h) => (log.push("draw"), { data: new Uint8ClampedArray(w * h * 4).fill(++tick % 255), width: w, height: h }),
			codecs,
		);
		// after the 3 sample pictures (each encoded both ways), encoding goes along with drawing
		const firstFrame = log.indexOf("encode", log.indexOf("draw", 9) + 1);
		expect(firstFrame).toBeGreaterThan(0);
		expect(firstFrame).toBeLessThan(log.lastIndexOf("draw"));
	});
});
