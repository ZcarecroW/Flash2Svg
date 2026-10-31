// The font pre-pass for the test scripts, as the panel and the CLI run it (src/core/fonts.ts):
// dynamic and input text get their installed fonts embedded.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compress } from "woff2-encoder";
import { nodeFontFiles } from "../../src/cli/fonts-node.ts";
import { createFontCodecs, encodeFonts, SUBSET_WASM_SOURCE } from "../../src/core/fonts.ts";
import type { SceneModel } from "../../src/core/model.ts";

const require = createRequire(import.meta.url);
const codecs = createFontCodecs(() => readFileSync(require.resolve(SUBSET_WASM_SOURCE)), compress);
const files = nodeFontFiles();

export async function withFonts(model: SceneModel): Promise<SceneModel> {
	return (await encodeFonts(model, files, codecs)).model;
}
