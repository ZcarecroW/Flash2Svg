/**
 * The image codecs for images.ts: WebAssembly builds of the Squoosh encoders (jSquash), used
 * directly in their single-thread form. (jSquash's own wrappers pick multi-thread or SIMD builds by
 * feature detection, which then wouldn't match the WebAssembly file we pass, and they pull every
 * variant into the bundle.) Each codec is initialised on first use, once per process.
 */
import initPng, { decode as decodePng } from "@jsquash/png/codec/pkg/squoosh_png.js";
import initOxipng, { optimise, optimise_raw } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import initResize, { resize } from "@jsquash/resize/lib/resize/pkg/squoosh_resize.js";
import webpFactory from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions as webpDefaults } from "@jsquash/webp/meta.js";
import jpegFactory from "@jsquash/jpeg/codec/enc/mozjpeg_enc.js";
import { defaultOptions as jpegDefaults } from "@jsquash/jpeg/meta.js";
import avifFactory from "@jsquash/avif/codec/enc/avif_enc.js";
import { defaultOptions as avifDefaults } from "@jsquash/avif/meta.js";
import type { Codecs, Pixels, WasmLoader } from "./images.ts";
import { WASM_FILES, type Codec } from "./images.ts";

type Encoder = { encode(data: Uint8Array | Uint8ClampedArray, w: number, h: number, opts: object): Uint8Array | null };

// the emscripten builds add this in Node; the PNG decoder needs it before any of them ran
const g = globalThis as { ImageData?: unknown };
g.ImageData ??= function ImageData(this: Pixels, data: Uint8ClampedArray, width: number, height: number) {
	this.data = data;
	this.width = width;
	this.height = height;
};

export function createCodecs(load: WasmLoader): Codecs {
	const modules = new Map<Codec, Promise<unknown>>();
	const once = <T>(name: Codec, init: (m: WebAssembly.Module) => Promise<T> | T): Promise<T> => {
		let p = modules.get(name) as Promise<T> | undefined;
		if (!p) {
			p = (async () => {
				const bytes = await load(WASM_FILES[name]);
				const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
				// a copy, so the module never sees a shared or offset buffer
				return init(await WebAssembly.compile(view.slice().buffer as ArrayBuffer));
			})();
			modules.set(name, p);
			p.catch(() => modules.delete(name));
		}
		return p;
	};
	const emscripten = (name: Codec, factory: unknown) =>
		once(name, (m) =>
			(factory as (o: object) => Promise<Encoder>)({
				noInitialRun: true,
				// asynchronously: Chromium forbids synchronous instances of bigger modules on the main thread
				instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) => {
					void WebAssembly.instantiate(m, imports).then(done);
					return {};
				},
			}),
		);
	const run = (enc: Encoder, img: { data: Uint8Array | Uint8ClampedArray; width: number; height: number }, opts: object) => {
		const out = enc.encode(img.data, img.width, img.height, opts);
		if (!out) throw new Error("Image encoding failed");
		return new Uint8Array(out);
	};
	return {
		async decodePng(png) {
			await once("png", (m) => initPng(m));
			return decodePng(png) as unknown as Pixels;
		},
		async optimisePng(png) {
			await once("oxipng", (m) => initOxipng(m));
			// optimiseAlpha would change the colour of fully transparent pixels: keep them as they are
			return optimise(png, 2, false, false);
		},
		async encodePng(img) {
			await once("oxipng", (m) => initOxipng(m));
			return optimise_raw(img.data, img.width, img.height, 2, false, false);
		},
		async resize(img, width, height) {
			await once("resize", (m) => initResize(m));
			const data = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
			// Lanczos 3 with premultiplied alpha (no dark fringes at transparent edges), in sRGB as
			// browsers and Flash scale bitmaps, so the result looks like the full bitmap shown smaller
			return { data: resize(data, img.width, img.height, width, height, 3, true, false), width, height };
		},
		async webp(img, opts) {
			return run(await emscripten("webp", webpFactory), img, { ...webpDefaults, ...opts });
		},
		async jpeg(img, quality) {
			return run(await emscripten("jpeg", jpegFactory), img, { ...jpegDefaults, quality });
		},
		async avif(img, quality) {
			// the AVIF build takes the bytes as a plain Uint8Array
			const data = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
			// (not {...img}: a browser ImageData has its size as prototype getters)
			return run(await emscripten("avif", avifFactory), { data, width: img.width, height: img.height }, { ...avifDefaults, quality, speed: 6 });
		},
	};
}
