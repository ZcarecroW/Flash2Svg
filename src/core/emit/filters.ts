/**
 * Animate filters, colour transforms and blend modes as SVG filter primitives / CSS.
 */
import { fmt } from "../geom.ts";
import type { FilterData } from "../model.ts";
import { el, type XmlNode } from "../xml.ts";

type Num = number;
const n = (v: unknown, d = 0): Num => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** "#RRGGBB" or "#RRGGBBAA" -> {hex, alpha} */
export function splitColor(c: unknown): { hex: string; alpha: number } {
	if (typeof c === "number") return { hex: "#" + (c >>> 0).toString(16).padStart(6, "0").slice(-6), alpha: 1 };
	const s = String(c ?? "#000000");
	if (/^#[0-9a-f]{8}$/i.test(s)) return { hex: s.slice(0, 7), alpha: parseInt(s.slice(7, 9), 16) / 255 };
	if (/^#[0-9a-f]{6}$/i.test(s)) return { hex: s, alpha: 1 };
	return { hex: "#000000", alpha: 1 };
}

export interface ColorMatrixValues {
	rP: number;
	gP: number;
	bP: number;
	aP: number;
	rA: number;
	gA: number;
	bA: number;
	aA: number;
}

export function colorMatrix(c: ColorMatrixValues): number[] {
	return [c.rP / 100, 0, 0, 0, c.rA / 255, 0, c.gP / 100, 0, 0, c.gA / 255, 0, 0, c.bP / 100, 0, c.bA / 255, 0, 0, 0, c.aP / 100, c.aA / 255];
}

export function matrixString(v: number[], digits = 4): string {
	return v.map((x) => fmt(x, digits)).join(" ");
}

/** True when only alpha is multiplied: can be written as `opacity`. */
export function isAlphaOnly(c: ColorMatrixValues): boolean {
	return c.rP === 100 && c.gP === 100 && c.bP === 100 && c.rA === 0 && c.gA === 0 && c.bA === 0 && c.aA === 0;
}

// ---------------------------------------------------------------------------------- adjust colour

// Same maths as Animate's fl.motion.AdjustColor / ColorMatrix.
const DELTA = [
	0, 0.01, 0.02, 0.04, 0.05, 0.06, 0.07, 0.08, 0.1, 0.11, 0.12, 0.14, 0.15, 0.16, 0.17, 0.18, 0.2, 0.21, 0.22, 0.24, 0.25, 0.27, 0.28, 0.3,
	0.32, 0.34, 0.36, 0.38, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77, 0.8, 0.83, 0.86, 0.89,
	0.92, 0.95, 0.98, 1.0, 1.06, 1.12, 1.18, 1.24, 1.3, 1.36, 1.42, 1.48, 1.54, 1.6, 1.66, 1.72, 1.78, 1.84, 1.9, 1.96, 2.0, 2.12, 2.25,
	2.37, 2.5, 2.62, 2.75, 2.87, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.3, 4.7, 4.9, 5.0, 5.5, 6.0, 6.5, 6.8, 7.0, 7.3, 7.5, 7.8, 8.0, 8.4, 8.7,
	9.0, 9.4, 9.6, 9.8, 10.0,
];

type M5 = number[]; // 4x5 colour matrix, offsets in 0..255
function mul(a: M5, b: M5): M5 {
	// result = a applied after b
	const out: number[] = new Array(20).fill(0);
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 5; c++) {
			let v = c === 4 ? a[r * 5 + 4]! : 0;
			for (let k = 0; k < 4; k++) v += a[r * 5 + k]! * b[k * 5 + c]!;
			out[r * 5 + c] = v;
		}
	}
	return out;
}
const ID5: M5 = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

