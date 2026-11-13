/**
 * Colour grading with LUTs (lookup tables): every colour of an export passes through them, in
 * order, each mixed with the colour it changes by its strength (0..1).
 *
 * Formats: `.cube` (Adobe/Resolve: 1D, 3D, or a 1D shaper before a 3D table, DOMAIN_MIN/MAX and
 * LUT_*_INPUT_RANGE), `.3dl` (Lustre/Nuke: a mesh line, blue fastest, 10–16-bit integers) and
 * Hald CLUT images (`haldLut`, the host decodes the PNG). 3D tables are read with tetrahedral
 * interpolation, as Resolve and OpenColorIO do. Input is the colour as Flash draws it (sRGB,
 * 0..1); a LUT made for log footage expects other input and looks wrong, as it would in an editor.
 *
 * Where colours are changed (see docs/architecture.md, "Colour grading"):
 * - drawings (fills, strokes, gradient stops) when they are imported (artwork.ts `gradeArtwork`),
 *   gradients with stops added where the LUT bends the colour between two stops;
 * - the model's own colours (`gradeModel`): stage colour, text colours and borders, filter
 *   colours, colour effects (tint, brightness, advanced: fitted so that the effect on graded
 *   colours comes close to the graded effect), the camera's tint;
 * - bitmaps, pixel by pixel, before they are encoded (images.ts);
 * - GIF, WebP, APNG and video: the finished pictures instead, exactly (raster.ts).
 */
import type { ColorTransform, ElementData, FilterData, Keyframe, LayerData, SceneModel, TextElement, TimelineData } from "./model.ts";

type RGB = [number, number, number];

interface Table {
	size: number;
	/** Input domain per channel. */
	min: RGB;
	max: RGB;
	/** Output triples: 1D one per step, 3D red fastest, then green, then blue. */
	data: Float32Array;
}

export interface Lut {
	name: string;
	/** Per channel, applied first (a 1D LUT, or the shaper of a .cube with both). */
	d1?: Table;
	d3?: Table;
}

/** A LUT and how much of it: 1 = all of it, 0.5 = halfway between the colour and the LUT's. */
export interface LutUse {
	lut: Lut;
	strength: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Throws with what is wrong, naming the file. */
function fail(name: string, why: string): never {
	throw new Error(`${name}: ${why}`);
}

/** A .cube file (Adobe Cube LUT 1.0, with Resolve's additions). */
export function parseCube(text: string, name: string): Lut {
	let size1 = 0,
		size3 = 0;
	let min: RGB = [0, 0, 0],
		max: RGB = [1, 1, 1];
	let range1: [number, number] | null = null,
		range3: [number, number] | null = null;
	const values: number[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line[0] === "#") continue;
		const c = line.charCodeAt(0);
		// data lines start with a digit, a sign or a point
		if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
			const p = line.split(/\s+/);
			if (p.length < 3) fail(name, `a line of values needs three numbers: "${line.slice(0, 40)}"`);
			for (let k = 0; k < 3; k++) {
				const v = Number(p[k]);
				if (!Number.isFinite(v)) fail(name, `not a number: "${p[k]}"`);
				values.push(v);
			}
			continue;
		}
		const [key, ...rest] = line.split(/\s+/);
		const nums = rest.map(Number);
		switch (key!.toUpperCase()) {
			case "TITLE":
				break;
			case "LUT_1D_SIZE":
				size1 = nums[0]!;
				break;
			case "LUT_3D_SIZE":
				size3 = nums[0]!;
				break;
			case "DOMAIN_MIN":
				min = [nums[0]!, nums[1]!, nums[2]!];
				break;
			case "DOMAIN_MAX":
				max = [nums[0]!, nums[1]!, nums[2]!];
				break;
			case "LUT_1D_INPUT_RANGE":
				range1 = [nums[0]!, nums[1]!];
				break;
			case "LUT_3D_INPUT_RANGE":
				range3 = [nums[0]!, nums[1]!];
				break;
			default:
			// other keywords (LUT_IN_VIDEO_RANGE, ...) don't change the table
		}
	}
	const okSize = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
	if (!size1 && !size3) fail(name, "no LUT_3D_SIZE or LUT_1D_SIZE (not a .cube LUT)");
	if (size1 && !okSize(size1, 2, 65536)) fail(name, `LUT_1D_SIZE ${size1} is out of range (2–65536)`);
	if (size3 && !okSize(size3, 2, 256)) fail(name, `LUT_3D_SIZE ${size3} is out of range (2–256)`);
	const n1 = size1 * 3,
		n3 = size3 ** 3 * 3;
	if (values.length !== n1 + n3)
		fail(
			name,
			`${values.length / 3} lines of values, expected ${(n1 + n3) / 3}${size1 && size3 ? ` (${size1} for the 1D part, ${size3}³ for the 3D part)` : ""}`,
		);
	for (let k = 0; k < 3; k++) if (!(max[k]! > min[k]!)) fail(name, "DOMAIN_MAX must be above DOMAIN_MIN");
	// (the same for the ranges Resolve writes: one without its numbers made every colour "#NANNANNAN")
	for (const [key, r] of [
		["LUT_1D_INPUT_RANGE", range1],
		["LUT_3D_INPUT_RANGE", range3],
	] as const)
		if (r && !(r[1] > r[0])) fail(name, `${key} needs two numbers, the second above the first`);
	const range = (r: [number, number] | null): { min: RGB; max: RGB } => (r ? { min: [r[0], r[0], r[0]], max: [r[1], r[1], r[1]] } : { min, max });
	const lut: Lut = { name };
	if (size1) lut.d1 = { size: size1, ...range(range1), data: Float32Array.from(values.slice(0, n1)) };
	if (size3) lut.d3 = { size: size3, ...range(range3), data: Float32Array.from(values.slice(n1)) };
	return lut;
}

