import { describe, expect, it } from "vitest";
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