export function adjustColorMatrix(f: FilterData): number[] {
	let m = ID5;
	const b = clamp(n(f.brightness), 100);
	if (b) m = mul([1, 0, 0, 0, b, 0, 1, 0, 0, b, 0, 0, 1, 0, b, 0, 0, 0, 1, 0], m);
	const c = Math.round(clamp(n(f.contrast), 100));
	if (c) {
		let x: number;
		if (c < 0) x = 127 + (c / 100) * 127;
		else {
			x = c % 1;
			x = x === 0 ? DELTA[c]! : DELTA[c]! * (1 - x) + DELTA[c + 1]! * x;
			x = x * 127 + 127;
		}
		m = mul([x / 127, 0, 0, 0, 0.5 * (127 - x), 0, x / 127, 0, 0, 0.5 * (127 - x), 0, 0, x / 127, 0, 0.5 * (127 - x), 0, 0, 0, 1, 0], m);
	}
	const s = clamp(n(f.saturation), 100);
	if (s) {
		const x = 1 + (s > 0 ? (3 * s) / 100 : s / 100);
		const lr = 0.3086,
			lg = 0.6094,
			lb = 0.082;
		m = mul(
			[
				lr * (1 - x) + x, lg * (1 - x), lb * (1 - x), 0, 0,
				lr * (1 - x), lg * (1 - x) + x, lb * (1 - x), 0, 0,
				lr * (1 - x), lg * (1 - x), lb * (1 - x) + x, 0, 0,
				0, 0, 0, 1, 0,
			],
			m,
		);
	}
	const h = clamp(n(f.hue), 180);
	if (h) {
		const a = (h / 180) * Math.PI;
		const cs = Math.cos(a),
			sn = Math.sin(a);
		const lr = 0.213,
			lg = 0.715,
			lb = 0.072;
		m = mul(
			[
				lr + cs * (1 - lr) + sn * -lr, lg + cs * -lg + sn * -lg, lb + cs * -lb + sn * (1 - lb), 0, 0,
				lr + cs * -lr + sn * 0.143, lg + cs * (1 - lg) + sn * 0.14, lb + cs * -lb + sn * -0.283, 0, 0,
				lr + cs * -lr + sn * -(1 - lr), lg + cs * -lg + sn * lg, lb + cs * (1 - lb) + sn * lb, 0, 0,
				0, 0, 0, 1, 0,
			],
			m,
		);
	}
	// offsets to 0..1
	return m.map((v, i) => (i % 5 === 4 ? v / 255 : v));
}

// ---------------------------------------------------------------------------------- filter chains

export interface FilterBuild {
	primitives: XmlNode[];
	/** Extra room the effect needs around the element, in its local units. */
	margin: number;
}

/** Converts Animate's box-blur amount (pixels) and quality to a Gaussian standard deviation. */
export function blurSigma(amount: number, quality: unknown): number {
	const passes = quality === "low" ? 1 : quality === "medium" ? 2 : 3;
	if (amount <= 1) return 0;
	return Math.sqrt((passes * (amount * amount - 1)) / 12);
}

/**
 * Builds primitives for a list of Animate filters. `scale` is the element's own scale; Animate
 * filters work in stage pixels, SVG filters in the element's units.
 */
