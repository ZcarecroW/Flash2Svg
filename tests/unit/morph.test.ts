import { describe, expect, it } from "vitest";
import { importArtwork, type Artwork } from "../../src/core/artwork.ts";
import { buildMorph, channelNumbers, channelText, internals, parsePath, type Morph } from "../../src/core/morph.ts";
import type { Track } from "../../src/core/tracks.ts";

/** A closed contour: points P0..Pn-1 and control points C0..Cn-1 (segment k: Pk -> Pk+1). */
type Contour = { p: number[][]; c: number[][] };

const lerp = (a: number[][], b: number[][], r: number) => a.map((p, i) => p.map((v, j) => v + (b[i]![j]! - v) * r));
const blend = (a: Contour, b: Contour, r: number): Contour => ({ p: lerp(a.p, b.p, r), c: lerp(a.c, b.c, r) });
/** Animate writes twips: 0.05 px steps. */
const q = (v: number) => Math.round(v * 20) / 20;

/** Path data the way Animate's exporter writes a contour: from point `start`, lines where straight, edges shorter than a twip left out. */
function pathOf(ct: Contour, start = 0, reverse = false): string {
	const n = ct.p.length;
	const pts: number[][] = [],
		ctl: number[][] = [];
	for (let m = 0; m < n; m++) {
		if (!reverse) {
			pts.push(ct.p[(start + m) % n]!);
			ctl.push(ct.c[(start + m) % n]!);
		} else {
			pts.push(ct.p[(((start - m) % n) + n) % n]!);
			ctl.push(ct.c[(((start - m - 1) % n) + n) % n]!);
		}
	}
	let d = `M ${q(pts[0]![0]!)} ${q(pts[0]![1]!)}`;
	for (let m = 0; m < n; m++) {
		const a = pts[m]!,
			b = pts[(m + 1) % n]!,
			c = ctl[m]!;
		if (Math.hypot(q(b[0]!) - q(a[0]!), q(b[1]!) - q(a[1]!)) < 0.01) continue;
		const straight = Math.abs(c[0]! - (a[0]! + b[0]!) / 2) < 0.01 && Math.abs(c[1]! - (a[1]! + b[1]!) / 2) < 0.01;
		d += straight ? ` L ${q(b[0]!)} ${q(b[1]!)}` : ` Q ${q(c[0]!)} ${q(c[1]!)} ${q(b[0]!)} ${q(b[1]!)}`;
	}
	return d + " Z";
}

const hex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
let ids = 0;
function art(body: string, defs = ""): Artwork {
	return importArtwork(`<svg xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`, `t${ids++}`, { digits: 2 });
}
const linear = (n: number): Track => [
	{ t: 0, v: 0, ease: "linear" },
	{ t: n, v: 1, ease: "hold" },
];

/** A square (straight edges, some split) into a curved diamond. */
const square: Contour = {
	p: [[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]],
	c: [[25, 0], [75, 0], [100, 50], [50, 100], [0, 50]],
};
const diamond: Contour = {
	p: [[50, -20], [90, 10], [120, 50], [50, 120], [-20, 50]],
	c: [[75, -10], [110, 25], [95, 95], [5, 95], [10, 10]],
};

/** Each frame's drawing as Animate writes it, with its own start point and direction. */
function frames(n: number, ratios: number[], color = true) {
	return Array.from({ length: n }, (_, k) => {
		const ct = blend(square, diamond, ratios[k]!);
		const fill = color ? hex([255 - 200 * ratios[k]!, 100, 50 + 200 * ratios[k]!]) : "#336699";
		return art(`<path fill="${fill}" d="${pathOf(ct, k % 5, k === 3)}"/>`);
	});
}

/** The morph's path at frame k, as numbers, with the path Animate wrote for that frame. */
function check(m: Morph, arts: Artwork[], ratios: number[]) {
	for (const p of m.parts)
		for (let k = p.from; k < p.to; k++) {
			const ch = p.channels.find((c) => c.kind === "d")!;
			const r = p.ratio ? valueAtTrack(p.ratio, k) : ratios[k]!;
			const d = channelText(ch, channelNumbers(ch, r, k - p.from), 2);
			let want = "";
			const walk = (x: Artwork["body"]) => {
				if (x.name === "path") want = x.attrs.d!;
				for (const c of x.children) if (typeof c !== "string") walk(c);
			};
			walk(arts[k]!.body);
			expect(internals.outlineDistance(parsePath(d)!, parsePath(want)!, 1), `frame ${k}`).toBeLessThan(0.08);
		}
}
function valueAtTrack(t: Track, x: number): number {
	for (let i = 0; i + 1 < t.length; i++) if (x < t[i + 1]!.t) return t[i]!.v + ((t[i + 1]!.v - t[i]!.v) * (x - t[i]!.t)) / (t[i + 1]!.t - t[i]!.t);
	return t[t.length - 1]!.v;
}