/** A .3dl file (Autodesk Lustre / Nuke): mesh line, then N³ integer triples, blue fastest. */
export function parse3dl(text: string, name: string): Lut {
	let mesh: number[] | null = null;
	let outBits = 0;
	const triples: number[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line[0] === "#") continue;
		const p = line.split(/\s+/);
		if (!Number.isFinite(Number(p[0]))) {
			// "3DMESH", "Mesh 4 12" (input and output bits), "LUT8", "gamma 1.0"
			if (/^mesh$/i.test(p[0]!) && p.length >= 3) outBits = Number(p[2]) || 0;
			continue;
		}
		const nums = p.map(Number);
		if (nums.some((v) => !Number.isFinite(v))) fail(name, `not a line of numbers: "${line.slice(0, 40)}"`);
		if (!mesh) {
			if (nums.length < 4) fail(name, "the first line of numbers should list the input steps (not a .3dl LUT)");
			mesh = nums;
			continue;
		}
		if (nums.length !== 3) fail(name, `a line of values needs three numbers: "${line.slice(0, 40)}"`);
		triples.push(nums[0]!, nums[1]!, nums[2]!);
	}
	if (!mesh) fail(name, "no values (not a .3dl LUT)");
	const n = mesh.length;
	if (triples.length !== n ** 3 * 3) fail(name, `${triples.length / 3} lines of values, expected ${n}³ = ${n ** 3}`);
	let top = 0;
	for (const v of triples) if (v > top) top = v;
	// the output depth: as declared, else the smallest common one that holds the largest value
	const scale = outBits ? 2 ** outBits - 1 : ([1023, 4095, 16383, 65535].find((m) => top <= m) ?? top) || 1;
	// blue fastest in the file, red fastest in the table
	const data = new Float32Array(n ** 3 * 3);
	for (let r = 0, i = 0; r < n; r++)
		for (let g = 0; g < n; g++)
			for (let b = 0; b < n; b++, i += 3) {
				const o = ((b * n + g) * n + r) * 3;
				data[o] = triples[i]! / scale;
				data[o + 1] = triples[i + 1]! / scale;
				data[o + 2] = triples[i + 2]! / scale;
			}
	return { name, d3: { size: n, min: [0, 0, 0], max: [1, 1, 1], data } };
}

/** A Hald CLUT image (level L: L³ × L³ pixels, a cube of L² steps, red fastest). */
export function haldLut(img: { data: Uint8Array | Uint8ClampedArray; width: number; height: number }, name: string): Lut {
	const level = Math.round(Math.cbrt(img.width));
	if (img.width !== img.height || level ** 3 !== img.width || level < 2)
		fail(name, `a Hald CLUT is square with a side of a cube number of pixels (8, 27, 64, 125, 216, 343, 512…), this is ${img.width}×${img.height}`);
	const n = level * level;
	const data = new Float32Array(n ** 3 * 3);
	for (let p = 0; p < n ** 3; p++) {
		data[p * 3] = img.data[p * 4]! / 255;
		data[p * 3 + 1] = img.data[p * 4 + 1]! / 255;
		data[p * 3 + 2] = img.data[p * 4 + 2]! / 255;
	}
	return { name, d3: { size: n, min: [0, 0, 0], max: [1, 1, 1], data } };
}

/** A LUT file by its name's extension (.cube or .3dl; images go through haldLut). */
export function parseLut(text: string, name: string): Lut {
	if (/\.3dl$/i.test(name)) return parse3dl(text, name);
	if (/\.cube$/i.test(name)) return parseCube(text, name);
	return /LUT_(1D|3D)_SIZE/i.test(text) ? parseCube(text, name) : parse3dl(text, name);
}

