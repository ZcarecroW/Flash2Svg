import type { Mat, Point } from "./model.ts";

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Matrix that applies `first`, then `then` (Animate's convention: x' = a*x + c*y + tx). */
export function concat(first: Mat, then: Mat): Mat {
	const [a1, b1, c1, d1, x1, y1] = first;
	const [a2, b2, c2, d2, x2, y2] = then;
	return [a2 * a1 + c2 * b1, b2 * a1 + d2 * b1, a2 * c1 + c2 * d1, b2 * c1 + d2 * d1, a2 * x1 + c2 * y1 + x2, b2 * x1 + d2 * y1 + y2];
}

export function invert(m: Mat): Mat {
	const [a, b, c, d, tx, ty] = m;
	const det = a * d - b * c;
	if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, -tx, -ty];
	const ia = d / det,
		ib = -b / det,
		ic = -c / det,
		id = a / det;
	return [ia, ib, ic, id, -(ia * tx + ic * ty), -(ib * tx + id * ty)];
}

export function apply(m: Mat, p: Point): Point {
	return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function isIdentity(m: Mat, eps = 1e-9): boolean {
	return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps && Math.abs(m[4]) < eps && Math.abs(m[5]) < eps;
}

export function matEquals(a: Mat, b: Mat, eps = 1e-6): boolean {
	for (let i = 0; i < 6; i++) if (Math.abs(a[i]! - b[i]!) > (i < 4 ? eps : eps * 100)) return false;
	return true;
}

/**
 * Animate-style decomposition of a matrix around a transformation point `tp` (local coords):
 * x/y = transformation point in parent space, scaleX/scaleY >= 0, skewX/skewY in degrees.
 * Rebuild with compose().
 */
export interface Decomposed {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	skewX: number;
	skewY: number;
}

const RAD = Math.PI / 180;

export function decompose(m: Mat, tp: Point = { x: 0, y: 0 }): Decomposed {
	const [a, b, c, d] = m;
	const p = apply(m, tp);
	return {
		x: p.x,
		y: p.y,
		scaleX: Math.hypot(a, b),
		scaleY: Math.hypot(c, d),
		skewY: Math.atan2(b, a) / RAD,
		skewX: Math.atan2(-c, d) / RAD,
	};
}

export function compose(t: Decomposed, tp: Point = { x: 0, y: 0 }): Mat {
	const a = t.scaleX * Math.cos(t.skewY * RAD);
	const b = t.scaleX * Math.sin(t.skewY * RAD);
	const c = -t.scaleY * Math.sin(t.skewX * RAD);
	const d = t.scaleY * Math.cos(t.skewX * RAD);
	// x = a*tp.x + c*tp.y + tx  =>  tx = x - (a*tp.x + c*tp.y)
	return [a, b, c, d, t.x - (a * tp.x + c * tp.y), t.y - (b * tp.x + d * tp.y)];
}

/** Returns `angle` shifted by multiples of 360 so that it is as close as possible to `ref`. */
export function nearestAngle(angle: number, ref: number): number {
	return angle + Math.round((ref - angle) / 360) * 360;
}

// -------------------------------------------------------------------- number formatting

/** Formats a number with at most `digits` decimals, without trailing zeros or a leading "0". */
export function fmt(n: number, digits = 3): string {
	if (!Number.isFinite(n)) return "0";
	const p = 10 ** digits;
	let r = Math.round(n * p) / p;
	if (Object.is(r, -0) || r === 0) return "0";
	let s = String(r);
	if (s.indexOf("e") >= 0) s = r.toFixed(digits).replace(/\.?0+$/, "");
	if (s.startsWith("0.")) s = s.slice(1);
	else if (s.startsWith("-0.")) s = "-" + s.slice(2);
	return s;
}

/** `digits` for the translation; `lin` for the linear part (by default a bit more precise than positions). */
export function fmtMatrix(m: Mat, digits = 3, lin = Math.max(digits, 4)): string {
	const [a, b, c, d, tx, ty] = m;
	const sd = lin;
	if (Math.abs(a - 1) < 1e-9 && Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9 && Math.abs(d - 1) < 1e-9) {
		if (Math.abs(tx) < 1e-9 && Math.abs(ty) < 1e-9) return "";
		return `translate(${fmt(tx, digits)} ${fmt(ty, digits)})`;
	}
	return `matrix(${fmt(a, sd)} ${fmt(b, sd)} ${fmt(c, sd)} ${fmt(d, sd)} ${fmt(tx, digits)} ${fmt(ty, digits)})`;
}

/** Parses an SVG transform list into a single matrix (supports matrix/translate/scale/rotate/skewX/skewY). */
export function parseTransform(s: string | undefined): Mat {
	let m: Mat = IDENTITY;
	if (!s) return m;
	const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
	let r: RegExpExecArray | null;
	while ((r = re.exec(s))) {
		const v = r[2]!
			.split(/[\s,]+/)
			.filter(Boolean)
			.map(Number);
		let t: Mat;
		switch (r[1]) {
			case "matrix":
				t = [v[0] ?? 1, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1, v[4] ?? 0, v[5] ?? 0];
				break;
			case "translate":
				t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
				break;
			case "scale":
				t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
				break;
			case "rotate": {
				const a = (v[0] ?? 0) * RAD;
				const cx = v[1] ?? 0,
					cy = v[2] ?? 0;
				t = concat(concat([1, 0, 0, 1, -cx, -cy], [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]), [1, 0, 0, 1, cx, cy]);
				break;
			}
			case "skewX":
				t = [1, 0, Math.tan((v[0] ?? 0) * RAD), 1, 0, 0];
				break;
			default:
				t = [1, Math.tan((v[0] ?? 0) * RAD), 0, 1, 0, 0];
		}
		// SVG lists apply right-most first: m = m * t
		m = concat(t, m);
	}
	return m;
}