describe("path data", () => {
	it("reads lines as curves with the control point in the middle, and closes contours", () => {
		const [a, b] = parsePath("M0 0L10 0Q10 10 0 10Z M20 20 L30 20 L20 20")!;
		expect(a!.cyclic).toBe(true);
		// the closing line is written out: three segments
		expect(a!.pts).toEqual([0, 0, 5, 0, 10, 0, 10, 10, 0, 10, 0, 5]);
		// back at its start without Z: cyclic too
		expect(b!.cyclic).toBe(true);
		expect(parsePath("M0 0C1 1 2 2 3 3")).toBeNull();
		expect(parsePath("m0 0l1 1")).toBeNull();
	});

	it("puts edges that shrank to nothing back where they were", () => {
		// ref: 4 segments, the second of no length in cur
		const ref = [0, 0, 5, 0, 10, 0, 10, 0, 10, 0, 10, 5, 10, 10, 5, 5];
		const cur = [0, 0, 5, 0, 10, 0, 10, 5, 10, 10, 5, 5];
		const r = internals.insertEdges(ref, cur);
		expect(r.cost).toBeLessThan(1e-9);
		expect(r.pts).toEqual(ref);
	});
});

describe("shape tweens as morphs", () => {
	it("blends every frame from one drawing, however Animate started and turned each contour", () => {
		const n = 12;
		const ratios = Array.from({ length: n }, (_, k) => k / n);
		const arts = frames(n, ratios);
		const m = buildMorph(arts, ratios, linear(n), 0, 2)!;
		expect(m.parts).toHaveLength(1);
		expect(m.parts[0]!).toMatchObject({ from: 0, to: n, smil: true });
		expect(m.parts[0]!.ratio).toBeUndefined();
		check(m, arts, ratios);
		// the fill follows the ratio: two values, no list per frame
		const fill = m.parts[0]!.channels.find((c) => c.attr === "fill")!;
		expect(fill.f).toBeUndefined();
		expect(channelText(fill, channelNumbers(fill, 0.5, 0), 2)).toBe("#9b6496");
	});

	it("keeps up when Animate leaves out an edge that is growing from nothing", () => {
		// the square's split point grows into an edge of the diamond
		const sq: Contour = { p: [[0, 0], [100, 0], [100, 0], [100, 100], [0, 100]], c: [[50, 0], [100, 0], [100, 50], [50, 100], [0, 50]] };
		const n = 20;
		const ratios = Array.from({ length: n }, (_, k) => (k / n) ** 3);
		const arts = Array.from({ length: n }, (_, k) => art(`<path fill="#336699" d="${pathOf(blend(sq, diamond, ratios[k]!), k % 3)}"/>`));
		const counts = arts.map((a) => parsePath((a.body as { attrs: Record<string, string> }).attrs.d!)![0]!.pts.length / 4);
		expect(Math.min(...counts)).toBeLessThan(Math.max(...counts));
		const m = buildMorph(arts, ratios, linear(n), 0, 2)!;
		expect(m.parts.map((p) => [p.from, p.to])).toEqual([[0, n]]);
		check(m, arts, ratios);
	});

	it("follows points that move further in a frame than they are apart, and points that coincide", () => {
		// a star whose every 10th point sits in the centre turns into a circle turned by 0.6 rad
		const N = 120,
			n = 30;
		const a: Contour = { p: [], c: [] },
			b: Contour = { p: [], c: [] };
		for (let i = 0; i < N; i++) {
			const t = (i / N) * Math.PI * 2,
				rs = i % 10 === 0 ? 0 : i % 2 ? 80 : 120;
			a.p.push([300 + Math.cos(t) * rs, 300 + Math.sin(t) * rs]);
			b.p.push([350 + Math.cos(t + 0.6) * 150, 280 + Math.sin(t + 0.6) * 150]);
		}
		for (const ct of [a, b]) ct.c = ct.p.map((p, i) => [(p[0]! + ct.p[(i + 1) % N]![0]!) / 2 + 1, (p[1]! + ct.p[(i + 1) % N]![1]!) / 2]);
		const ratios = Array.from({ length: n }, (_, k) => (k / n) ** 2);
		const arts = ratios.map((r, k) => art(`<path fill="#336699" d="${pathOf(blend(a, b, r), (k * 7) % N)}"/>`));
		const m = buildMorph(arts, ratios, linear(n), 0, 2)!;
		expect(m.parts.map((p) => [p.from, p.to])).toEqual([[0, n]]);
		check(m, arts, ratios);
	});

	it("finds each frame's ratio from the shapes when they follow another ease", () => {
		const n = 16;
		const actual = Array.from({ length: n }, (_, k) => Math.sin((k / n) * (Math.PI / 2)));
		const arts = frames(n, actual, false);
		const told = Array.from({ length: n }, (_, k) => k / n);
		const m = buildMorph(arts, told, linear(n), 0, 2)!;
		expect(m.parts).toHaveLength(1);
		expect(m.parts[0]!.ratio).toBeDefined();
		check(m, arts, actual);
	});

	it("never blends frames that aren't a blend", () => {
		const n = 12;
		const ratios = Array.from({ length: n }, (_, k) => k / n);
		const arts = frames(n, ratios);
		// frames 4..7 drawn 3 px off
		for (let k = 4; k < 8; k++) {
			const ct = blend(square, diamond, ratios[k]!);
			ct.p[2] = [ct.p[2]![0]! + 3 * Math.sin(k), ct.p[2]![1]!];
			arts[k] = art(`<path fill="#336699" d="${pathOf(ct)}"/>`);
		}
		const m = buildMorph(arts, ratios, linear(n), 0, 2);
		for (const p of m?.parts ?? []) for (let k = 4; k < 8; k++) expect(k >= p.from && k < p.to, `frame ${k} in [${p.from},${p.to})`).toBe(false);
	});

	it("starts at the keyframe when it shows the start shape with fewer edges", () => {
		const n = 10;
		const ratios = Array.from({ length: n }, (_, k) => k / n);
		const arts = frames(n, ratios);
		// the keyframe: the square as Animate draws it, four lines
		arts[0] = art(`<path fill="#ff6432" d="M 0 0 L 100 0 L 100 100 L 0 100 Z"/>`);
		const m = buildMorph(arts, ratios, linear(n), 0, 2)!;
		expect(m.parts[0]!.from).toBe(0);
		// not if it shows something else
		arts[0] = art(`<path fill="#ff6432" d="M 0 0 L 100 0 L 100 90 L 0 100 Z"/>`);
		expect(buildMorph(arts, ratios, linear(n), 0, 2)!.parts[0]!.from).toBe(1);
	});

	it("tells holes from their outline (same centre)", () => {
		const n = 8;
		const ratios = Array.from({ length: n }, (_, k) => k / n);
		const shrink = (ct: Contour, s: number): Contour => ({ p: ct.p.map(([x, y]) => [50 + (x! - 50) * s, 50 + (y! - 50) * s]), c: ct.c.map(([x, y]) => [50 + (x! - 50) * s, 50 + (y! - 50) * s]) });
		const ring = (r: number, k: number) => {
			const outer = blend(square, diamond, r);
			const hole = blend(shrink(square, 0.3), shrink(diamond, 0.5), r);
			const [a, b] = k % 2 ? [pathOf(hole, k % 5, true), pathOf(outer, 2)] : [pathOf(outer), pathOf(hole, 1, true)];
			return art(`<path fill="#336699" d="${a} ${b}"/>`);
		};
		const arts = Array.from({ length: n }, (_, k) => ring(ratios[k]!, k));
		const m = buildMorph(arts, ratios, linear(n), 0, 2)!;
		expect(m.parts.map((p) => [p.from, p.to])).toEqual([[0, n]]);
	});

	it("blends radial gradients in a form that is linear (radius 1, the size in the matrix)", () => {
		const n = 8;
		const ratios = Array.from({ length: n }, (_, k) => k / n);
		const arts = ratios.map((r) => {
			// Animate: the x scale as the radius, the matrix divided by it
			const a = 0.05 + 0.03 * r,
				d = 0.05 - 0.01 * r;
			const grad = `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${a * 819.2}" fx="0" fy="0" gradientTransform="matrix(1 0 0 ${d / a} ${70 + 90 * r} 290)"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#0033cc"/></radialGradient>`;
			return art(`<path fill="url(#g)" d="${pathOf(blend(square, diamond, r))}"/>`, grad);
		});
		const m = buildMorph(arts, ratios, linear(n), 0, 2)!;
		const p = m.parts[0]!;
		expect([p.from, p.to, p.smil]).toEqual([0, n, true]);
		const r = p.channels.find((c) => c.attr === "r")!;
		expect(channelNumbers(r, 0.5, 0)).toEqual([1]);
		const t = p.channels.find((c) => c.attr === "gradientTransform")!;
		expect(t.s).toBeDefined();
		const mid = channelNumbers(t, 0.5, 0);
		expect(mid[0]).toBeCloseTo(0.065 * 819.2, 1);
		expect(mid[3]).toBeCloseTo(0.045 * 819.2, 1);
	});
});