/**
 * Formats whose pictures are drawn by the export (GIF, WebP, APNG, video): graded as finished
 * pictures, so their drawings and bitmaps are not graded on the way.
 */
export const gradesPictures = (format: string | undefined) =>
	format === "gif" || format === "webp" || format === "apng" || format === "mp4" || format === "webm";

/** The file extensions LUTs can have (images are Hald CLUTs). */
export const LUT_EXTENSIONS = ["cube", "3dl", "png"];

/** One LUT applied to (r, g, b) in place. */
function applyLut(l: Lut, c: Float64Array) {
	const d1 = l.d1;
	if (d1) {
		const n = d1.size - 1;
		for (let k = 0; k < 3; k++) {
			const x = clamp01((c[k]! - d1.min[k]!) / (d1.max[k]! - d1.min[k]!)) * n;
			const i = x >= n ? n - 1 : Math.floor(x);
			const f = x - i;
			const a = d1.data[i * 3 + k]!,
				b = d1.data[(i + 1) * 3 + k]!;
			c[k] = a + (b - a) * f;
		}
	}
	const t = l.d3;
	if (!t) return;
	const n = t.size - 1;
	const pos = (k: number) => clamp01((c[k]! - t.min[k]!) / (t.max[k]! - t.min[k]!)) * n;
	const xr = pos(0),
		xg = pos(1),
		xb = pos(2);
	const ir = xr >= n ? n - 1 : Math.floor(xr),
		ig = xg >= n ? n - 1 : Math.floor(xg),
		ib = xb >= n ? n - 1 : Math.floor(xb);
	const fr = xr - ir,
		fg = xg - ig,
		fb = xb - ib;
	const S = t.size;
	tetra(t.data, ((ib * S + ig) * S + ir) * 3, S, fr, fg, fb, c);
}

/**
 * Tetrahedral interpolation in a 3D table of `S` steps (red fastest) at the cell starting at
 * `o000`, at fractions fr, fg, fb within it: the tetrahedron the point is in, by their order.
 */
function tetra(d: Float32Array, o000: number, S: number, fr: number, fg: number, fb: number, c: Float64Array) {
	// offsets of one step in r, g and b
	const R = 3,
		G = S * 3,
		B = S * S * 3;
	const o111 = o000 + R + G + B;
	let o1: number, o2: number, w0: number, w1: number, w2: number, w3: number;
	if (fr > fg) {
		if (fg > fb) {
			o1 = o000 + R;
			o2 = o000 + R + G;
			w0 = 1 - fr;
			w1 = fr - fg;
			w2 = fg - fb;
			w3 = fb;
		} else if (fr > fb) {
			o1 = o000 + R;
			o2 = o000 + R + B;
			w0 = 1 - fr;
			w1 = fr - fb;
			w2 = fb - fg;
			w3 = fg;
		} else {
			o1 = o000 + B;
			o2 = o000 + R + B;
			w0 = 1 - fb;
			w1 = fb - fr;
			w2 = fr - fg;
			w3 = fg;
		}
	} else if (fb > fg) {
		o1 = o000 + B;
		o2 = o000 + G + B;
		w0 = 1 - fb;
		w1 = fb - fg;
		w2 = fg - fr;
		w3 = fr;
	} else if (fb > fr) {
		o1 = o000 + G;
		o2 = o000 + G + B;
		w0 = 1 - fg;
		w1 = fg - fb;
		w2 = fb - fr;
		w3 = fr;
	} else {
		o1 = o000 + G;
		o2 = o000 + R + G;
		w0 = 1 - fg;
		w1 = fg - fr;
		w2 = fr - fb;
		w3 = fb;
	}
	for (let k = 0; k < 3; k++) c[k] = w0 * d[o000 + k]! + w1 * d[o1 + k]! + w2 * d[o2 + k]! + w3 * d[o111 + k]!;
}

const hex2 = (v: number) => {
	const x = Math.round(clamp01(v) * 255);
	return (x < 16 ? "0" : "") + x.toString(16);
};

/** The direct-mapped cache of the pixel path: 2^14 colours. */
const CACHE_BITS = 14;

/**
 * LUTs in order, with their strengths: maps colours. `toJSON` is its id, so settings that hold
 * it hash and print short.
 */
export class Grade {
	readonly uses: LutUse[];
	private hash: string | null = null;
	private readonly c = new Float64Array(3);
	private readonly hexes = new Map<string, string>();
	private keys: Int32Array | null = null;
	private vals: Uint32Array | null = null;

