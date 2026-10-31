/**
 * Colours that follow Animate's panel background (Preferences › User Interface): the secondary
 * text gets as close to the background as still reads well (WCAG AA, 4.5:1), on any shade.
 */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) =>
	"#" +
	c
		.map((v) =>
			Math.round(Math.max(0, Math.min(255, v)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("");

/** Relative luminance (WCAG 2). */
export function luminance(color: string): number {
	const [r, g, b] = rgb(color).map((v) => {
		const s = v / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
	const x = luminance(a),
		y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const mix = (a: string, b: string, t: number) => {
	const x = rgb(a),
		y = rgb(b);
	return hex(x.map((v, i) => v + (y[i]! - v) * t));
};

/**
 * Colours for a background: the text, the softest secondary text that reads well, borders and
 * input fields (darker than a dark background, white on a light one).
 */
export function skinColors(background: string): { fg: string; muted: string; line: string; field: string; dark: boolean } {
	const dark = luminance(background) < 0.2;
	const fg = dark ? "#e0e0e0" : "#1e1e1e";
	let t = 0.5;
	while (t < 1 && contrast(mix(background, fg, t), background) < 4.6) t += 0.02;
	return { fg, muted: mix(background, fg, Math.min(1, t)), line: mix(background, fg, 0.2), field: dark ? mix(background, "#000000", 0.25) : "#ffffff", dark };
}
