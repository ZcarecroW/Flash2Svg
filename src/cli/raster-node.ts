import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { WasmLoader } from "../core/images.ts";
import { unpremultiply, type Rasterize } from "../core/raster.ts";

/** resvg's WebAssembly: next to the built CLI as wasm/resvg.wasm, or from node_modules. */
export const RESVG_WASM = "resvg.wasm";
export const RESVG_WASM_SOURCE = "@resvg/resvg-wasm/index_bg.wasm";

let ready: Promise<void> | null = null;

/** SVG frames to pixels with resvg (system fonts not loaded: text comes as outlines). */
export function nodeRasterizer(load: WasmLoader): Rasterize {
	return async (svg, width) => {
		ready ??= (async () => initWasm(await load(RESVG_WASM)))();
		await ready;
		const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
		const img = r.render();
		const out = { data: new Uint8ClampedArray(img.pixels), width: img.width, height: img.height };
		img.free();
		r.free();
		unpremultiply(out.data);
		return out;
	};
}
