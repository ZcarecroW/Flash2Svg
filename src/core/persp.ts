/**
 * 3D rotation and translation in perspective. A symbol is a flat plane; seen in perspective its
 * points go through a homography, which no SVG transform can do. So an instance is drawn through
 * the flat transform closest to it around the instance's middle, and what is left (a homography
 * close to the identity) goes on an HTML element in a <foreignObject>, as a CSS matrix3d. Where
 * that isn't honoured (WebKit in a foreignObject; Lottie doesn't have it at all) the flat part
 * alone is the best that can be drawn.
 */
import type { Mat } from "./model.ts";

/** Row by row: x' = (h0 x + h1 y + h2) / (h6 x + h7 y + h8). */
export type Homography = [number, number, number, number, number, number, number, number, number];

export interface Perspective {
	/** Focal length in pixels. */
	focal: number;
	/** The vanishing point. */
	x: number;
	y: number;
}

/** Animate's: x' = c + (x - c) f / (f + z), the same as for layer depth. */
export const DEFAULT_FOCAL = 528.25;

/**
 * The plane z = 0 of a symbol through Animate's 3D matrix (m00..m02, m10..m12, m20..m22, m30..m32:
 * rows of the axes and the translation), then perspective.
 */
export function homographyOf(m: number[], p: Perspective): Homography {
	const [m00, m01, m02, m10, m11, m12, , , , m30, m31, m32] = m as [number, number, number, number, number, number, number, number, number, number, number, number];
	const f = p.focal;
	const s = 1 + m32 / f;
	const h: Homography = [m00 + (p.x * m02) / f, m10 + (p.x * m12) / f, m30 + (p.x * m32) / f, m01 + (p.y * m02) / f, m11 + (p.y * m12) / f, m31 + (p.y * m32) / f, m02 / f, m12 / f, s];
	return h.map((v) => v / s) as Homography;
}

/**
 * The focal length of a view angle, which documents store for their stage's width. Without one the
 * focal length is what layer depth has: on a stage 400 wide the file says 41.47 degrees for that.
 */
export function focalOf(angle: number | null | undefined, width: number): number {
	return angle ? width / 2 / Math.tan((angle * Math.PI) / 360) : DEFAULT_FOCAL;
}

export function unproject(h: Homography, u: number, v: number): [number, number] {
	const a = h[0] - u * h[6],
		b = h[1] - u * h[7],
		c = u * h[8] - h[2],
		d = h[3] - v * h[6],
		e = h[4] - v * h[7],
		f = v * h[8] - h[5];
	const det = a * e - b * d || 1e-9;
	return [(c * e - b * f) / det, (a * f - c * d) / det];
}

export function project(h: Homography, x: number, y: number): [number, number] {
	const w = h[6] * x + h[7] * y + h[8];
	return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** The flat transform that agrees with `h` at a point, in position and in slope. */
export function tangentAt(h: Homography, x: number, y: number): Mat {
	const w = h[6] * x + h[7] * y + h[8];
	const [u, v] = project(h, x, y);
	const a = (h[0] - u * h[6]) / w,
		c = (h[1] - u * h[7]) / w,
		b = (h[3] - v * h[6]) / w,
		d = (h[4] - v * h[7]) / w;
	return [a, b, c, d, u - a * x - c * y, v - b * x - d * y];
}

const times = (p: Homography, q: Homography): Homography => [
	p[0] * q[0] + p[1] * q[3] + p[2] * q[6],
	p[0] * q[1] + p[1] * q[4] + p[2] * q[7],
	p[0] * q[2] + p[1] * q[5] + p[2] * q[8],
	p[3] * q[0] + p[4] * q[3] + p[5] * q[6],
	p[3] * q[1] + p[4] * q[4] + p[5] * q[7],
	p[3] * q[2] + p[4] * q[5] + p[5] * q[8],
	p[6] * q[0] + p[7] * q[3] + p[8] * q[6],
	p[6] * q[1] + p[7] * q[4] + p[8] * q[7],
	p[6] * q[2] + p[7] * q[5] + p[8] * q[8],
];

/** What is left of `h` after `flat`: flat, then this, is `h`... the other way round: this, then flat. */
export function residual(h: Homography, flat: Mat): Homography {
	const [a, b, c, d, tx, ty] = flat;
	const det = a * d - b * c || 1e-9;
	const inverse: Homography = [d / det, -c / det, (c * ty - d * tx) / det, -b / det, a / det, (b * tx - a * ty) / det, 0, 0, 1];
	const r = times(inverse, h);
	return r.map((v) => v / r[8]) as Homography;
}

/** A homography for a box whose top left corner is the origin of the element it is on. */
export function fromCorner(h: Homography, x: number, y: number): Homography {
	const r = times(times([1, 0, -x, 0, 1, -y, 0, 0, 1], h), [1, 0, x, 0, 1, y, 0, 0, 1]);
	return r.map((v) => v / r[8]) as Homography;
}

const num = (v: number) => {
	const s = v.toFixed(7).replace(/\.?0+$/, "");
	return s === "-0" ? "0" : s;
};

/** As CSS: its columns come first. */
export function cssMatrix(h: Homography): string {
	return `matrix3d(${[h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]].map(num).join(",")})`;
}

export function isFlat(h: Homography): boolean {
	return Math.abs(h[6]) < 1e-7 && Math.abs(h[7]) < 1e-7;
}
