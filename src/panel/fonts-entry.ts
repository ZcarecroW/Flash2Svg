// The panel's font codecs (loaded on demand, see lazyBundle in lib/exporter.ts): HarfBuzz's
// subsetter (wasm/harfbuzz-subset.wasm) and the WOFF2 encoder (its WebAssembly is inside).
import { compress } from "woff2-encoder";
import { createFontCodecs as create, type FontCodecs } from "../core/fonts.ts";
import type { WasmLoader } from "../core/images.ts";

function createFontCodecs(load: WasmLoader): FontCodecs {
	return create(load, compress);
}

(globalThis as { Flash2SvgFonts?: { createFontCodecs: typeof createFontCodecs } }).Flash2SvgFonts = { createFontCodecs };
