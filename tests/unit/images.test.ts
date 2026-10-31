import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nodeWasmLoader } from "../../src/cli/wasm.ts";
import { createCodecs } from "../../src/core/codecs.ts";
import { compileScene } from "../../src/core/compile.ts";
import { encodeImages } from "../../src/core/images.ts";
import type { BitmapData, Mat, SceneModel } from "../../src/core/model.ts";

const codecs = createCodecs(nodeWasmLoader());
const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/assets/${name}`, import.meta.url)));
// what the extractor writes: lossless masters, and Animate's JPEG for "Photo" bitmaps
const FILES: Record<string, Uint8Array> = {
	"bitmaps/photo.png": asset("photo-as-png.png"),
	"bitmaps/photo.jpg": asset("photo.jpg"),
	"bitmaps/icon.png": asset("icon.png"),
	"bitmaps/glow.png": asset("glow.png"),
	"bitmaps/pattern.png": asset("pattern.png"),
};
const files = { readText: () => "", readBinary: (rel: string) => FILES[rel]! };
const bmp = (name: string, file: string, extra: Partial<BitmapData> = {}): BitmapData => ({
	name,
	file,
	width: 1,
	height: 1,
	smoothing: true,
	compression: "lossless",
	...extra,
});
/** A one-frame scene showing the bitmaps with these matrices (default: at their own size). */
const sceneOf = (bitmaps: Record<string, BitmapData>, matrices: Record<string, Mat> = {}) =>
	({
		version: 1,
		app: { version: "24", platform: "win" },
		doc: { name: "t.fla", type: "Flash", width: 400, height: 300, frameRate: 24, backgroundColor: "#ffffff" },
		roots: ["scene"],
		timelines: {
			scene: {
				id: "scene",
				name: "Scene 1",
				kind: "scene",
				frameCount: 1,
				layers: [
					{
						name: "bitmaps",
						type: "normal",
						visible: true,
						parent: -1,
						frameCount: 1,
						keyframes: [
							{
								index: 0,
								duration: 1,
								elements: Object.keys(bitmaps).map((id) => ({
									kind: "bitmap",
									bitmap: id,
									matrix: matrices[id] ?? [1, 0, 0, 1, 0, 0],
									bounds: { left: 0, top: 0, width: 1, height: 1 },
								})),
							},
						],
					},
				],
			},
		},
		atlas: {},
		sounds: {},
		warnings: [],
		bitmaps,
	}) as unknown as SceneModel;
const model = sceneOf({
	photo: bmp("photo.jpg", "bitmaps/photo.png", { compression: "photo", quality: -1, jpeg: "bitmaps/photo.jpg" }),
	icon: bmp("icon.png", "bitmaps/icon.png"),
	glow: bmp("glow.png", "bitmaps/glow.png", { compression: "photo", quality: 70 }),
	pattern: bmp("pattern.png", "bitmaps/pattern.png", { smoothing: false }),
});

const pixels = async (png: Uint8Array) => Array.from((await codecs.decodePng(png)).data);
const magic = (b: Uint8Array) =>
	b[0] === 0x89 && b[1] === 0x50
		? "png"
		: b[0] === 0xff && b[1] === 0xd8
			? "jpeg"
			: String.fromCharCode(...b.slice(8, 12)) === "WEBP"
				? "webp"
				: String.fromCharCode(...b.slice(4, 12)) === "ftypavif"
					? "avif"
					: "?";

describe("bitmap encoding", () => {
	it("follows Animate's settings: photos as its JPEG (imported JPEGs unchanged), the rest exact", async () => {
		const r = await encodeImages(model, files, {}, codecs);
		const out = (id: string) => r.files.readBinary(r.model.bitmaps[id]!.file);
		expect(out("photo")).toEqual(FILES["bitmaps/photo.jpg"]);
		expect(r.model.bitmaps.photo!.file).toMatch(/\.jpg$/);
		// lossless: smaller, every pixel the same
		expect(magic(out("icon"))).toBe("png");
		expect(out("icon").byteLength).toBeLessThan(FILES["bitmaps/icon.png"]!.byteLength);
		expect(await pixels(out("icon"))).toEqual(await pixels(FILES["bitmaps/icon.png"]!));
		expect(await pixels(out("pattern"))).toEqual(await pixels(FILES["bitmaps/pattern.png"]!));
		// a transparent "photo" never becomes a JPEG
		expect(["webp", "png"]).toContain(magic(out("glow")));
	});

	it("writes the chosen formats, and per-bitmap modes override Animate's", async () => {
		const r = await encodeImages(
			model,
			files,
			{ imageLossy: "avif", imageLossless: "webp", imageModes: { "photo.jpg": "lossless", "glow.png": "lossless" } },
			codecs,
		);
		const fmt = (id: string) => magic(r.files.readBinary(r.model.bitmaps[id]!.file));
		expect(fmt("photo")).toBe("webp"); // lossless now
		expect(fmt("icon")).toBe("webp");
		expect(r.report.find((x) => x.name === "photo.jpg")).toMatchObject({ mode: "lossless", format: "webp" });
		const lossy = await encodeImages(model, files, { imageLossy: "avif", imageQuality: 60 }, codecs);
		expect(magic(lossy.files.readBinary(lossy.model.bitmaps.photo!.file))).toBe("avif");
		expect(lossy.model.bitmaps.photo!.file).toMatch(/\.avif$/);
	});

	it("keeps small pictures exact when that is smaller, and warns only when JPEG gives way to WebP", async () => {
		const r = await encodeImages(model, files, { imageModes: { "icon.png": "lossy", "pattern.png": "lossy" } }, codecs);
		for (const id of ["icon", "pattern"]) {
			const rep = r.report.find((x) => x.name === r.model.bitmaps[id]!.name)!;
			// the lossy encodings of these tiny pictures are bigger than the exact ones
			expect(rep.format).toBe("png");
		}
		expect(r.warnings.every((w) => /WebP/.test(w))).toBe(true);
	});
});

describe("bitmap downscaling", () => {
	// the real sizes: the photos are 240 x 160, the icon 48 x 48
	const sized = {
		photo: bmp("photo.jpg", "bitmaps/photo.png", { width: 240, height: 160, compression: "photo", quality: -1, jpeg: "bitmaps/photo.jpg" }),
		exact: bmp("photo-as-png.png", "bitmaps/photo.png", { width: 240, height: 160 }),
		icon: bmp("icon.png", "bitmaps/icon.png", { width: 48, height: 48 }),
		pattern: bmp("pattern.png", "bitmaps/pattern.png", { width: 8, height: 8, smoothing: false }),
	};
	const quarter: Mat = [0.2, 0, 0, 0.2, 10, 10];
	const small = sceneOf(sized, { photo: quarter, exact: [0.25, 0, 0, 0.1, 0, 0], icon: [0.25, 0, 0, 0.1, 0, 0], pattern: [0.1, 0, 0, 0.1, 0, 0] });
	const size = async (png: Uint8Array) => {
		const p = await codecs.decodePng(png);
		return [p.width, p.height];
	};

	it("writes bitmaps shown smaller at twice their largest size on stage", async () => {
		const r = await encodeImages(small, files, {}, codecs);
		const rep = (name: string) => r.report.find((x) => x.name === name)!;
		// 240 x 160 shown at 0.2 -> 96 x 64; Animate's JPEG can't be used then: a new one
		expect(rep("photo.jpg")).toMatchObject({ width: 96, height: 64, sourceWidth: 240, sourceHeight: 160, format: "jpeg" });
		expect(r.model.bitmaps.photo!.pixels).toEqual([96, 64]);
		expect(magic(r.files.readBinary(r.model.bitmaps.photo!.file))).toBe("jpeg");
		// each axis on its own: 240 x 160 shown at 0.25 x 0.1 -> 120 x 32, still lossless (PNG)
		expect(rep("photo-as-png.png")).toMatchObject({ width: 120, height: 32, format: "png" });
		expect(await size(r.files.readBinary(r.model.bitmaps.exact!.file))).toEqual([120, 32]);
		// the tiny icon at 24 x 10 pixels would be a bigger file than at 48 x 48 (its resampled
		// soft edge compresses worse): every pixel then
		expect(rep("icon.png")).toMatchObject({ width: 48, height: 48, format: "png" });
		expect(r.model.bitmaps.icon!.pixels).toBeUndefined();
		// no smoothing (pixel art): every pixel stays
		expect(rep("pattern.png")).toMatchObject({ width: 8, height: 8 });
		expect(r.model.bitmaps.pattern!.pixels).toBeUndefined();
		// the SVG still draws them at their full size, stretched exactly over it
		const svg = compileScene(r.model, r.files, { format: "static" }).files[0]!.svg;
		expect(svg).toMatch(/<image [^>]*width="240" height="160"[^>]*preserveAspectRatio="none"/);
		expect(svg.match(/<image [^>]*width="240" height="160"[^>]*preserveAspectRatio="none"/g)).toHaveLength(2);
		expect(svg).not.toMatch(/<image [^>]*width="48" height="48"[^>]*preserveAspectRatio/);
		expect(svg).not.toMatch(/<image [^>]*width="8" height="8"[^>]*preserveAspectRatio/);
	});

	it("keeps every pixel with resolution 0, for bitmaps marked full size, and when the saving is small", async () => {
		const off = await encodeImages(small, files, { imageResolution: 0 }, codecs);
		expect(off.report.every((x) => x.width === x.sourceWidth && x.height === x.sourceHeight)).toBe(true);
		expect(off.model.bitmaps.photo!.file).toBe("bitmaps/photo.jpg"); // Animate's JPEG again
		const full = await encodeImages(small, files, { imageFullSize: { "photo.jpg": true } }, codecs);
		expect(full.report.find((x) => x.name === "photo.jpg")).toMatchObject({ width: 240, height: 160, format: "original" });
		expect(full.report.find((x) => x.name === "photo-as-png.png")!.width).toBe(120);
		// shown at 0.45: 2x is 0.9 of the pixels per side, 81 % of them: not worth a resampling
		const near = await encodeImages(sceneOf(sized, { photo: [0.45, 0, 0, 0.45, 0, 0] }), files, {}, codecs);
		expect(near.report.find((x) => x.name === "photo.jpg")!.width).toBe(240);
		// resolution 1: the size on stage
		const one = await encodeImages(small, files, { imageResolution: 1 }, codecs);
		expect(one.report.find((x) => x.name === "photo.jpg")).toMatchObject({ width: 48, height: 32 });
	});

	it("keeps every pixel when the smaller picture wouldn't be smaller as a file (flat gradients)", async () => {
		// a horizontal gradient: PNG predicts every row from the one above, resampled rows less so
		const wide = { wide: bmp("wide.png", "bitmaps/wide.png", { width: 400, height: 200 }) };
		const flat = { ...files, readBinary: (rel: string) => (rel === "bitmaps/wide.png" ? asset("wide.png") : files.readBinary(rel)) };
		const r = await encodeImages(sceneOf(wide, { wide: [0.2, 0, 0, 0.8, 0, 0] }), flat, {}, codecs);
		const rep = r.report[0]!;
		expect(rep).toMatchObject({ width: 400, height: 200, format: "png" });
		expect(rep.bytes).toBeLessThanOrEqual(asset("wide.png").byteLength);
		expect(r.model.bitmaps.wide!.pixels).toBeUndefined();
	});

	it("never writes more pixels than the bitmap has, and leaves bitmaps the export doesn't draw alone", async () => {
		const big = await encodeImages(sceneOf(sized, { photo: [3, 0, 0, 3, 0, 0] }), files, {}, codecs);
		expect(big.report.find((x) => x.name === "photo.jpg")).toMatchObject({ width: 240, height: 160 });
		const unused = sceneOf(sized);
		unused.timelines.scene!.layers[0]!.keyframes[0]!.elements = [];
		const r = await encodeImages(unused, files, {}, codecs);
		expect(r.report).toEqual([]);
		expect(r.model.bitmaps.photo).toBe(unused.bitmaps.photo);
	});
});