export function buildFilters(filters: FilterData[], scale: { x: number; y: number }, warn: (m: string) => void): FilterBuild {
	const prims: XmlNode[] = [];
	let margin = 0;
	let src = "SourceGraphic";
	let k = 0;
	const id = () => `r${k++}`;
	const sx = Math.max(1e-3, Math.abs(scale.x)),
		sy = Math.max(1e-3, Math.abs(scale.y));

	for (const f of filters) {
		if (f.enabled === false) continue;
		const sdx = blurSigma(n(f.blurX, 5), f.quality) / sx;
		const sdy = blurSigma(n(f.blurY, 5), f.quality) / sy;
		const std = `${fmt(sdx, 3)} ${fmt(sdy, 3)}`;
		const dist = n(f.distance, 4);
		const ang = (n(f.angle, 45) * Math.PI) / 180;
		// Flash renders filters on pixel-aligned bitmaps: offsets land on whole pixels
		const dx = Math.round(Math.cos(ang) * dist) / sx,
			dy = Math.round(Math.sin(ang) * dist) / sy;
		const strength = n(f.strength, 100) / 100;
		margin = Math.max(margin, 3 * Math.max(sdx, sdy) + Math.abs(dx) + Math.abs(dy));

		switch (f.name) {
			case "blurFilter": {
				const r = id();
				prims.push(el("feGaussianBlur", { in: src, stdDeviation: std, result: r }));
				src = r;
				break;
			}
			case "glowFilter":
			case "dropShadowFilter": {
				const isShadow = f.name === "dropShadowFilter";
				const { hex, alpha } = splitColor(f.color);
				const inner = !!f.inner;
				const knockout = !!f.knockout;
				const hide = isShadow && !!f.hideObject;
				const alphaIn = inner ? invertAlpha(prims, src, id) : alphaOf(prims, src, id);
				const blur = id();
				prims.push(el("feGaussianBlur", { in: alphaIn, stdDeviation: std, result: blur }));
				let shaped = blur;
				if (isShadow && (dx || dy)) {
					const o = id();
					prims.push(el("feOffset", { in: blur, dx: fmt(dx, 3), dy: fmt(dy, 3), result: o }));
					shaped = o;
				}
				const strong = id();
				prims.push(el("feComponentTransfer", { in: shaped, result: strong }, [el("feFuncA", { type: "linear", slope: fmt(strength * alpha, 3) })]));
				const flood = id();
				prims.push(el("feFlood", { "flood-color": hex, result: flood }));
				const colored = id();
				prims.push(el("feComposite", { in: flood, in2: strong, operator: "in", result: colored }));
				let effect = colored;
				if (inner) {
					const clipped = id();
					prims.push(el("feComposite", { in: colored, in2: src, operator: "in", result: clipped }));
					effect = clipped;
				}
				const out = id();
				if (knockout) {
					prims.push(el("feComposite", { in: effect, in2: src, operator: inner ? "in" : "out", result: out }));
				} else if (hide) {
					prims.push(el("feMerge", { result: out }, [el("feMergeNode", { in: effect })]));
				} else if (inner) {
					prims.push(el("feMerge", { result: out }, [el("feMergeNode", { in: src }), el("feMergeNode", { in: effect })]));
				} else {
					prims.push(el("feMerge", { result: out }, [el("feMergeNode", { in: effect }), el("feMergeNode", { in: src })]));
				}
				src = out;
				break;
			}
			case "bevelFilter":
			case "gradientBevelFilter": {
				const type = String(f.type ?? "inner");
				const a = alphaOf(prims, src, id);
				const blur = id();
				prims.push(el("feGaussianBlur", { in: a, stdDeviation: std, result: blur }));
				const o1 = id(),
					o2 = id();
				// Flash compares the blurred alpha at +distance and -distance along the angle (the full
				// distance each way, as Ruffle does; matches Animate's output pixel for pixel)
				prims.push(el("feOffset", { in: blur, dx: fmt(-dx, 3), dy: fmt(-dy, 3), result: o1 }));
				prims.push(el("feOffset", { in: blur, dx: fmt(dx, 3), dy: fmt(dy, 3), result: o2 }));
				if (f.name === "gradientBevelFilter") {
					// the signed bevel value picks the colour: ratio 0 = shadow side, 128 = flat, 255 = highlight
					const t = id();
					prims.push(el("feComposite", { in: o1, in2: o2, operator: "arithmetic", k1: 0, k2: fmt(strength / 2, 3), k3: fmt(-strength / 2, 3), k4: 0.5, result: t }));
					const spread = id();
					prims.push(el("feColorMatrix", { in: t, type: "matrix", values: "0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0", result: spread }));
					const tables = gradientTables(f, false);
					let effect = id();
					prims.push(
						el("feComponentTransfer", { in: spread, result: effect }, [
							el("feFuncR", { type: "table", tableValues: tables.r }),
							el("feFuncG", { type: "table", tableValues: tables.g }),
							el("feFuncB", { type: "table", tableValues: tables.b }),
							el("feFuncA", { type: "table", tableValues: tables.a }),
						]),
					);
					if (type === "inner" || type === "outer") {
						const m = id();
						prims.push(el("feComposite", { in: effect, in2: src, operator: type === "inner" ? "in" : "out", result: m }));
						effect = m;
					}
					const out = id();
					prims.push(el("feMerge", { result: out }, [...(f.knockout ? [] : [el("feMergeNode", { in: src })]), el("feMergeNode", { in: effect })]));
					src = out;
					break;
				}
				const hiA = id(),
					shA = id();
				prims.push(el("feComposite", { in: o1, in2: o2, operator: "arithmetic", k1: 0, k2: fmt(strength, 3), k3: fmt(-strength, 3), k4: 0, result: hiA }));
				prims.push(el("feComposite", { in: o2, in2: o1, operator: "arithmetic", k1: 0, k2: fmt(strength, 3), k3: fmt(-strength, 3), k4: 0, result: shA }));
				const layers: string[] = [];
				const paint = (alphaRes: string, color: unknown) => {
					const { hex, alpha } = splitColor(color);
					const fl = id(),
						c = id();
					prims.push(el("feFlood", { "flood-color": hex, "flood-opacity": fmt(alpha, 3), result: fl }));
					prims.push(el("feComposite", { in: fl, in2: alphaRes, operator: "in", result: c }));
					let r = c;
					if (type === "inner") {
						const ci = id();
						prims.push(el("feComposite", { in: c, in2: src, operator: "in", result: ci }));
						r = ci;
					} else if (type === "outer") {
						const co = id();
						prims.push(el("feComposite", { in: c, in2: src, operator: "out", result: co }));
						r = co;
					}
					layers.push(r);
				};
				paint(hiA, f.highlightColor ?? "#FFFFFF");
				paint(shA, f.shadowColor ?? "#000000");
				const out = id();
				const nodes = [...(f.knockout ? [] : [el("feMergeNode", { in: src })]), ...layers.map((l) => el("feMergeNode", { in: l }))];
				prims.push(el("feMerge", { result: out }, nodes));
				src = out;
				break;
			}
			case "gradientGlowFilter": {
				const inner = String(f.type ?? "outer") === "inner";
				const a = inner ? invertAlpha(prims, src, id) : alphaOf(prims, src, id);
				const blur = id();
				prims.push(el("feGaussianBlur", { in: a, stdDeviation: std, result: blur }));
				let shaped = blur;
				if (dx || dy) {
					const o = id();
					prims.push(el("feOffset", { in: blur, dx: fmt(dx, 3), dy: fmt(dy, 3), result: o }));
					shaped = o;
				}
				// alpha -> gradient colour lookup
				const spread = id();
				prims.push(el("feColorMatrix", { in: shaped, type: "matrix", values: "0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 " + fmt(Math.min(strength, 10), 3) + " 0", result: spread }));
				const tables = gradientTables(f);
				const mapped = id();
				prims.push(
					el("feComponentTransfer", { in: spread, result: mapped }, [
						el("feFuncR", { type: "table", tableValues: tables.r }),
						el("feFuncG", { type: "table", tableValues: tables.g }),
						el("feFuncB", { type: "table", tableValues: tables.b }),
						el("feFuncA", { type: "table", tableValues: tables.a }),
					]),
				);
				let effect = mapped;
				if (inner) {
					const ci = id();
					prims.push(el("feComposite", { in: mapped, in2: src, operator: "in", result: ci }));
					effect = ci;
				}
				const out = id();
				prims.push(
					el("feMerge", { result: out }, f.knockout ? [el("feMergeNode", { in: effect })] : inner ? [el("feMergeNode", { in: src }), el("feMergeNode", { in: effect })] : [el("feMergeNode", { in: effect }), el("feMergeNode", { in: src })]),
				);
				src = out;
				break;
			}
			case "adjustColorFilter": {
				const r = id();
				prims.push(el("feColorMatrix", { in: src, type: "matrix", values: matrixString(adjustColorMatrix(f)), result: r }));
				src = r;
				break;
			}
			default:
				warn(`Filter ${f.name} is not supported`);
		}
	}
	return { primitives: prims, margin };
}

