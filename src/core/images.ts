/**
 * Embedded bitmaps in the format the export settings ask for. Every bitmap is either kept exactly
 * ("Lossless (PNG/GIF)" in Animate's bitmap properties) or compressed with loss ("Photo (JPEG)"),
 * which the settings can override per bitmap. The codecs (codecs.ts) are WebAssembly builds of the
 * Squoosh encoders: the same code runs in the panel, the command line and the tests.
 */
import { bitmapScales, type BitmapScale } from "./bitmap-scale.ts";
import type { FileSource } from "./context.ts";
import { gradesPictures, type Grade } from "./grade.ts";
import { choice, type BitmapData, type SceneModel } from "./model.ts";

export type LossyFormat = "jpeg" | "webp" | "avif";
export type LosslessFormat = "png" | "webp";

export interface ImageSettings {
	/** Bitmaps compressed with loss ("Photo (JPEG)" in Animate, or "lossy" in imageModes). */
	imageLossy: LossyFormat;
	/** Bitmaps kept exactly as they are ("Lossless (PNG/GIF)", or "lossless" in imageModes). */
	imageLossless: LosslessFormat;
	/** Quality of lossy bitmaps, 1-100 (JPEG scale); 0 = each bitmap's quality set in Animate. */
	imageQuality: number;
	/** Per bitmap (library name): overrides Animate's compression setting. */
	imageModes: Record<string, "lossy" | "lossless">;
	/**
	 * Bitmaps shown smaller than their pixels are made smaller, down to this multiple of the
	 * largest size they are shown at (2 = sharp on screens with 2 device pixels per pixel, or with
	 * the SVG shown at twice its size); 0 = always every pixel.
	 */
	imageResolution: number;
	/** Per bitmap (library name): true = always every pixel. */
	imageFullSize: Record<string, boolean>;
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
	imageLossy: "jpeg",
	imageLossless: "png",
	imageQuality: 0,
	imageModes: {},
	imageResolution: 2,
	imageFullSize: {},
};

/** The WebAssembly files the codecs need (published next to the panel and the CLI). */
export const WASM_FILES = {
	png: "squoosh_png_bg.wasm",
	oxipng: "squoosh_oxipng_bg.wasm",
	resize: "squoosh_resize_bg.wasm",
	webp: "webp_enc.wasm",
	jpeg: "mozjpeg_enc.wasm",
	avif: "avif_enc.wasm",
} as const;
export type Codec = keyof typeof WASM_FILES;

/** Where each file comes from in node_modules (for the build and for running from source). */
export const WASM_SOURCES: Record<Codec, string> = {
	png: "@jsquash/png/codec/pkg/squoosh_png_bg.wasm",
	oxipng: "@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm",
	resize: "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm",
	webp: "@jsquash/webp/codec/enc/webp_enc.wasm",
	jpeg: "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm",
	avif: "@jsquash/avif/codec/enc/avif_enc.wasm",
};

/** Reads a WebAssembly file by its name in WASM_FILES. */
/** How the files of an encoded export reach a bitmap's lossless original: MASTER + its path. */
export const MASTER = "master:";

export type WasmLoader = (file: string) => Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>;