	constructor(uses: LutUse[]) {
		this.uses = uses.filter((u) => u.strength > 0).map((u) => ({ lut: u.lut, strength: Math.min(1, u.strength) }));
	}

	/** Changes with the tables and strengths (FNV-1a); worked out when first asked (an export's ids). */
	get id(): string {
		if (this.hash) return this.hash;
		let h = 0x811c9dc5;
		const mix = (v: number) => (h = Math.imul(h ^ v, 0x01000193));
		for (const u of this.uses) {
			mix(Math.round(u.strength * 1e4));
			for (const t of [u.lut.d1, u.lut.d3]) {
				if (!t) {
					mix(0);
					continue;
				}
				mix(t.size);
				for (const v of [...t.min, ...t.max]) mix(Math.round(v * 1e6));
				const words = new Int32Array(t.data.buffer, t.data.byteOffset, t.data.length);
				for (let i = 0; i < words.length; i++) mix(words[i]!);
			}
		}
		return (this.hash = "lut" + (h >>> 0).toString(36));
	}

	/** True when nothing changes (no LUT, or only strengths of 0). */
	get empty(): boolean {
		return !this.uses.length;
	}

	toJSON(): string {
		return this.id;
	}

	/** The graded colour of (r, g, b) in 0..1, into `out` (default: a new array). */
	rgb(r: number, g: number, b: number, out: RGB = [0, 0, 0]): RGB {
		const c = this.c;
		c[0] = r;
		c[1] = g;
		c[2] = b;
		for (const u of this.uses) {
			if (u.strength >= 1) applyLut(u.lut, c);
			else {
				const r0: number = c[0]!,
					g0: number = c[1]!,
					b0: number = c[2]!;
				applyLut(u.lut, c);
				c[0] = r0 + (c[0]! - r0) * u.strength;
				c[1] = g0 + (c[1]! - g0) * u.strength;
				c[2] = b0 + (c[2]! - b0) * u.strength;
			}
		}
		out[0] = clamp01(c[0]!);
		out[1] = clamp01(c[1]!);
		out[2] = clamp01(c[2]!);
		return out;
	}

	/** A colour as #rrggbb or #rrggbbaa (alpha kept), graded; anything else as it is. */
	hex(color: string): string {
		let v = this.hexes.get(color);
		if (v !== undefined) return v;
		const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(color);
		if (!m) v = color;
		else {
			const n = parseInt(m[1]!, 16);
			const [r, g, b] = this.rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
			// upper case like Animate's own colours
			v = ("#" + hex2(r) + hex2(g) + hex2(b) + (m[2] ?? "")).toUpperCase();
		}
		this.hexes.set(color, v);
		return v;
	}

	/**
	 * The packed graded colour of 8-bit (r, g, b) for one 3D table at full strength (the common
	 * case): where each level falls in the table is worked out once for all 256 levels, the rest
	 * as applyLut does it, so the result is the same as rgb()'s. Null for other grades.
	 */
	private fast(): ((r: number, g: number, b: number) => number) | null {
		const u = this.uses.length === 1 ? this.uses[0]! : null;
		const t = u && u.strength >= 1 && !u.lut.d1 ? u.lut.d3 : undefined;
		if (!t) return null;
		const n = t.size - 1,
			S = t.size,
			d = t.data;
		const steps = [3, S * 3, S * S * 3];
		const off = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
		const frac = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
		for (let k = 0; k < 3; k++)
			for (let v = 0; v < 256; v++) {
				const x = clamp01((v / 255 - t.min[k]!) / (t.max[k]! - t.min[k]!)) * n;
				const i = x >= n ? n - 1 : Math.floor(x);
				off[k]![v] = i * steps[k]!;
				frac[k]![v] = x - i;
			}
		const [OR, OG, OB] = off as [Int32Array, Int32Array, Int32Array];
		const [FR, FG, FB] = frac as [Float64Array, Float64Array, Float64Array];
		const c = new Float64Array(3);
		const ch = (v: number) => Math.round(clamp01(v) * 255);
		return (r, g, b) => {
			tetra(d, OR[r]! + OG[g]! + OB[b]!, S, FR[r]!, FG[g]!, FB[b]!, c);
			return (ch(c[0]!) << 16) | (ch(c[1]!) << 8) | ch(c[2]!);
		};
	}

	private miss: ((r: number, g: number, b: number) => number) | null = null;