function alphaOf(prims: XmlNode[], src: string, id: () => string): string {
	if (src === "SourceGraphic") return "SourceAlpha";
	const r = id();
	prims.push(el("feColorMatrix", { in: src, type: "matrix", values: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0", result: r }));
	return r;
}

function invertAlpha(prims: XmlNode[], src: string, id: () => string): string {
	const r = id();
	prims.push(el("feColorMatrix", { in: src === "SourceGraphic" ? "SourceAlpha" : src, type: "matrix", values: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 1", result: r }));
	return r;
}

/** Gradient lookup tables indexed by 0..1 (= ratio 0..255). Glows also fade the colour with the index (their blurred alpha). */
function gradientTables(f: FilterData, fadeWithIndex = true): { r: string; g: string; b: string; a: string } {
	const colors = (Array.isArray(f.colorArray) ? f.colorArray : ["#FFFFFF00", "#FFFFFF"]) as unknown[];
	const ratios = (Array.isArray(f.posArray) ? f.posArray : colors.map((_, i) => (i / Math.max(1, colors.length - 1)) * 255)) as number[];
	const stops = colors.map((c, i) => ({ ...splitColor(c), pos: n(ratios[i], 0) / 255 }));
	const sample = (t: number) => {
		let i = 0;
		while (i < stops.length - 1 && stops[i + 1]!.pos < t) i++;
		const a = stops[i]!,
			b = stops[Math.min(i + 1, stops.length - 1)]!;
		const u = b.pos > a.pos ? Math.min(1, Math.max(0, (t - a.pos) / (b.pos - a.pos))) : 0;
		const ch = (h: string, o: number) => parseInt(h.slice(o, o + 2), 16) / 255;
		return {
			r: ch(a.hex, 1) + (ch(b.hex, 1) - ch(a.hex, 1)) * u,
			g: ch(a.hex, 3) + (ch(b.hex, 3) - ch(a.hex, 3)) * u,
			b: ch(a.hex, 5) + (ch(b.hex, 5) - ch(a.hex, 5)) * u,
			a: a.alpha + (b.alpha - a.alpha) * u,
		};
	};
	const N = 16;
	const r: string[] = [],
		g: string[] = [],
		b: string[] = [],
		a: string[] = [];
	for (let i = 0; i <= N; i++) {
		const s = sample(i / N);
		r.push(fmt(s.r, 3));
		g.push(fmt(s.g, 3));
		b.push(fmt(s.b, 3));
		a.push(fmt(fadeWithIndex ? s.a * (i / N) : s.a, 3));
	}
	return { r: r.join(" "), g: g.join(" "), b: b.join(" "), a: a.join(" ") };
}

// ---------------------------------------------------------------------------------- blend modes

/** CSS mix-blend-mode for an Animate blend mode, or null. */
export function cssBlendMode(mode: string, warn: (m: string) => void): string | null {
	switch (mode) {
		case "normal":
		case "":
			return null;
		case "multiply":
		case "screen":
		case "overlay":
		case "lighten":
		case "darken":
		case "difference":
			return mode;
		case "hardlight":
		case "hardLight":
			return "hard-light";
		case "add":
			return "plus-lighter";
		case "invert":
			warn("Blend mode 'invert' is approximated with 'difference'");
			return "difference";
		case "layer":
			return null; // handled as isolation
		default:
			warn(`Blend mode '${mode}' is not supported`);
			return null;
	}
}
