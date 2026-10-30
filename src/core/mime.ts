/** MIME type of a bitmap file by its extension. */
export function imageMime(file: string): string {
	const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
	return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : "image/png";
}

/** MIME type of a sound file by its extension. */
export function audioMime(file: string): string {
	const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
	return ext === "wav" ? "audio/wav" : ext === "opus" || ext === "ogg" ? "audio/ogg" : "audio/mpeg";
}
