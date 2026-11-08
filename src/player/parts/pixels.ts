/**
 * Part of the player for scripts that work with BitmapData: drawing display objects onto pixels
 * (paint.ts) and reading library pictures at once (png.ts). The media part asks for them when it
 * needs them.
 */
import { Painter } from "../paint.ts";
import { decodePng } from "../png.ts";

export default function pixels(): Record<string, unknown> {
	return { $painter: Painter, $png: decodePng };
}
