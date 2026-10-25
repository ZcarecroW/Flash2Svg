// Draws the panel icons (23x23 PNG, light and dark variants) so no binary assets are needed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

function draw(color) {
	const size = 23;
	const png = new PNG({ width: size, height: size });
	const set = (x, y, a) => {
		if (x < 0 || y < 0 || x >= size || y >= size) return;
		const i = (y * size + x) * 4;
		png.data[i] = color[0];
		png.data[i + 1] = color[1];
		png.data[i + 2] = color[2];
		png.data[i + 3] = Math.max(png.data[i + 3], Math.round(a * 255));
	};
	// A bezier "S"-ish motion curve with a play triangle: easing + animation
	for (let s = 0; s <= 400; s++) {
		const t = s / 400;
		const x = 3 + 16 * t;
		const e = t * t * (3 - 2 * t);
		const y = 18 - 13 * e;
		for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) set(Math.round(x + dx * 0.6), Math.round(y + dy * 0.6), dx === 0 && dy === 0 ? 1 : 0.55);
	}
	for (let y = 0; y < 7; y++) for (let x = 0; x <= y && x < 4; x++) set(15 + x, 13 + y, 1);
	for (let y = 0; y < 3; y++) for (let x = 0; x < 4 - y; x++) set(15 + x, 20 - y, 1);
	return PNG.sync.write(png);
}

export function writeIcons(dir) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "icon-light.png"), draw([60, 60, 60]));
	writeFileSync(join(dir, "icon-dark.png"), draw([220, 220, 220]));
}
