// Separate bundle (panel/codecs.js), loaded by the panel on the first export that has bitmaps:
// keeps the image codecs out of the panel's start-up.
import { createCodecs } from "../core/codecs.ts";

(globalThis as { Flash2SvgCodecs?: { createCodecs: typeof createCodecs } }).Flash2SvgCodecs = { createCodecs };