	/** RGBA pixels (straight alpha) graded in place; fully transparent ones are left as they are. */
	pixels(data: Uint8Array | Uint8ClampedArray): void {
		const keys = (this.keys ??= new Int32Array(1 << CACHE_BITS).fill(-1));
		const vals = (this.vals ??= new Uint32Array(1 << CACHE_BITS));
		const out: RGB = [0, 0, 0];
		const miss = (this.miss ??=
			this.fast() ??
			((r, g, b) => {
				this.rgb(r / 255, g / 255, b / 255, out);
				return (Math.round(out[0] * 255) << 16) | (Math.round(out[1] * 255) << 8) | Math.round(out[2] * 255);
			}));
		let lastKey = -1,
			lastV = 0;
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] === 0) continue;
			const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
			let v: number;
			// drawings come in runs of one colour
			if (key === lastKey) v = lastV;
			else {
				// (a multiplicative hash spreads neighbouring colours over the cache)
				const slot = Math.imul(key, 0x9e3779b1) >>> (32 - CACHE_BITS);
				if (keys[slot] === key) v = vals[slot]!;
				else {
					v = miss(data[i]!, data[i + 1]!, data[i + 2]!);
					keys[slot] = key;
					vals[slot] = v;
				}
				lastKey = key;
				lastV = v;
			}
			data[i] = v >>> 16;
			data[i + 1] = (v >>> 8) & 255;
			data[i + 2] = v & 255;
		}
	}

	/**
	 * Gradient stops graded: between two stops the colour the gradient shows is interpolated
	 * (in sRGB, or in linear light for Animate's "Linear RGB"), then graded; stops are added where
	 * plain sRGB interpolation of the graded stops would be more than `tol` (0..1) off, halving each
	 * stretch at most `depth` times. Alpha stays linear.
	 */
	stops(stops: GradientStop[], linear: boolean, tol = 1 / 255, depth = 5): GradientStop[] {
		return this.stopsAt(stops, linear, this.knots(stops, linear, tol, depth));
	}

	/**
	 * Where stops are added between each pair of stops (shares u of the stretch, 0 < u < 1, from
	 * halving: dyadic fractions), as stops() places them. The frames of a shape tween use the union
	 * of all their frames' places (stopsAt), so they keep one structure and each stays within `tol`.
	 */
	knots(stops: GradientStop[], linear: boolean, tol = 1 / 255, depth = 5): number[][] {
		const graded = (u: number, a: GradientStop, b: GradientStop): RGB => {
			const c = mixStops(a, b, u, linear);
			return this.rgb(c[0], c[1], c[2]);
		};
		return stops.slice(1).map((b, i) => {
			const a = stops[i]!;
			const out: number[] = [];
			if (a.rgb.every((v, k) => v === b.rgb[k]) || !(b.off > a.off)) return out;
			// halve [u0, u1] while the graded colour bends away from the line between its ends
			const add = (u0: number, c0: RGB, u1: number, c1: RGB, level: number) => {
				let worst = 0;
				let mid: RGB = c0;
				for (const q of [0.25, 0.5, 0.75]) {
					const c = graded(u0 + (u1 - u0) * q, a, b);
					if (q === 0.5) mid = c;
					for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(c[k]! - (c0[k]! + (c1[k]! - c0[k]!) * q)));
				}
				if (worst <= tol || level >= depth) return;
				const um = (u0 + u1) / 2;
				add(u0, c0, um, mid, level + 1);
				out.push(um);
				add(um, mid, u1, c1, level + 1);
			};
			add(0, graded(0, a, b), 1, graded(1, a, b), 0);
			return out;
		});
	}

	/** Gradient stops graded, with stops added at the shares `at[i]` of the stretch after stop i. */
	stopsAt(stops: GradientStop[], linear: boolean, at: number[][]): GradientStop[] {
		const out: GradientStop[] = [];
		stops.forEach((a, i) => {
			out.push({ ...a, rgb: this.rgb(a.rgb[0], a.rgb[1], a.rgb[2]) });
			const b = stops[i + 1];
			if (!b) return;
			for (const u of at[i] ?? []) {
				const c = mixStops(a, b, u, linear);
				out.push({ off: a.off + (b.off - a.off) * u, rgb: this.rgb(c[0], c[1], c[2]), a: a.a + (b.a - a.a) * u });
			}
		});
		return out;
	}
}

/** The colour a gradient shows at u between two stops: interpolated in sRGB or linear light. */
function mixStops(a: GradientStop, b: GradientStop, u: number, linear: boolean): RGB {
	if (!linear) return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * u, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * u, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * u];
	const m = (k: number) => linearToSrgb(srgbToLinear(a.rgb[k]!) + (srgbToLinear(b.rgb[k]!) - srgbToLinear(a.rgb[k]!)) * u);
	return [m(0), m(1), m(2)];
}

export interface GradientStop {
	/** 0..1 */
	off: number;
	/** sRGB 0..1 */
	rgb: RGB;
	/** opacity 0..1 */
	a: number;
}