/** RGBA pixels (ImageData). */
export interface Pixels {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

/** The encoders (codecs.ts; the panel loads them only when a document has bitmaps). */
export interface Codecs {
	decodePng(png: Uint8Array): Promise<Pixels>;
	/** Lossless recompression; every pixel stays as it is, transparent ones included. */
	optimisePng(png: Uint8Array): Promise<Uint8Array>;
	/** Optimised PNG from pixels. */
	encodePng(img: Pixels): Promise<Uint8Array>;
	/** The pixels at another size (Lanczos 3). */
	resize(img: Pixels, width: number, height: number): Promise<Pixels>;
	webp(img: Pixels, opts: { quality?: number; lossless?: number; exact?: number; method?: number }): Promise<Uint8Array>;
	jpeg(img: Pixels, quality: number): Promise<Uint8Array>;
	/** quality on AVIF's own scale */
	avif(img: Pixels, quality: number): Promise<Uint8Array>;
}

export interface ImageReport {
	name: string;
	mode: "lossy" | "lossless";
	/** "original" = the file as Animate publishes it (no new compression). */
	format: LossyFormat | LosslessFormat | "original";
	bytes: number;
	/** Size of the lossless master. */
	sourceBytes: number;
	/** Pixels written (smaller than the bitmap's own when it is shown smaller). */
	width: number;
	height: number;
	/** The bitmap's own pixels. */
	sourceWidth: number;
	sourceHeight: number;
}

/**
 * Script calls that read a bitmap's pixels: the JS player then carries a PNG of them, as Flash
 * Player has them at once (emit/player.ts).
 */
export const PIXEL_READS =
	/\.(getPixel32|getPixel|getPixels|getVector|copyPixels|copyChannel|draw|threshold|compare|histogram|getColorBoundsRect|hitTest|merge|paletteMap|floodFill|clone)\b/;

/** True when a frame script or class file of the document may read bitmap pixels. */
function scriptsReadPixels(model: SceneModel): boolean {
	for (const tl of Object.values(model.timelines))
		for (const l of tl.layers) for (const k of l.keyframes) if (k.script && PIXEL_READS.test(k.script)) return true;
	return !!model.classes?.files.some((f) => PIXEL_READS.test(f.code));
}

/** Lossless masters below this size are also tried without loss (see encodeImages). */
const SMALL = 32 * 1024;

const EXT: Record<LossyFormat | LosslessFormat, string> = { jpeg: "jpg", png: "png", webp: "webp", avif: "avif" };

function modeOf(b: BitmapData, s: ImageSettings): "lossy" | "lossless" {
	const own = choice(s.imageModes, b.name);
	if (own === "lossy" || own === "lossless") return own;
	const c = b.compression ?? (b.file.endsWith(".jpg") ? "photo" : "lossless");
	return c === "photo" ? "lossy" : "lossless";
}

/** A bitmap is made smaller only when that saves at least this share of its pixels. */
const WORTH = 0.8;

/**
 * The size to write a bitmap at: smaller than its own when it is always shown smaller (see
 * bitmapScales), null = every pixel. Bitmaps without smoothing (pixel art, drawn with hard pixel
 * edges) and repeating fills (their tiles would get seams) keep their pixels.
 */
function targetSize(b: BitmapData, scale: BitmapScale | undefined, resolution: number): [number, number] | null {
	if (!resolution || !scale || scale.tiled || !b.smoothing || !(b.width > 0 && b.height > 0)) return null;
	const w = Math.max(1, Math.ceil(b.width * Math.min(1, scale.x * resolution) - 1e-6));
	const h = Math.max(1, Math.ceil(b.height * Math.min(1, scale.y * resolution) - 1e-6));
	return w * h <= WORTH * b.width * b.height ? [w, h] : null;
}

/**
 * Re-encodes the model's bitmaps. Returns a copy of the model whose bitmaps point at the new
 * files, and a file source that serves them (everything else comes from `files`). Bitmaps the
 * export never draws (only on guide layers, or hidden ones left out) are left as they are.
 * With `grade` (colour grading, grade.ts) every bitmap is graded pixel by pixel, at the size it is
 * written (formats that draw pictures grade those instead, see gradesPictures).
 */
export async function encodeImages(
	model: SceneModel,
	files: FileSource,
	partial: Partial<ImageSettings & { includeHiddenLayers: boolean; includeGuides: boolean; grade: Grade; format: string }>,
	codecs: Codecs,
): Promise<{ model: SceneModel; files: FileSource; report: ImageReport[]; warnings: string[] }> {
	const s: ImageSettings = { ...DEFAULT_IMAGE_SETTINGS, ...partial, imageModes: { ...partial.imageModes }, imageFullSize: { ...partial.imageFullSize } };
	const quality = Number.isFinite(s.imageQuality) ? Math.max(0, Math.min(100, Math.round(s.imageQuality))) : 0;
	const resolution = Number.isFinite(s.imageResolution) && s.imageResolution > 0 ? Math.max(0.25, Math.min(8, s.imageResolution)) : 0;
	const made = new Map<string, Uint8Array>();
	const bitmaps: Record<string, BitmapData> = {};
	const report: ImageReport[] = [];
	const warnings: string[] = [];
	const scales = bitmapScales(model, files, partial);
	const grade = partial.grade && !partial.grade.empty && !gradesPictures(partial.format) ? partial.grade : null;
	// graded bitmaps that scripts read get a graded lossless master (else the player's would be the old colours)
	const pixelReads = !!grade && scriptsReadPixels(model);

	for (const [id, b] of Object.entries(model.bitmaps)) {
		const mode = modeOf(b, s);
		const scale = scales.get(id);
		if (!scale) {
			bitmaps[id] = b;
			continue;
		}
		let source: Uint8Array;
		try {
			source = new Uint8Array(files.readBinary(b.file));
		} catch {
			bitmaps[id] = b;
			continue;
		}
		const entry = (format: ImageReport["format"], bytes: number, w: number, h: number): ImageReport => ({
			name: b.name,
			mode,
			format,
			bytes,
			sourceBytes: source.byteLength,
			width: w,
			height: h,
			sourceWidth: b.width,
			sourceHeight: b.height,
		});
		// older models hold the bitmap as Animate compresses it, not a lossless master
		// (graded, a PNG of an older model is pixels to grade like any master)
		if (!b.file.endsWith(".png") || (b.compression === undefined && mode === "lossy" && !grade)) {
			if (grade)
				warnings.push(`Bitmap ${b.name} keeps its colours: this scene data holds it as Animate compresses it, not as pixels (export it again from Animate)`);
			bitmaps[id] = b;
			report.push(entry("original", source.byteLength, b.width, b.height));
			continue;
		}
		const base = b.file.replace(/\.[^./]+$/, "");
		let decoded: Promise<Pixels> | null = null;
		const master = () => (decoded ??= codecs.decodePng(source));

		/** The bitmap encoded at `size` (null = every pixel). */
		const encode = async (size: [number, number] | null): Promise<{ rel: string; bytes: Uint8Array; format: ImageReport["format"]; webpForJpeg?: boolean }> => {
			let resized: Promise<Pixels> | null = null;
			const plain = () => (size ? (resized ??= master().then((img) => codecs.resize(img, size[0], size[1]))) : master());
			// graded on a copy, at the size written (the master serves the other size too)
			let graded: Promise<Pixels> | null = null;
			const pixels = grade
				? () =>
						(graded ??= plain().then((img) => {
							const copy = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
							grade.pixels(copy.data);
							return copy;
						}))
				: plain;
			const lossless = async (): Promise<[Uint8Array, LosslessFormat]> => {
				if (s.imageLossless === "png") return [size || grade ? await codecs.encodePng(await pixels()) : await codecs.optimisePng(source), "png"];
				// exact: keep the colour under transparent pixels too
				return [await codecs.webp(await pixels(), { lossless: 1, exact: 1, quality: 75, method: 4 }), "webp"];
			};
			if (mode === "lossless") {
				const [bytes, format] = await lossless();
				return { rel: `${base}.${EXT[format]}`, bytes, format };
			}
			const img = await pixels();
			let alpha = false;
			for (let i = 3; i < img.data.length; i += 4)
				if (img.data[i]! < 255) {
					alpha = true;
					break;
				}
			// JPEG can't keep transparency: WebP then
			const format: LossyFormat = s.imageLossy === "jpeg" && alpha ? "webp" : s.imageLossy;
			let bytes: Uint8Array | null = null;
			let kind: ImageReport["format"] = format;
			// Animate's own JPEG when its quality is wanted and the size stays (imported JPEGs: the
			// original file, no second compression)
			if (format === "jpeg" && !quality && b.jpeg && !size && !grade) {
				try {
					bytes = new Uint8Array(files.readBinary(b.jpeg));
					kind = "original";
				} catch {
					bytes = null;
				}
			}
			if (!bytes) {
				// Animate's quality; imported JPEGs keep theirs, which isn't known: a common default then
				const q = quality || (b.quality && b.quality > 0 ? b.quality : 80);
				if (format === "jpeg") bytes = await codecs.jpeg(img, q);
				else if (format === "webp") bytes = await codecs.webp(img, { quality: q, method: 4 });
				// AVIF's scale runs lower than JPEG's for the same look (measured: AVIF q*2/3 ~ JPEG q)
				else bytes = await codecs.avif(img, Math.max(1, Math.round((q * 2) / 3)));
			}
			// small or flat pictures (icons, patterns) are often smaller without loss: then they stay
			// exact. Big ones practically never are, and the lossless encoding would cost time. (The
			// master's size, scaled to the pixels written.)
			const ref = size ? (source.byteLength * size[0] * size[1]) / (b.width * b.height) : source.byteLength;
			if (bytes.byteLength >= ref || ref < SMALL) {
				const [lb, lf] = await lossless();
				if (lb.byteLength <= bytes.byteLength) return { rel: `${base}.${EXT[lf]}`, bytes: lb, format: lf };
			}
			if (kind === "original") return { rel: b.jpeg!, bytes, format: kind };
			return { rel: `${base}.${EXT[format]}`, bytes, format, webpForJpeg: format !== s.imageLossy };
		};

		let size = choice(s.imageFullSize, b.name) === true ? null : targetSize(b, scale, resolution);
		let r = await encode(size);
		// resampling can cost more than it saves on flat pictures (gradients that PNG predicts
		// exactly): when the result has more than twice the master's bytes per pixel, every pixel
		// as well, and the smaller one
		if (size && r.bytes.byteLength >= source.byteLength * Math.min(1, (2 * size[0] * size[1]) / (b.width * b.height))) {
			const full = await encode(null);
			if (full.bytes.byteLength <= r.bytes.byteLength) {
				r = full;
				size = null;
			}
		}
		if (r.webpForJpeg) warnings.push(`Bitmap ${b.name} is transparent: JPEG can't keep that, it is written as WebP`);
		made.set(r.rel, r.bytes);
		// graded, the lossless master has the old colours: for scripts that read pixels a graded one
		// at full size (the file written is what scripts would read otherwise)
		let masterFile: string | undefined = b.master ?? b.file;
		if (grade) {
			masterFile = undefined;
			if (pixelReads) {
				const img = await master();
				const copy = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
				grade.pixels(copy.data);
				masterFile = `${base}.graded.png`;
				made.set(masterFile, await codecs.encodePng(copy));
			}
		}
		bitmaps[id] = { ...b, file: r.rel, jpeg: undefined, pixels: size ?? undefined, master: masterFile };
		report.push(entry(r.format, r.bytes.byteLength, size?.[0] ?? b.width, size?.[1] ?? b.height));
	}

	return {
		model: { ...model, bitmaps },
		files: {
			readText: (rel) => files.readText(rel),
			readBinary: (rel) => {
				const r = rel.startsWith(MASTER) ? rel.slice(MASTER.length) : rel;
				return made.get(r) ?? files.readBinary(r);
			},
		},
		report,
		warnings,
	};
}
