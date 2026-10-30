import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MP3_WASM, MP3_WASM_SOURCE } from "../core/audio-codecs.ts";
import { WASM_FILES, WASM_SOURCES, type Codec, type WasmLoader } from "../core/images.ts";

/**
 * Loads the codecs' WebAssembly in Node: from the `wasm` folder next to the built CLI, or
 * from node_modules when running from source.
 */
export function nodeWasmLoader(): WasmLoader {
	const here = dirname(fileURLToPath(import.meta.url));
	const require = createRequire(import.meta.url);
	const byFile = new Map<string, Codec>(Object.entries(WASM_FILES).map(([codec, file]) => [file, codec as Codec]));
	return (file) => {
		const built = join(here, "wasm", file);
		if (existsSync(built)) return readFileSync(built);
		if (file === MP3_WASM) return readFileSync(require.resolve(MP3_WASM_SOURCE));
		const codec = byFile.get(file);
		if (!codec) throw new Error(`Unknown codec file ${file}`);
		return readFileSync(require.resolve(WASM_SOURCES[codec]));
	};
}