export function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** "#rrggbb" as 0..1 channels. */
export function hexRgb(hex: string): RGB {
	const n = parseInt(hex.replace("#", "").slice(0, 6), 16) || 0;
	return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbHex(c: RGB): string {
	return ("#" + hex2(c[0]) + hex2(c[1]) + hex2(c[2])).toUpperCase();
}

// ------------------------------------------------------------------------------------ the model

/** Sample colours the colour effects are fitted on: a 5×5×5 grid of the cube. */
const SAMPLE_STEPS = [0, 0.25, 0.5, 0.75, 1];

const isIdentityRgb = (ct: ColorTransform) => ct.rP === 100 && ct.gP === 100 && ct.bP === 100 && ct.rA === 0 && ct.gA === 0 && ct.bA === 0;

/**
 * A colour effect for graded colours: Flash applies `ct` to each colour, the export then shows
 * the effect on graded colours, so it should give what the graded effect would. The multipliers
 * and offsets are fitted by least squares over a grid of colours (graded colour → graded colour
 * after the effect); an effect with one multiplier for all channels (tint, brightness) keeps one,
 * so it stays a tint. Alpha is not graded.
 */
export class ColorFit {
	private readonly grade: Grade;
	/** Graded sample colours, flat r g b. */
	private readonly xs: Float64Array;
	private readonly samples: RGB[] = [];
	private readonly cache = new Map<string, ColorTransform>();
	constructor(grade: Grade) {
		this.grade = grade;
		for (const r of SAMPLE_STEPS) for (const g of SAMPLE_STEPS) for (const b of SAMPLE_STEPS) this.samples.push([r, g, b]);
		this.xs = new Float64Array(this.samples.length * 3);
		this.samples.forEach((s, i) => this.xs.set(grade.rgb(s[0], s[1], s[2]), i * 3));
	}

	fit(ct: ColorTransform): ColorTransform {
		if (isIdentityRgb(ct)) return ct;
		const key = `${ct.rP},${ct.gP},${ct.bP},${ct.rA},${ct.gA},${ct.bA}`;
		const hit = this.cache.get(key);
		if (hit) return { ...hit, aP: ct.aP, aA: ct.aA };
		const P = [ct.rP / 100, ct.gP / 100, ct.bP / 100],
			A = [ct.rA / 255, ct.gA / 255, ct.bA / 255];
		const ys = new Float64Array(this.samples.length * 3);
		const t: RGB = [0, 0, 0];
		// Flash clamps what the effect gives, and so does the output's own (feColorMatrix, Lottie):
		// the fit is made on the colours it doesn't clamp (all, if hardly any are left)
		const inside: number[] = [];
		this.samples.forEach((s, i) => {
			let clamped = false;
			for (let k = 0; k < 3; k++) {
				const v = s[k]! * P[k]! + A[k]!;
				if (v < -1e-9 || v > 1 + 1e-9) clamped = true;
				t[k] = clamp01(v);
			}
			if (!clamped) inside.push(i);
			ys.set(this.grade.rgb(t[0], t[1], t[2]), i * 3);
		});
		const used = inside.length >= 10 ? inside : this.samples.map((_, i) => i);
		const n = used.length;
		const mean = (a: Float64Array, k: number) => {
			let s = 0;
			for (const i of used) s += a[i * 3 + k]!;
			return s / n;
		};
		const mx = [0, 1, 2].map((k) => mean(this.xs, k)),
			my = [0, 1, 2].map((k) => mean(ys, k));
		const cov = [0, 0, 0],
			vx = [0, 0, 0];
		for (const i of used)
			for (let k = 0; k < 3; k++) {
				const dx = this.xs[i * 3 + k]! - mx[k]!;
				cov[k] = cov[k]! + dx * (ys[i * 3 + k]! - my[k]!);
				vx[k] = vx[k]! + dx * dx;
			}
		const shared = ct.rP === ct.gP && ct.gP === ct.bP;
		const sum = (v: number[]) => v[0]! + v[1]! + v[2]!;
		const m = shared ? [0, 1, 2].map(() => (sum(vx) > 1e-12 ? sum(cov) / sum(vx) : P[0]!)) : [0, 1, 2].map((k) => (vx[k]! > 1e-12 ? cov[k]! / vx[k]! : P[k]!));
		const o = [0, 1, 2].map((k) => my[k]! - m[k]! * mx[k]!);
		const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
		const out: ColorTransform = {
			mode: ct.mode,
			rP: r4(m[0]! * 100),
			gP: r4(m[1]! * 100),
			bP: r4(m[2]! * 100),
			aP: ct.aP,
			rA: r4(o[0]! * 255),
			gA: r4(o[1]! * 255),
			bA: r4(o[2]! * 255),
			aA: ct.aA,
		};
		this.cache.set(key, out);
		return out;
	}
}

const CT_KEYS = ["rP", "gP", "bP", "aP", "rA", "gA", "bA", "aA"] as const;
const IDENTITY: ColorTransform = { mode: "none", rP: 100, gP: 100, bP: 100, aP: 100, rA: 0, gA: 0, bA: 0, aA: 0 };

/**
 * The colours of the model graded (a copy; the input is not changed): what isn't drawn by
 * Animate's SVG export. Tween samples whose colour effect lies between the keyframes' get the
 * fitted effects' in-between at the same place, so tweens stay tweens.
 */
export function gradeModel(model: SceneModel, grade: Grade): SceneModel {
	if (grade.empty) return model;
	// (format "auto" compiles a model two or three times: graded once)
	const byModel = gradedModels.get(grade) ?? gradedModels.set(grade, new WeakMap()).get(grade)!;
	const hit = byModel.get(model);
	if (hit) return hit;
	const out = gradeModelNow(model, grade);
	byModel.set(model, out);
	return out;
}

const gradedModels = new WeakMap<Grade, WeakMap<SceneModel, SceneModel>>();

function gradeModelNow(model: SceneModel, grade: Grade): SceneModel {
	const fit = new ColorFit(grade);
	const ct = (c: ColorTransform | null | undefined): ColorTransform | null => (c ? fit.fit(c) : (c ?? null));
	const colour = (v: unknown): unknown => {
		if (typeof v === "number") return parseInt(grade.hex("#" + (v >>> 0).toString(16).padStart(6, "0").slice(-6)).slice(1), 16);
		return typeof v === "string" ? grade.hex(v) : v;
	};
	const filters = (list: FilterData[] | undefined): FilterData[] | undefined => list && list.map(gradeFilter);
	function gradeFilter(f: FilterData): FilterData {
		const out: FilterData = { ...f };
		for (const k of ["color", "highlightColor", "shadowColor"]) if (k in f) out[k] = colour(f[k]);
		// the colours the writers use when the data has none (emit/filters.ts, lottie.ts), graded too
		const missing = (k: string, d: unknown) => {
			if (!(k in f)) out[k] = colour(d);
		};
		if (f.name === "glowFilter" || f.name === "dropShadowFilter") missing("color", "#000000");
		if (f.name === "bevelFilter" || f.name === "gradientBevelFilter") {
			missing("highlightColor", "#FFFFFF");
			missing("shadowColor", "#000000");
		}
		const gradient = f.name === "gradientGlowFilter" || f.name === "gradientBevelFilter";
		if (Array.isArray(f.colorArray) || gradient)
			Object.assign(out, gradeGradientFilter(Array.isArray(f.colorArray) ? f : { ...f, colorArray: ["#FFFFFF00", "#FFFFFF"] }, grade));
		return out;
	}
	/** The colour of a sample between the keyframes' colours `a` and `b`, by where it lies. */
	const between = (
		s: ColorTransform | null,
		a: ColorTransform | null,
		b: ColorTransform | null,
		fa: ColorTransform | null,
		fb: ColorTransform | null,
	): ColorTransform | null => {
		const S = s ?? IDENTITY,
			A = a ?? IDENTITY,
			B = b ?? IDENTITY;
		let num = 0,
			den = 0;
		for (const k of CT_KEYS) {
			const d = B[k] - A[k];
			num += (S[k] - A[k]) * d;
			den += d * d;
		}
		if (den < 1e-12) return ct(s);
		const r = num / den;
		if (CT_KEYS.some((k) => Math.abs(A[k] + (B[k] - A[k]) * r - S[k]) > 0.02)) return ct(s);
		const FA = fa ?? IDENTITY,
			FB = fb ?? IDENTITY;
		const out = { ...S } as ColorTransform;
		for (const k of CT_KEYS) out[k] = Math.round((FA[k] + (FB[k] - FA[k]) * r) * 1e4) / 1e4;
		return out;
	};
	const element = (e: ElementData): ElementData => {
		switch (e.kind) {
			case "instance":
				return { ...e, color: ct(e.color), filters: filters(e.filters)! };
			case "text": {
				const t: TextElement = { ...e, runs: e.runs.map((r) => ({ ...r, fillColor: grade.hex(r.fillColor) })), filters: filters(e.filters) };
				if (e.border) t.borderColors = [grade.hex("#FFFFFF"), grade.hex("#000000")];
				return t;
			}
			default:
				return e;
		}
	};
	const keyframes = (kfs: Keyframe[]): Keyframe[] =>
		kfs.map((kf, k) => {
			const elements = kf.elements.map(element);
			const tw = kf.tween;
			if (!tw?.samples) return { ...kf, elements };
			// the tweened instance, and the same slot at the next keyframe (the tween's end)
			const slot = kf.elements.findIndex((e) => e.kind === "instance");
			const a = kf.elements[slot],
				b = kfs[k + 1]?.elements[slot];
			const A = a?.kind === "instance" ? a.color : null,
				B = b?.kind === "instance" ? b.color : null;
			const FA = ct(A),
				FB = ct(B);
			const samples = tw.samples.map((s, f) => ({ ...s, color: f === 0 ? ct(s.color) : between(s.color, A, B, FA, FB), filters: filters(s.filters) }));
			return { ...kf, elements, tween: { ...tw, samples } };
		});
	const layer = (l: LayerData): LayerData => ({
		...l,
		keyframes: keyframes(l.keyframes),
		effects: l.effects?.map((e) => ({ ...e, color: e.color ? fit.fit(e.color) : e.color, filters: filters(e.filters) })),
	});
	const timelines: Record<string, TimelineData> = {};
	for (const [id, tl] of Object.entries(model.timelines))
		timelines[id] = {
			...tl,
			layers: tl.layers.map(layer),
			camera: tl.camera?.map((c) => {
				if (!c.tint?.percent) return c;
				// a tint mixes in its colour: the graded colour then
				const [r, g, b] = grade.rgb(c.tint.red / 255, c.tint.green / 255, c.tint.blue / 255);
				return { ...c, tint: { percent: c.tint.percent, red: Math.round(r * 255), green: Math.round(g * 255), blue: Math.round(b * 255) } };
			}),
		};
	return { ...model, doc: { ...model.doc, backgroundColor: grade.hex(model.doc.backgroundColor) }, timelines };
}

/**
 * A gradient glow's or bevel's colours graded: the colour between two stops is interpolated
 * first, so the ramp gets stops where the writers read it besides its own (SVG: 17 even places,
 * filters.ts gradientTables; Lottie: 0, ½ and 1).
 */
function gradeGradientFilter(f: FilterData, grade: Grade): { colorArray: string[]; posArray: number[] } {
	const colors = (f.colorArray as unknown[]).map((c) => (typeof c === "number" ? "#" + (c >>> 0).toString(16).padStart(6, "0").slice(-6) + "FF" : String(c)));
	const pos = (Array.isArray(f.posArray) ? (f.posArray as number[]) : colors.map((_, i) => (i / Math.max(1, colors.length - 1)) * 255)).map(Number);
	const stops = colors.map((c, i) => {
		const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
		return { rgb: hexRgb(m ? m[1]! : "000000"), a: m?.[2] ? parseInt(m[2], 16) / 255 : 1, pos: pos[i] ?? 0 };
	});
	// every stop of its own (two at one place are a hard edge and stay one), and the places the
	// writers read between them, interpolated in the stretch they fall in
	const ramp: { pos: number; rgb: RGB; a: number }[] = stops.map((s) => ({ ...s }));
	for (let k = 0; k <= 16; k++) {
		const p = (k * 255) / 16;
		if (stops.some((s) => Math.abs(s.pos - p) < 1e-9)) continue;
		let i = -1;
		while (i + 1 < stops.length && stops[i + 1]!.pos < p) i++;
		const a = stops[Math.max(0, i)]!,
			b = stops[Math.min(i + 1, stops.length - 1)]!;
		const u = b.pos > a.pos ? clamp01((p - a.pos) / (b.pos - a.pos)) : 0;
		ramp.push({ pos: p, rgb: [0, 1, 2].map((c) => a.rgb[c]! + (b.rgb[c]! - a.rgb[c]!) * u) as RGB, a: a.a + (b.a - a.a) * u });
	}
	// (a stable sort: stops at one place keep their order)
	ramp.sort((x, y) => x.pos - y.pos);
	return {
		colorArray: ramp.map((s) => rgbHex(grade.rgb(s.rgb[0], s.rgb[1], s.rgb[2])) + hex2(s.a).toUpperCase()),
		posArray: ramp.map((s) => s.pos),
	};
}

/**
 * A LUT file from its bytes: .cube and .3dl as text, .png as a Hald CLUT (decoded by the host's
 * PNG decoder, see Codecs.decodePng in images.ts).
 */
export async function loadLut(
	name: string,
	bytes: Uint8Array,
	decodePng?: (png: Uint8Array) => Promise<{ data: Uint8Array | Uint8ClampedArray; width: number; height: number }>,
): Promise<Lut> {
	if (/\.png$/i.test(name)) {
		if (!decodePng) throw new Error(`${name}: Hald CLUT images need the image codecs`);
		return haldLut(await decodePng(bytes), name);
	}
	return parseLut(new TextDecoder().decode(bytes), name);
}
